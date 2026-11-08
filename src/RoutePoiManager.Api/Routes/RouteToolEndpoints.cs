using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;
using Route = RoutePoiManager.Domain.Route;

namespace RoutePoiManager.Api.Routes;

public sealed record SplitRequest(int PointIndex);

public sealed record SplitResponse(RouteDetailDto Route, RouteDetailDto Created);
public sealed record DistanceSplitRequest(double DistanceM);
public sealed record DistanceSplitResponse(List<RouteDetailDto> Routes);

public static partial class RouteToolEndpoints
{
    public static void MapRouteToolEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/routes/{id:guid}").RequireAuthorization();

        g.MapGet("/gpx", async (Guid id, HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var route = await db.Routes.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id && r.UserId == userId, ct);
            if (route is null)
                return Results.NotFound();
            if (route.Geometry is null)
                return Results.Problem(title: "Draw at least two points before downloading.", statusCode: 422);

            var pois = await db.Pois.AsNoTracking().Where(p => p.RouteId == id).ToListAsync(ct);
            var gpx = RouteGpx.BuildForDownload(route, pois);
            return Results.File(Encoding.UTF8.GetBytes(gpx), "application/gpx+xml", $"{FileName(route.Name)}.gpx");
        });

        g.MapPost("/split", async (Guid id, SplitRequest req, HttpContext http, AppDbContext db, TimeProvider clock,
            CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var route = await db.Routes.SingleOrDefaultAsync(r => r.Id == id && r.UserId == userId, ct);
            if (route is null)
                return Results.NotFound();
            if (req.PointIndex < 1 || req.PointIndex > route.ControlPoints.Count - 2)
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["pointIndex"] = ["Split at a point between the start and the end."],
                });

            var now = clock.GetUtcNow();
            var (head, tail, splitAlong) = RouteSplitting.Split(route.ControlPoints, req.PointIndex);
            var suffix = " (part 2)";
            var created = new Route
            {
                Id = Guid.CreateVersion7(),
                UserId = userId,
                Name = (route.Name.Length + suffix.Length > 200 ? route.Name[..(200 - suffix.Length)] : route.Name) + suffix,
                Description = route.Description,
                ActivityIds = route.ActivityIds,
                TurnWaypointsEnabled = route.TurnWaypointsEnabled,
                RoutingProfile = route.RoutingProfile,
                Source = route.Source,
                SimplifyToleranceM = route.SimplifyToleranceM,
                CreatedAt = now,
            };
            created.ApplyDrawing(tail, now);
            route.ApplyDrawing(head, now);
            db.Routes.Add(created);

            // POIs past the split go with the second part. They keep their Suunto keys: the same Suunto POIs.
            var pois = await db.Pois.Where(p => p.RouteId == route.Id).ToListAsync(ct);
            var headLine = RouteDrawing.FromLineString(route.Geometry, route.HasElevation);
            var tailLine = RouteDrawing.FromLineString(created.Geometry, created.HasElevation);
            var moved = new List<Poi>();
            foreach (var poi in pois)
            {
                if (poi.DistanceAlongM > splitAlong)
                {
                    poi.RouteId = created.Id;
                    poi.Relocate(tailLine);
                    moved.Add(poi);
                }
                else
                {
                    poi.Relocate(headLine);
                }
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(new SplitResponse(
                RouteEndpoints.ToDetail(route, pois.Except(moved)),
                RouteEndpoints.ToDetail(created, moved)));
        });

        g.MapPost("/split-by-distance", async (Guid id, DistanceSplitRequest req, HttpContext http, AppDbContext db,
            TimeProvider clock, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var route = await db.Routes.SingleOrDefaultAsync(r => r.Id == id && r.UserId == userId, ct);
            if (route is null)
                return Results.NotFound();

            List<(int Index, double SplitAlongM)> cuts;
            try
            {
                cuts = RouteSplitting.DistanceCuts(route.ControlPoints, req.DistanceM);
            }
            catch (ArgumentOutOfRangeException e)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["distanceM"] = [e.Message] });
            }
            catch (InvalidOperationException e)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["distanceM"] = [e.Message] });
            }

            var now = clock.GetUtcNow();
            var sourcePois = await db.Pois.Where(p => p.RouteId == route.Id).ToListAsync(ct);
            var sourceLine = RouteDrawing.BuildLine(route.ControlPoints);
            var createdRoutes = new List<(Route Route, List<Poi> Pois)>();
            var firstIndex = 0;
            var partCount = cuts.Count + 1;

            for (var partIndex = 0; partIndex < partCount; partIndex++)
            {
                var lastIndex = partIndex < cuts.Count ? cuts[partIndex].Index : route.ControlPoints.Count - 1;
                var controlPoints = route.ControlPoints.Skip(firstIndex).Take(lastIndex - firstIndex + 1).ToList();
                controlPoints[^1] = controlPoints[^1] with { Segment = null };

                var suffix = $" (part {partIndex + 1})";
                var baseNameLength = Math.Min(route.Name.Length, 200 - suffix.Length);
                var created = new Route
                {
                    Id = Guid.CreateVersion7(),
                    UserId = userId,
                    Name = route.Name[..baseNameLength] + suffix,
                    Description = route.Description,
                    ActivityIds = route.ActivityIds,
                    TurnWaypointsEnabled = route.TurnWaypointsEnabled,
                    RoutingProfile = route.RoutingProfile,
                    Source = route.Source,
                    SimplifyToleranceM = route.SimplifyToleranceM,
                    CreatedAt = now,
                };
                created.ApplyDrawing(controlPoints, now);
                db.Routes.Add(created);

                var line = RouteDrawing.FromLineString(created.Geometry, created.HasElevation);
                var lowerBound = partIndex == 0 ? 0 : cuts[partIndex - 1].SplitAlongM;
                var upperBound = partIndex < cuts.Count ? cuts[partIndex].SplitAlongM : double.PositiveInfinity;
                var partPois = new List<Poi>();
                foreach (var sourcePoi in sourcePois)
                {
                    var along = sourcePoi.DistanceAlongM ??
                                Geo.Locate(sourceLine, new GeoPosition(sourcePoi.Location.X, sourcePoi.Location.Y)).AlongM;
                    var belongs = (partIndex == 0 || along > lowerBound) && along <= upperBound;
                    if (!belongs)
                        continue;

                    var poi = new Poi
                    {
                        Id = Guid.CreateVersion7(),
                        UserId = userId,
                        RouteId = created.Id,
                        Name = sourcePoi.Name,
                        Description = sourcePoi.Description,
                        PoiType = sourcePoi.PoiType,
                        Location = sourcePoi.Location,
                        ElevationM = sourcePoi.ElevationM,
                        ActivityId = created.ActivityIds.FirstOrDefault(),
                        CreatedAt = now,
                        LocalModifiedAt = now,
                    };
                    poi.Relocate(line);
                    db.Pois.Add(poi);
                    partPois.Add(poi);
                }

                createdRoutes.Add((created, partPois));
                if (partIndex < cuts.Count)
                    firstIndex = lastIndex;
            }

            await db.SaveChangesAsync(ct);
            return Results.Ok(new DistanceSplitResponse(
                createdRoutes.Select(part => RouteEndpoints.ToDetail(part.Route, part.Pois)).ToList()));
        });
    }

    /// <summary>A safe download file name from the route name.</summary>
    internal static string FileName(string name)
    {
        var slug = Unsafe().Replace(name.Trim(), "-").Trim('-', '.');
        return slug.Length == 0 ? "route" : slug.Length > 80 ? slug[..80] : slug;
    }

    // Any run of characters other than letters, digits, '.' and '_' becomes one dash.
    [GeneratedRegex(@"[^\p{L}\p{Nd}._]+")]
    private static partial Regex Unsafe();
}
