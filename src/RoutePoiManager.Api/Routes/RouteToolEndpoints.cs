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
