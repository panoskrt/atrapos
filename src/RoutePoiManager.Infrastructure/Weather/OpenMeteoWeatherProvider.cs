using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;

namespace RoutePoiManager.Infrastructure.Weather;

public sealed class OpenMeteoWeatherProvider(HttpClient http, IMemoryCache cache) : IWeatherProvider
{
    public const string HttpClientName = "weather";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan TimeZoneCacheDuration = TimeSpan.FromDays(1);

    public async Task<string> GetTimeZoneIdAsync(double latitude, double longitude, CancellationToken ct)
    {
        var (lat, lon) = RoundCoordinates(latitude, longitude);
        var key = string.Create(CultureInfo.InvariantCulture, $"weather-timezone:{lat:F3},{lon:F3}");
        if (cache.TryGetValue(key, out string? cached) && cached is not null)
            return cached;

        var url = string.Create(CultureInfo.InvariantCulture,
            $"v1/forecast?latitude={lat:F3}&longitude={lon:F3}&current=temperature_2m&timezone=auto");
        using var response = await http.GetAsync(url, ct);
        if (response.StatusCode == HttpStatusCode.BadRequest)
        {
            var error = await response.Content.ReadFromJsonAsync<OpenMeteoResponse>(ct);
            if (error?.Error == true)
                throw new WeatherForecastUnavailableException("The weather provider has no forecast available for this location.");
        }
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<OpenMeteoResponse>(ct);
        if (string.IsNullOrWhiteSpace(body?.TimeZone))
            throw new HttpRequestException("Open-Meteo did not return a time zone for the route location.");

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(body.TimeZone);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            throw new HttpRequestException("Open-Meteo returned an unsupported time zone for the route location.", ex);
        }

        cache.Set(key, body.TimeZone, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = TimeZoneCacheDuration,
        });
        return body.TimeZone;
    }

    public async Task<IReadOnlyList<WeatherDay>> GetForecastAsync(
        double latitude,
        double longitude,
        string timeZoneId,
        CancellationToken ct)
    {
        var (lat, lon) = RoundCoordinates(latitude, longitude);
        var key = string.Create(CultureInfo.InvariantCulture, $"weather:{lat:F3},{lon:F3}:{timeZoneId}");
        if (cache.TryGetValue(key, out IReadOnlyList<WeatherDay>? cached) && cached is not null)
            return cached;

        var url = string.Create(CultureInfo.InvariantCulture,
            $"v1/forecast?latitude={lat:F3}&longitude={lon:F3}&daily=weather_code,temperature_2m_min,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max&hourly=temperature_2m,weather_code,precipitation_probability,wind_speed_10m&forecast_days=7&timezone={Uri.EscapeDataString(timeZoneId)}&timeformat=unixtime&temperature_unit=celsius&wind_speed_unit=kmh");
        using var httpResponse = await http.GetAsync(url, ct);
        if (httpResponse.StatusCode == HttpStatusCode.BadRequest)
        {
            var error = await httpResponse.Content.ReadFromJsonAsync<OpenMeteoResponse>(ct);
            if (error?.Error == true)
                throw new WeatherForecastUnavailableException("The weather provider has no forecast available for this location.");
        }
        httpResponse.EnsureSuccessStatusCode();
        var response = await httpResponse.Content.ReadFromJsonAsync<OpenMeteoResponse>(ct);
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        if (response?.Daily is not { } daily ||
            daily.Time is not { Count: 7 } ||
            daily.WeatherCode?.Count != 7 ||
            daily.MinTemperature?.Count != 7 ||
            daily.MaxTemperature?.Count != 7 ||
            daily.PrecipitationProbability?.Count != 7 ||
            daily.WindSpeed?.Count != 7 ||
            response.Hourly is not { } hourly ||
            hourly.Time is not { Count: > 0 } ||
            hourly.Temperature?.Count != hourly.Time.Count ||
            hourly.WeatherCode?.Count != hourly.Time.Count ||
            hourly.PrecipitationProbability?.Count != hourly.Time.Count ||
            hourly.WindSpeed?.Count != hourly.Time.Count)
            throw new HttpRequestException("Open-Meteo returned an incomplete forecast.");

        var forecast = Enumerable.Range(0, 7).Select(i =>
        {
            var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(daily.Time[i]), timeZone).DateTime);
            var hours = Enumerable.Range(0, hourly.Time.Count)
                .Where(hourIndex =>
                {
                    var time = TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(hourly.Time[hourIndex]), timeZone);
                    return DateOnly.FromDateTime(time.DateTime) == date && time.Hour % 3 == 0;
                })
                .Select(hourIndex => new WeatherHour(
                    DateTimeOffset.FromUnixTimeSeconds(hourly.Time[hourIndex]),
                    hourly.WeatherCode[hourIndex],
                    hourly.Temperature[hourIndex],
                    hourly.Temperature[hourIndex],
                    hourly.PrecipitationProbability[hourIndex],
                    hourly.WindSpeed[hourIndex]))
                .ToArray();
            if (hours.Length == 0)
                throw new HttpRequestException($"Open-Meteo returned no three-hour forecast slots for {date:yyyy-MM-dd}.");

            return new WeatherDay(
                date,
                daily.WeatherCode[i],
                daily.MinTemperature[i],
                daily.MaxTemperature[i],
                daily.PrecipitationProbability[i],
                daily.WindSpeed[i],
                hours);
        }).ToArray();
        cache.Set(key, forecast, new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = CacheDuration });
        return forecast;
    }

    private static (double Latitude, double Longitude) RoundCoordinates(double latitude, double longitude) =>
        (Math.Round(latitude, 3), Math.Round(longitude, 3));

    private sealed record OpenMeteoResponse(
        [property: JsonPropertyName("timezone")] string? TimeZone,
        [property: JsonPropertyName("daily")] DailyResponse? Daily,
        [property: JsonPropertyName("hourly")] HourlyResponse? Hourly,
        [property: JsonPropertyName("error")] bool? Error);

    private sealed record DailyResponse(
        [property: JsonPropertyName("time")] List<long>? Time,
        [property: JsonPropertyName("weather_code")] List<int>? WeatherCode,
        [property: JsonPropertyName("temperature_2m_min")] List<double>? MinTemperature,
        [property: JsonPropertyName("temperature_2m_max")] List<double>? MaxTemperature,
        [property: JsonPropertyName("precipitation_probability_max")] List<double>? PrecipitationProbability,
        [property: JsonPropertyName("wind_speed_10m_max")] List<double>? WindSpeed);

    private sealed record HourlyResponse(
        [property: JsonPropertyName("time")] List<long>? Time,
        [property: JsonPropertyName("temperature_2m")] List<double>? Temperature,
        [property: JsonPropertyName("weather_code")] List<int>? WeatherCode,
        [property: JsonPropertyName("precipitation_probability")] List<double>? PrecipitationProbability,
        [property: JsonPropertyName("wind_speed_10m")] List<double>? WindSpeed);
}
