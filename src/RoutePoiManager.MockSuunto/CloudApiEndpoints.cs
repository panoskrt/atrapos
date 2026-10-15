using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.Options;

namespace RoutePoiManager.MockSuunto;

/// <summary>Mimics cloudapi.suunto.com /v2/route and /v2/poi, including subscription-key and token checks.</summary>
public static class CloudApiEndpoints
{
    private const string SessionKey = "mock.session";
    private const string GpxContentType = "application/gpx+xml";

    private static readonly HashSet<int> PoiTypeIds =
        [-1, .. Enumerable.Range(0, 48), .. Enumerable.Range(64, 14)];

    public static void MapMockCloudApi(this IEndpointRouteBuilder app)
    {
        var v2 = app.MapGroup("/v2").AddEndpointFilter(async (ctx, next) =>
        {
            var http = ctx.HttpContext;
            var key = http.Request.Headers["Ocp-Apim-Subscription-Key"].FirstOrDefault()
                      ?? http.Request.Query["subscription-key"].FirstOrDefault();
            var options = http.RequestServices.GetRequiredService<IOptions<MockOptions>>().Value;
            if (key != options.SubscriptionKey)
                return Results.Json(new
                {
                    statusCode = 401,
                    message = "Access denied due to missing subscription key. Make sure to include subscription key when making requests to an API.",
                }, statusCode: 401);

            var session = MockAuth.FindSession(http.Request, http.RequestServices.GetRequiredService<MockStore>());
            if (session is null)
                return Results.Json(new { statusCode = 401, message = "Unauthorized" }, statusCode: 401);

            http.Items[SessionKey] = session;
            return await next(ctx);
        });

        MapRoutes(v2.MapGroup("/route"));
        MapPois(v2.MapGroup("/poi"));

        // Test hook, not part of Suunto: the next POI create/upsert is refused the way the live API does it.
        app.MapPost("/mock/pois/reject-next", (int? errorCode, MockStore store) =>
        {
            store.RejectNextPoi(errorCode ?? 4);
            return Results.Ok();
        });

        // Test hook, not part of Suunto: simulate the user editing a route in the Suunto app.
        app.MapPost("/mock/routes/{oid}/touch", (string oid, MockStore store) =>
        {
            if (!store.Routes.TryGetValue(oid, out var r)) return Results.NotFound();
            r.Revision = store.NextRevision();
            r.Modified = r.Revision;
            return Results.Ok(new { r.Id, r.Revision });
        });
    }

    private static void MapRoutes(RouteGroupBuilder g)
    {
        g.MapPost("/import", async (HttpContext http, string? activities, MockStore store) =>
        {
            var user = Session(http).Username;
            var doc = await ReadGpxAsync(http.Request);
            if (doc is null || MockGpx.CountRoutes(doc) == 0)
                return Results.BadRequest(new { message = "Invalid GPX or no rte/trk elements." });

            int[]? queryActivities;
            try
            {
                queryActivities = ParseActivities(activities);
            }
            catch (FormatException)
            {
                return Results.BadRequest(new { message = "activities must be a comma-separated list of integers." });
            }

            var created = new List<object>();
            foreach (var single in MockGpx.SplitRoutes(doc))
            {
                var rev = store.NextRevision();
                var route = new MockRoute
                {
                    Id = MockStore.NewObjectId(),
                    Username = user,
                    Gpx = single,
                    Revision = rev,
                    Created = rev,
                    Modified = rev,
                    ActivityIds = queryActivities ?? [1],
                };
                store.Routes[route.Id] = route;
                created.Add(PartnerRoute(route));
            }

            // Undocumented, but the live API answers {"items":[{ "id": …, "username": …, … }]} (seen 2026-10-15).
            return Results.Ok(new { items = created });
        });

        g.MapGet("/", (HttpContext http, MockStore store, int? page, int? size, long? since, string? sort) =>
        {
            var user = Session(http).Username;
            var q = store.Routes.Values.Where(r => r.Username == user && (since is null || r.Modified >= since));
            q = string.Equals(sort, "desc", StringComparison.OrdinalIgnoreCase)
                ? q.OrderByDescending(r => r.Modified)
                : q.OrderBy(r => r.Modified);
            var p = Math.Max(0, page ?? 0);
            var s = Math.Clamp(size ?? 5, 1, 100);
            return Results.Ok(q.Skip(p * s).Take(s).Select(PartnerRoute).ToList());
        });

        g.MapGet("/{oid}", (HttpContext http, string oid, MockStore store) =>
            FindOwned(http, oid, store, out var route, out var error) ? Results.Ok(PartnerRoute(route!)) : error!);

        g.MapGet("/{oid}/export", (HttpContext http, string oid, MockStore store) =>
            FindOwned(http, oid, store, out var route, out var error) ? GpxResult(Exported(route!)) : error!);

        g.MapPut("/{oid}", async (HttpContext http, string oid, MockStore store) =>
        {
            if (!FindOwned(http, oid, store, out var route, out var error))
                return error!;

            var doc = await ReadGpxAsync(http.Request);
            if (doc is null || MockGpx.CountRoutes(doc) != 1)
                return Results.BadRequest(new { message = "GPX must be valid and resolve to exactly one route." });

            var (id, revision) = MockGpx.ReadIdentity(doc);
            if (id is null || revision is null)
                return Results.BadRequest(new { message = "Missing suunto:id or suunto:revision. Export the route again." });
            if (id != oid)
                return Results.BadRequest(new { message = "suunto:id does not match the route id." });
            if (revision != route!.Revision)
                return Results.Conflict(new { message = "Revision conflict. Export the latest GPX and retry." });

            route.Gpx = doc;
            route.ActivityIds = MockGpx.ActivityIds(doc) ?? route.ActivityIds;
            route.Revision = store.NextRevision();
            route.Modified = route.Revision;
            return GpxResult(Exported(route));
        });
    }

