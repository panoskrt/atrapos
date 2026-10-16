using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Http.HttpResults;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Weather;

namespace RoutePoiManager.Api.Routes;

/// <summary>Daily route-wide weather, aggregated from representative points along the saved route.</summary>
public sealed record RouteWeatherResponse(
    bool Available,
    string? Reason,
    string? TimeZoneId,
    IReadOnlyList<RouteWeatherDayResponse> Forecast);

/// <summary>A daily forecast with temperature range, maximum precipitation and wind, plus three-hour slots along the route.</summary>
public sealed record RouteWeatherDayResponse(
    DateOnly Date,
    int WeatherCode,
    double MinTemperatureC,
    double MaxTemperatureC,
    double PrecipitationProbabilityPercent,
    double WindSpeedKmh,
    IReadOnlyList<RouteWeatherHourResponse> Hours);

/// <summary>A three-hour forecast slot with route-wide temperature, precipitation, wind, and condition.</summary>
public sealed record RouteWeatherHourResponse(
    DateTimeOffset Time,
    int WeatherCode,
    double MinTemperatureC,
    double MaxTemperatureC,
    double PrecipitationProbabilityPercent,
    double WindSpeedKmh);

public static class WeatherEndpoints
{
    public static void MapWeatherEndpoints(this WebApplication app)
    {
        app.MapGet("/api/routes/{id:guid}/weather",
                async Task<Results<Ok<RouteWeatherResponse>, NotFound>> (
                    Guid id,
                    HttpContext http,
                    AppDbContext db,
                    RouteWeatherService weather,
                    CancellationToken ct) =>
                {
                    var userId = http.User.GetUserId();
                    var route = await db.Routes.AsNoTracking()
                        .Where(r => r.UserId == userId && r.Id == id)
                        .Select(r => new { r.Geometry })
                        .SingleOrDefaultAsync(ct);
                    if (route is null)
                        return TypedResults.NotFound();

                    var result = await weather.GetForecastAsync(route.Geometry, ct);
                    return TypedResults.Ok(new RouteWeatherResponse(
                        result.Available,
                        result.Reason,
                        result.TimeZoneId,
                        result.Forecast.Select(f => new RouteWeatherDayResponse(
                            f.Date,
                            f.WeatherCode,
                            f.MinTemperatureC,
                            f.MaxTemperatureC,
                            f.PrecipitationProbabilityPercent,
                            f.WindSpeedKmh,
                            f.Hours.Select(hour => new RouteWeatherHourResponse(
                                hour.Time,
                                hour.WeatherCode,
                                hour.MinTemperatureC,
                                hour.MaxTemperatureC,
                                hour.PrecipitationProbabilityPercent,
                                hour.WindSpeedKmh)).ToArray())).ToArray()));
                })
            .RequireAuthorization()
            .WithName("GetRouteWeather")
            .WithSummary("Get the forecast along a route")
            .WithDescription("Returns the next seven daily forecasts and three-hour slots, aggregated from the start, midpoint, and end of the saved route. Three-hour timestamps are UTC instants; use timeZoneId to display route-local time.")
            .Produces<RouteWeatherResponse>()
            .Produces(StatusCodes.Status404NotFound);
    }
}
