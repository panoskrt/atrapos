using System.Globalization;
using System.Net;
using System.Text.Json;
using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Surface;

public sealed class SurfaceDataUnavailableException(string message, Exception? innerException = null)
    : Exception(message, innerException);

public sealed class OverpassConcurrencyGate : IDisposable
{
    private readonly SemaphoreSlim _gate = new(2, 2);

    public Task WaitAsync(CancellationToken ct) => _gate.WaitAsync(ct);
    public void Release() => _gate.Release();
    public void Dispose() => _gate.Dispose();
}

public sealed class OverpassSurfaceProvider(HttpClient http, OverpassConcurrencyGate requestGate) : IOsmSurfaceProvider
{
    public const string HttpClientName = "openstreetmap-overpass";
    private const int PointsPerRequest = 60;
    private const double SearchRadiusM = 35;
    private const int MaxAttempts = 3;

    public async Task<IReadOnlyList<OsmWay>> GetWaysNearAsync(
        IReadOnlyList<(double Longitude, double Latitude)> points,
        CancellationToken ct)
    {
        var requests = points.Chunk(PointsPerRequest).Select(batch => QueryWaysAsync(batch, requestGate, ct));
        var results = await Task.WhenAll(requests);
        return results.SelectMany(result => result)
            .DistinctBy(way => way.Id)
            .ToArray();
    }

    private async Task<IReadOnlyList<OsmWay>> QueryWaysAsync(
        IReadOnlyList<(double Longitude, double Latitude)> points,
        OverpassConcurrencyGate requestGate,
        CancellationToken ct)
    {
        var query = new System.Text.StringBuilder("[out:json][timeout:25];(");
        foreach (var (longitude, latitude) in points)
        {
            query.Append("way(around:")
                .Append(SearchRadiusM.ToString(CultureInfo.InvariantCulture))
                .Append(',')
                .Append(latitude.ToString("F6", CultureInfo.InvariantCulture))
                .Append(',')
                .Append(longitude.ToString("F6", CultureInfo.InvariantCulture))
                .Append(")[\"highway\"];");
        }
        query.Append(");out tags geom;");

        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            var shouldRetry = false;
            await requestGate.WaitAsync(ct);
            try
            {
                using var content = new FormUrlEncodedContent(new Dictionary<string, string> { ["data"] = query.ToString() });
                using var response = await http.PostAsync("api/interpreter", content, ct);
                if (IsTransient(response.StatusCode) && attempt < MaxAttempts - 1)
                {
                    shouldRetry = true;
                }
                else
                {
                    if (!response.IsSuccessStatusCode)
                        throw new SurfaceDataUnavailableException(
                            $"OpenStreetMap surface lookup failed with HTTP {(int)response.StatusCode}.");

                    await using var stream = await response.Content.ReadAsStreamAsync(ct);
                    using var document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                    if (document.RootElement.TryGetProperty("remark", out var remark) &&
                        !string.IsNullOrWhiteSpace(remark.GetString()))
                        throw new SurfaceDataUnavailableException("OpenStreetMap could not complete the surface lookup.");
                    if (!document.RootElement.TryGetProperty("elements", out var elements) || elements.ValueKind != JsonValueKind.Array)
                        throw new SurfaceDataUnavailableException("OpenStreetMap returned an invalid surface response.");

                    return ParseWays(elements);
                }
            }
            catch (HttpRequestException) when (attempt < MaxAttempts - 1)
            {
                shouldRetry = true;
            }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested && attempt < MaxAttempts - 1)
            {
                shouldRetry = true;
            }
            finally
            {
                requestGate.Release();
            }

            if (shouldRetry)
                await Task.Delay(TimeSpan.FromSeconds(1 << attempt), ct);
        }

        throw new SurfaceDataUnavailableException("OpenStreetMap surface data is temporarily unavailable.");
    }

    private static List<OsmWay> ParseWays(JsonElement elements)
    {
        var ways = new List<OsmWay>();
        foreach (var element in elements.EnumerateArray())
        {
            if (!element.TryGetProperty("type", out var type) || type.GetString() != "way" ||
                !element.TryGetProperty("id", out var id) ||
                !element.TryGetProperty("tags", out var tagsElement) ||
                !element.TryGetProperty("geometry", out var geometryElement))
                continue;

            var tags = tagsElement.EnumerateObject()
                .ToDictionary(property => property.Name, property => property.Value.GetString() ?? "", StringComparer.Ordinal);
            var geometry = geometryElement.EnumerateArray()
                .Where(point => point.TryGetProperty("lon", out _) && point.TryGetProperty("lat", out _))
                .Select(point => (point.GetProperty("lon").GetDouble(), point.GetProperty("lat").GetDouble()))
                .ToArray();
            if (geometry.Length >= 2)
                ways.Add(new OsmWay(id.GetInt64(), tags, geometry));
        }
        return ways;
    }

    private static bool IsTransient(HttpStatusCode statusCode) =>
        statusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.InternalServerError or HttpStatusCode.BadGateway or
            HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;
}
