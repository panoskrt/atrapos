using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Surface;
using Microsoft.AspNetCore.Http;

namespace RoutePoiManager.Api.Routes;

public sealed record SurfaceAmountResponse(double DistanceKm, double Percent);

public sealed record RouteSurfaceResponse(
    double TotalDistanceKm,
    SurfaceAmountResponse Asphalt,
    SurfaceAmountResponse OffRoad,
    SurfaceAmountResponse Path,
    double UnclassifiedDistanceKm,
    double UnclassifiedPercent);

public static class SurfaceEndpoints
{
    public static void MapSurfaceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/routes/{id:guid}/surface",
                async Task<IResult> (
                    Guid id,
                    HttpContext http,
                    AppDbContext db,
                    RouteSurfaceService surfaces,
                    CancellationToken ct) =>
                {
                    var userId = http.User.GetUserId();
                    var route = await db.Routes.AsNoTracking()
                        .Where(r => r.UserId == userId && r.Id == id)
                        .Select(r => new { r.Geometry })
                        .SingleOrDefaultAsync(ct);
                    if (route is null)
                        return TypedResults.NotFound();

                    RouteSurfaceBreakdown result;
                    try
                    {
                        result = await surfaces.GetBreakdownAsync(route.Geometry, ct);
                    }
                    catch (SurfaceDataUnavailableException)
                    {
                        return Results.Problem(
                            title: "Surface data is temporarily unavailable.",
                            statusCode: StatusCodes.Status503ServiceUnavailable,
                            extensions: new Dictionary<string, object?> { ["code"] = "surface_unavailable" });
                    }
                    return TypedResults.Ok(new RouteSurfaceResponse(
                        result.TotalDistanceKm,
                        new SurfaceAmountResponse(result.Asphalt.DistanceKm, result.Asphalt.Percent),
                        new SurfaceAmountResponse(result.OffRoad.DistanceKm, result.OffRoad.Percent),
                        new SurfaceAmountResponse(result.Path.DistanceKm, result.Path.Percent),
                        result.UnclassifiedDistanceKm,
                        result.UnclassifiedPercent));
                })
            .RequireAuthorization()
            .WithName("GetRouteSurface")
            .WithSummary("Get the surface breakdown along a route")
            .WithDescription("Estimates distance and percentage for asphalt, off-road, and path segments by matching the saved route against nearby OpenStreetMap ways. Unmatched or untagged portions are reported as unclassified.")
            .Produces<RouteSurfaceResponse>()
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable)
            .Produces(StatusCodes.Status404NotFound);
    }
}
