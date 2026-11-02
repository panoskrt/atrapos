using System.Net;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using RoutePoiManager.Infrastructure.Elevation;

namespace RoutePoiManager.UnitTests;

public sealed class ElevationServiceTests
{
    [Fact]
    public async Task Open_topo_data_batches_and_sends_lat_lon_order()
    {
        var handler = new RecordingHandler(req =>
        {
            var count = Uri.UnescapeDataString(req.RequestUri!.Query).Split('|').Length;
            var results = string.Join(',', Enumerable.Range(0, count).Select(i => $"{{\"elevation\":{i}.5}}"));
            return $"{{\"results\":[{results}],\"status\":\"OK\"}}";
        });
        using var gate = new ElevationRateGate(TimeProvider.System);
        var provider = new OpenTopoDataProvider(new HttpClient(handler), gate, Options.Create(new ElevationOptions
        {
            MaxLocationsPerRequest = 2,
            MinRequestInterval = TimeSpan.Zero,
        }));

        var result = await provider.LookupAsync([(60.1, 24.1), (60.2, 24.2), (60.3, 24.3)], CancellationToken.None);

        Assert.Equal([0.5, 1.5, 0.5], result);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains("locations=60.100000,24.100000|60.200000,24.200000", Uri.UnescapeDataString(handler.Requests[0]), StringComparison.Ordinal);
        Assert.StartsWith("https://api.opentopodata.org/v1/mapzen?", handler.Requests[0], StringComparison.Ordinal);
    }

    [Fact]
    public async Task Service_caches_on_grid_and_survives_provider_failure()
    {
        var provider = new FlakyProvider();
        using var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 });
        var service = new ElevationService(provider, cache, NullLogger<ElevationService>.Instance);

        var first = await service.LookupAsync([(60.30001, 24.50001)], CancellationToken.None);
        var nearby = await service.LookupAsync([(60.30002, 24.50002)], CancellationToken.None);   // same ~11 m cell
        Assert.Equal(first, nearby);
        Assert.Equal(1, provider.Calls);

        provider.Fail = true;
        var failed = await service.LookupAsync([(61.0, 25.0)], CancellationToken.None);
        Assert.Equal([null], failed);
    }

    private sealed class FlakyProvider : IElevationProvider
    {
        public int Calls { get; private set; }
        public bool Fail { get; set; }

        public Task<double?[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> points, CancellationToken ct)
        {
            Calls++;
            if (Fail) throw new HttpRequestException("down");
            return Task.FromResult(points.Select(_ => (double?)42).ToArray());
        }
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, string> respond) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!.ToString());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(respond(request), Encoding.UTF8, "application/json"),
            });
        }
    }
}
