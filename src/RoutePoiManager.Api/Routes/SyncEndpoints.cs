using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Sync;

namespace RoutePoiManager.Api.Routes;

public sealed record RemoteRouteDto(string? Name, double DistanceM, DateTimeOffset? Modified);

public sealed record RoutePushResponse(string Outcome, string? Reason, RemoteRouteDto? Remote, RouteDetailDto Route);

public sealed record ResolveRequest(ConflictStrategy Strategy);

public sealed record ResolveResponse(RoutePushResponse Result, Guid? CopyId);

public sealed record PoiPushRequest(List<Guid>? Ids);

public sealed record PoiPushResponse(List<PoiPushResult> Results, List<PoiDto> Pois);

public sealed record PoiListItemDto(PoiDto Poi, Guid? RouteId, string? RouteName);

public static class SyncEndpoints
{
    public static void MapSyncEndpoints(this IEndpointRouteBuilder app)
    {
        var routes = app.MapGroup("/api/routes/{id:guid}").RequireAuthorization();

        routes.MapPost("/push", async (Guid id, HttpContext http, RouteSyncService sync, AppDbContext db, CancellationToken ct) =>
        {
            var result = await sync.PushAsync(http.User.GetUserId(), id, overwrite: false, ct);
            var body = await ToResponseAsync(db, result, ct);
            return result.Pushed ? Results.Ok(body) : Results.Conflict(body);
        });

        routes.MapPost("/resolve", async (Guid id, ResolveRequest req, HttpContext http, RouteSyncService sync, AppDbContext db,
            CancellationToken ct) =>
        {
            var (result, copy) = await sync.ResolveAsync(http.User.GetUserId(), id, req.Strategy, ct);
            return Results.Ok(new ResolveResponse(await ToResponseAsync(db, result, ct), copy?.Id));
        });

        routes.MapPost("/pois/push", async (Guid id, HttpContext http, PoiSyncService sync, AppDbContext db, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            if (!await db.Routes.AnyAsync(r => r.Id == id && r.UserId == userId, ct))
                return Results.NotFound();
            var results = await sync.PushAsync(userId, id, null, ct);
            var pois = await RoutePois.ActiveAsync(db, id, ct);
            return Results.Ok(new PoiPushResponse(results, pois.Select(RoutePois.ToDto).ToList()));
        });

        var pois = app.MapGroup("/api/pois").RequireAuthorization();

        pois.MapGet("/", async (HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var rows = await db.Pois.AsNoTracking()
                .Where(p => p.UserId == userId)
                .GroupJoin(db.Routes, p => p.RouteId, r => r.Id, (p, r) => new { Poi = p, Routes = r })
                .SelectMany(x => x.Routes.DefaultIfEmpty(), (x, r) => new { x.Poi, RouteName = r == null ? null : r.Name })
                .OrderBy(x => x.RouteName == null)
                .ThenBy(x => x.RouteName)
                .ThenBy(x => x.Poi.DistanceAlongM)
                .ThenBy(x => x.Poi.Name)
                .ToListAsync(ct);
            return rows.Select(x => new PoiListItemDto(RoutePois.ToDto(x.Poi), x.Poi.RouteId, x.RouteName));
        });

        pois.MapPost("/push", async (PoiPushRequest req, HttpContext http, PoiSyncService sync, CancellationToken ct) =>
            Results.Ok(new { results = await sync.PushAsync(http.User.GetUserId(), null, req.Ids, ct) }));

        pois.MapDelete("/{poiId:guid}", async (Guid poiId, HttpContext http, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var poi = await db.Pois.SingleOrDefaultAsync(p => p.Id == poiId && p.UserId == userId, ct);
            if (poi is null)
                return Results.NotFound();
            var now = clock.GetUtcNow();
            poi.DeletedAt = now;   // Local only: Suunto's POI API has no delete.
            // Its waypoint disappears from the route at the next route push.
            if (poi.RouteId is { } routeId && await db.Routes.FindAsync([routeId], ct) is { } route)
                route.MarkLocallyModified(now);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        pois.MapPost("/delete", async (BulkDeleteRequest req, HttpContext http, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            if (req.Validate() is { } errors)
                return Results.ValidationProblem(errors);
            var userId = http.User.GetUserId();
            var ids = req.Ids!.Distinct().ToList();
            var found = await db.Pois.Where(p => p.UserId == userId && ids.Contains(p.Id)).ToListAsync(ct);
            var now = clock.GetUtcNow();
            foreach (var poi in found)
                poi.DeletedAt = now;   // tombstones, as for the single delete
            var routeIds = found.Where(p => p.RouteId is not null).Select(p => p.RouteId!.Value).Distinct().ToList();
            foreach (var route in await db.Routes.Where(r => routeIds.Contains(r.Id)).ToListAsync(ct))
                route.MarkLocallyModified(now);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new BulkDeleteResponse(found.Count));
        });

        app.MapPost("/api/suunto/refresh", async (HttpContext http, SuuntoRefreshService refresh, CancellationToken ct) =>
            Results.Ok(await refresh.RefreshAsync(http.User.GetUserId(), ct))).RequireAuthorization();
    }

    private static async Task<RoutePushResponse> ToResponseAsync(AppDbContext db, RoutePushResult result, CancellationToken ct)
    {
        var pois = await RoutePois.ActiveAsync(db, result.Route.Id, ct);
        return new RoutePushResponse(
            result.Pushed ? "pushed" : "conflict",
            result.Conflict switch
            {
                ConflictReason.RemoteChanged => "remote_changed",
                ConflictReason.RemoteMissing => "remote_missing",
                _ => null,
            },
            result.Remote is { } r ? new RemoteRouteDto(r.Name, Math.Round(r.DistanceM, 1), r.Modified) : null,
            RouteEndpoints.ToDetail(result.Route, pois));
    }
}
