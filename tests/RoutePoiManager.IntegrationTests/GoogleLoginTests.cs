using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.WebUtilities;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class GoogleLoginTests(PostgresFixture pg)
{
    [Fact]
    public async Task Google_subject_creates_and_reuses_a_separate_app_account()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        await using var scope = api.Services.CreateAsyncScope();
        var accounts = scope.ServiceProvider.GetRequiredService<GoogleAccountService>();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var first = await accounts.GetOrCreateAsync("google-subject-1", CancellationToken.None);
        var repeated = await accounts.GetOrCreateAsync("google-subject-1", CancellationToken.None);
        var separate = await accounts.GetOrCreateAsync("google-subject-2", CancellationToken.None);

        Assert.Equal(first.Id, repeated.Id);
        Assert.NotEqual(first.Id, separate.Id);
        Assert.Null(first.SuuntoUsername);
        Assert.Equal("google-subject-1", first.GoogleSubject);
        Assert.Equal("", first.AccessTokenProtected);
        Assert.Equal(2, db.Users.Count());
        var tokens = scope.ServiceProvider.GetRequiredService<SuuntoTokenService>();
        await Assert.ThrowsAsync<SuuntoNotConnectedException>(
            () => tokens.GetAccessTokenAsync(first.Id, CancellationToken.None));
    }

    [Fact]
    public async Task Google_login_reports_missing_provider_configuration()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);

        var response = await api.CreateBrowser().GetAsync("/auth/google");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("google_not_configured", await response.Content.ReadAsStringAsync());
        Assert.Contains("rpm-google-auth", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Google_login_challenges_the_google_oauth_provider_when_configured()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto, enableGoogle: true);

        var response = await api.CreateBrowser().GetAsync("/auth/google");
        var location = response.Headers.Location!;
        var query = QueryHelpers.ParseQuery(location.Query);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        Assert.Equal("accounts.google.com", location.Host);
        Assert.Equal("test-google-client", query["client_id"]);
        Assert.EndsWith("/auth/google-callback", query["redirect_uri"]);
    }
}
