using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace RoutePoiManager.Infrastructure.Suunto;

/// <summary>A Suunto Cloud API call failed. <see cref="StatusCode"/> is null for network failures.</summary>
public class SuuntoApiException(string message, int? statusCode = null, Exception? inner = null) : Exception(message, inner)
{
    public int? StatusCode { get; } = statusCode;
}

/// <summary>PUT /v2/route/{id} rejected the revision: the route changed in the Suunto app.</summary>
public sealed class SuuntoRevisionConflictException(string message) : SuuntoApiException(message, 409);

/// <summary>The POI API answered 200 but refused the POI (a non-zero errorCode in the body). Error code meanings
/// aren't documented.</summary>
public sealed class SuuntoPoiRejectedException(int errorCode)
    : SuuntoApiException($"Suunto refused the POI (error code {errorCode}).", 200)
{
    public int ErrorCode { get; } = errorCode;
}

/// <summary>The route or POI doesn't exist on Suunto any more (deleted in the app).</summary>
public sealed class SuuntoNotFoundException(string message) : SuuntoApiException(message, 404);

/// <summary>Route summary as returned by GET /v2/route ("PartnerRoute").</summary>
public sealed record SuuntoRouteSummary(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("modified")] long Modified,
    [property: JsonPropertyName("created")] long Created,
    [property: JsonPropertyName("totalDistance")] double TotalDistance,
    [property: JsonPropertyName("activityIds")] int[]? ActivityIds);

public sealed record SuuntoPoint(
    [property: JsonPropertyName("x")] double X,
    [property: JsonPropertyName("y")] double Y,
    [property: JsonPropertyName("z")] double? Z,
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("type")] int Type);

/// <summary>Body of the POI API (x = longitude, y = latitude, z = altitude).</summary>
public sealed record SuuntoPoi(
    [property: JsonPropertyName("key")] string? Key,
    [property: JsonPropertyName("creation")] long? Creation,
    [property: JsonPropertyName("modified")] long? Modified,
    [property: JsonPropertyName("point")] SuuntoPoint Point,
    [property: JsonPropertyName("activityId")] int? ActivityId,
    [property: JsonPropertyName("watchEnabled")] bool WatchEnabled = true);

/// <summary>Suunto Cloud API (cloudapi.suunto.com): Route API and POI API. Every call needs the user's access
/// token and the app's subscription key.</summary>
public sealed class SuuntoApiClient(HttpClient http, IOptions<SuuntoOptions> options, ILogger<SuuntoApiClient> logger)
{
    public const string HttpClientName = "suunto-api";
    private const string GpxMediaType = "application/gpx+xml";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // ---------- Route API ----------

