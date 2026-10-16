using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Infrastructure.Sync;

public sealed record RefreshSummary(
    int RoutesAdded,
    int RoutesUpdated,
    int RouteConflicts,
    int PoisAdded,
    int PoisUpdated,
    int PoiConflicts,
    DateTimeOffset RefreshedAt);

/// <summary>"Refresh from Suunto": pulls routes and POIs changed since the last refresh. Only ever runs when the
/// user asks (Suunto prohibits polling). Unchanged local copies take the Suunto version; edited ones become
/// conflicts instead of being overwritten.</summary>
public sealed class SuuntoRefreshService(
    AppDbContext db,
    SuuntoTokenService tokens,
    SuuntoApiClient api,
    TimeProvider clock,
    ILogger<SuuntoRefreshService> logger)
{
    private const int RoutePageSize = 50;
    private const int MaxRoutePages = 40;
    private const int PoiPageSize = 100;
    private const int MaxPoiPages = 50;

    /// <summary>Waypoints of a route pulled from Suunto match an existing POI within this distance and same name.</summary>
    private const double SamePoiM = 15;

    public async Task<RefreshSummary> RefreshAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users.SingleAsync(u => u.Id == userId, ct);
        var token = await tokens.GetAccessTokenAsync(userId, ct);
        var started = clock.GetUtcNow();
        // A little overlap so a route modified while the previous refresh ran isn't missed.
        long? since = user.LastSuuntoRefreshAt?.AddMinutes(-5).ToUnixTimeMilliseconds();

        int poisAdded = 0, poisUpdated = 0, poiConflicts = 0;
        for (var page = 0; page < MaxPoiPages; page++)
        {
            var remote = await api.ListPoisAsync(token, PoiPageSize, page * PoiPageSize, ct);
            foreach (var r in remote.Where(r => r.Key is not null))
            {
                switch (await PullPoiAsync(userId, r, started, ct))
                {
                    case PullResult.Added: poisAdded++; break;
                    case PullResult.Updated: poisUpdated++; break;
                    case PullResult.Conflict: poiConflicts++; break;
                }
            }
            if (remote.Count < PoiPageSize) break;
        }
        await db.SaveChangesAsync(ct);

        int routesAdded = 0, routesUpdated = 0, routeConflicts = 0;
        for (var page = 0; page < MaxRoutePages; page++)
        {
            var remote = await api.ListRoutesAsync(token, since, page, RoutePageSize, ct);
            foreach (var summary in remote)
            {
                switch (await PullRouteAsync(userId, token, summary, started, ct))
                {
                    case PullResult.Added: routesAdded++; break;
                    case PullResult.Updated: routesUpdated++; break;
                    case PullResult.Conflict: routeConflicts++; break;
                }
                await db.SaveChangesAsync(ct);
            }
            if (remote.Count < RoutePageSize) break;
        }

        user.LastSuuntoRefreshAt = started;
        SyncSupport.Log(db, userId, "account", null, "refresh", 200,
            $"routes +{routesAdded} ~{routesUpdated} !{routeConflicts}; pois +{poisAdded} ~{poisUpdated} !{poiConflicts}", started);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("Refreshed from Suunto for {User}: {Routes} new routes, {Pois} new POIs", user.SuuntoUsername, routesAdded, poisAdded);

        return new RefreshSummary(routesAdded, routesUpdated, routeConflicts, poisAdded, poisUpdated, poiConflicts, started);
    }

    private enum PullResult
    {
        Unchanged,
        Added,
        Updated,
        Conflict,
    }

    private async Task<PullResult> PullPoiAsync(Guid userId, SuuntoPoi remote, DateTimeOffset now, CancellationToken ct)
    {
        // Tombstones too: a POI deleted here must not come back from Suunto.
        var local = await db.Pois.IgnoreQueryFilters().SingleOrDefaultAsync(p => p.UserId == userId && p.SuuntoPoiKey == remote.Key, ct)
                    ?? db.Pois.Local.SingleOrDefault(p => p.UserId == userId && p.SuuntoPoiKey == remote.Key);
        var remoteModified = remote.Modified is { } m ? SyncSupport.FromSuuntoTime(m) : (DateTimeOffset?)null;

        if (local is null)
        {
            db.Pois.Add(new Poi
            {
                Id = Guid.CreateVersion7(),
                UserId = userId,
                RouteId = null,
                Name = string.IsNullOrWhiteSpace(remote.Point.Name) ? "Suunto POI" : remote.Point.Name.Trim(),
                PoiType = PoiTypes.IsValid(remote.Point.Type) ? remote.Point.Type : PoiTypes.Poi,
                Location = PoiBehaviour.CreateLocation(remote.Point.X, remote.Point.Y),
                ElevationM = remote.Point.Z,
                ActivityId = remote.ActivityId,
                SuuntoPoiKey = remote.Key,
                SuuntoModifiedAt = remoteModified ?? now,
                SyncState = SyncState.Synced,
                CreatedAt = remote.Creation is { } c ? SyncSupport.FromSuuntoTime(c) : now,
                LocalModifiedAt = now,
            });
            return PullResult.Added;
        }

        if (local.DeletedAt is not null || remoteModified is null || local.SuuntoModifiedAt is { } known && remoteModified <= known.AddSeconds(1))
            return PullResult.Unchanged;

        if (local.SyncState is SyncState.LocalChanges or SyncState.Conflict)
        {
            local.SyncState = SyncState.Conflict;
            return PullResult.Conflict;
        }

        local.Name = string.IsNullOrWhiteSpace(remote.Point.Name) ? local.Name : remote.Point.Name.Trim();
        local.PoiType = PoiTypes.IsValid(remote.Point.Type) ? remote.Point.Type : local.PoiType;
        local.Location = PoiBehaviour.CreateLocation(remote.Point.X, remote.Point.Y);
        local.ElevationM = remote.Point.Z ?? local.ElevationM;
        local.SuuntoModifiedAt = remoteModified;
        local.SyncState = SyncState.Synced;
        local.LocalModifiedAt = now;
        if (local.RouteId is { } routeId && await db.Routes.FindAsync([routeId], ct) is { } route)
            local.Relocate(RouteDrawing.FromLineString(route.Geometry, route.HasElevation));
        return PullResult.Updated;
    }

    private async Task<PullResult> PullRouteAsync(Guid userId, string token, SuuntoRouteSummary summary, DateTimeOffset now,
        CancellationToken ct)
    {
        var local = await db.Routes.SingleOrDefaultAsync(r => r.UserId == userId && r.SuuntoRouteId == summary.Id, ct);
        string gpx;
        try
        {
            gpx = await api.ExportRouteAsync(token, summary.Id, ct);
        }
        catch (SuuntoNotFoundException)
        {
            return PullResult.Unchanged;
        }
        var (_, revision) = RouteGpx.ReadIdentity(gpx);
        SuuntoRouteContent content;
        try
        {
            content = RouteGpx.Read(gpx);
        }
        catch (Import.ImportException ex)
        {
            logger.LogWarning(ex, "Skipping unreadable Suunto route {SuuntoId}", summary.Id);
            return PullResult.Unchanged;
        }

        if (local is null)
        {
            var route = new Route
            {
                Id = Guid.CreateVersion7(),
                UserId = userId,
                Name = content.Name ?? summary.Description ?? "Suunto route",
                Source = RouteSource.Suunto,
                SuuntoRouteId = summary.Id,
                CreatedAt = summary.Created > 0 ? SyncSupport.FromSuuntoTime(summary.Created) : now,
            };
            SyncSupport.ApplyRemote(route, content, revision, [], now);
            db.Routes.Add(route);
            await AttachWaypointsAsync(userId, route, content.Waypoints, ct);
            return PullResult.Added;
        }

        if (revision == local.SuuntoRevision)
        {
            var existingPois = await db.Pois.Where(p => p.RouteId == local.Id).ToListAsync(ct);
            var legacyWaypoints = existingPois.Where(p => IsLegacyWaypointPoi(local, p, content.Waypoints)).ToList();
            if (legacyWaypoints.Count == 0)
                return PullResult.Unchanged;
            db.Pois.RemoveRange(legacyWaypoints);
            return PullResult.Updated;
        }

        if (local.SyncState is SyncState.LocalChanges or SyncState.Conflict)
        {
            local.SyncState = SyncState.Conflict;
            return PullResult.Conflict;
        }

        var pois = await db.Pois.Where(p => p.RouteId == local.Id).ToListAsync(ct);
        var legacyWaypointPois = pois.Where(p => IsLegacyWaypointPoi(local, p, content.Waypoints)).ToList();
        db.Pois.RemoveRange(legacyWaypointPois);
        pois.RemoveAll(p => legacyWaypointPois.Contains(p));
        SyncSupport.ApplyRemote(local, content, revision, pois, now);
        return PullResult.Updated;
    }

    private static bool IsLegacyWaypointPoi(Route route, Poi poi, IReadOnlyCollection<Import.ParsedWaypoint> waypoints) =>
        route.Source == RouteSource.Suunto &&
        poi.SuuntoPoiKey is null &&
        poi.CreatedAt == route.LocalModifiedAt &&
        poi.LocalModifiedAt == route.LocalModifiedAt &&
        waypoints.Any(w =>
            string.Equals(w.Name, poi.Name, StringComparison.OrdinalIgnoreCase) &&
            Geo.DistanceM(new GeoPosition(poi.Location.X, poi.Location.Y), w.Position) <= SamePoiM);

    /// <summary>Associates route waypoints with POIs pulled separately from Suunto's POI API when they identify
    /// the same place. A route waypoint alone does not create a POI.</summary>
    private async Task AttachWaypointsAsync(Guid userId, Route route, List<Import.ParsedWaypoint> waypoints, CancellationToken ct)
    {
        if (waypoints.Count == 0)
            return;
        var line = RouteDrawing.FromLineString(route.Geometry, route.HasElevation);
        var standalone = await db.Pois.Where(p => p.UserId == userId && p.RouteId == null).ToListAsync(ct);
        standalone.AddRange(db.Pois.Local.Where(p => p.UserId == userId && p.RouteId == null && !standalone.Contains(p)));

        foreach (var wp in waypoints)
        {
            var match = standalone.FirstOrDefault(p =>
                string.Equals(p.Name, wp.Name, StringComparison.OrdinalIgnoreCase) &&
                Geo.DistanceM(new GeoPosition(p.Location.X, p.Location.Y), wp.Position) <= SamePoiM);
            if (match is not null)
            {
                match.RouteId = route.Id;
                match.Relocate(line);
                standalone.Remove(match);
            }
        }
    }
}
