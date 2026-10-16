using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Weather;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class WeatherApiTests(PostgresFixture pg)
{
    [Fact]
    public async Task Weather_endpoint_returns_a_forecast_for_the_owners_saved_route()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, services =>
        {
            services.RemoveAll<IWeatherProvider>();
            services.AddSingleton<IWeatherProvider, FixedWeatherProvider>();
        });
        var http = await TestAuth.SignInAsync(api, suunto, "weather-owner");
        var route = await CreateSavedRoute(http);

        var response = await http.GetAsync($"/api/routes/{route.Id}/weather");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var forecast = await response.Content.ReadFromJsonAsync<RouteWeatherResponse>();
        Assert.True(forecast!.Available);
        Assert.Equal("Europe/Helsinki", forecast.TimeZoneId);
        Assert.Equal(7, forecast.Forecast.Count);
        Assert.Equal(5, forecast.Forecast[0].MinTemperatureC);
        Assert.Equal(20, forecast.Forecast[0].MaxTemperatureC);
        Assert.Equal(8, forecast.Forecast[0].Hours.Count);
    }

    [Fact]
    public async Task Weather_endpoint_does_not_expose_another_users_route()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, services =>
        {
            services.RemoveAll<IWeatherProvider>();
            services.AddSingleton<IWeatherProvider, FixedWeatherProvider>();
        });
        var owner = await TestAuth.SignInAsync(api, suunto, "weather-private-owner");
        var other = await TestAuth.SignInAsync(api, suunto, "weather-private-other");
        var route = await CreateSavedRoute(owner);

        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/routes/{route.Id}/weather")).StatusCode);
    }

    private static async Task<RouteDetailDto> CreateSavedRoute(HttpClient http)
    {
        var createdResponse = await http.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute());
        var created = (await createdResponse.Content.ReadFromJsonAsync<RouteDetailDto>())!;
        var update = RouteTestRequests.NewRoute() with
        {
            ControlPoints =
            [
                new(24.5, 60.3, SegmentMode.Freehand, [[24.5, 60.3, null], [24.51, 60.31, null]]),
                new(24.51, 60.31, SegmentMode.Freehand),
            ],
        };
        var savedResponse = await http.PutAsJsonAsync($"/api/routes/{created.Id}", update);
        return (await savedResponse.Content.ReadFromJsonAsync<RouteDetailDto>())!;
    }

    private sealed class FixedWeatherProvider : IWeatherProvider
    {
        public Task<string> GetTimeZoneIdAsync(double latitude, double longitude, CancellationToken ct) =>
            Task.FromResult("Europe/Helsinki");

        public Task<IReadOnlyList<WeatherDay>> GetForecastAsync(
            double latitude,
            double longitude,
            string timeZoneId,
            CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<WeatherDay>>(Enumerable.Range(0, 7)
                .Select(i =>
                {
                    var date = new DateOnly(2026, 10, 16).AddDays(i);
                    var hours = Enumerable.Range(0, 8)
                        .Select(hour => new WeatherHour(
                            new DateTimeOffset(date.ToDateTime(new TimeOnly(hour * 3, 0), DateTimeKind.Utc)),
                            0, 12, 12, 10, 12))
                        .ToArray();
                    return new WeatherDay(date, 0, 5, 20, 10, 12, hours);
                })
                .ToArray());
    }
}
