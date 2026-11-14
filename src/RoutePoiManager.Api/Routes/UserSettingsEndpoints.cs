using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Routes;

public sealed record UserSettingsDto(
    string DefaultMap,
    string Units,
    string Theme,
    string Design,
    int[]? FavoriteActivityIds = null,
    string? DefaultRoutingProfile = null,
    string? MenuPosition = null);

public static class UserSettingsEndpoints
{
    private static readonly HashSet<string> MapIds = ["osm", "topo", "cyclosm"];
    private static readonly HashSet<string> UnitSystems = ["metric", "imperial"];
    private static readonly HashSet<string> Themes = ["dark", "light"];
    private static readonly HashSet<string> Designs = ["classic", "alpine", "soft"];
    internal static readonly HashSet<string> MenuPositions = ["left", "top"];

    public static void MapUserSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings").RequireAuthorization();

        group.MapGet("/", async (HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var settings = await db.Users.AsNoTracking()
                .Where(user => user.Id == http.User.GetUserId())
                .Select(user => new UserSettingsDto(
                    user.DefaultMap, user.Units, user.Theme, user.Design, user.FavoriteActivityIds, user.DefaultRoutingProfile,
                    user.MenuPosition))
                .SingleOrDefaultAsync(ct);
            return settings is null ? Results.NotFound() : Results.Ok(settings);
        });

        group.MapPut("/", async (UserSettingsDto settings, HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (!MapIds.Contains(settings.DefaultMap))
                errors["defaultMap"] = ["Choose an available map."];
            if (!UnitSystems.Contains(settings.Units))
                errors["units"] = ["Choose metric or imperial units."];
            if (!Themes.Contains(settings.Theme))
                errors["theme"] = ["Choose light or dark mode."];
            if (!Designs.Contains(settings.Design))
                errors["design"] = ["Choose an available design."];
            var favoriteActivityIds = settings.FavoriteActivityIds ?? [11, 22, 1, 70, 10, 2, 0, 99, 31, 3];
            if (favoriteActivityIds.Any(id => !ActivityTypes.IsValid(id)) ||
                favoriteActivityIds.Distinct().Count() != favoriteActivityIds.Length)
                errors["favoriteActivityIds"] = ["Choose valid, unique activities."];
            if (!string.IsNullOrWhiteSpace(settings.DefaultRoutingProfile) &&
                !RoutingProfiles.IsValid(settings.DefaultRoutingProfile))
                errors["defaultRoutingProfile"] = ["Choose an available routing profile or leave it blank."];
            if (settings.MenuPosition is not null && !MenuPositions.Contains(settings.MenuPosition))
                errors["menuPosition"] = ["Choose left or top."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var user = await db.Users.SingleOrDefaultAsync(user => user.Id == http.User.GetUserId(), ct);
            if (user is null) return Results.NotFound();

            user.DefaultMap = settings.DefaultMap;
            user.Units = settings.Units;
            user.Theme = settings.Theme;
            user.Design = settings.Design;
            user.FavoriteActivityIds = favoriteActivityIds;
            // Older clients don't send it; keep what the user chose.
            if (settings.MenuPosition is not null) user.MenuPosition = settings.MenuPosition;
            user.DefaultRoutingProfile = string.IsNullOrWhiteSpace(settings.DefaultRoutingProfile)
                ? null
                : settings.DefaultRoutingProfile;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new UserSettingsDto(
                user.DefaultMap, user.Units, user.Theme, user.Design, user.FavoriteActivityIds, user.DefaultRoutingProfile,
                    user.MenuPosition));
        });
    }
}
