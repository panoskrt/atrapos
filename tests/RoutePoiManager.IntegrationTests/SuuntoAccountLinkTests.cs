using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class SuuntoAccountLinkTests(PostgresFixture pg)
{
    [Fact]
    public async Task Connecting_suunto_merges_existing_data_into_google_account_and_keeps_suunto_records_on_conflicts()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        await using var scope = api.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<AppDbContext>();
        var accounts = services.GetRequiredService<GoogleAccountService>();
        var oauth = services.GetRequiredService<SuuntoOAuthClient>();
        var tokens = services.GetRequiredService<SuuntoTokenService>();

        var suuntoBrowser = api.CreateBrowser();
        var firstCallback = await TestAuth.AuthorizeAtSuuntoAsync(suuntoBrowser, suunto, "link-user", allow: true);
        var firstCode = QueryHelpers.ParseQuery(new Uri($"http://localhost{firstCallback}").Query)["code"].ToString();
        var suuntoTokens = await oauth.ExchangeCodeAsync(firstCode, CancellationToken.None);
        var suuntoAccount = await tokens.SaveTokensAsync(suuntoTokens, CancellationToken.None);
        var googleAccount = await accounts.GetOrCreateAsync("google-link-subject", CancellationToken.None);

        var now = DateTimeOffset.UtcNow;
        var suuntoRoute = new Route
        {
            Id = Guid.NewGuid(),
            UserId = suuntoAccount.Id,
            Name = "Suunto route version",
            SuuntoRouteId = "remote-route",
            SyncState = SyncState.Synced,
            CreatedAt = now,
            LocalModifiedAt = now,
        };
        var googleRoute = new Route
        {
            Id = Guid.NewGuid(),
            UserId = googleAccount.Id,
            Name = "Google route version",
            SuuntoRouteId = "remote-route",
            SyncState = SyncState.LocalChanges,
            CreatedAt = now,
            LocalModifiedAt = now,
        };
        db.Routes.AddRange(suuntoRoute, googleRoute);
        var suuntoPoi = CreatePoi(suuntoAccount.Id, suuntoRoute.Id, "Suunto POI version", "remote-poi", now);
        var duplicateGooglePoi = CreatePoi(googleAccount.Id, googleRoute.Id, "Google POI version", "remote-poi", now);
        var googleOnlyPoi = CreatePoi(googleAccount.Id, googleRoute.Id, "Google-only POI", "google-only-poi", now);
        db.Pois.AddRange(suuntoPoi, duplicateGooglePoi, googleOnlyPoi);
        db.SourceFiles.Add(new SourceFile
        {
            Id = Guid.NewGuid(),
            RouteId = googleRoute.Id,
            FileName = "google-copy.gpx",
            Kind = RouteSource.Gpx,
            Content = [1, 2, 3],
            UploadedAt = now,
        });
        await db.SaveChangesAsync();

        var connectBrowser = api.CreateBrowser();
        var connectCallback = await TestAuth.AuthorizeAtSuuntoAsync(connectBrowser, suunto, "link-user", allow: true);
        var connectCode = QueryHelpers.ParseQuery(new Uri($"http://localhost{connectCallback}").Query)["code"].ToString();
        var connectTokens = await oauth.ExchangeCodeAsync(connectCode, CancellationToken.None);

        await tokens.ConnectToGoogleAccountAsync(googleAccount.Id, connectTokens, CancellationToken.None);

        db.ChangeTracker.Clear();
        var mergedAccount = await db.Users.SingleAsync(u => u.Id == googleAccount.Id);
        Assert.Equal("link-user", mergedAccount.SuuntoUsername);
        Assert.NotEqual("", mergedAccount.RefreshTokenProtected);
        Assert.False(await db.Users.AnyAsync(u => u.Id == suuntoAccount.Id));

        var keptRoute = await db.Routes.SingleAsync(r => r.UserId == googleAccount.Id && r.SuuntoRouteId == "remote-route");
        Assert.Equal(suuntoRoute.Id, keptRoute.Id);
        Assert.Equal("Suunto route version", keptRoute.Name);
        Assert.Equal(2, await db.Pois.CountAsync(p => p.UserId == googleAccount.Id));
        Assert.Equal(
            "Suunto POI version",
            await db.Pois.Where(p => p.UserId == googleAccount.Id && p.SuuntoPoiKey == "remote-poi").Select(p => p.Name).SingleAsync());
        var keptGooglePoi = await db.Pois.SingleAsync(p => p.UserId == googleAccount.Id && p.SuuntoPoiKey == "google-only-poi");
        Assert.Equal(suuntoRoute.Id, keptGooglePoi.RouteId);
        Assert.Equal(suuntoRoute.Id, await db.SourceFiles.Where(f => f.FileName == "google-copy.gpx").Select(f => f.RouteId).SingleAsync());
    }

    private static Poi CreatePoi(Guid userId, Guid routeId, string name, string? suuntoPoiKey, DateTimeOffset now) =>
        new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            RouteId = routeId,
            Name = name,
            PoiType = PoiTypes.Poi,
            Location = new Point(24, 60) { SRID = 4326 },
            SuuntoPoiKey = suuntoPoiKey,
            SyncState = suuntoPoiKey is null ? SyncState.LocalOnly : SyncState.Synced,
            CreatedAt = now,
            LocalModifiedAt = now,
        };
}
