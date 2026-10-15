using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Infrastructure.Sync;

/// <summary>A sync request that can't go ahead (nothing to push, wrong state…). Maps to 422.</summary>
public sealed class SyncException(string message) : Exception(message);

internal static class SyncSupport
{
    /// <summary>Suunto mixes units: route revisions/modified are epoch milliseconds, the POI example uses seconds.</summary>
    public static DateTimeOffset FromSuuntoTime(long value) =>
        value > 100_000_000_000 ? DateTimeOffset.FromUnixTimeMilliseconds(value) : DateTimeOffset.FromUnixTimeSeconds(value);

    public static void Log(AppDbContext db, Guid userId, string entity, Guid? entityId, string operation, int? status,
        string? message, DateTimeOffset now) =>
        db.SyncLog.Add(new SyncLogEntry
        {
            UserId = userId,
            Entity = entity,
            EntityId = entityId,
            Operation = operation,
            HttpStatus = status,
            Message = message is { Length: > 1000 } ? message[..1000] : message,
            At = now,
        });

    /// <summary>Replaces the route's drawing with what Suunto has (their version wins). Local POIs stay; they're
    /// relocated along the new line.</summary>
    public static void ApplyRemote(Route route, Suunto.SuuntoRouteContent remote, long? revision, IEnumerable<Poi> pois, DateTimeOffset now)
    {
        route.ApplyDrawing(ImportShaping.BuildControlPoints(remote.Points), now);
        if (!string.IsNullOrWhiteSpace(remote.Name))
            route.Name = remote.Name.Length > 200 ? remote.Name[..200] : remote.Name;
        route.ActivityIds = remote.ActivityIds;
        route.TurnWaypointsEnabled = remote.TurnWaypointsEnabled;
        route.SuuntoRevision = revision;
        route.SuuntoModifiedAt = revision is { } r ? FromSuuntoTime(r) : now;
        route.SyncState = SyncState.Synced;

        var line = RouteDrawing.FromLineString(route.Geometry, route.HasElevation);
        foreach (var poi in pois)
            poi.Relocate(line);
    }
}
