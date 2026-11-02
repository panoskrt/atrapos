using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NetTopologySuite.Geometries;
using RoutePoiManager.Api.Admin;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using Route = RoutePoiManager.Domain.Route;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class AdminApiTests(PostgresFixture pg)
{
    private const string Admin = "admin-user";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private ApiFactory NewApi(MockSuuntoFactory suunto) =>
        new(pg, suunto, settings: new Dictionary<string, string> { ["Admin:SuuntoUsernames"] = Admin });

    [Fact]
    public async Task Admin_api_is_closed_to_signed_out_and_non_admin_users()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);

        Assert.Equal(HttpStatusCode.Unauthorized, (await api.CreateBrowser().GetAsync("/api/admin/stats")).StatusCode);

        using var other = await TestAuth.SignInAsync(api, suunto, "regular-user");
        foreach (var path in new[] { "stats", "users", "routes", "pois", "source-files", "sync-log", "error-logs", "config" })
            Assert.Equal(HttpStatusCode.Forbidden, (await other.GetAsync($"/api/admin/{path}")).StatusCode);
        Assert.False((await other.GetFromJsonAsync<MeResponse>("/api/me", Json))!.IsAdmin);

        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/admin/stats")).StatusCode);
        Assert.True((await admin.GetFromJsonAsync<MeResponse>("/api/me", Json))!.IsAdmin);
    }

    [Fact]
    public async Task Nobody_is_an_admin_when_no_admin_is_configured()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        using var user = await TestAuth.SignInAsync(api, suunto, Admin);

        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/api/admin/stats")).StatusCode);
    }

    [Fact]
    public async Task Admin_lists_edits_and_deletes_routes_and_pois_across_users()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);
        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);
        using var other = await TestAuth.SignInAsync(api, suunto, "route-owner");
        var (userId, routeId, poiId) = await SeedAsync(api, "route-owner");

        var routes = await admin.GetFromJsonAsync<PagedResult<AdminRouteRow>>("/api/admin/routes?q=Seeded", Json);
        var row = Assert.Single(routes!.Items);
        Assert.Equal(routeId, row.Id);
        Assert.Equal("route-owner", row.Owner);
        Assert.Equal(1, row.PoiCount);

        var before = await admin.GetFromJsonAsync<AdminStats>("/api/admin/stats", Json);
        Assert.Equal(1, before!.RoutesBySyncState["localOnly"]);

        var files = await admin.GetFromJsonAsync<PagedResult<AdminSourceFileRow>>("/api/admin/source-files", Json);
        var file = Assert.Single(files!.Items);
        Assert.Equal((4, "Seeded route"), (file.SizeBytes, file.RouteName));
        Assert.Equal([1, 2, 3, 4], await admin.GetByteArrayAsync($"/api/admin/source-files/{file.Id}/download"));
        var log = await admin.GetFromJsonAsync<PagedResult<AdminSyncLogRow>>("/api/admin/sync-log?q=seed", Json);
        Assert.Equal("route-owner", Assert.Single(log!.Items).Owner);

        var update = new AdminRouteUpdate("Renamed", "desc", [ActivityTypes.Cycling], true, RoutingProfiles.Default, 7, SyncState.Synced);
        var saved = await admin.PutAsJsonAsync($"/api/admin/routes/{routeId}", update, Json);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var detail = await saved.Content.ReadFromJsonAsync<AdminRouteDetail>(Json);
        Assert.Equal("Renamed", detail!.Row.Name);
        Assert.Equal(SyncState.Synced, detail.Row.SyncState);
        Assert.Equal([ActivityTypes.Cycling], detail.ActivityIds);
        Assert.Equal("seed.gpx", Assert.Single(detail.SourceFiles).FileName);

        var invalid = await admin.PutAsJsonAsync($"/api/admin/routes/{routeId}", update with { Name = " ", ActivityIds = [9999] }, Json);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        // A soft-deleted POI is invisible to the app but listed (and restorable) here.
        var poiUpdate = new AdminPoiUpdate("Spring", null, PoiTypes.Water, 60.1, 24.1, 12, null, SyncState.LocalOnly, Deleted: true);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/pois/{poiId}", poiUpdate, Json)).StatusCode);
        Assert.Empty((await other.GetFromJsonAsync<List<JsonElement>>("/api/pois"))!);
        var deleted = await admin.GetFromJsonAsync<PagedResult<AdminPoiRow>>("/api/admin/pois?deleted=only", Json);
        Assert.Equal(poiId, Assert.Single(deleted!.Items).Id);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/pois/{poiId}", poiUpdate with { Deleted = false }, Json)).StatusCode);
        Assert.Empty((await admin.GetFromJsonAsync<PagedResult<AdminPoiRow>>("/api/admin/pois?deleted=only", Json))!.Items);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/routes/{routeId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/admin/routes/{routeId}")).StatusCode);
        // The route's POI went with it.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/admin/pois/{poiId}")).StatusCode);

        var stats = await admin.GetFromJsonAsync<AdminStats>("/api/admin/stats", Json);
        Assert.Equal(2, stats!.Users);
        Assert.Equal(0, stats.Routes);
        Assert.NotEqual(Guid.Empty, userId);
    }

    [Fact]
    public async Task Admin_cannot_delete_their_own_account_but_can_delete_others()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);
        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);
        var (userId, _, _) = await SeedAsync(api, "doomed-user");

        var users = await admin.GetFromJsonAsync<PagedResult<AdminUserRow>>("/api/admin/users", Json);
        var self = users!.Items.Single(u => u.SuuntoUsername == Admin);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/admin/users/{self.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/users/{userId}")).StatusCode);
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Routes.AnyAsync());
        Assert.False(await db.Pois.IgnoreQueryFilters().AnyAsync());
    }

    [Fact]
    public async Task Allowlist_edits_apply_immediately_and_cannot_lock_the_admin_out()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);
        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);
        var allowlist = api.Services.GetRequiredService<SignInAllowlist>();
        Assert.True(allowlist.IsOpen);

        var lockout = await admin.PutAsJsonAsync("/api/admin/config/auth", new AdminAuthConfigUpdate(null, "someone-else"), Json);
        Assert.Equal(HttpStatusCode.Conflict, lockout.StatusCode);
        Assert.True(allowlist.IsOpen);

        var ok = await admin.PutAsJsonAsync("/api/admin/config/auth", new AdminAuthConfigUpdate(null, $"{Admin}, friend\nfriend"), Json);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var config = await ok.Content.ReadFromJsonAsync<AdminConfig>(Json);
        Assert.True(config!.AllowedSuuntoUsernames.Overridden);
        Assert.Equal($"{Admin}, friend", config.AllowedSuuntoUsernames.Value);
        Assert.True(allowlist.AllowsSuunto("friend"));
        Assert.False(allowlist.AllowsSuunto("stranger"));

        var reset = await admin.PutAsJsonAsync("/api/admin/config/auth", new AdminAuthConfigUpdate(null, null, ResetSuuntoUsernames: true), Json);
        Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
        Assert.True(allowlist.IsOpen);
    }

    [Fact]
    public async Task Config_never_reveals_secrets()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);
        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);

        var body = await (await admin.GetAsync("/api/admin/config")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("mock-secret", body, StringComparison.Ordinal);
        Assert.DoesNotContain("mock-subscription-key", body, StringComparison.Ordinal);
        Assert.DoesNotContain("Password=", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Error_log_entries_can_be_listed_and_purged()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);
        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);
        await using (var scope = api.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ErrorLogs.Add(new ErrorLog { At = DateTimeOffset.UtcNow.AddDays(-100), Operation = "old", Message = "old failure" });
            db.ErrorLogs.Add(new ErrorLog { At = DateTimeOffset.UtcNow, Operation = "new", Message = "fresh failure", StackTrace = "trace" });
            await db.SaveChangesAsync();
        }

        var page = await admin.GetFromJsonAsync<PagedResult<AdminErrorLogRow>>("/api/admin/error-logs?q=failure", Json);
        Assert.Equal(2, page!.Total);
        Assert.Equal("new", page.Items[0].Operation);
        var detail = await admin.GetFromJsonAsync<AdminErrorLogDetail>($"/api/admin/error-logs/{page.Items[0].Id}", Json);
        Assert.Equal("trace", detail!.StackTrace);

        var purged = await admin.PostAsJsonAsync("/api/admin/error-logs/purge", new PurgeRequest(30), Json);
        Assert.Equal(1, (await purged.Content.ReadFromJsonAsync<PurgeResponse>(Json))!.Deleted);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync("/api/admin/error-logs/purge", new PurgeRequest(-1), Json)).StatusCode);
    }

    [Fact]
    public async Task Time_series_is_zero_filled_per_bucket_and_validates_the_range()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = NewApi(suunto);
        using var admin = await TestAuth.SignInAsync(api, suunto, Admin);
        await SeedAsync(api, "series-user");

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = today.AddDays(-6);
        var series = await admin.GetFromJsonAsync<AdminTimeSeries>($"/api/admin/stats/timeseries?from={from:yyyy-MM-dd}&to={today:yyyy-MM-dd}&bucket=day", Json);
        Assert.Equal(7, series!.Buckets.Count);
        Assert.Equal(from, series.Buckets[0]);
        var routes = series.Metrics.Single(m => m.Key == "routes");
        Assert.Equal(7, routes.Values.Count);
        Assert.Equal(1, routes.Total);
        Assert.Equal(1, routes.Values[^1]);
        Assert.Equal(1, series.Metrics.Single(m => m.Key == "routePushes").Total);
        Assert.Equal(0, series.Metrics.Single(m => m.Key == "errors").Total);

        // Auto picks weeks for a long range and starts on a Monday; data outside the range is not counted.
        var year = await admin.GetFromJsonAsync<AdminTimeSeries>($"/api/admin/stats/timeseries?from={today.AddDays(-200):yyyy-MM-dd}&to={today:yyyy-MM-dd}", Json);
        Assert.Equal("week", year!.Bucket);
        Assert.Equal(DayOfWeek.Monday, year.Buckets[0].DayOfWeek);
        var past = await admin.GetFromJsonAsync<AdminTimeSeries>($"/api/admin/stats/timeseries?from=2020-01-01&to=2020-03-31&bucket=month", Json);
        Assert.Equal([new DateOnly(2020, 1, 1), new DateOnly(2020, 2, 1), new DateOnly(2020, 3, 1)], past!.Buckets);
        Assert.All(past.Metrics, m => Assert.Equal(0, m.Total));

        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.GetAsync($"/api/admin/stats/timeseries?from={today:yyyy-MM-dd}&to={from:yyyy-MM-dd}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.GetAsync("/api/admin/stats/timeseries?from=2024-01-01&to=2026-01-01&bucket=day")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.GetAsync("/api/admin/stats/timeseries?bucket=hour")).StatusCode);
    }

    private static async Task<(Guid UserId, Guid RouteId, Guid PoiId)> SeedAsync(ApiFactory api, string suuntoUsername)
    {
        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = DateTimeOffset.UtcNow;
        var user = await db.Users.SingleOrDefaultAsync(u => u.SuuntoUsername == suuntoUsername);
        if (user is null)
        {
            user = new User { Id = Guid.CreateVersion7(), SuuntoUsername = suuntoUsername, AccessTokenProtected = "", RefreshTokenProtected = "", CreatedAt = now };
            db.Users.Add(user);
        }
        var route = new Route { Id = Guid.CreateVersion7(), UserId = user.Id, Name = "Seeded route", CreatedAt = now, LocalModifiedAt = now };
        var poi = new Poi
        {
            Id = Guid.CreateVersion7(), UserId = user.Id, RouteId = route.Id, Name = "Spring",
            Location = new Point(24.1, 60.1) { SRID = 4326 }, CreatedAt = now, LocalModifiedAt = now,
        };
        db.Routes.Add(route);
        db.Pois.Add(poi);
        db.SourceFiles.Add(new SourceFile { Id = Guid.CreateVersion7(), RouteId = route.Id, FileName = "seed.gpx", Kind = RouteSource.Gpx, Content = [1, 2, 3, 4], UploadedAt = now });
        db.SyncLog.Add(new SyncLogEntry { UserId = user.Id, Entity = "route", EntityId = route.Id, Operation = "import", HttpStatus = 200, Message = "seed message", At = now });
        await db.SaveChangesAsync();
        return (user.Id, route.Id, poi.Id);
    }
}
