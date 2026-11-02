using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Elevation;

namespace RoutePoiManager.Infrastructure.Routing;

public sealed class RoutingOptions
{
    public const string Section = "Routing";

    /// <summary>BRouter endpoint. The public server is fair-use; point this at a self-hosted BRouter for heavy use.</summary>
    public string BaseUrl { get; set; } = "https://brouter.de/brouter";

    /// <summary>BRouter snaps each end to the nearest way however far it is. Beyond this distance the click
    /// clearly wasn't near a trail, so the segment counts as "no route".</summary>
    public double MaxSnapDistanceM { get; set; } = 300;

    /// <summary>Straight-line limit for one segment; longer ones are slow or rejected by BRouter.</summary>
    public double MaxSegmentLengthM { get; set; } = 150_000;

    /// <summary>Concurrent requests to BRouter (be gentle with the public server).</summary>
    public int MaxConcurrency { get; set; } = 2;
}

/// <summary>Routing is temporarily impossible (server down, timeout, unknown profile on the server).</summary>
public sealed class RoutingUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

public interface IRoutingProvider
{
    /// <summary>The routed line from <paramref name="from"/> to <paramref name="to"/>. An empty or one-point
    /// line means no route. Throws <see cref="RoutingUnavailableException"/> when the router can't answer.</summary>
    Task<IReadOnlyList<GeoPosition>> RouteAsync(GeoPosition from, GeoPosition to, string profile, CancellationToken ct);
}

public sealed class BRouterProvider(HttpClient http, IOptions<RoutingOptions> options) : IRoutingProvider
{
    public const string HttpClientName = "brouter";

    public async Task<IReadOnlyList<GeoPosition>> RouteAsync(GeoPosition from, GeoPosition to, string profile, CancellationToken ct)
    {
        var lonlats = string.Create(CultureInfo.InvariantCulture, $"{from.Lon:F6},{from.Lat:F6}|{to.Lon:F6},{to.Lat:F6}");
        var url = $"{options.Value.BaseUrl.TrimEnd('/')}?lonlats={Uri.EscapeDataString(lonlats)}" +
                  $"&profile={Uri.EscapeDataString(profile)}&alternativeidx=0&format=geojson";

        HttpResponseMessage res;
        try
        {
            res = await http.GetAsync(url, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new RoutingUnavailableException("The routing service didn't respond.", ex);
        }

        using (res)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                // BRouter reports "no route" style problems as 4xx/500 with a plain-text message.
                if (res.StatusCode is HttpStatusCode.BadRequest || body.Contains("not mapped", StringComparison.OrdinalIgnoreCase)
                    || body.Contains("no track found", StringComparison.OrdinalIgnoreCase))
                    return [];
                throw new RoutingUnavailableException($"Routing service error ({(int)res.StatusCode}).");
            }

            try
            {
                using var doc = JsonDocument.Parse(body);
                var coords = doc.RootElement.GetProperty("features")[0].GetProperty("geometry").GetProperty("coordinates");
                var line = new List<GeoPosition>(coords.GetArrayLength());
                foreach (var c in coords.EnumerateArray())
                {
                    var ele = c.GetArrayLength() > 2 ? c[2].GetDouble() : (double?)null;
                    line.Add(new GeoPosition(c[0].GetDouble(), c[1].GetDouble(), ele));
                }
                return line;
            }
            catch (Exception ex) when (ex is JsonException or KeyNotFoundException or IndexOutOfRangeException or InvalidOperationException)
            {
                throw new RoutingUnavailableException("Unexpected response from the routing service.", ex);
            }
        }
    }
}

public enum RoutingFailure
{
    /// <summary>No trail connects the points, or a point is too far from any trail.</summary>
    NoRoute,
    /// <summary>The points are too far apart for one segment.</summary>
    TooLong,
}

public sealed record RoutingResult(IReadOnlyList<GeoPosition>? Line, RoutingFailure? Failure, string? Message)
{
    public static RoutingResult Ok(IReadOnlyList<GeoPosition> line) => new(line, null, null);
    public static RoutingResult Fail(RoutingFailure f, string message) => new(null, f, message);
}

/// <summary>Snap-to-trail segments: BRouter + sanity checks + elevation gap filling + caching.</summary>
public sealed class RoutingService(
    IRoutingProvider provider,
    ElevationService elevation,
    IMemoryCache cache,
    IOptions<RoutingOptions> options,
    RoutingConcurrencyGate gate,
    ILogger<RoutingService> logger)
{
    public async Task<RoutingResult> RouteSegmentAsync(GeoPosition from, GeoPosition to, string profile, CancellationToken ct)
    {
        var o = options.Value;
        if (Geo.DistanceM(from, to) > o.MaxSegmentLengthM)
            return RoutingResult.Fail(RoutingFailure.TooLong,
                $"Points are more than {o.MaxSegmentLengthM / 1000:0} km apart. Add points in between.");

        var key = string.Create(CultureInfo.InvariantCulture,
            $"route:{profile}:{from.Lon:F6},{from.Lat:F6}:{to.Lon:F6},{to.Lat:F6}");
        if (cache.TryGetValue(key, out RoutingResult? cached) && cached is not null)
            return cached;

        var line = await gate.RunAsync(() => provider.RouteAsync(from, to, profile, ct), ct);

        RoutingResult result;
        if (line.Count < 2)
        {
            result = RoutingResult.Fail(RoutingFailure.NoRoute, "No trail found between these points.");
        }
        else if (Geo.DistanceM(from, line[0]) > o.MaxSnapDistanceM || Geo.DistanceM(to, line[^1]) > o.MaxSnapDistanceM)
        {
            logger.LogInformation("Snap rejected: endpoints {Start:0} m / {End:0} m from the nearest way",
                Geo.DistanceM(from, line[0]), Geo.DistanceM(to, line[^1]));
            result = RoutingResult.Fail(RoutingFailure.NoRoute, "A point is too far from any trail.");
        }
        else
        {
            result = RoutingResult.Ok(await FillElevationAsync(line, ct));
        }

        cache.Set(key, result, new MemoryCacheEntryOptions { Size = 1, AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(6) });
        return result;
    }

    /// <summary>BRouter has no elevation where its DEM has gaps; ask the elevation service for those points.</summary>
    private async Task<IReadOnlyList<GeoPosition>> FillElevationAsync(IReadOnlyList<GeoPosition> line, CancellationToken ct)
    {
        var missing = line.Select((p, i) => (p, i)).Where(x => x.p.Ele is null).ToList();
        if (missing.Count == 0)
            return line;

        var result = line.ToArray();
        foreach (var chunk in missing.Chunk(ElevationService.MaxPointsPerCall))
        {
            var found = await elevation.LookupAsync(chunk.Select(x => (x.p.Lat, x.p.Lon)).ToList(), ct);
            for (var k = 0; k < chunk.Length; k++)
                result[chunk[k].i] = result[chunk[k].i] with { Ele = found[k] };
        }
        return result;
    }
}

public sealed class RoutingConcurrencyGate(IOptions<RoutingOptions> options) : IDisposable
{
    private readonly SemaphoreSlim _gate = new(Math.Max(1, options.Value.MaxConcurrency));

    public async Task<T> RunAsync<T>(Func<Task<T>> action, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return await action();
        }
        finally
        {
            _gate.Release();
        }
    }

    public void Dispose() => _gate.Dispose();
}
