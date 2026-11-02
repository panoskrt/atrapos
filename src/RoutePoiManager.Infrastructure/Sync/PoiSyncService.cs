using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Diagnostics;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Infrastructure.Sync;

public enum PoiPushStatus
{
    Created,
    Updated,
    Failed,
}

public sealed record PoiPushResult(Guid Id, string Name, PoiPushStatus Status, string? Message);

/// <summary>Pushes POIs to the Suunto POI API one at a time: create when new, upsert by key otherwise.
/// One failure doesn't stop the others.</summary>
public sealed class PoiSyncService(AppDbContext db, SuuntoTokenService tokens, SuuntoApiClient api, TimeProvider clock,
    ErrorLogService errors)
{
    private static readonly SyncState[] Pending = [SyncState.LocalOnly, SyncState.LocalChanges, SyncState.Error, SyncState.Conflict];

    /// <summary>Pushes the pending POIs of a route, or the given POIs (pending or not), or all pending POIs.</summary>
    public async Task<List<PoiPushResult>> PushAsync(Guid userId, Guid? routeId, IReadOnlyCollection<Guid>? ids, CancellationToken ct)
    {
        var query = db.Pois.Where(p => p.UserId == userId);
        query = ids is { Count: > 0 }
            ? query.Where(p => ids.Contains(p.Id))
            : query.Where(p => Pending.Contains(p.SyncState));
        if (routeId is not null)
            query = query.Where(p => p.RouteId == routeId);
        var pois = await query.OrderBy(p => p.DistanceAlongM).ThenBy(p => p.Name).ToListAsync(ct);
        if (pois.Count == 0)
            return [];

        var routeActivities = await db.Routes
            .Where(r => r.UserId == userId && pois.Select(p => p.RouteId).Contains(r.Id))
            .ToDictionaryAsync(r => r.Id, r => r.ActivityIds.FirstOrDefault(), ct);
        var token = await tokens.GetAccessTokenAsync(userId, ct);
        var results = new List<PoiPushResult>(pois.Count);

        foreach (var poi in pois)
        {
            var now = clock.GetUtcNow();
            var activity = poi.ActivityId ?? (poi.RouteId is { } rid && routeActivities.TryGetValue(rid, out var a) ? a : ActivityTypes.Hiking);
            // Epoch MILLISECONDS: the live API refuses seconds with errorCode 4, although its docs example looks
            // like seconds (verified 2026-10-15). country/locality are optional.
            var body = new SuuntoPoi(
                poi.SuuntoPoiKey,
                poi.CreatedAt.ToUnixTimeMilliseconds(),
                now.ToUnixTimeMilliseconds(),
                new SuuntoPoint(Math.Round(poi.Location.X, 7), Math.Round(poi.Location.Y, 7), poi.ElevationM, poi.Name, poi.PoiType),
                activity);
            try
            {
                var created = poi.SuuntoPoiKey is null;
                var saved = created ? await api.CreatePoiAsync(token, body, ct) : await api.UpsertPoiAsync(token, body, ct);
                poi.SuuntoPoiKey = saved.Key ?? poi.SuuntoPoiKey;
                poi.SuuntoModifiedAt = saved.Modified is { } m ? SyncSupport.FromSuuntoTime(m) : now;
                poi.LastPushedAt = now;
                poi.SyncState = SyncState.Synced;
                results.Add(new PoiPushResult(poi.Id, poi.Name, created ? PoiPushStatus.Created : PoiPushStatus.Updated, null));
                SyncSupport.Log(db, userId, "poi", poi.Id, created ? "create" : "upsert", 200, poi.SuuntoPoiKey, now);
            }
            catch (SuuntoApiException ex)
            {
                poi.SyncState = SyncState.Error;
                results.Add(new PoiPushResult(poi.Id, poi.Name, PoiPushStatus.Failed, ex.Message));
                SyncSupport.Log(db, userId, "poi", poi.Id, "push", ex.StatusCode, ex.Message, now);
                await errors.LogAsync("PoiSync.Push", ex, $"POI '{poi.Name}' ({poi.Id}): {ex.Message}", userId, httpStatus: ex.StatusCode);
            }
            // Save as we go: a later reauth failure must not lose keys we already got.
            await db.SaveChangesAsync(ct);
        }
        return results;
    }
}