    private static void MapPois(RouteGroupBuilder g)
    {
        g.MapPost("/create", async (HttpContext http, MockStore store) =>
        {
            var body = await ReadJsonAsync(http.Request);
            if (ValidatePoi(body) is { } invalid)
                return invalid;
            if (store.TakePoiRejection() is { } code)
                return Rejected(body!, code);
            if (HasSecondTimestamps(body!))
                return Rejected(body!, 4);

            var key = body!["key"]?.GetValue<string>();
            if (string.IsNullOrEmpty(key))
                key = MockStore.NewObjectId();
            else if (store.Pois.ContainsKey(key))
                return Results.BadRequest(new { errorCode = 400, message = "POI key already exists." });

            return Results.Ok(new { pointOfInterest = Store(http, store, key, body) });
        });

        g.MapPut("/{poiKey}", async (HttpContext http, string poiKey, MockStore store) =>
        {
            var body = await ReadJsonAsync(http.Request);
            if (ValidatePoi(body) is { } invalid)
                return invalid;
            if (store.TakePoiRejection() is { } code)
                return Rejected(body!, code);
            if (HasSecondTimestamps(body!))
                return Rejected(body!, 4);
            if (body!["key"]?.GetValue<string>() != poiKey)
                return Results.BadRequest(new { errorCode = 400, message = "Body key must match the poiKey path parameter." });
            if (store.Pois.TryGetValue(poiKey, out var existing) && existing.Username != Session(http).Username)
                return Results.Json(new { errorCode = 403 }, statusCode: 403);

            return Results.Ok(new { pointOfInterest = Store(http, store, poiKey, body) });
        });

        g.MapGet("/detail", (HttpContext http, string? poiKey, MockStore store) =>
        {
            if (string.IsNullOrEmpty(poiKey) || !store.Pois.TryGetValue(poiKey, out var poi))
                return Results.NotFound(new { errorCode = 404 });
            return poi.Username == Session(http).Username
                ? Results.Ok(new { pointOfInterest = poi.Body })
                : Results.Json(new { errorCode = 403 }, statusCode: 403);
        });

        g.MapGet("/", (HttpContext http, MockStore store, int? limit, int? offset) =>
        {
            var user = Session(http).Username;
            return Results.Ok(store.Pois.Values
                .Where(p => p.Username == user)
                .OrderBy(p => p.Body["creation"]?.GetValue<long>() ?? 0)
                .Skip(Math.Max(0, offset ?? 0))
                .Take(Math.Clamp(limit ?? 100, 1, 1000))
                .Select(p => new { pointOfInterest = p.Body })
                .ToList());
        });
    }

    /// <summary>The live API refuses epoch-second creation/modified with errorCode 4; it wants milliseconds.</summary>
    private static bool HasSecondTimestamps(JsonObject body) =>
        new[] { body["creation"], body["modified"] }.Any(n => TryNumber(n, out var v) && v < 100_000_000_000);

    /// <summary>What the live POI API sends when it refuses a POI: HTTP 200, an empty key and a non-zero errorCode.</summary>
    private static IResult Rejected(JsonObject body, int errorCode)
    {
        var echoed = (JsonObject)body.DeepClone();
        echoed["key"] = "";
        echoed["country"] ??= "";
        echoed["locality"] ??= "";
        return Results.Ok(new { pointOfInterest = echoed, errorCode });
    }

