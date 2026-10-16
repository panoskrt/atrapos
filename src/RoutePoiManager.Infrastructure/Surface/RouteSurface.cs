using NetTopologySuite.Geometries;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Surface;

public enum RouteSurfaceType
{
    Asphalt,
    OffRoad,
    Path,
}

public sealed record RouteSurfaceAmount(double DistanceKm, double Percent);

public sealed record RouteSurfaceBreakdown(
    double TotalDistanceKm,
    RouteSurfaceAmount Asphalt,
    RouteSurfaceAmount OffRoad,
    RouteSurfaceAmount Path,
    double UnclassifiedDistanceKm,
    double UnclassifiedPercent);

public sealed record OsmWay(long Id, IReadOnlyDictionary<string, string> Tags, IReadOnlyList<(double Longitude, double Latitude)> Geometry);

public interface IOsmSurfaceProvider
{
    Task<IReadOnlyList<OsmWay>> GetWaysNearAsync(
        IReadOnlyList<(double Longitude, double Latitude)> points,
        CancellationToken ct);
}

public sealed class RouteSurfaceService(IOsmSurfaceProvider provider, IMemoryCache cache, ILogger<RouteSurfaceService> logger)
{
    private const double SampleSpacingM = 100;
    private const int MaxSamples = 500;
    private const double MatchRadiusM = 35;

    private static readonly HashSet<string> PathHighways = new(StringComparer.OrdinalIgnoreCase)
    {
        "path", "footway", "cycleway", "bridleway", "steps", "pedestrian",
    };

    private static readonly HashSet<string> AsphaltSurfaces = new(StringComparer.OrdinalIgnoreCase)
    {
        "asphalt", "paved", "concrete", "concrete:lanes", "concrete:plates", "paving_stones",
        "sett", "cobblestone", "metal", "wood", "bricks", "brick",
    };

    private static readonly HashSet<string> OffRoadSurfaces = new(StringComparer.OrdinalIgnoreCase)
    {
        "unpaved", "compacted", "fine_gravel", "gravel", "pebblestone", "ground", "dirt", "earth",
        "grass", "sand", "mud", "rock", "stone", "woodchips", "ice", "snow", "clay",
    };

