using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using Route = RoutePoiManager.Domain.Route;

namespace RoutePoiManager.Api.Routes;

public sealed record PoiDto(
    Guid Id,
    string Name,
    string? Description,
    int PoiType,
    double Lon,
    double Lat,
    double? Ele,
    double? DistanceAlongM,
    SyncState SyncState,
    string? SuuntoPoiKey);

/// <summary>A POI as the editor sends it. The client generates <see cref="Id"/> for new POIs.</summary>
public sealed record PoiInput(Guid Id, string Name, string? Description, int PoiType, double Lon, double Lat, double? Ele);

public sealed class PoiIdConflictException : Exception;

/// <summary>Route POIs travel with the route document: the editor sends the full list and this applies the diff.</summary>
public static class RoutePois
{
    public const int MaxPoisPerRoute = 1000;

    public static Task<List<Poi>> ActiveAsync(AppDbContext db, Guid routeId, CancellationToken ct) =>
        db.Pois.Where(p => p.RouteId == routeId).ToListAsync(ct);

    public static Dictionary<string, string[]>? Validate(List<PoiInput>? pois)
    {
        if (pois is null)
            return null;
        string? error = pois.Count > MaxPoisPerRoute ? $"At most {MaxPoisPerRoute} POIs per route."
            : pois.Any(p => p.Id == Guid.Empty) || pois.Select(p => p.Id).Distinct().Count() != pois.Count ? "POI ids must be unique."
            : pois.Any(p => string.IsNullOrWhiteSpace(p.Name) || p.Name.Trim().Length > 200) ? "POI names are 1 to 200 characters."
            : pois.Any(p => p.Description is { Length: > 4000 }) ? "POI descriptions are at most 4000 characters."
            : pois.Any(p => !PoiTypes.IsValid(p.PoiType)) ? "Unknown POI type."
            : pois.Any(p => !Geo.IsValid(p.Lon, p.Lat) || p.Ele is { } e && !double.IsFinite(e)) ? "POIs need a valid position."
            : null;
        return error is null ? null : new Dictionary<string, string[]> { ["pois"] = [error] };
    }

    /// <summary>Creates, updates, soft-deletes (and un-deletes, for undo) so the route's POIs match
    /// <paramref name="inputs"/>, then relocates all of them along the route's current line.</summary>
    public static async Task<List<Poi>> ApplyAsync(AppDbContext db, Route route, List<PoiInput>? inputs, DateTimeOffset now,
        CancellationToken ct)
    {
        var line = RouteDrawing.FromLineString(route.Geometry, route.HasElevation);

        if (inputs is null)
        {
            var current = await ActiveAsync(db, route.Id, ct);
            current.ForEach(p => p.Relocate(line));
            return current;
        }

        var ids = inputs.Select(p => p.Id).ToList();
        var existing = await db.Pois.IgnoreQueryFilters()
            .Where(p => p.RouteId == route.Id || ids.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, ct);
        if (existing.Values.Any(p => ids.Contains(p.Id) && (p.RouteId != route.Id || p.UserId != route.UserId)))
            throw new PoiIdConflictException();

        var active = new List<Poi>();
        foreach (var input in inputs)
        {
            var name = input.Name.Trim();
            var description = string.IsNullOrWhiteSpace(input.Description) ? null : input.Description.Trim();
            var ele = input.Ele is { } e ? Math.Round(e, 1) : (double?)null;

            if (!existing.TryGetValue(input.Id, out var poi))
            {
                poi = new Poi
                {
                    Id = input.Id,
                    UserId = route.UserId,
                    RouteId = route.Id,
                    Name = name,
                    Description = description,
                    PoiType = input.PoiType,
                    Location = PoiBehaviour.CreateLocation(input.Lon, input.Lat),
                    ElevationM = ele,
                    ActivityId = route.ActivityIds.FirstOrDefault(),
                    CreatedAt = now,
                    LocalModifiedAt = now,
                };
                db.Pois.Add(poi);
            }
            else
            {
                var restored = poi.DeletedAt is not null;
                poi.DeletedAt = null;
                var moved = Math.Abs(poi.Location.X - input.Lon) > 1e-7 || Math.Abs(poi.Location.Y - input.Lat) > 1e-7;
                if (restored || moved || poi.Name != name || poi.Description != description || poi.PoiType != input.PoiType ||
                    poi.ElevationM != ele)
                {
                    poi.Name = name;
                    poi.Description = description;
                    poi.PoiType = input.PoiType;
                    if (moved) poi.Location = PoiBehaviour.CreateLocation(input.Lon, input.Lat);
                    poi.ElevationM = ele;
                    // Restoring a deleted POI isn't an edit: it's back to what it was.
                    if (!restored || moved) poi.MarkLocallyModified(now);
                }
            }
            active.Add(poi);
        }

        foreach (var gone in existing.Values.Where(p => p.RouteId == route.Id && p.DeletedAt is null && !ids.Contains(p.Id)))
            gone.DeletedAt = now;   // Local only: Suunto's POI API has no delete.

        active.ForEach(p => p.Relocate(line));
        return active;
    }

    public static PoiDto ToDto(Poi p) => new(
        p.Id, p.Name, p.Description, p.PoiType, Math.Round(p.Location.X, 7), Math.Round(p.Location.Y, 7), p.ElevationM,
        p.DistanceAlongM, p.SyncState, p.SuuntoPoiKey);
}
