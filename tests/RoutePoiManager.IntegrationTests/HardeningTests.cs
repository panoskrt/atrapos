using System.Net;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class HardeningTests(PostgresFixture pg)
{
    [Fact]
    public async Task Responses_carry_security_headers_and_the_csp_skips_auth_pages()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        using var browser = api.CreateBrowser();

        var home = await browser.GetAsync("/healthz");
        Assert.Equal("nosniff", home.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", home.Headers.GetValues("X-Frame-Options").Single());
        Assert.Contains("frame-ancestors 'none'", home.Headers.GetValues("Content-Security-Policy").Single());

        var auth = await browser.GetAsync("/auth/google");
        Assert.False(auth.Headers.Contains("Content-Security-Policy"));
        Assert.Equal("nosniff", auth.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task Hsts_is_off_by_default_and_on_for_https_when_enabled()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var plain = new ApiFactory(pg, suunto);
        using var plainClient = plain.CreateBrowser();
        Assert.False((await plainClient.GetAsync("/healthz")).Headers.Contains("Strict-Transport-Security"));

        await using var hsts = new ApiFactory(pg, suunto, settings: new Dictionary<string, string> { ["Hosting:Hsts"] = "true" });
        using var secure = hsts.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://app.example.com"),
            AllowAutoRedirect = false,
        });
        Assert.Contains("max-age=", (await secure.GetAsync("/healthz")).Headers.GetValues("Strict-Transport-Security").Single());
    }

    [Fact]
    public async Task Forwarded_proto_is_honoured_only_when_enabled()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var off = new ApiFactory(pg, suunto, enableGoogle: true);
        await using var on = new ApiFactory(pg, suunto, enableGoogle: true,
            settings: new Dictionary<string, string> { ["Hosting:ForwardedHeaders"] = "true" });

        Assert.StartsWith("http://", await RedirectUriAsync(off));
        Assert.StartsWith("https://localhost/", await RedirectUriAsync(on));

        static async Task<string> RedirectUriAsync(ApiFactory api)
        {
            using var browser = api.CreateBrowser();
            using var request = new HttpRequestMessage(HttpMethod.Get, "/auth/google");
            request.Headers.Add("X-Forwarded-Proto", "https");
            var response = await browser.SendAsync(request);
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            var query = System.Web.HttpUtility.ParseQueryString(response.Headers.Location!.Query);
            return query["redirect_uri"]!;
        }
    }

    [Fact]
    public async Task Auth_endpoints_are_rate_limited_per_address()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto,
            settings: new Dictionary<string, string> { ["Hosting:RateLimit:AuthPerMinute"] = "3" });
        using var browser = api.CreateBrowser();

        for (var i = 0; i < 3; i++)
            Assert.NotEqual(HttpStatusCode.TooManyRequests, (await browser.GetAsync("/auth/login")).StatusCode);

        var limited = await browser.GetAsync("/auth/login");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(limited.Headers.Contains("Retry-After"));
        // Other endpoints keep their own budget.
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/healthz")).StatusCode);
    }

    [Fact]
    public async Task Rate_limiting_can_be_turned_off()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, settings: new Dictionary<string, string>
        {
            ["Hosting:RateLimit:Enabled"] = "false",
            ["Hosting:RateLimit:AuthPerMinute"] = "1",
        });
        using var browser = api.CreateBrowser();
        for (var i = 0; i < 5; i++)
            Assert.NotEqual(HttpStatusCode.TooManyRequests, (await browser.GetAsync("/auth/login")).StatusCode);
    }
}
