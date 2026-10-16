using System.Xml.Linq;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.UnitTests;

public sealed class RouteGpxTests
{
    private static readonly XNamespace G = RouteGpx.Gpx;
    private static readonly XNamespace S = RouteGpx.Suunto;

    private static Route DenseStraightRoute()
    {
        // 101 points every ~11 m due east: collinear, so the push simplification keeps only what it must.
        var route = new Route { Name = "Straight", ActivityIds = [11, 22], TurnWaypointsEnabled = true, Description = "Flat" };
        route.ApplyDrawing(
        [
            new ControlPoint(24.0, 60.0, SegmentMode.Freehand,
                Enumerable.Range(0, 101).Select(i => new double?[] { 24.0 + i * 0.0002, 60.0, 100 + i * 0.5 }).ToArray()),
            new ControlPoint(24.02, 60.0, SegmentMode.Freehand),
        ], DateTimeOffset.UnixEpoch);
        return route;
    }

    private static Poi PoiAt(string name, int type, double? alongM) => new()
    {
        Name = name,
        PoiType = type,
        Location = PoiBehaviour.CreateLocation(24.01, 60.0005),
        DistanceAlongM = alongM,
    };

    [Fact]
    public void Build_writes_suunto_extensions_and_waypoints_in_route_order()
    {
        var route = DenseStraightRoute();
        var pois = new[] { PoiAt("B spring", PoiTypes.Water, 800), PoiAt("A view", 22, 300), PoiAt("Off", 9, null) };

        var doc = XDocument.Parse(RouteGpx.Build(route, pois, "abc123", 1791291783072));

        var sr = doc.Descendants(S + "route").Single();
        Assert.Equal("abc123", sr.Element(S + "id")!.Value);
        Assert.Equal("1791291783072", sr.Element(S + "revision")!.Value);
        Assert.Equal(["11", "22"], sr.Element(S + "activityIds")!.Elements().Select(e => e.Value));
        Assert.Equal("true", sr.Element(S + "turnWaypointsEnabled")!.Value);
        Assert.Equal("Flat", doc.Root!.Element(G + "metadata")!.Element(G + "desc")!.Value);

        var points = doc.Descendants(G + "rtept").ToList();
        // Collinear line → just the ends, plus the two on-route POIs; the off-route POI isn't a waypoint.
        Assert.Equal(4, points.Count);
        var named = points.Select(p => p.Descendants(S + "name").SingleOrDefault()?.Value).ToList();
        Assert.Equal([null, "A view", "B spring", null], named);
        Assert.Equal("Water", points[2].Descendants(S + "type").Single().Value);
        // Waypoints sit on the line (latitude 60), not at the POI's own position.
        Assert.Equal(60.0, double.Parse(points[1].Attribute("lat")!.Value, System.Globalization.CultureInfo.InvariantCulture), 6);
    }

    [Fact]
    public void Build_without_identity_is_an_import()
    {
        var doc = XDocument.Parse(RouteGpx.Build(DenseStraightRoute(), []));

        Assert.Null(doc.Descendants(S + "id").SingleOrDefault());
        Assert.Equal((null, null), RouteGpx.ReadIdentity(doc.ToString()));
    }

    [Fact]
    public void Read_round_trips_the_route()
    {
        var gpx = RouteGpx.Build(DenseStraightRoute(), [PoiAt("A view", 22, 300)], "id1", 42);

        var read = RouteGpx.Read(gpx);

        Assert.Equal("Straight", read.Name);
        Assert.Equal([11, 22], read.ActivityIds);
        Assert.True(read.TurnWaypointsEnabled);
        Assert.Equal(3, read.Points.Count);
        Assert.Equal(("A view", 22), (read.Waypoints.Single().Name, read.Waypoints.Single().PoiType));
        Assert.Equal(("id1", 42L), RouteGpx.ReadIdentity(gpx));
    }

    [Fact]
    public void Read_keeps_route_waypoints_separate_from_explicit_pois()
    {
        const string gpx = """
            <gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:suunto="http://www.suunto.com/xmlschemas/RouteExtension/v1">
              <wpt lat="60.3" lon="24.505"><name>Spring</name><sym>Drinking Water</sym></wpt>
              <rte><name>Ridge</name>
                <rtept lat="60.3" lon="24.5"><name>Trail marker</name></rtept>
                <rtept lat="60.3" lon="24.505">
                  <extensions><suunto:routePoint><suunto:name>Big Ben</suunto:name><suunto:type>Sight</suunto:type></suunto:routePoint></extensions>
                </rtept>
                <rtept lat="60.3" lon="24.51"/>
              </rte>
            </gpx>
            """;

        var read = RouteGpx.Read(gpx);

        Assert.Equal(["Trail marker", "Big Ben", "Spring"], read.Waypoints.Select(w => w.Name));
        Assert.Equal([false, true, true], read.Waypoints.Select(w => w.IsExplicitPoi));
    }

    [Fact]
    public void Poi_result_with_error_code_or_without_key_is_a_failure()
    {
        // Verbatim shape of the live refusal (2026-10-15).
        const string refused = """
            {"pointOfInterest":{"creation":1792049397,"modified":1792049407,"point":{"x":20.839283,"y":39.6732878,"z":500.0,"name":"Spiti","type":26},"activityId":11,"country":"","locality":"","watchEnabled":true,"key":""},"errorCode":4}
            """;
        var ex = Assert.Throws<SuuntoPoiRejectedException>(() => SuuntoApiClient.ParsePoiResult(refused, 200));
        Assert.Equal(4, ex.ErrorCode);

        Assert.Throws<SuuntoApiException>(() => SuuntoApiClient.ParsePoiResult("""{"pointOfInterest":{"key":"","point":{"x":1,"y":1,"type":26}}}""", 200));

        var ok = SuuntoApiClient.ParsePoiResult("""{"pointOfInterest":{"key":"5e3b","point":{"x":1,"y":2,"type":26}},"errorCode":0}""", 200);
        Assert.Equal("5e3b", ok.Key);
    }

    [Theory]
    [InlineData("""{"items":[{"id":"6ad0814784257c0d7031eb32","username":"u","description":"Test route"}]}""", "6ad0814784257c0d7031eb32")]
    [InlineData("""{"items":[]}""", null)]
    [InlineData("""{"id":"r1","description":"x"}""", "r1")]
    [InlineData("""[{"id":"r2"},{"id":"r3"}]""", "r2")]
    [InlineData("\"r4\"", "r4")]
    [InlineData("""{"route":{"id":"r5"}}""", "r5")]
    [InlineData("{}", null)]
    public void Import_response_id_is_read_defensively(string body, string? expected) =>
        Assert.Equal(expected, SuuntoApiClient.ReadRouteId(body));
}
