extern alias mock;

using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;
using MockStore = mock::RoutePoiManager.MockSuunto.MockStore;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class SuuntoLoginFlowTests(PostgresFixture pg)
{
    [Fact]
    public async Task Login_round_trip_creates_session_and_stores_encrypted_tokens()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var browser = api.CreateBrowser();

        var callback = await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "alice", allow: true);
        var callbackRes = await browser.GetAsync(callback);

        Assert.Equal(HttpStatusCode.OK, callbackRes.StatusCode);
        Assert.Contains("\"status\":\"success\"", await callbackRes.Content.ReadAsStringAsync());

        var me = await browser.GetFromJsonAsync<MeResponse>("/api/me");
        Assert.Equal("alice", me!.Username);
        Assert.Equal("Mock", me.SuuntoMode);
        Assert.True(me.SuuntoConnected);

        await using var scope = api.Services.CreateAsyncScope();
        var user = scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Single();
        Assert.Equal("alice", user.SuuntoUsername);
        Assert.DoesNotContain(suunto.Services.GetRequiredService<MockStore>().AccessTokens.Keys, k => user.AccessTokenProtected.Contains(k, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Callback_with_wrong_state_is_rejected()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var browser = api.CreateBrowser();

        var callback = await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "mallory", allow: true);
        var tampered = callback.Replace("state=", "state=x", StringComparison.Ordinal);

        var res = await browser.GetAsync(tampered);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("/login?error=state_mismatch", await res.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Denied_consent_returns_to_login_with_error()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var browser = api.CreateBrowser();

        var callback = await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "bob", allow: false);
        var res = await browser.GetAsync(callback);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("/login?error=access_denied", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Expiring_access_token_is_refreshed()
    {
        // 60 s lifetime is inside the 5 min refresh window, so every request refreshes.
        await using var suunto = new MockSuuntoFactory(accessTokenLifetimeSeconds: 60);
        await using var api = new ApiFactory(pg, suunto);
        var browser = api.CreateBrowser();
        await browser.GetAsync(await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "carol", allow: true));

        var mockStore = suunto.Services.GetRequiredService<MockStore>();
        var issuedAtLogin = mockStore.AccessTokens.Keys.Single();

        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var tokens = scope.ServiceProvider.GetRequiredService<SuuntoTokenService>();
        var token = await tokens.GetAccessTokenAsync(db.Users.Single().Id, CancellationToken.None);

        Assert.NotEqual(issuedAtLogin, token);
        Assert.True(mockStore.AccessTokens.ContainsKey(token));
        Assert.Equal("carol", SuuntoOAuthClient.ReadUsername(token));
    }

    [Fact]
    public async Task Disconnect_revokes_at_suunto_and_ends_session()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var browser = api.CreateBrowser();
        await browser.GetAsync(await TestAuth.AuthorizeAtSuuntoAsync(browser, suunto, "dave", allow: true));

        using var req = new HttpRequestMessage(HttpMethod.Post, "/auth/disconnect");
        req.Headers.Add("X-RPM-CSRF", "1");
        var res = await browser.SendAsync(req);

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Empty(suunto.Services.GetRequiredService<MockStore>().AccessTokens);
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/me")).StatusCode);
    }

    [Fact]
    public async Task Unsafe_request_without_csrf_header_is_rejected()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);

        var res = await api.CreateBrowser().PostAsync("/auth/logout", null);

        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }
}
