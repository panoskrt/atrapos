using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Routes;

public sealed record UserSettingsDto(string DefaultMap, string Units, string Theme);

public static class UserSettingsEndpoints
{
    private static readonly HashSet<string> MapIds = ["osm", "topo", "cyclosm"];
    private static readonly HashSet<string> UnitSystems = ["metric", "imperial"];
    private static readonly HashSet<string> Themes = ["dark", "light"];

    public static void MapUserSettingsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/settings").RequireAuthorization();

        group.MapGet("/", async (HttpContext http, AppDbContext db, CancellationToken ct) =>
        {
            var settings = await db.Users.AsNoTracking()
                .Where(user => user.Id == http.User.GetUserId())
                .Select(user => new UserSettingsDto(user.DefaultMap, user.Units, user.Theme))
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
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var user = await db.Users.SingleOrDefaultAsync(user => user.Id == http.User.GetUserId(), ct);
            if (user is null) return Results.NotFound();

            user.DefaultMap = settings.DefaultMap;
            user.Units = settings.Units;
            user.Theme = settings.Theme;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new UserSettingsDto(user.DefaultMap, user.Units, user.Theme));
        });
    }
}
