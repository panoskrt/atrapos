using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Elevation;
using RoutePoiManager.Infrastructure.Routing;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class RouteApiTests(PostgresFixture pg)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    [Fact]
    public async Task Create_rejects_a_route_without_map_points()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "empty-route");

        var response = await http.PostAsJsonAsync(
            "/api/routes",
            RouteTestRequests.NewRoute() with { ControlPoints = [] },
            Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(await http.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json) ?? []);
    }

    [Fact]
    public async Task Create_draw_reload_list_delete()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "hiker");

        var created = await Read<RouteDetailDto>(await http.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute()));
        Assert.Equal("Untitled route", created.Name);
        Assert.Equal(SyncState.LocalOnly, created.SyncState);
        Assert.Single(created.ControlPoints);

        // Two freehand segments, ~1.1 km each, climbing 100 m then descending 40 m.
        var update = new UpdateRouteRequest("Ridge loop", "  Clockwise  ", [ActivityTypes.Hiking, ActivityTypes.TrailRunning], true,
        [
            new ControlPoint(24.50, 60.30, SegmentMode.Freehand, [[24.50, 60.30, 100], [24.505, 60.305, 150], [24.51, 60.31, 200]]),
            new ControlPoint(24.51, 60.31, SegmentMode.Freehand, [[24.51, 60.31, 200], [24.52, 60.31, 160]]),
            new ControlPoint(24.52, 60.31, SegmentMode.Freehand),
        ]);
        var saved = await Read<RouteDetailDto>(await http.PutAsJsonAsync($"/api/routes/{created.Id}", update, Json));

        Assert.Equal("Ridge loop", saved.Name);
        Assert.Equal("Clockwise", saved.Description);
        Assert.True(saved.HasElevation);
        Assert.Equal(100, saved.AscentM, 1);
        Assert.Equal(40, saved.DescentM, 1);
        Assert.InRange(saved.DistanceM, 1700, 1900);

        var reloaded = await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{created.Id}", Json);
        Assert.Equal(3, reloaded!.ControlPoints.Count);
        Assert.Equal(3, reloaded.ControlPoints[0].Segment!.Length);   // segment cache survives the round trip
        Assert.Equal([ActivityTypes.Hiking, ActivityTypes.TrailRunning], reloaded.ActivityIds);

        var list = await http.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json);
        var summary = Assert.Single(list!);
        Assert.Equal("Ridge loop", summary.Name);
        Assert.True(summary.Preview.Length >= 2);

        Assert.Equal(HttpStatusCode.NoContent, (await http.DeleteAsync($"/api/routes/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"/api/routes/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task Routes_are_private_to_their_owner()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var owner = await TestAuth.SignInAsync(api, suunto, "owner");
        var other = await TestAuth.SignInAsync(api, suunto, "other");

        var created = await Read<RouteDetailDto>(await owner.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute("Mine"), Json));

        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/routes/{created.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/routes/{created.Id}")).StatusCode);
        Assert.Empty((await other.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json))!);
    }

    [Fact]
    public async Task Bulk_delete_removes_only_the_callers_routes()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var owner = await TestAuth.SignInAsync(api, suunto, "bulk-owner");
        var other = await TestAuth.SignInAsync(api, suunto, "bulk-other");
        var ids = new List<Guid>();
        foreach (var name in new[] { "One", "Two", "Three" })
            ids.Add((await Read<RouteDetailDto>(await owner.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute(name), Json))).Id);
        var theirs = (await Read<RouteDetailDto>(await other.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute("Theirs"), Json))).Id;

        var res = await owner.PostAsJsonAsync("/api/routes/delete", new BulkDeleteRequest([ids[0], ids[1], ids[1], theirs]));

        Assert.Equal(2, (await Read<BulkDeleteResponse>(res)).Deleted);
        Assert.Equal("Three", Assert.Single((await owner.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json))!).Name);
        Assert.Single((await other.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json))!);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await owner.PostAsJsonAsync("/api/routes/delete", new BulkDeleteRequest(null))).StatusCode);
    }

    [Fact]
    public async Task Invalid_update_is_rejected()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "validator");
        var created = await Read<RouteDetailDto>(await http.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute()));

        var res = await http.PutAsJsonAsync($"/api/routes/{created.Id}",
            new UpdateRouteRequest(" ", null, [89], false, [new ControlPoint(200, 95, SegmentMode.Freehand)]), Json);

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var problem = await res.Content.ReadFromJsonAsync<JsonElement>();
        var errors = problem.GetProperty("errors");
        Assert.True(errors.TryGetProperty("name", out _));
        Assert.True(errors.TryGetProperty("activityIds", out _));
        Assert.True(errors.TryGetProperty("controlPoints", out _));
    }

    [Fact]
    public async Task Routes_require_sign_in()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateBrowser().GetAsync("/api/routes")).StatusCode);
    }

    [Fact]
    public async Task Elevation_endpoint_uses_provider_and_cache()
    {
        var provider = new CountingElevationProvider();
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, s => s.Replace(ServiceDescriptor.Singleton<IElevationProvider>(provider)));
        var http = await TestAuth.SignInAsync(api, suunto, "climber");

        var first = await http.PostAsJsonAsync("/api/elevation", new ElevationRequest([[24.5, 60.3], [24.6, 60.4]]));
        var body = await first.Content.ReadFromJsonAsync<ElevationResponse>();
        Assert.Equal([603.0, 604.0], body!.Elevations);

        await http.PostAsJsonAsync("/api/elevation", new ElevationRequest([[24.5, 60.3]]));
        Assert.Equal(2, provider.PointsLookedUp);   // second call served from cache

        var invalid = await http.PostAsJsonAsync("/api/elevation", new ElevationRequest([[999, 0]]));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task Routing_endpoint_maps_results_to_status_codes()
    {
        var provider = new ScriptedRoutingProvider();
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, s => s.Replace(ServiceDescriptor.Singleton<IRoutingProvider>(provider)));
        var http = await TestAuth.SignInAsync(api, suunto, "router");

        provider.Next = () => [new GeoPosition(24.4969, 60.2932, 80), new GeoPosition(24.5201, 60.3108, 60)];
        var ok = await http.PostAsJsonAsync("/api/routing/segment", new RouteSegmentRequest([24.4968, 60.2931], [24.5202, 60.3109], "hiking-mountain"));
        var segment = await Read<RouteSegmentResponse>(ok);
        Assert.Equal(2, segment.Coordinates.Length);
        Assert.Equal(80, segment.Coordinates[0][2]);

        provider.Next = () => [];
        var none = await http.PostAsJsonAsync("/api/routing/segment", new RouteSegmentRequest([24.0, 60.0], [24.01, 60.0], "hiking-mountain"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, none.StatusCode);
        Assert.Equal("no_route", (await none.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());

        provider.Next = () => throw new RoutingUnavailableException("down");
        var down = await http.PostAsJsonAsync("/api/routing/segment", new RouteSegmentRequest([25.0, 60.0], [25.01, 60.0], "trekking"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, down.StatusCode);

        var badProfile = await http.PostAsJsonAsync("/api/routing/segment", new RouteSegmentRequest([25.0, 60.0], [25.01, 60.0], "car-fast"));
        Assert.Equal(HttpStatusCode.BadRequest, badProfile.StatusCode);
    }

    [Fact]
    public async Task Routing_profile_is_saved_and_validated()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "cyclist");
        var created = await Read<RouteDetailDto>(await http.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute()));
        Assert.Equal(RoutingProfiles.Default, created.RoutingProfile);

        var saved = await Read<RouteDetailDto>(await http.PutAsJsonAsync($"/api/routes/{created.Id}",
            new UpdateRouteRequest("Gravel", null, [ActivityTypes.Cycling], false, [], "gravel"), Json));
        Assert.Equal("gravel", saved.RoutingProfile);

        var invalid = await http.PutAsJsonAsync($"/api/routes/{created.Id}",
            new UpdateRouteRequest("Gravel", null, [ActivityTypes.Cycling], false, [], "car-fast"), Json);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    private sealed class ScriptedRoutingProvider : IRoutingProvider
    {
        public Func<IReadOnlyList<GeoPosition>> Next { get; set; } = () => [];

        public Task<IReadOnlyList<GeoPosition>> RouteAsync(GeoPosition from, GeoPosition to, string profile, CancellationToken ct) =>
            Task.FromResult(Next());
    }

    private static async Task<T> Read<T>(HttpResponseMessage res)
    {
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }

    private sealed class CountingElevationProvider : IElevationProvider
    {
        public int PointsLookedUp { get; private set; }

        public Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct)
        {
            PointsLookedUp += points.Count;
            return Task.FromResult(points.Select(p => (double?)Math.Round(p.Lat * 10, 1)).ToArray());
        }
    }

}

internal static class RouteTestRequests
{
    public static UpdateRouteRequest NewRoute(string name = "Untitled route") =>
        new(name, null, [ActivityTypes.Hiking], false, [new ControlPoint(24.5, 60.3, SegmentMode.Freehand)]);
}
