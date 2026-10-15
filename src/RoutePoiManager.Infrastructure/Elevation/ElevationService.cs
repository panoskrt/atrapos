using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace RoutePoiManager.Infrastructure.Elevation;

public enum ElevationProviderKind
{
    OpenTopoData,
    /// <summary>No lookups; every elevation is unknown. For offline use and tests.</summary>
    None,
}

public sealed class ElevationOptions
{
    public const string Section = "Elevation";

    public ElevationProviderKind Provider { get; set; } = ElevationProviderKind.OpenTopoData;
    public string BaseUrl { get; set; } = "https://api.opentopodata.org/v1/";

    /// <summary>Open Topo Data dataset(s). "mapzen" is global, including above 60°N where SRTM has no data.</summary>
    public string Dataset { get; set; } = "mapzen";

    /// <summary>The public API allows at most 100 locations per request…</summary>
    public int MaxLocationsPerRequest { get; set; } = 100;

    /// <summary>…and one request per second.</summary>
    public TimeSpan MinRequestInterval { get; set; } = TimeSpan.FromMilliseconds(1050);
}

public interface IElevationProvider
{
    /// <summary>Elevations in metres, in input order; null where the provider has no data.</summary>
    Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct);
}

public sealed class NoElevationProvider : IElevationProvider
{
    public Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct) =>
        Task.FromResult(new double?[points.Count]);
}

/// <summary>Serialises calls so the provider's per-second limit holds across all requests.</summary>
public sealed class ElevationRateGate(TimeProvider clock) : IDisposable
{
    public void Dispose() => _gate.Dispose();

    private readonly SemaphoreSlim _gate = new(1, 1);
    private DateTimeOffset _last = DateTimeOffset.MinValue;

    public async Task<T> RunAsync<T>(TimeSpan minInterval, Func<Task<T>> action, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            var wait = _last + minInterval - clock.GetUtcNow();
            if (wait > TimeSpan.Zero)
                await Task.Delay(wait, clock, ct);
            try
            {
                return await action();
            }
            finally
            {
                _last = clock.GetUtcNow();
            }
        }
        finally
        {
            _gate.Release();
        }
    }
}

public sealed class OpenTopoDataProvider(
    HttpClient http,
    ElevationRateGate gate,
    IOptions<ElevationOptions> options) : IElevationProvider
{
    public const string HttpClientName = "elevation";

    public async Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct)
    {
        var o = options.Value;
        var result = new double?[points.Count];
        for (var start = 0; start < points.Count; start += o.MaxLocationsPerRequest)
        {
            var batch = points.Skip(start).Take(o.MaxLocationsPerRequest).ToList();
            // Open Topo Data takes "lat,lon|lat,lon".
            var locations = string.Join('|', batch.Select(p =>
                string.Create(CultureInfo.InvariantCulture, $"{p.Lat:F6},{p.Lon:F6}")));
            var url = $"{o.BaseUrl.TrimEnd('/')}/{o.Dataset}?locations={Uri.EscapeDataString(locations)}";

            var response = await gate.RunAsync(o.MinRequestInterval,
                () => http.GetFromJsonAsync<OpenTopoDataResponse>(url, ct), ct);
            if (response?.Results is not { } results || results.Count != batch.Count)
                throw new HttpRequestException($"Unexpected Open Topo Data response (status {response?.Status}).");

            for (var i = 0; i < results.Count; i++)
                result[start + i] = results[i].Elevation;
        }
        return result;
    }

    private sealed record OpenTopoDataResponse(
        [property: JsonPropertyName("results")] List<OpenTopoDataResult>? Results,
        [property: JsonPropertyName("status")] string? Status);

    private sealed record OpenTopoDataResult([property: JsonPropertyName("elevation")] double? Elevation);
}

/// <summary>Elevation lookups with a cache on a ~11 m grid (4 decimals). DEM resolution is 30 m or coarser,
/// so nearby points share a value without losing accuracy.</summary>
public sealed class ElevationService(IElevationProvider provider, IMemoryCache cache, ILogger<ElevationService> logger)
{
    public const int MaxPointsPerCall = 1000;

    public async Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct)
    {
        var result = new double?[points.Count];
        var missingKeys = new Dictionary<string, (double Lat, double Lon)>();
        var keys = new string[points.Count];

        for (var i = 0; i < points.Count; i++)
        {
            var (lat, lon) = (Math.Round(points[i].Lat, 4), Math.Round(points[i].Lon, 4));
            keys[i] = string.Create(CultureInfo.InvariantCulture, $"ele:{lat:F4},{lon:F4}");
            if (cache.TryGetValue(keys[i], out double? cached))
                result[i] = cached;
            else
                missingKeys.TryAdd(keys[i], (lat, lon));
        }

        if (missingKeys.Count > 0)
        {
            try
            {
                var lookedUp = await provider.LookupAsync(missingKeys.Values.ToList(), ct);
                var k = 0;
                foreach (var key in missingKeys.Keys)
                    cache.Set(key, lookedUp[k++], new MemoryCacheEntryOptions { Size = 1, SlidingExpiration = TimeSpan.FromDays(7) });
            }
            // Includes Polly timeout/circuit-breaker exceptions from the resilience handler.
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // Elevation is a nice-to-have: the route still works, just without a profile for these points.
                logger.LogWarning(ex, "Elevation lookup failed for {Count} points", missingKeys.Count);
                return result;
            }

            for (var i = 0; i < points.Count; i++)
                if (result[i] is null && cache.TryGetValue(keys[i], out double? v))
                    result[i] = v;
        }

        return result;
    }
}
