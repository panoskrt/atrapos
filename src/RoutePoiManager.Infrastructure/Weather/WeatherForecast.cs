namespace RoutePoiManager.Infrastructure.Weather;

public sealed record WeatherHour(
    DateTimeOffset Time,
    int WeatherCode,
    double MinTemperatureC,
    double MaxTemperatureC,
    double PrecipitationProbabilityPercent,
    double WindSpeedKmh);

public sealed record WeatherDay(DateOnly Date, int WeatherCode, double MinTemperatureC, double MaxTemperatureC,
    double PrecipitationProbabilityPercent, double WindSpeedKmh, IReadOnlyList<WeatherHour> Hours);

public sealed record RouteWeather(bool Available, string? Reason, string? TimeZoneId, IReadOnlyList<WeatherDay> Forecast);

public sealed class WeatherForecastUnavailableException(string message) : Exception(message);

public interface IWeatherProvider
{
    Task<string> GetTimeZoneIdAsync(double latitude, double longitude, CancellationToken ct);
    Task<IReadOnlyList<WeatherDay>> GetForecastAsync(double latitude, double longitude, string timeZoneId, CancellationToken ct);
}
