using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Infrastructure.Sync;

public enum ConflictReason
{
    /// <summary>The route was edited in the Suunto app since our last sync.</summary>
    RemoteChanged,
    /// <summary>The route was deleted in the Suunto app.</summary>
    RemoteMissing,
}

public sealed record RemoteRouteInfo(string? Name, double DistanceM, DateTimeOffset? Modified);

public sealed record RoutePushResult(Route Route, ConflictReason? Conflict, RemoteRouteInfo? Remote)
{
    public bool Pushed => Conflict is null;
}

public enum ConflictStrategy
{
    /// <summary>Push ours on top of the latest Suunto revision.</summary>
    KeepMine,
    /// <summary>Replace ours with the Suunto version.</summary>
    TakeTheirs,
    /// <summary>Copy ours to a new local route, then take theirs on this one.</summary>
    SaveCopy,
}

/// <summary>Pushes a route to the Suunto Route API: import when new, else PUT on the current revision.</summary>
public sealed class RouteSyncService(
    AppDbContext db,
    SuuntoTokenService tokens,
    SuuntoApiClient api,
    TimeProvider clock,
    ILogger<RouteSyncService> logger)
{
    public async Task<RoutePushResult> PushAsync(Guid userId, Guid routeId, bool overwrite, CancellationToken ct)
    {
        var route = await LoadAsync(userId, routeId, ct);
        if (route.Geometry is null)
            throw new SyncException("Draw at least two points before pushing the route.");
        var pois = await db.Pois.Where(p => p.RouteId == route.Id).ToListAsync(ct);
        var token = await tokens.GetAccessTokenAsync(userId, ct);
        var now = clock.GetUtcNow();

        if (route.SuuntoRouteId is null)
        {
            var id = await api.ImportRouteAsync(token, RouteGpx.Build(route, pois), route.ActivityIds, route.Name, ct);
            // Save the id before anything else can fail: without it the next push would create a duplicate.
            route.SuuntoRouteId = id;
            SyncSupport.Log(db, userId, "route", route.Id, "import", 200, id, now);
            await db.SaveChangesAsync(ct);

            var (_, revision) = RouteGpx.ReadIdentity(await api.ExportRouteAsync(token, id, ct));
            MarkPushed(route, id, revision, now);
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Imported route {Route} to Suunto as {SuuntoId}", route.Id, id);
            return new RoutePushResult(route, null, null);
        }

        string current;
        try
        {
            current = await api.ExportRouteAsync(token, route.SuuntoRouteId, ct);
        }
        catch (SuuntoNotFoundException)
        {
            if (!overwrite)
                return await ConflictAsync(route, userId, ConflictReason.RemoteMissing, null, now, ct);
            // Deleted in the app and the user wants theirs back: upload as a new Suunto route.
            route.SuuntoRouteId = null;
            route.SuuntoRevision = null;
            await db.SaveChangesAsync(ct);
            return await PushAsync(userId, routeId, overwrite: false, ct);
        }

        var (_, remoteRevision) = RouteGpx.ReadIdentity(current);
        // No known revision means our import succeeded but reading it back didn't: what's on Suunto is our upload,
        // so push on top of it instead of reporting a conflict.
        if (!overwrite && route.SuuntoRevision is not null && remoteRevision != route.SuuntoRevision)
            return await ConflictAsync(route, userId, ConflictReason.RemoteChanged, current, now, ct);

        try
        {
            var updated = await api.UpdateRouteAsync(token, route.SuuntoRouteId,
                RouteGpx.Build(route, pois, route.SuuntoRouteId, remoteRevision), ct);
            MarkPushed(route, route.SuuntoRouteId, RouteGpx.ReadIdentity(updated).Revision ?? remoteRevision, now);
            SyncSupport.Log(db, userId, "route", route.Id, "update", 200, route.SuuntoRouteId, now);
            await db.SaveChangesAsync(ct);
            return new RoutePushResult(route, null, null);
        }
        catch (SuuntoRevisionConflictException)
        {
            // Edited in the app between our export and PUT.
            var latest = await api.ExportRouteAsync(token, route.SuuntoRouteId, ct);
            return await ConflictAsync(route, userId, ConflictReason.RemoteChanged, latest, now, ct);
        }
    }

    /// <summary>Resolves a conflict. Returns the route and, for <see cref="ConflictStrategy.SaveCopy"/>, the copy.</summary>
    public async Task<(RoutePushResult Result, Route? Copy)> ResolveAsync(Guid userId, Guid routeId, ConflictStrategy strategy,
        CancellationToken ct)
    {
        if (strategy == ConflictStrategy.KeepMine)
            return (await PushAsync(userId, routeId, overwrite: true, ct), null);

        var route = await LoadAsync(userId, routeId, ct);
        if (route.SuuntoRouteId is null)
            throw new SyncException("This route isn't on Suunto.");
        var token = await tokens.GetAccessTokenAsync(userId, ct);
        var now = clock.GetUtcNow();

        Route? copy = null;
        if (strategy == ConflictStrategy.SaveCopy)
        {
            copy = new Route
            {
                Id = Guid.CreateVersion7(),
                UserId = userId,
                Name = $"{route.Name} (my version)"[..Math.Min(200, route.Name.Length + 13)],
                Description = route.Description,
                ActivityIds = route.ActivityIds,
                TurnWaypointsEnabled = route.TurnWaypointsEnabled,
                RoutingProfile = route.RoutingProfile,
                Source = route.Source,
                SimplifyToleranceM = route.SimplifyToleranceM,
                CreatedAt = now,
            };
            copy.ApplyDrawing(route.ControlPoints, now);
            db.Routes.Add(copy);
        }

        string remote;
        try
        {
            remote = await api.ExportRouteAsync(token, route.SuuntoRouteId, ct);
        }
        catch (SuuntoNotFoundException)
        {
            // Nothing to take: it's gone from Suunto. Our copy becomes local-only.
            route.SuuntoRouteId = null;
            route.SuuntoRevision = null;
            route.SyncState = SyncState.LocalOnly;
            await db.SaveChangesAsync(ct);
            return (new RoutePushResult(route, null, null), copy);
        }

        var pois = await db.Pois.Where(p => p.RouteId == route.Id).ToListAsync(ct);
        SyncSupport.ApplyRemote(route, RouteGpx.Read(remote), RouteGpx.ReadIdentity(remote).Revision, pois, now);
        SyncSupport.Log(db, userId, "route", route.Id, "take_theirs", 200, null, now);
        await db.SaveChangesAsync(ct);
        return (new RoutePushResult(route, null, null), copy);
    }

    private async Task<RoutePushResult> ConflictAsync(Route route, Guid userId, ConflictReason reason, string? remoteGpx,
        DateTimeOffset now, CancellationToken ct)
    {
        route.SyncState = SyncState.Conflict;
        SyncSupport.Log(db, userId, "route", route.Id, "conflict", 409, reason.ToString(), now);
        await db.SaveChangesAsync(ct);

        RemoteRouteInfo? info = null;
        if (remoteGpx is not null)
        {
            var remote = RouteGpx.Read(remoteGpx);
            var rev = RouteGpx.ReadIdentity(remoteGpx).Revision;
            info = new RemoteRouteInfo(remote.Name, Geo.LengthM(remote.Points), rev is { } r ? SyncSupport.FromSuuntoTime(r) : null);
        }
        return new RoutePushResult(route, reason, info);
    }

    private static void MarkPushed(Route route, string suuntoId, long? revision, DateTimeOffset now)
    {
        route.SuuntoRouteId = suuntoId;
        route.SuuntoRevision = revision;
        route.SuuntoModifiedAt = revision is { } r ? SyncSupport.FromSuuntoTime(r) : now;
        route.LastPushedAt = now;
        route.SyncState = SyncState.Synced;
    }

    private async Task<Route> LoadAsync(Guid userId, Guid routeId, CancellationToken ct) =>
        await db.Routes.SingleOrDefaultAsync(r => r.Id == routeId && r.UserId == userId, ct)
        ?? throw new KeyNotFoundException("Route not found.");
}
