using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class AccessControlTests(PostgresFixture pg)
{
    /// <summary>Everything else needs a signed-in user. Adding a public endpoint means adding it here, on purpose.</summary>
    private static readonly string[] PublicEndpoints =
    [
        "GET /healthz",
        "GET /auth/google",
        "GET /auth/login",
        "GET /auth/callback",
        "POST /auth/logout",
        "GET /openapi/{documentName}.json",
        "GET,HEAD {*path:nonfile}",
    ];

    [Fact]
    public async Task Endpoints_require_sign_in_unless_explicitly_public()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);

        var fallback = api.Services.GetRequiredService<IOptions<AuthorizationOptions>>().Value.FallbackPolicy;
        Assert.NotNull(fallback);
        Assert.Contains(fallback.Requirements, r => r is Microsoft.AspNetCore.Authorization.Infrastructure.DenyAnonymousAuthorizationRequirement);

        var endpoints = api.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().ToList();
        var anonymous = endpoints
            .Where(e => e.Metadata.GetMetadata<IAllowAnonymous>() is not null)
            .Select(e => $"{string.Join(',', e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["*"])} {e.RoutePattern.RawText}")
            .Order(StringComparer.Ordinal);

        // Joined, so a failure prints the whole list.
        Assert.Equal(string.Join('\n', PublicEndpoints.Order(StringComparer.Ordinal)), string.Join('\n', anonymous));
        Assert.True(endpoints.Count > PublicEndpoints.Length + 20, "The endpoint list looks incomplete.");
    }

    [Theory]
    [InlineData("/api/me")]
    [InlineData("/api/lookups/poi-types")]
    [InlineData("/api/lookups/activity-types")]
    [InlineData("/api/routes")]
    [InlineData("/api/unknown")]
    public async Task Signed_out_requests_are_unauthorized(string path)
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateBrowser().GetAsync(path)).StatusCode);
    }

    [Theory]
    [InlineData("http://127.0.0.1")]
    [InlineData("http://[::1]")]
    public async Task Pages_opened_on_a_loopback_ip_move_to_localhost_where_sign_in_is_registered(string origin)
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, enableGoogle: true);
        var browser = api.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, BaseAddress = new Uri(origin) });

        var page = await browser.GetAsync("/auth/google?from=test");
        Assert.Equal(HttpStatusCode.TemporaryRedirect, page.StatusCode);
        Assert.Equal("http://localhost/auth/google?from=test", page.Headers.Location!.ToString());

        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/healthz")).StatusCode);
        var logout = new HttpRequestMessage(HttpMethod.Post, "/auth/logout");
        logout.Headers.Add("X-RPM-CSRF", "1");
        Assert.Equal(HttpStatusCode.NoContent, (await browser.SendAsync(logout)).StatusCode);

        var google = await api.CreateBrowser().GetAsync("/auth/google");
        Assert.Equal("http://localhost/auth/google-callback",
            QueryHelpers.ParseQuery(google.Headers.Location!.Query)["redirect_uri"].ToString());
    }

    [Fact]
    public async Task Suunto_sign_in_outside_the_allowlist_is_refused_and_stores_nothing()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, settings: new Dictionary<string, string>
        {
            ["Auth:AllowedSuuntoUsernames"] = "alice, bob",
        });
        var browser = api.CreateBrowser();

        var res = await browser.GetAsync(await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "mallory", allow: true));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("/login?error=not_allowed", await res.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/me")).StatusCode);
        await using var scope = api.Services.CreateAsyncScope();
        Assert.Empty(scope.ServiceProvider.GetRequiredService<AppDbContext>().Users);
    }

    [Fact]
    public async Task Suunto_sign_in_on_the_allowlist_ignores_case_and_spacing()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, settings: new Dictionary<string, string>
        {
            ["Auth:AllowedSuuntoUsernames"] = " Alice ; bob",
        });

        var browser = await TestAuth.SignInAsync(api, suunto, "alice");

        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/me")).StatusCode);
    }

    [Theory]
    [InlineData(null, 60)]
    [InlineData("7.00:00:00", 7)]
    public async Task Session_cookie_lasts_the_configured_lifetime(string? setting, int expectedDays)
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, settings: setting is null
            ? null
            : new Dictionary<string, string> { ["Auth:SessionLifetime"] = setting });
        var browser = api.CreateBrowser();

        var res = await browser.GetAsync(await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "alice", allow: true));

        var cookie = Microsoft.Net.Http.Headers.SetCookieHeaderValue.ParseList(res.Headers.GetValues("Set-Cookie").ToList())
            .Single(c => c.Name == "rpm.session");
        Assert.NotNull(cookie.Expires);
        var expected = TimeSpan.FromDays(expectedDays);
        Assert.InRange(cookie.Expires.Value - DateTimeOffset.UtcNow, expected - TimeSpan.FromMinutes(5), expected);
    }

    [Fact]
    public async Task Session_ends_when_the_account_is_deleted()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, settings: RevalidateEveryRequest);
        var browser = await TestAuth.SignInAsync(api, suunto, "alice");
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/me")).StatusCode);

        await using (var scope = api.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Users.RemoveRange(db.Users);
            await db.SaveChangesAsync();
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Session_ends_when_the_account_is_taken_off_the_allowlist()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, settings: new Dictionary<string, string>(RevalidateEveryRequest)
        {
            ["Auth:AllowedSuuntoUsernames"] = "alice",
        });
        var browser = await TestAuth.SignInAsync(api, suunto, "alice");
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/api/me")).StatusCode);

        var config = (IConfigurationRoot)api.Services.GetRequiredService<IConfiguration>();
        config["Auth:AllowedSuuntoUsernames"] = "bob";
        config.Reload();

        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Google_sign_in_with_an_allowlisted_verified_email_succeeds()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = GoogleApi(suunto, "Owner@Example.com", verified: true);
        var browser = HttpsBrowser(api);

        var res = await CompleteGoogleSignInAsync(browser);

        Assert.Equal(HttpStatusCode.Redirect, res.StatusCode);
        Assert.Equal("/auth/google-popup-complete", res.Headers.Location!.OriginalString);
        var me = await browser.GetFromJsonAsync<RoutePoiManager.Api.Auth.MeResponse>("/api/me");
        Assert.True(me!.GoogleAccount);
        Assert.Equal("Owner", me.Username);
    }

    [Theory]
    [InlineData("stranger@example.com", true)]
    [InlineData("owner@example.com", false)]
    public async Task Google_sign_in_outside_the_allowlist_or_unverified_is_refused_and_stores_nothing(string email, bool verified)
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = GoogleApi(suunto, email, verified);
        var browser = HttpsBrowser(api);

        var res = await CompleteGoogleSignInAsync(browser);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("/login?error=not_allowed", await res.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/me")).StatusCode);
        await using var scope = api.Services.CreateAsyncScope();
        Assert.Empty(scope.ServiceProvider.GetRequiredService<AppDbContext>().Users);
    }

    private static readonly Dictionary<string, string> RevalidateEveryRequest = new()
    {
        ["Auth:SessionRevalidationInterval"] = "00:00:00",
    };

    /// <summary>The API with Google sign-in enabled, its server-to-server calls answered by <see cref="FakeGoogle"/>.</summary>
    private ApiFactory GoogleApi(MockSuuntoFactory suunto, string email, bool verified) =>
        new(pg, suunto,
            services => services.PostConfigure<GoogleOptions>(GoogleDefaults.AuthenticationScheme,
                o => o.Backchannel = new HttpClient(new FakeGoogle(email, verified))),
            enableGoogle: true,
            settings: new Dictionary<string, string> { ["Auth:AllowedGoogleEmails"] = "owner@example.com" });

    /// <summary>Google's correlation cookie is Secure, so the browser must talk HTTPS to keep it.</summary>
    private static HttpClient HttpsBrowser(ApiFactory api) =>
        api.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
            BaseAddress = new Uri("https://localhost"),
        });

    /// <summary>Plays the browser: /auth/google → (Google consent) → the callback with Google's code and the state.</summary>
    private static async Task<HttpResponseMessage> CompleteGoogleSignInAsync(HttpClient browser)
    {
        var challenge = await browser.GetAsync("/auth/google");
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        var state = QueryHelpers.ParseQuery(challenge.Headers.Location!.Query)["state"].ToString();
        return await browser.GetAsync($"/auth/google-callback?code=fake-code&state={Uri.EscapeDataString(state)}");
    }

    private sealed class FakeGoogle(string email, bool verified) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(request.RequestUri!.AbsolutePath switch
            {
                "/token" => new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new { access_token = "fake-access", token_type = "Bearer", expires_in = 3600 }),
                },
                "/oauth2/v3/userinfo" => new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = JsonContent.Create(new { sub = "google-owner", email, email_verified = verified, name = "Owner" }),
                },
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            });
    }
}
