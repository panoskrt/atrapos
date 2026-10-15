using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;

namespace RoutePoiManager.IntegrationTests;

/// <summary>The mock stands in for Suunto until credentials exist, so it must keep Suunto's documented contracts.</summary>
public sealed class MockSuuntoContractTests : IAsyncLifetime
{
    private static readonly XNamespace Suunto = "http://www.suunto.com/xmlschemas/RouteExtension/v1";

    private const string SampleGpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:suunto="http://www.suunto.com/xmlschemas/RouteExtension/v1" version="1.1" creator="test">
          <metadata><name>Example route</name></metadata>
          <rte>
            <rtept lat="51.500866" lon="-0.12611513"><ele>5.05</ele>
              <extensions><suunto:routePoint><suunto:name>Big Ben</suunto:name><suunto:type>Sight</suunto:type></suunto:routePoint></extensions>
            </rtept>
            <rtept lat="51.50072" lon="-0.11992768"><ele>2.74</ele></rtept>
          </rte>
        </gpx>
        """;

    private readonly MockSuuntoFactory _suunto = new();
    private HttpClient _api = null!;

    public async Task InitializeAsync()
    {
        var token = await GetAccessTokenAsync("erin");
        _api = _suunto.CreateClient();
        _api.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        _api.DefaultRequestHeaders.Add("Ocp-Apim-Subscription-Key", "mock-subscription-key");
    }

    public async Task DisposeAsync() => await _suunto.DisposeAsync();

    [Fact]
    public async Task Cloud_api_requires_subscription_key()
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "/v2/route");
        req.Headers.Authorization = _api.DefaultRequestHeaders.Authorization;

        var res = await _suunto.CreateClient().SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Route_import_then_export_carries_id_and_revision()
    {
        var imported = await ImportAsync(SampleGpx, "11,22");

        Assert.Equal("Example route", imported.GetProperty("description").GetString());
        Assert.Equal([11, 22], imported.GetProperty("activityIds").EnumerateArray().Select(e => e.GetInt32()));
        Assert.True(imported.GetProperty("totalDistance").GetDouble() > 400);

        var gpx = await ExportAsync(imported.GetProperty("id").GetString()!);
        var route = gpx.Descendants(Suunto + "route").Single();
        Assert.Equal(imported.GetProperty("id").GetString(), route.Element(Suunto + "id")!.Value);
        Assert.Equal(imported.GetProperty("modified").GetInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
            route.Element(Suunto + "revision")!.Value);
    }

    [Fact]
    public async Task Route_update_with_current_revision_succeeds_and_stale_revision_conflicts()
    {
        var id = (await ImportAsync(SampleGpx)).GetProperty("id").GetString()!;
        var exported = await ExportAsync(id);
        exported.Descendants(MockGpxNs.Gpx + "name").First().Value = "Renamed";

        var ok = await PutGpxAsync(id, exported);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var newRevision = XDocument.Parse(await ok.Content.ReadAsStringAsync()).Descendants(Suunto + "revision").Single().Value;
        Assert.NotEqual(exported.Descendants(Suunto + "revision").Single().Value, newRevision);

        // Same (now stale) document again: Suunto answers 409.
        var stale = await PutGpxAsync(id, exported);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task Route_update_without_identity_is_bad_request()
    {
        var id = (await ImportAsync(SampleGpx)).GetProperty("id").GetString()!;

        var res = await PutGpxAsync(id, XDocument.Parse(SampleGpx));

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Poi_create_upsert_get_list()
    {
        var create = await _api.PostAsJsonAsync("/v2/poi/create", new
        {
            point = new { x = 24.5032, y = 60.3121, z = 1034.0, name = "Kettle spring", type = 12 },
            activityId = 11,
            watchEnabled = true,
        });
        Assert.Equal(HttpStatusCode.OK, create.StatusCode);
        var poi = (await create.Content.ReadFromJsonAsync<JsonObject>())!["pointOfInterest"]!.AsObject();
        var key = poi["key"]!.GetValue<string>();
        Assert.Equal(24, key.Length);

        poi["point"]!["name"] = "Kettle spring (dry in Aug)";
        var upsert = await _api.PutAsJsonAsync($"/v2/poi/{key}", poi);
        Assert.Equal(HttpStatusCode.OK, upsert.StatusCode);

        var detail = await _api.GetFromJsonAsync<JsonObject>($"/v2/poi/detail?poiKey={key}");
        Assert.Equal("Kettle spring (dry in Aug)", detail!["pointOfInterest"]!["point"]!["name"]!.GetValue<string>());

        var list = await _api.GetFromJsonAsync<JsonArray>("/v2/poi?limit=10&offset=0");
        Assert.Single(list!);
    }

    [Theory]
    [InlineData(false, 12)]   // watchEnabled must be true
    [InlineData(true, 50)]    // 50 is not a PoiType value (48..63 are unused)
    public async Task Poi_create_validates_like_suunto(bool watchEnabled, int type)
    {
        var res = await _api.PostAsJsonAsync("/v2/poi/create", new
        {
            point = new { x = 24.5, y = 60.3, type },
            watchEnabled,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Poi_with_second_timestamps_is_refused_like_the_live_api()
    {
        var res = await _api.PostAsJsonAsync("/v2/poi/create", new
        {
            creation = 1792049397L,   // seconds: the live API answers 200 + errorCode 4
            modified = 1792049407L,
            point = new { x = 24.5, y = 60.3, type = 26 },
            watchEnabled = true,
        });

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = (await res.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal(4, body["errorCode"]!.GetValue<int>());
        Assert.Equal("", body["pointOfInterest"]!["key"]!.GetValue<string>());
    }

    [Fact]
    public async Task Poi_upsert_key_must_match_path()
    {
        var res = await _api.PutAsJsonAsync("/v2/poi/aaaaaaaaaaaaaaaaaaaaaaaa", new
        {
            key = "bbbbbbbbbbbbbbbbbbbbbbbb",
            point = new { x = 24.5, y = 60.3, type = 26 },
            watchEnabled = true,
        });

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    private async Task<JsonElement> ImportAsync(string gpx, string? activities = null)
    {
        var url = activities is null ? "/v2/route/import" : $"/v2/route/import?activities={activities}";
        var res = await _api.PostAsync(url, new StringContent(gpx, Encoding.UTF8, "application/gpx+xml"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        // Live shape: {"items":[route]}.
        return (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("items")[0];
    }

    private async Task<XDocument> ExportAsync(string id)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, $"/v2/route/{id}/export");
        req.Headers.Accept.ParseAdd("application/gpx+xml");
        var res = await _api.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return XDocument.Parse(await res.Content.ReadAsStringAsync());
    }

    private Task<HttpResponseMessage> PutGpxAsync(string id, XDocument gpx) =>
        _api.PutAsync($"/v2/route/{id}", new StringContent(gpx.ToString(), Encoding.UTF8, "application/gpx+xml"));

    private async Task<string> GetAccessTokenAsync(string username)
    {
        var browser = _suunto.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var consent = await browser.PostAsync("/oauth/authorize", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = "mock-client",
            ["redirect_uri"] = "http://localhost/cb",
            ["username"] = username,
            ["decision"] = "allow",
        }));
        var code = QueryHelpers.ParseQuery(consent.Headers.Location!.Query)["code"]!;

        using var tokenReq = new HttpRequestMessage(HttpMethod.Post, "/oauth/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["code"] = code!,
                ["redirect_uri"] = "http://localhost/cb",
            }),
        };
        tokenReq.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String("mock-client:mock-secret"u8.ToArray()));
        var tokenRes = await browser.SendAsync(tokenReq);
        return (await tokenRes.Content.ReadFromJsonAsync<JsonObject>())!["access_token"]!.GetValue<string>();
    }

    private static class MockGpxNs
    {
        public static readonly XNamespace Gpx = "http://www.topografix.com/GPX/1/1";
    }
}