    public async Task<RouteSurfaceBreakdown> GetBreakdownAsync(LineString? route, CancellationToken ct)
    {
        if (route is null || route.NumPoints < 2)
            throw new ArgumentException("The route must have at least two points.", nameof(route));

        var samples = SampleRoute(route);
        if (samples.Length == 0)
            throw new ArgumentException("The route does not contain valid geometry.", nameof(route));

        var key = CacheKey(route);
        if (cache.TryGetValue(key, out RouteSurfaceBreakdown? cached) && cached is not null)
            return cached;

        IReadOnlyList<OsmWay> ways;
        try
        {
            ways = await provider.GetWaysNearAsync(samples.Select(sample => sample.Point).ToArray(), ct);
        }
        catch (SurfaceDataUnavailableException ex)
        {
            logger.LogWarning(ex, "OpenStreetMap surface data lookup failed.");
            throw;
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "OpenStreetMap surface data lookup failed.");
            throw new SurfaceDataUnavailableException("OpenStreetMap surface data is temporarily unavailable.", ex);
        }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested)
        {
            logger.LogWarning(ex, "OpenStreetMap surface data lookup timed out.");
            throw new SurfaceDataUnavailableException("OpenStreetMap surface data lookup timed out.", ex);
        }
        catch (System.Text.Json.JsonException ex)
        {
            logger.LogWarning(ex, "OpenStreetMap returned invalid surface data.");
            throw new SurfaceDataUnavailableException("OpenStreetMap returned invalid surface data.", ex);
        }
        var totals = new Dictionary<RouteSurfaceType, double>
        {
            [RouteSurfaceType.Asphalt] = 0,
            [RouteSurfaceType.OffRoad] = 0,
            [RouteSurfaceType.Path] = 0,
        };
        var unclassified = 0d;

        foreach (var sample in samples)
        {
            var nearest = ways
                .Select(way => (Way: way, Distance: DistanceToWayM(sample.Point, way.Geometry)))
                .Where(candidate => candidate.Distance <= MatchRadiusM)
                .OrderBy(candidate => candidate.Distance)
                .FirstOrDefault();
            var type = nearest.Way is null ? null : Classify(nearest.Way.Tags);
            if (type is { } surface)
                totals[surface] += sample.DistanceM;
            else
                unclassified += sample.DistanceM;
        }

        var totalDistance = samples.Sum(sample => sample.DistanceM) / 1000;
        var breakdown = new RouteSurfaceBreakdown(
            totalDistance,
            Amount(RouteSurfaceType.Asphalt),
            Amount(RouteSurfaceType.OffRoad),
            Amount(RouteSurfaceType.Path),
            Math.Round(unclassified / 1000, 2),
            Percent(unclassified));
        cache.Set(key, breakdown, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(12),
        });
        return breakdown;

        RouteSurfaceAmount Amount(RouteSurfaceType surface)
        {
            var meters = totals[surface];
            return new RouteSurfaceAmount(Math.Round(meters / 1000, 2), Percent(meters));
        }

        double Percent(double meters) =>
            totalDistance == 0 ? 0 : Math.Round(meters / (totalDistance * 1000) * 100, 1);
    }

    private static string CacheKey(LineString route)
    {
        var coordinates = string.Join(';', route.Coordinates.Select(coordinate =>
            string.Create(CultureInfo.InvariantCulture, $"{coordinate.X:R},{coordinate.Y:R}")));
        return $"route-surface:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(coordinates)))}";
    }

    private static RouteSurfaceType? Classify(IReadOnlyDictionary<string, string> tags)
    {
        tags.TryGetValue("highway", out var highway);
        if (highway is not null && PathHighways.Contains(highway))
            return RouteSurfaceType.Path;

        tags.TryGetValue("surface", out var surface);
        if (surface is not null && AsphaltSurfaces.Contains(surface))
            return RouteSurfaceType.Asphalt;
        if (surface is not null && OffRoadSurfaces.Contains(surface))
            return RouteSurfaceType.OffRoad;
        if (string.Equals(highway, "track", StringComparison.OrdinalIgnoreCase))
            return RouteSurfaceType.OffRoad;
        return null;
    }

    private static double DistanceToWayM(
        (double Longitude, double Latitude) point,
        IReadOnlyList<(double Longitude, double Latitude)> geometry)
    {
        var nearest = double.PositiveInfinity;
        for (var i = 1; i < geometry.Count; i++)
        {
            var a = ToLocalMeters(point, geometry[i - 1]);
            var b = ToLocalMeters(point, geometry[i]);
            var dx = b.X - a.X;
            var dy = b.Y - a.Y;
            var lengthSquared = dx * dx + dy * dy;
            var ratio = lengthSquared == 0
                ? 0
                : Math.Clamp(-(a.X * dx + a.Y * dy) / lengthSquared, 0, 1);
            nearest = Math.Min(nearest, Math.Sqrt(Math.Pow(a.X + dx * ratio, 2) + Math.Pow(a.Y + dy * ratio, 2)));
        }
        return nearest;

        (double X, double Y) ToLocalMeters(
            (double Longitude, double Latitude) origin,
            (double Longitude, double Latitude) coordinate)
        {
            var cosLatitude = Math.Cos(origin.Latitude * Math.PI / 180);
            return (
                (coordinate.Longitude - origin.Longitude) * 111_320 * cosLatitude,
                (coordinate.Latitude - origin.Latitude) * 110_574);
        }
    }

    private static ( (double Longitude, double Latitude) Point, double DistanceM)[] SampleRoute(LineString route)
    {
        var coordinates = route.Coordinates;
        if (coordinates.Length < 2 || coordinates.Any(c =>
                !double.IsFinite(c.X) || !double.IsFinite(c.Y) ||
                c.X is < -180 or > 180 || c.Y is < -90 or > 90))
            return [];

        var lengths = new double[coordinates.Length - 1];
        var total = 0d;
        for (var i = 0; i < lengths.Length; i++)
        {
            lengths[i] = Geo.DistanceM(
                new GeoPosition(coordinates[i].X, coordinates[i].Y),
                new GeoPosition(coordinates[i + 1].X, coordinates[i + 1].Y));
            total += lengths[i];
        }
        if (total <= 0)
            return [];

        var count = Math.Min(MaxSamples, Math.Max(1, (int)Math.Ceiling(total / SampleSpacingM)));
        var spacing = total / count;
        var samples = new ((double Longitude, double Latitude) Point, double DistanceM)[count];
        var segment = 0;
        var traveled = 0d;
        for (var i = 0; i < count; i++)
        {
            var target = spacing * (i + 0.5);
            while (segment < lengths.Length - 1 && traveled + lengths[segment] < target)
            {
                traveled += lengths[segment];
                segment++;
            }
            var ratio = lengths[segment] == 0 ? 0 : (target - traveled) / lengths[segment];
            var from = coordinates[segment];
            var to = coordinates[segment + 1];
            samples[i] = (
                (from.X + (to.X - from.X) * ratio, from.Y + (to.Y - from.Y) * ratio),
                spacing);
        }
        return samples;
    }
}
