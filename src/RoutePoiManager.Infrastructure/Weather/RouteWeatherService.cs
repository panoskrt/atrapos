using NetTopologySuite.Geometries;
using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Weather;

public sealed class RouteWeatherService(IWeatherProvider provider)
{
    public const int ForecastDays = 7;

    public async Task<RouteWeather> GetForecastAsync(LineString? route, CancellationToken ct)
    {
        if (route is null || route.NumPoints < 2)
            return new RouteWeather(false, "Save a route with at least two points to see its forecast.", null, []);

        var samples = SampleRoute(route);
        if (samples.Length == 0)
            return new RouteWeather(false, "This route does not have enough valid geometry for a forecast.", null, []);

        IReadOnlyList<WeatherDay>[] forecasts;
        string timeZoneId;
        try
        {
            var midpoint = samples[1];
            timeZoneId = await provider.GetTimeZoneIdAsync(midpoint.Latitude, midpoint.Longitude, ct);
            forecasts = await Task.WhenAll(samples.Select(p =>
                provider.GetForecastAsync(p.Latitude, p.Longitude, timeZoneId, ct)));
        }
        catch (WeatherForecastUnavailableException ex)
        {
            return new RouteWeather(false, ex.Message, null, []);
        }
        if (forecasts.Any(f => f.Count != ForecastDays || f.Any(day => day.Hours.Count == 0)))
            throw new HttpRequestException("The weather provider returned an incomplete forecast.");

        var combined = Enumerable.Range(0, ForecastDays).Select(day =>
        {
            var weather = forecasts.Select(f => f[day]).ToArray();
            return new WeatherDay(
                weather[0].Date,
                weather.MaxBy(w => Severity(w.WeatherCode))!.WeatherCode,
                weather.Min(w => w.MinTemperatureC),
                weather.Max(w => w.MaxTemperatureC),
                weather.Max(w => w.PrecipitationProbabilityPercent),
                weather.Max(w => w.WindSpeedKmh),
                AggregateHours(weather.SelectMany(w => w.Hours).GroupBy(hour => hour.Time)));
        }).ToArray();

        return new RouteWeather(true, null, timeZoneId, combined);
    }

    private static WeatherHour[] AggregateHours(IEnumerable<IGrouping<DateTimeOffset, WeatherHour>> grouped) =>
        grouped.OrderBy(group => group.Key)
            .Select(group =>
            {
                var hours = group.ToArray();
                return new WeatherHour(
                    group.Key,
                    hours.MaxBy(hour => Severity(hour.WeatherCode))!.WeatherCode,
                    hours.Min(hour => hour.MinTemperatureC),
                    hours.Max(hour => hour.MaxTemperatureC),
                    hours.Max(hour => hour.PrecipitationProbabilityPercent),
                    hours.Max(hour => hour.WindSpeedKmh));
            })
            .ToArray();

    internal static (double Latitude, double Longitude)[] SampleRoute(LineString route)
    {
        var coordinates = route.Coordinates;
        if (coordinates.Length < 2 || coordinates.Any(c => !Geo.IsValid(c.X, c.Y)))
            return [];

        var lengths = new double[coordinates.Length - 1];
        var total = 0d;
        for (var i = 0; i < lengths.Length; i++)
        {
            lengths[i] = Distance(coordinates[i], coordinates[i + 1]);
            total += lengths[i];
        }
        if (total <= 0)
            return [];

        return [At(0), At(0.5), At(1)];

        (double Latitude, double Longitude) At(double fraction)
        {
            var target = total * fraction;
            var traveled = 0d;
            for (var i = 0; i < lengths.Length; i++)
            {
                if (target <= traveled + lengths[i] || i == lengths.Length - 1)
                {
                    var ratio = lengths[i] == 0 ? 0 : (target - traveled) / lengths[i];
                    var a = coordinates[i];
                    var b = coordinates[i + 1];
                    var deltaLon = b.X - a.X;
                    if (deltaLon > 180) deltaLon -= 360;
                    if (deltaLon < -180) deltaLon += 360;
                    var lon = (a.X + deltaLon * ratio + 540) % 360 - 180;
                    return (a.Y + (b.Y - a.Y) * ratio, lon);
                }
                traveled += lengths[i];
            }
            return (coordinates[^1].Y, coordinates[^1].X);
        }
    }

    private static double Distance(Coordinate a, Coordinate b)
    {
        const double earthRadiusM = 6_371_000;
        var lat1 = a.Y * Math.PI / 180;
        var lat2 = b.Y * Math.PI / 180;
        var dLat = lat2 - lat1;
        var dLon = (b.X - a.X) * Math.PI / 180;
        if (dLon > Math.PI) dLon -= 2 * Math.PI;
        if (dLon < -Math.PI) dLon += 2 * Math.PI;
        var h = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(lat1) * Math.Cos(lat2) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * earthRadiusM * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    private static int Severity(int code) => code switch
    {
        95 or 96 or 99 => 7,
        66 or 67 or 71 or 73 or 75 or 77 or 85 or 86 => 6,
        56 or 57 or 61 or 63 or 65 or 80 or 81 or 82 => 5,
        51 or 53 or 55 => 4,
        45 or 48 => 3,
        3 => 2,
        2 => 1,
        _ => 0,
    };
}
