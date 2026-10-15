using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class RoutePoiTests(PostgresFixture pg)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>A straight ~1.1 km route due east along 60°N.</summary>
    private static readonly List<ControlPoint> Line =
    [
        new(24.00, 60.0, SegmentMode.Freehand, [[24.00, 60.0, 100], [24.02, 60.0, 120]]),
        new(24.02, 60.0, SegmentMode.Freehand),
    ];

    private static UpdateRouteRequest Update(List<PoiInput>? pois, List<ControlPoint>? line = null) =>
        new("POI route", null, [ActivityTypes.Hiking], false, line ?? Line, RoutingProfiles.Default, pois);

    [Fact]
    public async Task Pois_are_created_located_edited_deleted_and_restored()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "poi-owner");
        var route = await Create(http);

        var spring = new PoiInput(Guid.NewGuid(), "Spring", null, PoiTypes.Water, 24.01, 60.0, 110);
        var hut = new PoiInput(Guid.NewGuid(), "Hut", "Open in summer", 9, 24.01, 60.01, null);   // ~1.1 km north: off route
        var saved = await Put(http, route, Update([spring, hut]));

        var s = saved.Pois.Single(p => p.Name == "Spring");
        Assert.InRange(s.DistanceAlongM!.Value, 540, 570);
        Assert.Equal(110, s.Ele);
        Assert.Equal(SyncState.LocalOnly, s.SyncState);
        Assert.Null(saved.Pois.Single(p => p.Name == "Hut").DistanceAlongM);
        Assert.Equal("Spring", saved.Pois[0].Name);   // on-route POIs first, by distance

        // Pretend the spring was pushed to Suunto.
        await WithDb(api, async db =>
        {
            var poi = await db.Pois.SingleAsync(p => p.Id == spring.Id);
            poi.SuuntoPoiKey = "5e3be95baba83c5b1781593a";
            poi.SyncState = SyncState.Synced;
            await db.SaveChangesAsync();
        });

        // Delete it (omit from the list): gone from the route, but kept as a tombstone.
        saved = await Put(http, route, Update([hut]));
        Assert.DoesNotContain(saved.Pois, p => p.Id == spring.Id);
        Assert.DoesNotContain((await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{route}", Json))!.Pois, p => p.Id == spring.Id);

        // Undo: the same id comes back with its Suunto key and sync state intact (no duplicate on Suunto later).
        saved = await Put(http, route, Update([spring, hut]));
        var restored = saved.Pois.Single(p => p.Id == spring.Id);
        Assert.Equal("5e3be95baba83c5b1781593a", restored.SuuntoPoiKey);
        Assert.Equal(SyncState.Synced, restored.SyncState);

        // Renaming a synced POI marks it changed.
        saved = await Put(http, route, Update([spring with { Name = "Spring (dry in Aug)" }, hut]));
        Assert.Equal(SyncState.LocalChanges, saved.Pois.Single(p => p.Id == spring.Id).SyncState);

        // A request without a POI list leaves POIs alone.
        saved = await Put(http, route, Update(null));
        Assert.Equal(2, saved.Pois.Count);
    }

    [Fact]
    public async Task Changing_the_route_relocates_its_pois()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "relocator");
        var route = await Create(http);
        var poi = new PoiInput(Guid.NewGuid(), "Bridge", null, 21, 24.01, 60.0, null);
        await Put(http, route, Update([poi]));

        // Move the route 2 km north: the POI is now off route.
        List<ControlPoint> moved =
        [
            new(24.00, 60.02, SegmentMode.Freehand, [[24.00, 60.02, 100], [24.02, 60.02, 120]]),
            new(24.02, 60.02, SegmentMode.Freehand),
        ];
        var saved = await Put(http, route, Update([poi], moved));

        Assert.Null(saved.Pois.Single().DistanceAlongM);
        Assert.Equal(SyncState.LocalOnly, saved.Pois.Single().SyncState);
    }

    [Fact]
    public async Task Poi_ids_from_another_route_and_invalid_pois_are_rejected()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var alice = await TestAuth.SignInAsync(api, suunto, "alice-poi");
        var mallory = await TestAuth.SignInAsync(api, suunto, "mallory-poi");
        var aliceRoute = await Create(alice);
        var malloryRoute = await Create(mallory);
        var alicePoi = new PoiInput(Guid.NewGuid(), "Secret spot", null, PoiTypes.Poi, 24.01, 60.0, null);
        await Put(alice, aliceRoute, Update([alicePoi]));

        var steal = await mallory.PutAsJsonAsync($"/api/routes/{malloryRoute}", Update([alicePoi with { Name = "Mine now" }]), Json);
        Assert.Equal(HttpStatusCode.BadRequest, steal.StatusCode);

        var badType = await alice.PutAsJsonAsync($"/api/routes/{aliceRoute}", Update([alicePoi with { PoiType = 55 }]), Json);
        Assert.Equal(HttpStatusCode.BadRequest, badType.StatusCode);

        var unchanged = (await alice.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{aliceRoute}", Json))!;
        Assert.Equal("Secret spot", unchanged.Pois.Single().Name);
    }

    [Fact]
    public async Task Bulk_delete_tombstones_only_the_callers_pois_and_marks_routes_changed()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "poi-bulk");
        var other = await TestAuth.SignInAsync(api, suunto, "poi-bulk-other");
        var route = await Create(http);
        var a = new PoiInput(Guid.NewGuid(), "A", null, PoiTypes.Water, 24.005, 60.0, null);
        var b = new PoiInput(Guid.NewGuid(), "B", null, PoiTypes.Water, 24.010, 60.0, null);
        var c = new PoiInput(Guid.NewGuid(), "C", null, PoiTypes.Water, 24.015, 60.0, null);
        await Put(http, route, Update([a, b, c]));
        var theirs = await Create(other);
        var foreign = new PoiInput(Guid.NewGuid(), "Theirs", null, PoiTypes.Water, 24.01, 60.0, null);
        await Put(other, theirs, Update([foreign]));
        await WithDb(api, async db =>
        {
            (await db.Routes.SingleAsync(r => r.Id == route)).SyncState = SyncState.Synced;
            await db.SaveChangesAsync();
        });

        var res = await http.PostAsJsonAsync("/api/pois/delete", new BulkDeleteRequest([a.Id, b.Id, b.Id, foreign.Id, Guid.NewGuid()]));

        Assert.Equal(2, (await res.Content.ReadFromJsonAsync<BulkDeleteResponse>(Json))!.Deleted);
        var detail = (await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{route}", Json))!;
        Assert.Equal("C", Assert.Single(detail.Pois).Name);
        Assert.Equal(SyncState.LocalChanges, detail.SyncState);   // waypoints leave at the next route push
        Assert.Single((await other.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{theirs}", Json))!.Pois);
        await WithDb(api, async db =>
            Assert.Equal(2, await db.Pois.IgnoreQueryFilters().CountAsync(p => p.RouteId == route && p.DeletedAt != null)));

        Assert.Equal(HttpStatusCode.BadRequest, (await http.PostAsJsonAsync("/api/pois/delete", new BulkDeleteRequest([]))).StatusCode);
    }

    private static async Task<Guid> Create(HttpClient http)
    {
        var res = await http.PostAsJsonAsync("/api/routes", new CreateRouteRequest(null));
        return (await res.Content.ReadFromJsonAsync<RouteDetailDto>(Json))!.Id;
    }

    private static async Task<RouteDetailDto> Put(HttpClient http, Guid route, UpdateRouteRequest body)
    {
        var res = await http.PutAsJsonAsync($"/api/routes/{route}", body, Json);
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<RouteDetailDto>(Json))!;
    }

    private static async Task WithDb(ApiFactory api, Func<AppDbContext, Task> action)
    {
        await using var scope = api.Services.CreateAsyncScope();
        await action(scope.ServiceProvider.GetRequiredService<AppDbContext>());
    }
}
