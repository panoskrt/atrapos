using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Xml.Linq;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class RouteToolTests(PostgresFixture pg)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>Three ~550 m freehand legs due east: points at 24.00, 24.01, 24.02, 24.03.</summary>
    private static readonly List<ControlPoint> ThreeLegs =
    [
        new(24.00, 60.0, SegmentMode.Freehand, [[24.00, 60.0, 100], [24.01, 60.0, 110]]),
        new(24.01, 60.0, SegmentMode.Freehand, [[24.01, 60.0, 110], [24.02, 60.0, 120]]),
        new(24.02, 60.0, SegmentMode.Freehand, [[24.02, 60.0, 120], [24.03, 60.0, 130]]),
        new(24.03, 60.0, SegmentMode.Freehand),
    ];

    [Fact]
    public async Task Split_moves_the_tail_and_its_pois_to_a_new_route()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "splitter");
        var id = await CreateRoute(http, "Long day",
        [
            new PoiInput(Guid.NewGuid(), "Early spring", null, PoiTypes.Water, 24.005, 60.0, null),
            new PoiInput(Guid.NewGuid(), "Late peak", null, PoiTypes.Peak, 24.025, 60.0, null),
        ]);

        var res = await http.PostAsJsonAsync($"/api/routes/{id}/split", new SplitRequest(2), Json);
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        var split = (await res.Content.ReadFromJsonAsync<SplitResponse>(Json))!;

        Assert.Equal(3, split.Route.ControlPoints.Count);
        Assert.InRange(split.Route.DistanceM, 1080, 1150);
        Assert.Equal("Early spring", Assert.Single(split.Route.Pois).Name);

        Assert.Equal("Long day (part 2)", split.Created.Name);
        Assert.Equal(2, split.Created.ControlPoints.Count);
        var late = Assert.Single(split.Created.Pois);
        Assert.Equal("Late peak", late.Name);
        Assert.InRange(late.DistanceAlongM!.Value, 250, 300);   // relocated along the new route

        var bad = await http.PostAsJsonAsync($"/api/routes/{id}/split", new SplitRequest(0), Json);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Split_by_distance_creates_route_parts_and_moves_pois_with_them()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "distance-splitter");
        var id = await CreateRoute(http, "Long day",
        [
            new PoiInput(Guid.NewGuid(), "Early spring", null, PoiTypes.Water, 24.005, 60.0, null),
            new PoiInput(Guid.NewGuid(), "Late peak", null, PoiTypes.Peak, 24.025, 60.0, null),
        ]);
        var original = (await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{id}", Json))!;

        var res = await http.PostAsJsonAsync($"/api/routes/{id}/split-by-distance", new DistanceSplitRequest(500), Json);
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        var split = (await res.Content.ReadFromJsonAsync<DistanceSplitResponse>(Json))!;

        Assert.Equal(["Long day (part 1)", "Long day (part 2)", "Long day (part 3)"], split.Routes.Select(route => route.Name));
        Assert.Equal(["Early spring"], split.Routes[0].Pois.Select(poi => poi.Name));
        Assert.Empty(split.Routes[1].Pois);
        Assert.Equal(["Late peak"], split.Routes[2].Pois.Select(poi => poi.Name));
        Assert.All(split.Routes, part => Assert.InRange(part.DistanceM, 500, 600));
        Assert.All(split.Routes.SelectMany(part => part.Pois), poi =>
        {
            Assert.Equal(SyncState.LocalOnly, poi.SyncState);
            Assert.Null(poi.SuuntoPoiKey);
        });

        var unchanged = (await http.GetFromJsonAsync<RouteDetailDto>($"/api/routes/{id}", Json))!;
        Assert.Equal(original.Id, unchanged.Id);
        Assert.Equal(original.Name, unchanged.Name);
        Assert.Equal(original.DistanceM, unchanged.DistanceM);
        Assert.Equal(original.ControlPoints.Count, unchanged.ControlPoints.Count);
        Assert.Equal(original.Pois.Select(poi => poi.Id), unchanged.Pois.Select(poi => poi.Id));

        var bad = await http.PostAsJsonAsync($"/api/routes/{id}/split-by-distance", new DistanceSplitRequest(5000), Json);
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Gpx_download_has_the_route_and_every_poi()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "downloader");
        var id = await CreateRoute(http, "Lakes / ridges: day 1",
        [
            new PoiInput(Guid.NewGuid(), "Spring", "Refill", PoiTypes.Water, 24.005, 60.0, 105),
            new PoiInput(Guid.NewGuid(), "Far hut", null, 9, 24.01, 60.02, null),   // off route
        ]);

        var res = await http.GetAsync($"/api/routes/{id}/gpx");

        Assert.Equal("application/gpx+xml", res.Content.Headers.ContentType!.MediaType);
        Assert.Equal("Lakes-ridges-day-1.gpx", res.Content.Headers.ContentDisposition!.FileNameStar ?? res.Content.Headers.ContentDisposition.FileName);
        var doc = XDocument.Parse(await res.Content.ReadAsStringAsync());
        XNamespace g = "http://www.topografix.com/GPX/1/1";
        Assert.Equal(["Spring", "Far hut"], doc.Root!.Elements(g + "wpt").Select(w => w.Element(g + "name")!.Value));
        Assert.True(doc.Root.Elements().ToList().IndexOf(doc.Root.Element(g + "rte")!) > 0);   // wpt before rte
        Assert.Contains(doc.Descendants(), e => e.Name.LocalName == "routePoint");             // on-route POI as waypoint too
    }

    private static async Task<Guid> CreateRoute(HttpClient http, string name, List<PoiInput> pois)
    {
        var created = await http.PostAsJsonAsync("/api/routes", RouteTestRequests.NewRoute(name), Json);
        var id = (await created.Content.ReadFromJsonAsync<RouteDetailDto>(Json))!.Id;
        var res = await http.PutAsJsonAsync($"/api/routes/{id}",
            new UpdateRouteRequest(name, null, [ActivityTypes.Hiking], false, ThreeLegs, RoutingProfiles.Default, pois), Json);
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        return id;
    }
}
