extern alias mock;

using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Sync;
using MockStore = mock::RoutePoiManager.MockSuunto.MockStore;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class SyncTests(PostgresFixture pg)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private static readonly List<ControlPoint> Line =
    [
        new(24.00, 60.0, SegmentMode.Freehand, [[24.00, 60.0, 100], [24.01, 60.0, 110], [24.02, 60.0, 120]]),
        new(24.02, 60.0, SegmentMode.Freehand),
    ];

    private static readonly PoiInput Spring = new(Guid.NewGuid(), "Kettle spring", "Refill here", PoiTypes.Water, 24.01, 60.0002, 110);
    private static readonly PoiInput Hut = new(Guid.NewGuid(), "Far hut", null, 9, 24.01, 60.02, null);   // 2 km off route

    [Fact]
    public async Task Route_push_imports_then_updates_with_waypoints()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "pusher");
        var id = await CreateRoute(http, "Lake loop", [Spring, Hut]);

        var first = await Push(http, id);
        Assert.Equal("pushed", first.Outcome);
        Assert.Equal(SyncState.Synced, first.Route.SyncState);
        var suuntoId = first.Route.SuuntoRouteId!;

        var remote = Store(suunto).Routes[suuntoId];
        var gpx = remote.Gpx.ToString();
        Assert.Contains("<suunto:name>Kettle spring</suunto:name>", gpx, StringComparison.Ordinal);   // on-route POI → waypoint
        Assert.Contains("<suunto:type>Water</suunto:type>", gpx, StringComparison.Ordinal);
        Assert.DoesNotContain("Far hut", gpx, StringComparison.Ordinal);                                // off-route: POI only
        var firstRevision = remote.Revision;

        var edited = await Put(http, id, "Lake loop (long)", [Spring, Hut]);
        Assert.Equal(SyncState.LocalChanges, edited.SyncState);

        var second = await Push(http, id);
        Assert.Equal("pushed", second.Outcome);
        Assert.Equal(suuntoId, second.Route.SuuntoRouteId);
        Assert.True(Store(suunto).Routes[suuntoId].Revision > firstRevision);
        Assert.Contains("Lake loop (long)", Store(suunto).Routes[suuntoId].Gpx.ToString(), StringComparison.Ordinal);
        Assert.Single(Store(suunto).Routes);   // updated in place, not duplicated
    }

    [Fact]
    public async Task Edit_in_the_suunto_app_is_a_conflict_with_three_resolutions()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "conflicted");
        var id = await CreateRoute(http, "Ridge", []);
        var suuntoId = (await Push(http, id)).Route.SuuntoRouteId!;

        // Edited in the Suunto app → our push must not silently overwrite it.
        await TouchOnSuunto(suunto, suuntoId);
        await Put(http, id, "Ridge (mine)", []);
        var res = await http.PostAsync($"/api/routes/{id}/push", null);
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        var conflict = (await res.Content.ReadFromJsonAsync<RoutePushResponse>(Json))!;
        Assert.Equal("remote_changed", conflict.Reason);
        Assert.Equal("Ridge", conflict.Remote!.Name);
        Assert.Equal(SyncState.Conflict, conflict.Route.SyncState);

        // Keep mine: pushed on top of the latest revision.
        var keep = await Resolve(http, id, ConflictStrategy.KeepMine);
        Assert.Equal("pushed", keep.Result.Outcome);
        Assert.Contains("Ridge (mine)", Store(suunto).Routes[suuntoId].Gpx.ToString(), StringComparison.Ordinal);

        // Save a copy: mine survives as a new local route, this one takes Suunto's version.
        await TouchOnSuunto(suunto, suuntoId);
        await Put(http, id, "Ridge (local edit)", []);
        var copy = await Resolve(http, id, ConflictStrategy.SaveCopy);
        Assert.Equal("Ridge (mine)", copy.Result.Route.Name);
        Assert.Equal(SyncState.Synced, copy.Result.Route.SyncState);
        var copyDetail = (await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{copy.CopyId}", Json))!;
        Assert.Equal("Ridge (local edit) (my version)", copyDetail.Name);
        Assert.Null(copyDetail.SuuntoRouteId);
    }

    [Fact]
    public async Task Pois_are_created_then_upserted_by_key()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "poi-pusher");
        var id = await CreateRoute(http, "POI route", [Spring, Hut]);

        var first = await PushPois(http, id);
        Assert.Equal([PoiPushStatus.Created, PoiPushStatus.Created], first.Results.Select(r => r.Status));
        Assert.All(first.Pois, p => Assert.Equal(SyncState.Synced, p.SyncState));
        var keys = first.Pois.Select(p => p.SuuntoPoiKey!).ToHashSet();
        Assert.Equal(keys, Store(suunto).Pois.Keys.ToHashSet());
        var springBody = Store(suunto).Pois.Values.Single(p => p.Body["point"]!["name"]!.GetValue<string>() == "Kettle spring").Body;
        Assert.Equal(24.01, springBody["point"]!["x"]!.GetValue<double>(), 6);   // x = longitude
        Assert.Equal(60.0002, springBody["point"]!["y"]!.GetValue<double>(), 6);
        Assert.True(springBody["creation"]!.GetValue<long>() > 100_000_000_000);   // epoch milliseconds, as the live API requires

        // Nothing pending → nothing pushed.
        Assert.Empty((await PushPois(http, id)).Results);

        await Put(http, id, "POI route", [Spring with { Name = "Kettle spring (dry in Aug)" }, Hut]);
        var second = await PushPois(http, id);
        var upserted = Assert.Single(second.Results);
        Assert.Equal(PoiPushStatus.Updated, upserted.Status);
        Assert.Equal(2, Store(suunto).Pois.Count);
        Assert.Contains(Store(suunto).Pois.Values, p => p.Body["point"]!["name"]!.GetValue<string>() == "Kettle spring (dry in Aug)");
    }

    [Fact]
    public async Task Poi_refused_with_200_and_error_code_is_a_failure_not_synced()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "refused");
        var id = await CreateRoute(http, "Refusals", [Spring]);

        // What the live API did: HTTP 200, {"pointOfInterest":{…,"key":""},"errorCode":4}.
        (await suunto.CreateClient().PostAsync("/mock/pois/reject-next?errorCode=4", null)).EnsureSuccessStatusCode();
        var res = await PushPois(http, id);

        var result = Assert.Single(res.Results);
        Assert.Equal(PoiPushStatus.Failed, result.Status);
        Assert.Contains("error code 4", result.Message, StringComparison.Ordinal);
        var poi = Assert.Single(res.Pois);
        Assert.Equal(SyncState.Error, poi.SyncState);
        Assert.Null(poi.SuuntoPoiKey);
        Assert.Empty(Store(suunto).Pois);

        // Retrying works once Suunto accepts it.
        var retry = await PushPois(http, id);
        Assert.Equal(PoiPushStatus.Created, Assert.Single(retry.Results).Status);
    }

    [Fact]
    public async Task Linked_route_without_known_revision_is_updated_not_duplicated()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "relinked");
        var id = await CreateRoute(http, "Half pushed", []);
        var suuntoId = (await Push(http, id)).Route.SuuntoRouteId!;

        // The state an import leaves when its response couldn't be read back: id known, revision not.
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<Infrastructure.Persistence.AppDbContext>();
            var route = await db.Routes.FindAsync(id);
            route!.SuuntoRevision = null;
            route.SyncState = SyncState.LocalOnly;
            await db.SaveChangesAsync();
        }

        var again = await Push(http, id);

        Assert.Equal("pushed", again.Outcome);
        Assert.Equal(suuntoId, again.Route.SuuntoRouteId);
        Assert.Single(Store(suunto).Routes);
    }

    [Fact]
    public async Task Refresh_pulls_new_routes_and_pois_once()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "puller");

        // Things created in the Suunto app (or by another service) for this user.
        var app = SuuntoAppClient(suunto, "puller");
        var poiRes = await app.PostAsJsonAsync("/v2/poi/create", new
        {
            point = new { x = 24.505, y = 60.3, z = 40.0, name = "Shelter", type = 9 },
            watchEnabled = true,
        });
        poiRes.EnsureSuccessStatusCode();
        const string gpx = """
            <gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:suunto="http://www.suunto.com/xmlschemas/RouteExtension/v1" version="1.1">
              <metadata><name>Made in the app</name></metadata>
              <rte>
                <rtept lat="60.30" lon="24.50"><ele>30</ele></rtept>
                <rtept lat="60.30" lon="24.505"><ele>40</ele>
                  <extensions><suunto:routePoint><suunto:name>Shelter</suunto:name><suunto:type>Lodging</suunto:type></suunto:routePoint></extensions>
                </rtept>
                <rtept lat="60.30" lon="24.51"><ele>50</ele></rtept>
              </rte>
            </gpx>
            """;
        var routeRes = await app.PostAsync("/v2/route/import?activities=11", new StringContent(gpx, Encoding.UTF8, "application/gpx+xml"));
        var suuntoId = (await routeRes.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items")[0].GetProperty("id").GetString()!;

        var first = await Refresh(http);
        Assert.Equal((1, 1), (first.RoutesAdded, first.PoisAdded));

        var summary = Assert.Single((await http.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json))!);
        Assert.Equal(("Made in the app", RouteSource.Suunto, SyncState.Synced), (summary.Name, summary.Source, summary.SyncState));
        var detail = (await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{summary.Id}", Json))!;
        var shelter = Assert.Single(detail.Pois);   // the waypoint reused the pulled POI instead of duplicating it
        Assert.NotNull(shelter.SuuntoPoiKey);
        Assert.NotNull(shelter.DistanceAlongM);

        var again = await Refresh(http);
        Assert.Equal((0, 0, 0, 0), (again.RoutesAdded, again.RoutesUpdated, again.PoisAdded, again.PoisUpdated));

        // Edited in the app while our copy is unchanged → our copy follows.
        await TouchOnSuunto(suunto, suuntoId);
        Assert.Equal(1, (await Refresh(http)).RoutesUpdated);
    }

    // ---------- helpers ----------

    private static MockStore Store(MockSuuntoFactory suunto) => suunto.Services.GetRequiredService<MockStore>();

    private static async Task TouchOnSuunto(MockSuuntoFactory suunto, string suuntoId)
    {
        await Task.Delay(5);   // revisions are millisecond timestamps
        (await suunto.CreateClient().PostAsync($"/mock/routes/{suuntoId}/touch", null)).EnsureSuccessStatusCode();
    }

    /// <summary>A Cloud API client acting for the user, like the Suunto app or another partner service.</summary>
    private static HttpClient SuuntoAppClient(MockSuuntoFactory suunto, string username)
    {
        var token = Store(suunto).AccessTokens.First(kv => kv.Value.Username == username).Key;
        var client = suunto.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", "mock-subscription-key");
        return client;
    }

    private static async Task<Guid> CreateRoute(HttpClient http, string name, List<PoiInput> pois)
    {
        var res = await http.PostAsJsonAsync("/api/routes", new CreateRouteRequest(name));
        var id = (await res.Content.ReadFromJsonAsync<RouteDetailDto>(Json))!.Id;
        await Put(http, id, name, pois);
        return id;
    }

    private static async Task<RouteDetailDto> Put(HttpClient http, Guid id, string name, List<PoiInput> pois) =>
        await Read<RouteDetailDto>(await http.PutAsJsonAsync($"/api/routes/{id}",
            new UpdateRouteRequest(name, null, [ActivityTypes.Hiking], true, Line, RoutingProfiles.Default, pois), Json));

    private static async Task<RoutePushResponse> Push(HttpClient http, Guid id) =>
        await Read<RoutePushResponse>(await http.PostAsync($"/api/routes/{id}/push", null));

    private static async Task<ResolveResponse> Resolve(HttpClient http, Guid id, ConflictStrategy strategy) =>
        await Read<ResolveResponse>(await http.PostAsJsonAsync($"/api/routes/{id}/resolve", new ResolveRequest(strategy), Json));

    private static async Task<PoiPushResponse> PushPois(HttpClient http, Guid id) =>
        await Read<PoiPushResponse>(await http.PostAsync($"/api/routes/{id}/pois/push", null));

    private static async Task<RefreshSummary> Refresh(HttpClient http) =>
        await Read<RefreshSummary>(await http.PostAsync("/api/suunto/refresh", null));

    private static async Task<T> Read<T>(HttpResponseMessage res)
    {
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }
}