    /// <summary>POST /v2/route/import. Returns the new route's id. If the response shape isn't recognised, the
    /// route is looked up in the user's recently modified routes by name: it was created either way, and losing its
    /// id would make the next push create a duplicate.</summary>
    public async Task<string> ImportRouteAsync(string token, string gpx, IEnumerable<int> activityIds, string routeName,
        CancellationToken ct)
    {
        var startedMs = DateTimeOffset.UtcNow.AddMinutes(-2).ToUnixTimeMilliseconds();
        var url = $"v2/route/import?activities={string.Join(',', activityIds)}";
        using var res = await SendAsync(token, HttpMethod.Post, url, new StringContent(gpx, Encoding.UTF8, GpxMediaType), null, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        Diagnose("POST v2/route/import", res, body);
        if (ReadRouteId(body) is { } id)
            return id;

        logger.LogWarning("Suunto route import response had no recognisable id; looking the route up by name");
        var recent = await ListRoutesAsync(token, startedMs, 0, 20, ct);
        return recent.Where(r => r.Description == routeName).MaxBy(r => r.Created)?.Id
               ?? throw new SuuntoApiException(
                   "Suunto accepted the route, but its id couldn't be determined. Use Refresh from Suunto to link it.",
                   (int)res.StatusCode);
    }

    /// <summary>GET /v2/route/{id}/export: the route as GPX, including suunto:id and suunto:revision.</summary>
    public async Task<string> ExportRouteAsync(string token, string routeId, CancellationToken ct)
    {
        using var res = await SendAsync(token, HttpMethod.Get, $"v2/route/{Uri.EscapeDataString(routeId)}/export", null, GpxMediaType, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        Diagnose("GET v2/route/{id}/export", res, body);
        return body;
    }

    /// <summary>PUT /v2/route/{id}. The GPX must carry the current revision; returns the updated GPX.</summary>
    public async Task<string> UpdateRouteAsync(string token, string routeId, string gpx, CancellationToken ct)
    {
        using var res = await SendAsync(token, HttpMethod.Put, $"v2/route/{Uri.EscapeDataString(routeId)}",
            new StringContent(gpx, Encoding.UTF8, GpxMediaType), GpxMediaType, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        Diagnose("PUT v2/route/{id}", res, body);
        return body;
    }

    /// <summary>GET /v2/route, one page. Only routes modified at or after <paramref name="since"/> (epoch ms).</summary>
    public async Task<List<SuuntoRouteSummary>> ListRoutesAsync(string token, long? since, int page, int size, CancellationToken ct)
    {
        var url = $"v2/route?page={page}&size={size}&sort=asc" + (since is { } s ? $"&since={s}" : "");
        using var res = await SendAsync(token, HttpMethod.Get, url, null, "application/json", ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        Diagnose("GET v2/route", res, body);
        return JsonSerializer.Deserialize<List<SuuntoRouteSummary>>(body, Json) ?? [];
    }

    // ---------- POI API ----------

    public async Task<SuuntoPoi> CreatePoiAsync(string token, SuuntoPoi poi, CancellationToken ct)
    {
        using var res = await SendAsync(token, HttpMethod.Post, "v2/poi/create", JsonContent.Create(poi, options: Json), "application/json", ct);
        return await ReadPoiResultAsync(res, ct);
    }

    public async Task<SuuntoPoi> UpsertPoiAsync(string token, SuuntoPoi poi, CancellationToken ct)
    {
        var key = poi.Key ?? throw new ArgumentException("Upsert needs a key.", nameof(poi));
        using var res = await SendAsync(token, HttpMethod.Put, $"v2/poi/{Uri.EscapeDataString(key)}",
            JsonContent.Create(poi, options: Json), "application/json", ct);
        return await ReadPoiResultAsync(res, ct);
    }

    public async Task<List<SuuntoPoi>> ListPoisAsync(string token, int limit, int offset, CancellationToken ct)
    {
        using var res = await SendAsync(token, HttpMethod.Get, $"v2/poi?limit={limit}&offset={offset}", null, "application/json", ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        Diagnose("GET v2/poi", res, body);
        var items = JsonSerializer.Deserialize<List<PoiResult>>(body, Json) ?? [];
        return items.Select(i => i.PointOfInterest).OfType<SuuntoPoi>().ToList();
    }

    // ---------- plumbing ----------

    private async Task<HttpResponseMessage> SendAsync(string token, HttpMethod method, string relativeUrl, HttpContent? content,
        string? accept, CancellationToken ct)
    {
        var o = options.Value;
        using var req = new HttpRequestMessage(method, new Uri(new Uri(o.ApiBaseUrl.TrimEnd('/') + "/"), relativeUrl)) { Content = content };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Add("Ocp-Apim-Subscription-Key", o.SubscriptionKey);
        if (accept is not null)
            req.Headers.Accept.ParseAdd(accept);

        HttpResponseMessage res;
        try
        {
            res = await http.SendAsync(req, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new SuuntoApiException("Suunto didn't respond. Try again in a moment.", null, ex);
        }

        if (res.IsSuccessStatusCode)
            return res;

        using (res)
        {
            var detail = Truncate(await res.Content.ReadAsStringAsync(ct), 300);
            throw res.StatusCode switch
            {
                HttpStatusCode.Unauthorized => new SuuntoReauthRequiredException("Suunto rejected the sign-in. Sign in with Suunto again."),
                HttpStatusCode.Conflict => new SuuntoRevisionConflictException("The route changed in the Suunto app."),
                HttpStatusCode.NotFound => new SuuntoNotFoundException("Not found on Suunto."),
                HttpStatusCode.TooManyRequests => new SuuntoApiException("Suunto is rate-limiting requests. Try again in a minute.", 429),
                _ => new SuuntoApiException($"Suunto returned {(int)res.StatusCode}: {detail}", (int)res.StatusCode),
            };
        }
    }

    /// <summary>The import response body isn't documented. The live API returns <c>{"items":[{"id":…}]}</c> (seen
    /// 2026-10-15); an object or array with an "id", or a bare string, is accepted too.</summary>
    internal static string? ReadRouteId(string body)
    {
        try
        {
            var node = JsonNode.Parse(body);
            var id = node switch
            {
                JsonObject o when o["items"] is JsonArray items => items.FirstOrDefault()?["id"],
                JsonObject o => o["id"] ?? o["routeId"] ?? o["route"]?["id"],
                JsonArray a => a.FirstOrDefault()?["id"],
                JsonValue v => v,
                _ => null,
            };
            return id is JsonValue value && value.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s : null;
        }
        catch (JsonException)
        {
            return string.IsNullOrWhiteSpace(body) ? null : body.Trim().Trim('"');
        }
    }

    /// <summary>The POI API answers 200 even when it rejects a POI: the body then has a non-zero <c>errorCode</c> and
    /// an empty key (seen live: errorCode 4). Anything but a POI with a key is a failure.</summary>
    private async Task<SuuntoPoi> ReadPoiResultAsync(HttpResponseMessage res, CancellationToken ct)
    {
        var body = await res.Content.ReadAsStringAsync(ct);
        Diagnose($"{res.RequestMessage?.Method} {res.RequestMessage?.RequestUri?.AbsolutePath}", res, body);
        return ParsePoiResult(body, (int)res.StatusCode);
    }

    internal static SuuntoPoi ParsePoiResult(string body, int status)
    {
        var result = JsonSerializer.Deserialize<PoiResult>(body, Json);
        if (result?.ErrorCode is { } code and not 0)
            throw new SuuntoPoiRejectedException(code);
        if (result?.PointOfInterest is not { Key: { Length: > 0 } } poi)
            throw new SuuntoApiException("Suunto didn't return the saved POI.", status);
        return poi;
    }

    /// <summary>Response bodies of the Route and POI APIs hold route/POI data only; never auth material.</summary>
    private void Diagnose(string call, HttpResponseMessage res, string body)
    {
        if (options.Value.DiagnosticLogging)
            logger.LogInformation("Suunto diagnostics {Call}: {Status} {ContentType} {Length} chars: {Body}",
                call, (int)res.StatusCode, res.Content.Headers.ContentType?.ToString(), body.Length, Truncate(body, 600));
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    private sealed record PoiResult(
        [property: JsonPropertyName("pointOfInterest")] SuuntoPoi? PointOfInterest,
        [property: JsonPropertyName("errorCode")] int? ErrorCode);
}
