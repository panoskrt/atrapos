using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Simplify;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using Route = RoutePoiManager.Domain.Route;

namespace RoutePoiManager.Api.Routes;

public sealed record RouteSummaryDto(
    Guid Id,
    string Name,
    double DistanceM,
    double AscentM,
    int[] ActivityIds,
    RouteSource Source,
    SyncState SyncState,
    int PoiCount,
    int PoisPending,
    DateTimeOffset LocalModifiedAt,
    double[][] Preview);

public sealed record RouteDetailDto(
    Guid Id,
    string Name,
    string? Description,
    int[] ActivityIds,
    bool TurnWaypointsEnabled,
    string RoutingProfile,
    RouteSource Source,
    SyncState SyncState,
    string? SuuntoRouteId,
    double DistanceM,
    double AscentM,
    double DescentM,
    bool HasElevation,
    List<ControlPoint> ControlPoints,
    List<PoiDto> Pois,
    DateTimeOffset CreatedAt,
    DateTimeOffset LocalModifiedAt);

/// <summary>Ids to delete in one go (routes or POIs). Ids that aren't the caller's are ignored.</summary>
public sealed record BulkDeleteRequest(List<Guid>? Ids)
{
    public const int MaxIds = 1000;

    public Dictionary<string, string[]>? Validate() => Ids is null || Ids.Count is 0 or > MaxIds
        ? new Dictionary<string, string[]> { ["ids"] = [$"Choose 1 to {MaxIds} items."] }
        : null;
}

public sealed record BulkDeleteResponse(int Deleted);

public sealed record UpdateRouteRequest(
    string Name,
    string? Description,
    int[] ActivityIds,
    bool TurnWaypointsEnabled,
    List<ControlPoint> ControlPoints,
    string RoutingProfile = RoutingProfiles.Default,
    /// <summary>The route's complete POI list; null leaves POIs unchanged.</summary>
    List<PoiInput>? Pois = null);

public static class RouteEndpoints
{
    public const int MaxControlPoints = 2000;
    public const int MaxSegmentPoints = 200_000;
    private const int PreviewMaxPoints = 120;

    public static void MapRouteEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/routes").RequireAuthorization();

        g.MapGet("/", async (HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var rows = await db.Routes.AsNoTracking()
                .Where(r => r.UserId == userId)
                .OrderByDescending(r => r.LocalModifiedAt)
                .Select(r => new { Route = r, PoiCount = r.Pois.Count, PoisPending = r.Pois.Count(p => p.SyncState != SyncState.Synced) })
                .ToListAsync(ct);
            return rows.Select(x => ToSummary(x.Route, x.PoiCount, x.PoisPending));
        });

        g.MapPost("/", async (HttpContext http, UpdateRouteRequest req, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            if ((Validate(req) ?? RoutePois.Validate(req.Pois)) is { } errors)
                return Results.ValidationProblem(errors);
            if (req.ControlPoints.Count == 0)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["controlPoints"] = ["Place at least one point on the map before saving a route."] });

