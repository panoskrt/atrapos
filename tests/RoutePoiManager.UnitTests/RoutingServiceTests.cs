using System.Net;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Elevation;
using RoutePoiManager.Infrastructure.Routing;

namespace RoutePoiManager.UnitTests;

public sealed class RoutingServiceTests : IDisposable
{
    private static readonly GeoPosition From = new(24.4968, 60.2931);
    private static readonly GeoPosition To = new(24.5202, 60.3109);

    private readonly MemoryCache _cache = new(new MemoryCacheOptions { SizeLimit = 1000 });
    private readonly RoutingConcurrencyGate _gate = new(Options.Create(new RoutingOptions()));

    public void Dispose()
    {
        _cache.Dispose();
        _gate.Dispose();
    }

    [Fact]
    public async Task Brouter_geojson_is_parsed_as_lon_lat_ele()
    {
        var provider = Provider(HttpStatusCode.OK, """
            {"type":"FeatureCollection","features":[{"type":"Feature","properties":{"track-length":"3773"},
             "geometry":{"type":"LineString","coordinates":[[24.494881,60.291689,86.75],[24.52089,60.310013]]}}]}
            """, out var handler);

        var line = await provider.RouteAsync(From, To, "hiking-mountain", CancellationToken.None);

        Assert.Equal([new GeoPosition(24.494881, 60.291689, 86.75), new GeoPosition(24.52089, 60.310013)], line);
        Assert.Contains("lonlats=24.496800,60.293100|24.520200,60.310900", Uri.UnescapeDataString(handler.LastUrl!), StringComparison.Ordinal);
        Assert.Contains("profile=hiking-mountain", handler.LastUrl, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Brouter_server_error_means_unavailable()
    {
        var provider = Provider(HttpStatusCode.InternalServerError, "", out _);

        await Assert.ThrowsAsync<RoutingUnavailableException>(() => provider.RouteAsync(From, To, "hiking-mountain", CancellationToken.None));
    }

    [Fact]
    public async Task Endpoint_snapped_far_away_is_no_route()
    {
        // What brouter.de really does for points in the sea: snaps both ends to the nearest road ~30 km away.
        var service = Service(new FixedProvider([new GeoPosition(21.341456, 59.807449, 0), new GeoPosition(21.341456, 59.807449, 0)]));

        var result = await service.RouteSegmentAsync(new GeoPosition(21.0, 59.5), new GeoPosition(21.1, 59.6), "hiking-mountain", CancellationToken.None);

        Assert.Equal(RoutingFailure.NoRoute, result.Failure);
    }

    [Fact]
    public async Task Single_point_line_is_no_route()
    {
        var service = Service(new FixedProvider([new GeoPosition(24.5, 60.3)]));

        var result = await service.RouteSegmentAsync(From, To, "hiking-mountain", CancellationToken.None);

        Assert.Equal(RoutingFailure.NoRoute, result.Failure);
    }

    [Fact]
    public async Task Too_long_segment_is_rejected_without_calling_the_router()
    {
        var provider = new FixedProvider([]);
        var service = Service(provider);

        var result = await service.RouteSegmentAsync(new GeoPosition(10, 50), new GeoPosition(20, 60), "trekking", CancellationToken.None);

        Assert.Equal(RoutingFailure.TooLong, result.Failure);
        Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task Missing_elevation_is_filled_and_result_is_cached()
    {
        var provider = new FixedProvider([new GeoPosition(24.4969, 60.2932, 80), new GeoPosition(24.5201, 60.3108)]);
        var service = Service(provider, new FixedElevation(55));

        var first = await service.RouteSegmentAsync(From, To, "hiking-mountain", CancellationToken.None);
        var second = await service.RouteSegmentAsync(From, To, "hiking-mountain", CancellationToken.None);

        Assert.Equal([80.0, 55.0], first.Line!.Select(p => p.Ele!.Value));
        Assert.Same(first, second);
        Assert.Equal(1, provider.Calls);
    }

    private RoutingService Service(IRoutingProvider provider, IElevationProvider? elevation = null) => new(
        provider,
        new ElevationService(elevation ?? new NoElevationProvider(), _cache, NullLogger<ElevationService>.Instance),
        _cache,
        Options.Create(new RoutingOptions()),
        _gate,
        NullLogger<RoutingService>.Instance);

    private static BRouterProvider Provider(HttpStatusCode status, string body, out StubHandler handler)
    {
        handler = new StubHandler(status, body);
        return new BRouterProvider(new HttpClient(handler), Options.Create(new RoutingOptions()));
    }

    private sealed class FixedProvider(IReadOnlyList<GeoPosition> line) : IRoutingProvider
    {
        public int Calls { get; private set; }

        public Task<IReadOnlyList<GeoPosition>> RouteAsync(GeoPosition from, GeoPosition to, string profile, CancellationToken ct)
        {
            Calls++;
            return Task.FromResult(line);
        }
    }

    private sealed class FixedElevation(double value) : IElevationProvider
    {
        public Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct) =>
            Task.FromResult(points.Select(_ => (double?)value).ToArray());
    }

    private sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public string? LastUrl { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastUrl = request.RequestUri!.ToString();
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }
}
