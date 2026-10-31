using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using Route = RoutePoiManager.Domain.Route;

namespace RoutePoiManager.Api.Admin;

public sealed record PagedResult<T>(List<T> Items, int Total, int Page, int PageSize);

public sealed record AdminUserRow(
    Guid Id, string? SuuntoUsername, bool GoogleAccount, bool SuuntoConnected,
    DateTimeOffset CreatedAt, DateTimeOffset? LastSuuntoRefreshAt,
    string DefaultMap, string Units, string Theme, string Design, int RouteCount, int PoiCount);

public sealed record AdminUserUpdate(string DefaultMap, string Units, string Theme, string Design);

public sealed record AdminRouteRow(
    Guid Id, Guid UserId, string? Owner, string Name, RouteSource Source, SyncState SyncState,
    double DistanceM, double AscentM, double DescentM, int PoiCount, string? SuuntoRouteId,
    DateTimeOffset CreatedAt, DateTimeOffset LocalModifiedAt);

public sealed record AdminRouteDetail(
    AdminRouteRow Row, string? Description, int[] ActivityIds, bool TurnWaypointsEnabled, string RoutingProfile,
    double SimplifyToleranceM, bool HasElevation, int GeometryPoints, int ControlPointCount,
    long? SuuntoRevision, DateTimeOffset? SuuntoModifiedAt, DateTimeOffset? LastPushedAt, string? LastPushedHash,
    List<AdminSourceFileRow> SourceFiles);

public sealed record AdminRouteUpdate(
    string Name, string? Description, int[] ActivityIds, bool TurnWaypointsEnabled,
    string RoutingProfile, double SimplifyToleranceM, SyncState SyncState);

public sealed record AdminPoiRow(
    Guid Id, Guid UserId, string? Owner, Guid? RouteId, string? RouteName, string Name, int PoiType,
    double Lat, double Lon, double? ElevationM, double? DistanceAlongM, SyncState SyncState,
    string? SuuntoPoiKey, DateTimeOffset CreatedAt, DateTimeOffset LocalModifiedAt, DateTimeOffset? DeletedAt);

public sealed record AdminPoiDetail(
    AdminPoiRow Row, string? Description, int? ActivityId, DateTimeOffset? SuuntoModifiedAt,
    DateTimeOffset? LastPushedAt, string? LastPushedHash);

public sealed record AdminPoiUpdate(
    string Name, string? Description, int PoiType, double Lat, double Lon, double? ElevationM,
    int? ActivityId, SyncState SyncState, bool Deleted);

public sealed record AdminSourceFileRow(
    Guid Id, Guid RouteId, string? RouteName, string FileName, RouteSource Kind, int SizeBytes, DateTimeOffset UploadedAt);

public sealed record AdminStats(
    int Users, int Routes, int Pois, int DeletedPois, int SourceFiles, long SourceFileBytes,
    int SyncLogEntries, int ErrorLogEntries, int ErrorsLast24h, long DatabaseBytes,
    Dictionary<string, int> RoutesBySyncState, Dictionary<string, int> PoisBySyncState);

/// <summary>The admin API: every entity in the database plus the runtime configuration. All of it answers 403
/// unless the signed-in identity is listed under <c>Admin</c> in configuration.</summary>
public static class AdminEndpoints
{
    private const int MaxPageSize = 200;
    private static readonly HashSet<string> MapIds = ["osm", "topo", "cyclosm"];
    private static readonly HashSet<string> UnitSystems = ["metric", "imperial"];
    private static readonly HashSet<string> Themes = ["dark", "light"];
    private static readonly HashSet<string> Designs = ["classic", "alpine", "soft"];

    public static void MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var admin = app.MapGroup("/api/admin").RequireAuthorization(AdminAccess.Policy);