            var now = clock.GetUtcNow();
            var route = new Route
            {
                Id = Guid.CreateVersion7(),
                UserId = http.User.GetUserId(),
                Name = req.Name.Trim(),
                Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                ActivityIds = req.ActivityIds.Distinct().ToArray(),
                TurnWaypointsEnabled = req.TurnWaypointsEnabled,
                RoutingProfile = req.RoutingProfile,
                Source = RouteSource.Drawn,
                CreatedAt = now,
                LocalModifiedAt = now,
            };
            route.ApplyDrawing(req.ControlPoints, now);
            db.Routes.Add(route);
            List<Poi> pois;
            try
            {
                pois = await RoutePois.ApplyAsync(db, route, req.Pois, now, ct);
            }
            catch (PoiIdConflictException)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["pois"] = ["A POI id belongs to another route."] });
            }
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/routes/{route.Id}", ToDetail(route, pois));
        });

        g.MapGet("/{id:guid}", async (Guid id, HttpContext http, AppDbContext db, CancellationToken ct) =>
            await FindAsync(db, http, id, ct) is { } route
                ? Results.Ok(ToDetail(route, await RoutePois.ActiveAsync(db, route.Id, ct)))
                : Results.NotFound());

        g.MapPut("/{id:guid}", async (Guid id, UpdateRouteRequest req, HttpContext http, AppDbContext db, TimeProvider clock,
            CancellationToken ct) =>
        {
            if ((Validate(req) ?? RoutePois.Validate(req.Pois)) is { } errors)
                return Results.ValidationProblem(errors);
            if (await FindAsync(db, http, id, ct) is not { } route)
                return Results.NotFound();

            route.Name = req.Name.Trim();
            route.Description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim();
            route.ActivityIds = req.ActivityIds.Distinct().ToArray();
            route.TurnWaypointsEnabled = req.TurnWaypointsEnabled;
            route.RoutingProfile = req.RoutingProfile;
            var now = clock.GetUtcNow();
            route.ApplyDrawing(req.ControlPoints, now);

            List<Poi> pois;
            try
            {
                pois = await RoutePois.ApplyAsync(db, route, req.Pois, now, ct);
            }
            catch (PoiIdConflictException)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["pois"] = ["A POI id belongs to another route."] });
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(ToDetail(route, pois));
        });

        g.MapDelete("/{id:guid}", async (Guid id, HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            if (await FindAsync(db, http, id, ct) is not { } route)
                return Results.NotFound();
            // Local only: Suunto's Route API has no delete (PLAN.md §5.6).
            db.Routes.Remove(route);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        g.MapPost("/delete", async (BulkDeleteRequest req, HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            if (req.Validate() is { } errors)
                return Results.ValidationProblem(errors);
            var userId = http.User.GetUserId();
            var ids = req.Ids!.Distinct().ToList();
            // POIs and sync records go with their route (FK cascade). Local only, like the single delete.
            var deleted = await db.Routes.Where(r => r.UserId == userId && ids.Contains(r.Id)).ExecuteDeleteAsync(ct);
            return Results.Ok(new BulkDeleteResponse(deleted));
        });
    }

    private static Task<Route?> FindAsync(AppDbContext db, HttpContext http, Guid id, CancellationToken ct)
    {
        var userId = http.User.GetUserId();
        return db.Routes.SingleOrDefaultAsync(r => r.Id == id && r.UserId == userId, ct);
    }

    private static Dictionary<string, string[]>? Validate(UpdateRouteRequest req)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(req.Name) || req.Name.Trim().Length > 200)
            errors["name"] = ["Name is required and at most 200 characters."];
        if (req.Description is { Length: > 4000 })
            errors["description"] = ["Description is at most 4000 characters."];
        if (req.ActivityIds is null || req.ActivityIds.Length is 0 or > 10 || !req.ActivityIds.All(ActivityTypes.IsValid))
            errors["activityIds"] = ["Choose 1 to 10 valid Suunto activities."];
        if (!RoutingProfiles.IsValid(req.RoutingProfile))
            errors["routingProfile"] = ["Unknown routing profile."];

        if (req.ControlPoints is null || req.ControlPoints.Count > MaxControlPoints)
        {
            errors["controlPoints"] = [$"At most {MaxControlPoints} control points."];
        }
        else
        {
            if (req.ControlPoints.Any(cp => !Geo.IsValid(cp.Lon, cp.Lat) || !Enum.IsDefined(cp.ModeToNext)))
                errors["controlPoints"] = ["Control points need a valid position and mode."];
            if (req.ControlPoints.Sum(cp => cp.Segment?.Length ?? 0) > MaxSegmentPoints)
                errors["controlPoints"] = [$"The route has more than {MaxSegmentPoints} points."];
        }

        return errors.Count == 0 ? null : errors;
    }

    internal static RouteDetailDto ToDetail(Route r, IEnumerable<Poi> pois) => new(
        r.Id, r.Name, r.Description, r.ActivityIds, r.TurnWaypointsEnabled, r.RoutingProfile, r.Source, r.SyncState,
        r.SuuntoRouteId, r.DistanceM, r.AscentM, r.DescentM, r.HasElevation, r.ControlPoints,
        pois.OrderBy(p => p.DistanceAlongM ?? double.MaxValue).ThenBy(p => p.Name).Select(RoutePois.ToDto).ToList(),
        r.CreatedAt, r.LocalModifiedAt);

    private static RouteSummaryDto ToSummary(Route r, int poiCount, int poisPending) => new(
        r.Id, r.Name, r.DistanceM, r.AscentM, r.ActivityIds, r.Source, r.SyncState, poiCount, poisPending, r.LocalModifiedAt,
        Preview(r));

    /// <summary>A coarse outline for library thumbnails.</summary>
    private static double[][] Preview(Route r)
    {
        if (r.Geometry is null)
            return [];
        var env = r.Geometry.EnvelopeInternal;
        var tolerance = Math.Max(env.Width, env.Height) / 150;
        var simplified = tolerance > 0 ? DouglasPeuckerSimplifier.Simplify(r.Geometry, tolerance) : r.Geometry;
        var coords = simplified.Coordinates;
        var step = Math.Max(1, (int)Math.Ceiling(coords.Length / (double)PreviewMaxPoints));
        return coords.Where((_, i) => i % step == 0 || i == coords.Length - 1)
            .Select(c => new[] { Math.Round(c.X, 5), Math.Round(c.Y, 5) })
            .ToArray();
    }
}
