using System.Net;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using RoutePoiManager.Infrastructure.Weather;

namespace RoutePoiManager.UnitTests;

public sealed class WeatherServiceTests
{
    private static readonly DateOnly FirstDay = new(2026, 10, 16);

    [Fact]
    public async Task Samples_start_midpoint_and_end_then_aggregates_daily_route_conditions()
    {
        var provider = new RecordingProvider();
        var route = new NetTopologySuite.Geometries.GeometryFactory().CreateLineString(
        [
            new(24.0, 60.0),
            new(24.1, 60.0),
            new(24.3, 60.0),
        ]);
        var service = new RouteWeatherService(provider);

        var result = await service.GetForecastAsync(route, CancellationToken.None);

        Assert.True(result.Available);
        Assert.Equal("Europe/Helsinki", result.TimeZoneId);
        Assert.Equal(7, result.Forecast.Count);
        Assert.Equal(3, provider.Points.Count);
        Assert.Equal(24.0, provider.Points[0].Longitude, 3);
        Assert.Equal(24.15, provider.Points[1].Longitude, 3);
        Assert.Equal(24.3, provider.Points[2].Longitude, 3);
        Assert.Equal(6, result.Forecast[0].MinTemperatureC);
        Assert.Equal(15, result.Forecast[0].MaxTemperatureC);
        Assert.Equal(60, result.Forecast[0].PrecipitationProbabilityPercent);
        Assert.Equal(30, result.Forecast[0].WindSpeedKmh);
        Assert.Equal(95, result.Forecast[0].WeatherCode);
        Assert.Equal(8, result.Forecast[0].Hours.Count);
        Assert.Equal(6, result.Forecast[0].Hours[0].MinTemperatureC);
        Assert.Equal(8, result.Forecast[0].Hours[0].MaxTemperatureC);
        Assert.Equal(TimeSpan.FromHours(3), result.Forecast[0].Hours[1].Time - result.Forecast[0].Hours[0].Time);
        Assert.Equal(60, result.Forecast[0].Hours[0].PrecipitationProbabilityPercent);
        Assert.Equal(30, result.Forecast[0].Hours[0].WindSpeedKmh);
        Assert.Equal(95, result.Forecast[0].Hours[0].WeatherCode);
    }

    [Fact]
    public async Task Returns_unavailable_for_missing_or_invalid_route_geometry()
    {
        var provider = new RecordingProvider();
        var service = new RouteWeatherService(provider);
        var missing = await service.GetForecastAsync(null, CancellationToken.None);
        var invalid = await service.GetForecastAsync(
            new NetTopologySuite.Geometries.GeometryFactory().CreateLineString(
            [
                new(double.NaN, 60.0),
                new(24.1, 60.0),
            ]),
            CancellationToken.None);

        Assert.False(missing.Available);
        Assert.False(invalid.Available);
        Assert.Empty(missing.Forecast);
        Assert.Empty(invalid.Forecast);
        Assert.Empty(provider.Points);
    }

