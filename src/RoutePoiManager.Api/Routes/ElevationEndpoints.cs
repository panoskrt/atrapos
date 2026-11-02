using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Elevation;

namespace RoutePoiManager.Api.Routes;

/// <summary>Points are [lon, lat] like GeoJSON.</summary>
public sealed record ElevationRequest(double[][] Points);

public sealed record ElevationResponse(double?[] Elevations);

public static class ElevationEndpoints
{
    public static void MapElevationEndpoints(this IEndpointRouteBuilder app) =>
        app.MapPost("/api/elevation", async (ElevationRequest req, ElevationService elevation, CancellationToken ct) =>
        {
            if (req.Points is null || req.Points.Length > ElevationService.MaxPointsPerCall ||
                req.Points.Any(p => p.Length < 2 || !Geo.IsValid(p[0], p[1])))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["points"] = [$"Up to {ElevationService.MaxPointsPerCall} [lon, lat] points with valid coordinates."],
                });
            }

            var result = await elevation.LookupAsync(req.Points.Select(p => (p[1], p[0])).ToList(), ct);
            return Results.Ok(new ElevationResponse(result.Select(e => e is { } v ? Math.Round(v, 1) : (double?)null).ToArray()));
        }).RequireAuthorization();
}
