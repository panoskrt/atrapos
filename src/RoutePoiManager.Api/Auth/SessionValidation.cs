using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Auth;

/// <summary>Session cookies live for weeks (Auth:SessionLifetime), so they are re-checked periodically: a deleted account, or one taken
/// off the allowlist, loses its session at the next check instead of when the cookie expires.</summary>
public static class SessionValidation
{
    private const string ValidatedAtKey = "rpm.validated_at";

    public static async Task ValidateAsync(CookieValidatePrincipalContext context)
    {
        var services = context.HttpContext.RequestServices;
        var interval = services.GetRequiredService<IOptionsMonitor<AuthOptions>>().CurrentValue.SessionRevalidationInterval;
        var now = services.GetRequiredService<TimeProvider>().GetUtcNow();
        if (context.Properties.Items.TryGetValue(ValidatedAtKey, out var raw) &&
            DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var validatedAt) &&
            now - validatedAt < interval)
            return;

        var principal = context.Principal!;
        var valid = Guid.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) &&
                    services.GetRequiredService<SignInAllowlist>().AllowsSession(principal) &&
                    await services.GetRequiredService<AppDbContext>().Users
                        .AnyAsync(u => u.Id == userId, context.HttpContext.RequestAborted);
        if (!valid)
        {
            services.GetRequiredService<ILogger<SignInAllowlist>>()
                .LogInformation("Ended session for {UserId}: account removed or no longer allowed", principal.FindFirstValue(ClaimTypes.NameIdentifier));
            context.RejectPrincipal();
            await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return;
        }

        context.Properties.Items[ValidatedAtKey] = now.ToString("O", CultureInfo.InvariantCulture);
        context.ShouldRenew = true;
    }
}
