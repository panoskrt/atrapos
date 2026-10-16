using Microsoft.Extensions.Caching.Memory;
using NetTopologySuite.Geometries;
using RoutePoiManager.Infrastructure.Surface;
using System.Net;
using System.Text;
using Microsoft.Extensions.Logging.Abstractions;

namespace RoutePoiManager.UnitTests;

public sealed class RouteSurfaceTests
{
    [Theory]
    [InlineData("footway", "asphalt", "Path")]
    [InlineData("primary", "asphalt", "Asphalt")]
    [InlineData("track", "", "OffRoad")]
    [InlineData("primary", "gravel", "OffRoad")]
    public async Task Classifies_matched_route_surface(string highway, string surface, string expected)
    {
        var coordinates = new[]
        {
            (24.0, 60.0),
            (24.009, 60.0),
        };
        var provider = new FixedSurfaceProvider(
        [
            Way(1, highway, surface, coordinates),
        ]);
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var route = new GeometryFactory().CreateLineString(
        [
            new Coordinate(coordinates[0].Item1, coordinates[0].Item2),
            new Coordinate(coordinates[1].Item1, coordinates[1].Item2),
        ]);

        var result = await new RouteSurfaceService(provider, cache, NullLogger<RouteSurfaceService>.Instance)
            .GetBreakdownAsync(route, CancellationToken.None);

        Assert.Equal(expected switch
        {
            "Path" => 100,
            "Asphalt" => 100,
            _ => 0,
        }, result.Path.Percent + result.Asphalt.Percent);
        if (expected == "OffRoad")
            Assert.Equal(100, result.OffRoad.Percent);
        Assert.Equal(0, result.UnclassifiedPercent);
        Assert.Equal(result.TotalDistanceKm, result.Path.DistanceKm + result.Asphalt.DistanceKm + result.OffRoad.DistanceKm, 2);
    }

    [Fact]
    public async Task Reports_unmatched_distance_as_unclassified()
    {
        var provider = new FixedSurfaceProvider([]);
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var route = new GeometryFactory().CreateLineString([new Coordinate(24.0, 60.0), new Coordinate(24.009, 60.0)]);

        var result = await new RouteSurfaceService(provider, cache, NullLogger<RouteSurfaceService>.Instance)
            .GetBreakdownAsync(route, CancellationToken.None);

        Assert.Equal(100, result.UnclassifiedPercent);
        Assert.Equal(result.TotalDistanceKm, result.UnclassifiedDistanceKm, 2);
    }

    [Fact]
    public async Task Overpass_provider_maps_way_tags_and_geometry()
    {
        var handler = new SurfaceHandler();
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://overpass-api.de/") };
        using var gate = new OverpassConcurrencyGate();
        var provider = new OverpassSurfaceProvider(http, gate);

        var ways = await provider.GetWaysNearAsync([(24.0, 60.0)], CancellationToken.None);

        var way = Assert.Single(ways);
        Assert.Equal(42, way.Id);
        Assert.Equal("footway", way.Tags["highway"]);
        Assert.Equal("paving_stones", way.Tags["surface"]);
        Assert.Equal(2, way.Geometry.Count);
        Assert.Contains(
            "way(around:35,60.000000,24.000000)",
            Uri.UnescapeDataString(handler.RequestBody.Replace("+", " ", StringComparison.Ordinal)),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task Overpass_provider_retries_when_the_public_service_is_temporarily_at_capacity()
    {
        var handler = new SurfaceHandler(failOnce: true);
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://overpass-api.de/") };
        using var gate = new OverpassConcurrencyGate();
        var provider = new OverpassSurfaceProvider(http, gate);

        var ways = await provider.GetWaysNearAsync([(24.0, 60.0)], CancellationToken.None);

        Assert.Single(ways);
        Assert.Equal(2, handler.Calls);
    }

    private static OsmWay Way(long id, string highway, string surface, (double, double)[] geometry)
    {
        var tags = new Dictionary<string, string> { ["highway"] = highway };
        if (!string.IsNullOrEmpty(surface))
            tags["surface"] = surface;
        return new OsmWay(id, tags, geometry.Select(point => (point.Item1, point.Item2)).ToArray());
    }

    private sealed class FixedSurfaceProvider(IReadOnlyList<OsmWay> ways) : IOsmSurfaceProvider
    {
        public Task<IReadOnlyList<OsmWay>> GetWaysNearAsync(
            IReadOnlyList<(double Longitude, double Latitude)> points,
            CancellationToken ct) => Task.FromResult(ways);
    }

    private sealed class SurfaceHandler(bool failOnce = false) : HttpMessageHandler
    {
        public string RequestBody { get; private set; } = "";
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            RequestBody = await request.Content!.ReadAsStringAsync(cancellationToken);
            if (failOnce && Calls == 1)
                return new HttpResponseMessage(HttpStatusCode.BadGateway);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """{"elements":[{"type":"way","id":42,"tags":{"highway":"footway","surface":"paving_stones"},"geometry":[{"lat":60.0,"lon":24.0},{"lat":60.001,"lon":24.001}]}]}""",
                    Encoding.UTF8,
                    "application/json"),
            };
        }
    }
}
