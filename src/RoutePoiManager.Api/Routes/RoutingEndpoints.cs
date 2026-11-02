using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Routing;

namespace RoutePoiManager.Api.Routes;

/// <summary>From/to are [lon, lat].</summary>
public sealed record RouteSegmentRequest(double[] From, double[] To, string Profile);

/// <summary>Coordinates are [lon, lat, ele|null].</summary>
public sealed record RouteSegmentResponse(double?[][] Coordinates, double DistanceM);

public static class RoutingEndpoints
{
    public static void MapRoutingEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/routing").RequireAuthorization();

        g.MapGet("/profiles", () => RoutingProfiles.All);

        g.MapPost("/segment", async (RouteSegmentRequest req, RoutingService routing, CancellationToken ct) =>
        {
            if (req.From is not { Length: 2 } || req.To is not { Length: 2 } ||
                !Geo.IsValid(req.From[0], req.From[1]) || !Geo.IsValid(req.To[0], req.To[1]))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["from"] = ["from and to are [lon, lat]."] });
            if (!RoutingProfiles.IsValid(req.Profile))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["profile"] = ["Unknown routing profile."] });

            RoutingResult result;
            try
            {
                result = await routing.RouteSegmentAsync(
                    new GeoPosition(req.From[0], req.From[1]), new GeoPosition(req.To[0], req.To[1]), req.Profile, ct);
            }
            catch (RoutingUnavailableException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 503,
                    extensions: new Dictionary<string, object?> { ["code"] = "routing_unavailable" });
            }

            if (result.Line is not { } line)
            {
                return Results.Problem(title: result.Message, statusCode: 422,
                    extensions: new Dictionary<string, object?>
                    {
                        ["code"] = result.Failure == RoutingFailure.TooLong ? "too_long" : "no_route",
                    });
            }

            return Results.Ok(new RouteSegmentResponse(
                line.Select(p => new double?[] { Math.Round(p.Lon, 6), Math.Round(p.Lat, 6), p.Ele is { } e ? Math.Round(e, 1) : null })
                    .ToArray(),
                Math.Round(Geo.LengthM(line), 1)));
        });
    }
}