    [Fact]
    public async Task Returns_unavailable_when_weather_provider_has_no_coverage()
    {
        var provider = new RecordingProvider { Unavailable = true };
        var route = new NetTopologySuite.Geometries.GeometryFactory().CreateLineString(
            [new(24.0, 60.0), new(24.1, 60.0)]);
        var result = await new RouteWeatherService(provider).GetForecastAsync(route, CancellationToken.None);

        Assert.False(result.Available);
        Assert.Contains("no forecast", result.Reason, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(result.Forecast);
    }

    [Fact]
    public async Task Open_meteo_provider_maps_and_caches_seven_daily_values()
    {
        var handler = new RecordingHandler();
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.open-meteo.com/") };
        var provider = new OpenMeteoWeatherProvider(http, cache);

        var timeZoneId = await provider.GetTimeZoneIdAsync(60.30001, 24.50001, CancellationToken.None);
        var first = await provider.GetForecastAsync(60.30001, 24.50001, timeZoneId, CancellationToken.None);
        var nearby = await provider.GetForecastAsync(60.30002, 24.50002, timeZoneId, CancellationToken.None);

        Assert.Equal("Europe/Helsinki", timeZoneId);
        Assert.Equal(7, first.Count);
        Assert.Equal(new DateOnly(2026, 10, 16), first[0].Date);
        Assert.Equal(1.5, first[0].MinTemperatureC);
        Assert.Equal(8, first[0].Hours.Count);
        Assert.Equal(new DateTimeOffset(2026, 10, 15, 21, 0, 0, TimeSpan.Zero), first[0].Hours[0].Time);
        Assert.Equal(2, handler.Calls);
        Assert.Equal(first, nearby);
        Assert.Contains("latitude=60.300&longitude=24.500", handler.RequestedUrl, StringComparison.Ordinal);
        Assert.Contains("forecast_days=7", handler.RequestedUrl, StringComparison.Ordinal);
        Assert.Contains("timezone=Europe%2FHelsinki", handler.RequestedUrl, StringComparison.Ordinal);
        Assert.Contains("timeformat=unixtime", handler.RequestedUrl, StringComparison.Ordinal);
        Assert.Contains("hourly=temperature_2m", handler.RequestedUrl, StringComparison.Ordinal);
        Assert.Contains("wind_speed_unit=kmh", handler.RequestedUrl, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Open_meteo_provider_rejects_incomplete_response()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var http = new HttpClient(new StringHandler("""{"daily":{"time":[1792098000]}}"""))
        {
            BaseAddress = new Uri("https://api.open-meteo.com/"),
        };
        var provider = new OpenMeteoWeatherProvider(http, cache);

        await Assert.ThrowsAsync<HttpRequestException>(() => provider.GetForecastAsync(60, 24, "Europe/Helsinki", CancellationToken.None));
    }

    [Fact]
    public async Task Open_meteo_provider_reports_unavailable_location()
    {
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var http = new HttpClient(new StringHandler("""{"error":true,"reason":"No data"}""", HttpStatusCode.BadRequest))
        {
            BaseAddress = new Uri("https://api.open-meteo.com/"),
        };
        var provider = new OpenMeteoWeatherProvider(http, cache);

        await Assert.ThrowsAsync<WeatherForecastUnavailableException>(() => provider.GetForecastAsync(60, 24, "Europe/Helsinki", CancellationToken.None));
    }

    private sealed class RecordingProvider : IWeatherProvider
    {
        public List<(double Latitude, double Longitude)> Points { get; } = [];
        public bool Unavailable { get; init; }

        public Task<string> GetTimeZoneIdAsync(double latitude, double longitude, CancellationToken ct) =>
            Task.FromResult("Europe/Helsinki");

        public Task<IReadOnlyList<WeatherDay>> GetForecastAsync(
            double latitude,
            double longitude,
            string timeZoneId,
            CancellationToken ct)
        {
            if (Unavailable) throw new WeatherForecastUnavailableException("The weather provider has no forecast available for this location.");
            Points.Add((latitude, longitude));
            var index = Points.Count;
            IReadOnlyList<WeatherDay> result = Enumerable.Range(0, 7)
                .Select(day =>
                {
                    var weatherCode = index == 3 ? 95 : 0;
                    var hours = Enumerable.Range(0, 8)
                        .Select(hour => new WeatherHour(
                            new DateTimeOffset(FirstDay.AddDays(day).ToDateTime(new TimeOnly(hour * 3, 0), DateTimeKind.Utc)),
                            weatherCode,
                            5 + index,
                            5 + index,
                            20 * index,
                            10 * index))
                        .ToArray();
                    return new WeatherDay(FirstDay.AddDays(day), weatherCode, 5 + index, 12 + index,
                        20 * index, 10 * index, hours);
                })
                .ToArray();
            return Task.FromResult(result);
        }
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string RequestedUrl { get; private set; } = "";

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            RequestedUrl = request.RequestUri!.ToString();
            var content = request.RequestUri!.Query.Contains("timezone=auto", StringComparison.Ordinal)
                ? """{"timezone":"Europe/Helsinki"}"""
                : ValidResponse;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(content, Encoding.UTF8, "application/json"),
            });
        }
    }

    private sealed class StringHandler(string json, HttpStatusCode statusCode = HttpStatusCode.OK) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            });
    }

    private static readonly TimeZoneInfo Helsinki = TimeZoneInfo.FindSystemTimeZoneById("Europe/Helsinki");
    private static readonly string ValidResponse = System.Text.Json.JsonSerializer.Serialize(new
    {
        timezone = "Europe/Helsinki",
        daily = new
        {
            time = Enumerable.Range(0, 7).Select(day => ToUnixSeconds(
                TimeZoneInfo.ConvertTimeToUtc(FirstDay.AddDays(day).ToDateTime(TimeOnly.MinValue), Helsinki))),
            weather_code = Enumerable.Repeat(3, 7),
            temperature_2m_min = Enumerable.Repeat(1.5, 7),
            temperature_2m_max = Enumerable.Repeat(8.0, 7),
            precipitation_probability_max = Enumerable.Repeat(20, 7),
            wind_speed_10m_max = Enumerable.Repeat(12, 7),
        },
        hourly = new
        {
            time = Enumerable.Range(0, 7 * 24).Select(hour => ToUnixSeconds(
                TimeZoneInfo.ConvertTimeToUtc(FirstDay.ToDateTime(TimeOnly.MinValue).AddHours(hour), Helsinki))),
            temperature_2m = Enumerable.Repeat(2.5, 7 * 24),
            weather_code = Enumerable.Repeat(3, 7 * 24),
            precipitation_probability = Enumerable.Repeat(25, 7 * 24),
            wind_speed_10m = Enumerable.Repeat(13, 7 * 24),
        },
    });

    private static long ToUnixSeconds(DateTime utc) => new DateTimeOffset(utc, TimeSpan.Zero).ToUnixTimeSeconds();
}