    private static JsonObject Store(HttpContext http, MockStore store, string key, JsonObject body)
    {
        var now = store.Now.ToUnixTimeMilliseconds();   // the live POI API uses epoch milliseconds
        var stored = (JsonObject)body.DeepClone();
        stored["key"] = key;
        stored["creation"] ??= now;
        stored["modified"] = now;
        store.Pois[key] = new MockPoi { Key = key, Username = Session(http).Username, Body = stored };
        return stored;
    }

    private static IResult? ValidatePoi(JsonObject? body)
    {
        if (body is null)
            return Results.BadRequest(new { errorCode = 400, message = "Body must be a JSON object." });
        if (body["watchEnabled"]?.GetValueKind() != System.Text.Json.JsonValueKind.True)
            return Results.BadRequest(new { errorCode = 400, message = "watchEnabled must be true." });
        if (body["point"] is not JsonObject point)
            return Results.BadRequest(new { errorCode = 400, message = "point is required." });
        if (!TryNumber(point["x"], out var x) || !TryNumber(point["y"], out var y) || x is < -180 or > 180 || y is < -90 or > 90)
            return Results.BadRequest(new { errorCode = 400, message = "point.x (longitude) and point.y (latitude) are required." });
        if (!TryNumber(point["type"], out var type) || !PoiTypeIds.Contains((int)type) || type != Math.Floor(type))
            return Results.BadRequest(new { errorCode = 400, message = "point.type must be a PoiType value." });
        return null;
    }

    private static bool TryNumber(JsonNode? node, out double value)
    {
        value = 0;
        return node is JsonValue v && v.TryGetValue(out value);
    }

    private static AccessSession Session(HttpContext http) => (AccessSession)http.Items[SessionKey]!;

    private static bool FindOwned(HttpContext http, string oid, MockStore store, out MockRoute? route, out IResult? error)
    {
        error = null;
        if (!store.Routes.TryGetValue(oid, out route))
        {
            error = Results.NotFound(new { message = "Route not found." });
            return false;
        }
        if (route.Username != Session(http).Username)
        {
            error = Results.Json(new { message = "Forbidden" }, statusCode: 403);
            return false;
        }
        return true;
    }

    private static XDocument Exported(MockRoute r) => MockGpx.WithIdentity(r.Gpx, r.Id, r.Revision, r.ActivityIds);

    private static IResult GpxResult(XDocument doc)
    {
        var xml = new StringBuilder();
        using (var w = XmlWriter.Create(xml, new XmlWriterSettings { Indent = true, OmitXmlDeclaration = true }))
            doc.Save(w);
        return Results.Text("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n" + xml, GpxContentType, Encoding.UTF8);
    }

    private static object PartnerRoute(MockRoute r)
    {
        var pts = MockGpx.Points(r.Gpx);
        object P(GeoPoint? p) => new { altitude = p?.Ele ?? 0, latitude = p?.Lat ?? 0, longitude = p?.Lon ?? 0 };
        return new
        {
            activityIds = r.ActivityIds,
            averageSpeed = 0,
            centerPoint = P(pts.Count == 0 ? null : pts[pts.Count / 2]),
            created = r.Created,
            description = MockGpx.RouteName(r.Gpx),
            endPoint = P(pts.LastOrDefault()),
            id = r.Id,
            modified = r.Modified,
            startPoint = P(pts.FirstOrDefault()),
            totalDistance = Math.Round(MockGpx.DistanceMeters(pts), 1),
            turnWaypointsEnabled = MockGpx.TurnWaypointsEnabled(r.Gpx),
            visibility = "PRIVATE",
            watchEnabled = true,
        };
    }

    private static int[]? ParseActivities(string? activities) =>
        string.IsNullOrWhiteSpace(activities)
            ? null
            : activities.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(a => int.Parse(a, CultureInfo.InvariantCulture)).ToArray();

    private static async Task<XDocument?> ReadGpxAsync(HttpRequest req)
    {
        try
        {
            using var reader = new StreamReader(req.Body, Encoding.UTF8);
            var text = await reader.ReadToEndAsync();
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            using var xr = XmlReader.Create(new StringReader(text), settings);
            var doc = XDocument.Load(xr);
            return doc.Root?.Name == MockGpx.Gpx + "gpx" ? doc : null;
        }
        catch (XmlException)
        {
            return null;
        }
    }

    private static async Task<JsonObject?> ReadJsonAsync(HttpRequest req)
    {
        try
        {
            return await JsonNode.ParseAsync(req.Body) as JsonObject;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }
}