        admin.MapGet("/stats", GetStats);
        MapUsers(admin.MapGroup("/users"));
        MapRoutes(admin.MapGroup("/routes"));
        MapPois(admin.MapGroup("/pois"));
        MapSourceFiles(admin.MapGroup("/source-files"));
        admin.MapAdminLogEndpoints();
        admin.MapAdminConfigEndpoints();
    }

    internal static (int Page, int PageSize) Paging(int? page, int? pageSize) =>
        (Math.Max(page ?? 1, 1), Math.Clamp(pageSize ?? 50, 1, MaxPageSize));

    internal static async Task<PagedResult<T>> ToPageAsync<T>(IQueryable<T> query, int? page, int? pageSize, CancellationToken ct)
    {
        var (p, size) = Paging(page, pageSize);
        var total = await query.CountAsync(ct);
        var items = await query.Skip((p - 1) * size).Take(size).ToListAsync(ct);
        return new PagedResult<T>(items, total, p, size);
    }

    internal static string Like(string q) => "%" + q.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";

    private static async Task<IResult> GetStats(AppDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var since = clock.GetUtcNow().AddHours(-24);
        var routesBySync = await db.Routes.GroupBy(r => r.SyncState).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
        var poisBySync = await db.Pois.GroupBy(p => p.SyncState).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
        var dbBytes = await db.Database.SqlQuery<long>($"SELECT pg_database_size(current_database()) AS \"Value\"").SingleAsync(ct);
        return Results.Ok(new AdminStats(
            await db.Users.CountAsync(ct),
            await db.Routes.CountAsync(ct),
            await db.Pois.CountAsync(ct),
            await db.Pois.IgnoreQueryFilters().CountAsync(p => p.DeletedAt != null, ct),
            await db.SourceFiles.CountAsync(ct),
            await db.SourceFiles.SumAsync(s => (long)s.Content.Length, ct),
            await db.SyncLog.CountAsync(ct),
            await db.ErrorLogs.CountAsync(ct),
            await db.ErrorLogs.CountAsync(e => e.At >= since, ct),
            dbBytes,
            routesBySync.ToDictionary(x => JsonNamingPolicy.CamelCase.ConvertName(x.Key.ToString()), x => x.N),
            poisBySync.ToDictionary(x => JsonNamingPolicy.CamelCase.ConvertName(x.Key.ToString()), x => x.N)));
    }

    // ---- Users ----------------------------------------------------------------------------------------------

    private static void MapUsers(RouteGroupBuilder g)
    {
        g.MapGet("/", async (string? q, int? page, int? pageSize, AppDbContext db, CancellationToken ct) =>
        {
            var users = db.Users.AsNoTracking().AsQueryable();
            if (!string.IsNullOrWhiteSpace(q))
            {
                var like = Like(q);
                users = users.Where(u => (u.SuuntoUsername != null && EF.Functions.ILike(u.SuuntoUsername, like, "\\")) ||
                                         (u.GoogleSubject != null && EF.Functions.ILike(u.GoogleSubject, like, "\\")) ||
                                         EF.Functions.ILike(u.Id.ToString(), like, "\\"));
            }
            return Results.Ok(await ToPageAsync(UserRows(db, users.OrderByDescending(u => u.CreatedAt)), page, pageSize, ct));
        });

        g.MapGet("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var row = await UserRows(db, db.Users.AsNoTracking().Where(u => u.Id == id)).SingleOrDefaultAsync(ct);
            return row is null ? Results.NotFound() : Results.Ok(row);
        });

        g.MapPut("/{id:guid}", async (Guid id, AdminUserUpdate body, AppDbContext db, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (!MapIds.Contains(body.DefaultMap)) errors["defaultMap"] = ["Choose an available map."];
            if (!UnitSystems.Contains(body.Units)) errors["units"] = ["Choose metric or imperial units."];
            if (!Themes.Contains(body.Theme)) errors["theme"] = ["Choose light or dark."];
            if (!Designs.Contains(body.Design)) errors["design"] = ["Choose an available design."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct);
            if (user is null) return Results.NotFound();
            user.DefaultMap = body.DefaultMap;
            user.Units = body.Units;
            user.Theme = body.Theme;
            user.Design = body.Design;
            await db.SaveChangesAsync(ct);
            return Results.Ok(await UserRows(db, db.Users.AsNoTracking().Where(u => u.Id == id)).SingleAsync(ct));
        });

        // Blanks the stored tokens; the user keeps their routes and POIs (same as "Disconnect Suunto").
        g.MapPost("/{id:guid}/disconnect-suunto", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct);
            if (user is null) return Results.NotFound();
            user.AccessTokenProtected = "";
            user.RefreshTokenProtected = "";
            user.AccessTokenExpiresAt = DateTimeOffset.MinValue;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // Cascades to the user's routes, POIs, source files and sync log.
        g.MapDelete("/{id:guid}", async (Guid id, HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            if (id == http.User.GetUserId())
                return Results.Problem("You can't delete the account you are signed in with.", statusCode: StatusCodes.Status409Conflict);
            var deleted = await db.Users.Where(u => u.Id == id).ExecuteDeleteAsync(ct);
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static IQueryable<AdminUserRow> UserRows(AppDbContext db, IQueryable<User> users) =>
        users.Select(u => new AdminUserRow(
            u.Id, u.SuuntoUsername, u.GoogleSubject != null, u.RefreshTokenProtected != "",
            u.CreatedAt, u.LastSuuntoRefreshAt, u.DefaultMap, u.Units, u.Theme, u.Design,
            db.Routes.Count(r => r.UserId == u.Id), db.Pois.Count(p => p.UserId == u.Id)));

    // ---- Routes ---------------------------------------------------------------------------------------------

    private static void MapRoutes(RouteGroupBuilder g)
    {
        g.MapGet("/", async (string? q, Guid? userId, SyncState? syncState, RouteSource? source, int? page, int? pageSize,
            AppDbContext db, CancellationToken ct) =>
        {
            var routes = db.Routes.AsNoTracking().AsQueryable();
            if (userId is { } uid) routes = routes.Where(r => r.UserId == uid);
            if (syncState is { } s) routes = routes.Where(r => r.SyncState == s);
            if (source is { } src) routes = routes.Where(r => r.Source == src);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var like = Like(q);
                routes = routes.Where(r => EF.Functions.ILike(r.Name, like, "\\") ||
                                           (r.SuuntoRouteId != null && EF.Functions.ILike(r.SuuntoRouteId, like, "\\")) ||
                                           EF.Functions.ILike(r.Id.ToString(), like, "\\"));
            }
            return Results.Ok(await ToPageAsync(RouteRows(db, routes.OrderByDescending(r => r.LocalModifiedAt)), page, pageSize, ct));
        });

        g.MapGet("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var row = await RouteRows(db, db.Routes.AsNoTracking().Where(r => r.Id == id)).SingleOrDefaultAsync(ct);
            if (row is null) return Results.NotFound();
            return Results.Ok(await RouteDetail(db, row, ct));
        });

        g.MapPut("/{id:guid}", async (Guid id, AdminRouteUpdate body, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Trim().Length > 200) errors["name"] = ["Enter a name of up to 200 characters."];
            if (body.ActivityIds is not { Length: > 0 } || body.ActivityIds.Any(a => !ActivityTypes.IsValid(a)))
                errors["activityIds"] = ["Choose at least one valid activity."];
            if (!RoutingProfiles.IsValid(body.RoutingProfile)) errors["routingProfile"] = ["Choose an available routing profile."];
            if (!double.IsFinite(body.SimplifyToleranceM) || body.SimplifyToleranceM < 0 || body.SimplifyToleranceM > 1000)
                errors["simplifyToleranceM"] = ["Enter a tolerance from 0 to 1000 metres."];
            if (!Enum.IsDefined(body.SyncState)) errors["syncState"] = ["Choose a sync state."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var route = await db.Routes.SingleOrDefaultAsync(r => r.Id == id, ct);
            if (route is null) return Results.NotFound();
            var changed = route.Name != body.Name.Trim() || route.Description != body.Description ||
                          !route.ActivityIds.SequenceEqual(body.ActivityIds) ||
                          route.TurnWaypointsEnabled != body.TurnWaypointsEnabled ||
                          route.RoutingProfile != body.RoutingProfile || route.SimplifyToleranceM != body.SimplifyToleranceM;
            route.Name = body.Name.Trim();
            route.Description = string.IsNullOrWhiteSpace(body.Description) ? null : body.Description;
            route.ActivityIds = body.ActivityIds.Distinct().ToArray();
            route.TurnWaypointsEnabled = body.TurnWaypointsEnabled;
            route.RoutingProfile = body.RoutingProfile;
            route.SimplifyToleranceM = body.SimplifyToleranceM;
            ApplySyncState(route.SyncState, body.SyncState, changed, s => route.SyncState = s);
            if (changed) route.LocalModifiedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);

            var row = await RouteRows(db, db.Routes.AsNoTracking().Where(r => r.Id == id)).SingleAsync(ct);
            return Results.Ok(await RouteDetail(db, row, ct));
        });

        // Forgets the Suunto link, so the next push creates the route anew.
        g.MapPost("/{id:guid}/unlink-suunto", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var route = await db.Routes.SingleOrDefaultAsync(r => r.Id == id, ct);
            if (route is null) return Results.NotFound();
            route.SuuntoRouteId = null;
            route.SuuntoRevision = null;
            route.SuuntoModifiedAt = null;
            route.LastPushedHash = null;
            route.LastPushedAt = null;
            route.SyncState = SyncState.LocalOnly;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // Cascades to the route's POIs and source files.
        g.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var deleted = await db.Routes.Where(r => r.Id == id).ExecuteDeleteAsync(ct);
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    /// <summary>Editing content on a synced item without picking a state would leave it "Synced" and never pushed,
    /// so it becomes "Local changes" unless the admin chose a state themselves.</summary>
    private static void ApplySyncState(SyncState current, SyncState requested, bool contentChanged, Action<SyncState> set)
    {
        if (requested != current) set(requested);
        else if (contentChanged && current == SyncState.Synced) set(SyncState.LocalChanges);
    }

    private static IQueryable<AdminRouteRow> RouteRows(AppDbContext db, IQueryable<Route> routes) =>
        from r in routes
        join u in db.Users on r.UserId equals u.Id
        select new AdminRouteRow(
            r.Id, r.UserId, u.SuuntoUsername, r.Name, r.Source, r.SyncState,
            r.DistanceM, r.AscentM, r.DescentM, db.Pois.Count(p => p.RouteId == r.Id), r.SuuntoRouteId,
            r.CreatedAt, r.LocalModifiedAt);

    private static async Task<AdminRouteDetail> RouteDetail(AppDbContext db, AdminRouteRow row, CancellationToken ct)
    {
        var d = await db.Routes.AsNoTracking().Where(r => r.Id == row.Id).Select(r => new
        {
            r.Description, r.ActivityIds, r.TurnWaypointsEnabled, r.RoutingProfile, r.SimplifyToleranceM, r.HasElevation,
            Points = r.Geometry == null ? 0 : r.Geometry.NumPoints,
            r.SuuntoRevision, r.SuuntoModifiedAt, r.LastPushedAt, r.LastPushedHash,
        }).SingleAsync(ct);
        var control = await db.Database
            .SqlQuery<int>($"SELECT jsonb_array_length(control_points) AS \"Value\" FROM routes WHERE id = {row.Id}")
            .SingleAsync(ct);
        var files = await SourceFileRows(db, db.SourceFiles.AsNoTracking().Where(s => s.RouteId == row.Id)
            .OrderByDescending(s => s.UploadedAt)).ToListAsync(ct);
        return new AdminRouteDetail(row, d.Description, d.ActivityIds, d.TurnWaypointsEnabled, d.RoutingProfile,
            d.SimplifyToleranceM, d.HasElevation, d.Points, control, d.SuuntoRevision, d.SuuntoModifiedAt,
            d.LastPushedAt, d.LastPushedHash, files);
    }

    // ---- POIs -----------------------------------------------------------------------------------------------

    private static void MapPois(RouteGroupBuilder g)
    {
        g.MapGet("/", async (string? q, Guid? userId, Guid? routeId, SyncState? syncState, string? deleted, int? page,
            int? pageSize, AppDbContext db, CancellationToken ct) =>
        {
            // The app hides soft-deleted POIs; the admin sees them unless asked not to ("only" shows just those).
            var pois = db.Pois.IgnoreQueryFilters().AsNoTracking().AsQueryable();
            pois = deleted switch
            {
                "only" => pois.Where(p => p.DeletedAt != null),
                "exclude" => pois.Where(p => p.DeletedAt == null),
                _ => pois,
            };
            if (userId is { } uid) pois = pois.Where(p => p.UserId == uid);
            if (routeId is { } rid) pois = pois.Where(p => p.RouteId == rid);
            if (syncState is { } s) pois = pois.Where(p => p.SyncState == s);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var like = Like(q);
                pois = pois.Where(p => EF.Functions.ILike(p.Name, like, "\\") ||
                                       (p.SuuntoPoiKey != null && EF.Functions.ILike(p.SuuntoPoiKey, like, "\\")) ||
                                       EF.Functions.ILike(p.Id.ToString(), like, "\\"));
            }
            return Results.Ok(await ToPageAsync(PoiRows(db, pois.OrderByDescending(p => p.LocalModifiedAt)), page, pageSize, ct));
        });

        g.MapGet("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var row = await PoiRows(db, db.Pois.IgnoreQueryFilters().AsNoTracking().Where(p => p.Id == id)).SingleOrDefaultAsync(ct);
            return row is null ? Results.NotFound() : Results.Ok(await PoiDetail(db, row, ct));
        });

        g.MapPut("/{id:guid}", async (Guid id, AdminPoiUpdate body, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(body.Name) || body.Name.Trim().Length > 200) errors["name"] = ["Enter a name of up to 200 characters."];
            if (!PoiTypes.IsValid(body.PoiType)) errors["poiType"] = ["Choose a valid POI type."];
            if (!double.IsFinite(body.Lat) || body.Lat is < -90 or > 90) errors["lat"] = ["Latitude must be between -90 and 90."];
            if (!double.IsFinite(body.Lon) || body.Lon is < -180 or > 180) errors["lon"] = ["Longitude must be between -180 and 180."];
            if (body.ElevationM is { } e && !double.IsFinite(e)) errors["elevationM"] = ["Enter a number."];
            if (body.ActivityId is { } a && !ActivityTypes.IsValid(a)) errors["activityId"] = ["Choose a valid activity."];
            if (!Enum.IsDefined(body.SyncState)) errors["syncState"] = ["Choose a sync state."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var poi = await db.Pois.IgnoreQueryFilters().SingleOrDefaultAsync(p => p.Id == id, ct);
            if (poi is null) return Results.NotFound();
            var now = clock.GetUtcNow();
            var changed = poi.Name != body.Name.Trim() || poi.Description != body.Description || poi.PoiType != body.PoiType ||
                          poi.Location.Y != body.Lat || poi.Location.X != body.Lon || poi.ElevationM != body.ElevationM ||
                          poi.ActivityId != body.ActivityId;
            poi.Name = body.Name.Trim();
            poi.Description = string.IsNullOrWhiteSpace(body.Description) ? null : body.Description;
            poi.PoiType = body.PoiType;
            poi.Location = new Point(body.Lon, body.Lat) { SRID = 4326 };
            poi.ElevationM = body.ElevationM;
            poi.ActivityId = body.ActivityId;
            ApplySyncState(poi.SyncState, body.SyncState, changed, s => poi.SyncState = s);
            if (body.Deleted != (poi.DeletedAt != null)) poi.DeletedAt = body.Deleted ? now : null;
            if (changed) poi.LocalModifiedAt = now;
            await db.SaveChangesAsync(ct);

            var row = await PoiRows(db, db.Pois.IgnoreQueryFilters().AsNoTracking().Where(p => p.Id == id)).SingleAsync(ct);
            return Results.Ok(await PoiDetail(db, row, ct));
        });

        g.MapPost("/{id:guid}/unlink-suunto", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var poi = await db.Pois.IgnoreQueryFilters().SingleOrDefaultAsync(p => p.Id == id, ct);
            if (poi is null) return Results.NotFound();
            poi.SuuntoPoiKey = null;
            poi.SuuntoModifiedAt = null;
            poi.LastPushedHash = null;
            poi.LastPushedAt = null;
            poi.SyncState = SyncState.LocalOnly;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // A permanent delete. The app itself only soft-deletes, so that a re-push updates the same Suunto POI.
        g.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var deleted = await db.Pois.IgnoreQueryFilters().Where(p => p.Id == id).ExecuteDeleteAsync(ct);
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static IQueryable<AdminPoiRow> PoiRows(AppDbContext db, IQueryable<Poi> pois) =>
        from p in pois
        join u in db.Users on p.UserId equals u.Id
        join r in db.Routes on p.RouteId equals r.Id into routes
        from r in routes.DefaultIfEmpty()
        select new AdminPoiRow(
            p.Id, p.UserId, u.SuuntoUsername, p.RouteId, r == null ? null : r.Name, p.Name, p.PoiType,
            p.Location.Y, p.Location.X, p.ElevationM, p.DistanceAlongM, p.SyncState, p.SuuntoPoiKey,
            p.CreatedAt, p.LocalModifiedAt, p.DeletedAt);

    private static async Task<AdminPoiDetail> PoiDetail(AppDbContext db, AdminPoiRow row, CancellationToken ct)
    {
        var d = await db.Pois.IgnoreQueryFilters().AsNoTracking().Where(p => p.Id == row.Id).Select(p => new
        {
            p.Description, p.ActivityId, p.SuuntoModifiedAt, p.LastPushedAt, p.LastPushedHash,
        }).SingleAsync(ct);
        return new AdminPoiDetail(row, d.Description, d.ActivityId, d.SuuntoModifiedAt, d.LastPushedAt, d.LastPushedHash);
    }

    // ---- Source files ---------------------------------------------------------------------------------------

    private static void MapSourceFiles(RouteGroupBuilder g)
    {
        g.MapGet("/", async (string? q, Guid? routeId, int? page, int? pageSize, AppDbContext db, CancellationToken ct) =>
        {
            var files = db.SourceFiles.AsNoTracking().AsQueryable();
            if (routeId is { } rid) files = files.Where(s => s.RouteId == rid);
            if (!string.IsNullOrWhiteSpace(q)) files = files.Where(s => EF.Functions.ILike(s.FileName, Like(q), "\\"));
            return Results.Ok(await ToPageAsync(SourceFileRows(db, files.OrderByDescending(s => s.UploadedAt)), page, pageSize, ct));
        });

        g.MapGet("/{id:guid}/download", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var file = await db.SourceFiles.AsNoTracking().SingleOrDefaultAsync(s => s.Id == id, ct);
            return file is null
                ? Results.NotFound()
                : Results.File(file.Content, "application/octet-stream", Path.GetFileName(file.FileName));
        });

        g.MapDelete("/{id:guid}", async (Guid id, AppDbContext db, CancellationToken ct) =>
        {
            var deleted = await db.SourceFiles.Where(s => s.Id == id).ExecuteDeleteAsync(ct);
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    private static IQueryable<AdminSourceFileRow> SourceFileRows(AppDbContext db, IQueryable<SourceFile> files) =>
        files.Select(s => new AdminSourceFileRow(
            s.Id, s.RouteId, db.Routes.Where(r => r.Id == s.RouteId).Select(r => r.Name).FirstOrDefault(),
            s.FileName, s.Kind, s.Content.Length, s.UploadedAt));
}
