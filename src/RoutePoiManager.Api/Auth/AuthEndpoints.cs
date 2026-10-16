using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Api.Auth;

public static class AuthEndpoints
{
    public const string StateCookie = "rpm.oauth_state";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/auth");

        auth.MapGet("/google", (IConfiguration configuration, IOptions<AppOptions> appOptions) =>
        {
            if (string.IsNullOrWhiteSpace(configuration["Google:ClientId"]) ||
                string.IsNullOrWhiteSpace(configuration["Google:ClientSecret"]))
                return Results.Content(
                    GoogleAuthPopupHtml(appOptions.Value.PublicBaseUrl, "/login?error=google_not_configured", false, "google_not_configured"),
                    "text/html");

            return Results.Challenge(
                new AuthenticationProperties { RedirectUri = "/auth/google-popup-complete" },
                [GoogleDefaults.AuthenticationScheme]);
        });

        auth.MapGet("/google-popup-complete", (IOptions<AppOptions> appOptions) =>
                Results.Content(GoogleAuthPopupHtml(appOptions.Value.PublicBaseUrl, "/", true), "text/html"))
            .RequireAuthorization();

        auth.MapGet("/login", (HttpContext http, SuuntoOAuthClient oauth) =>
        {
            var state = Base64Url(RandomNumberGenerator.GetBytes(32));
            http.Response.Cookies.Append(StateCookie, state, new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Lax,
                Secure = http.Request.IsHttps,
                Path = "/auth",
                MaxAge = TimeSpan.FromMinutes(10),
            });
            return Results.Redirect(oauth.BuildAuthorizeUrl(state));
        });

        auth.MapGet("/callback", async (
            HttpContext http,
            string? code,
            string? state,
            string? error,
            SuuntoOAuthClient oauth,
            SuuntoTokenService tokens,
            IOptions<AppOptions> app,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var home = app.Value.PublicBaseUrl.TrimEnd('/');
            var expectedState = http.Request.Cookies[StateCookie];
            http.Response.Cookies.Delete(StateCookie, new CookieOptions { Path = "/auth" });

            if (!string.IsNullOrEmpty(error))
                return Results.Content(AuthPopupHtml(home, $"/login?error={Uri.EscapeDataString(error)}", false, error), "text/html");

            if (string.IsNullOrEmpty(code))
                return Results.Content(AuthPopupHtml(home, "/login?error=missing_code", false, "missing_code"), "text/html");

            if (app.Value.RequireOAuthState && !StateMatches(expectedState, state))
            {
                logger.LogWarning("OAuth callback rejected: state mismatch");
                return Results.Content(AuthPopupHtml(home, "/login?error=state_mismatch", false, "state_mismatch"), "text/html");
            }

            try
            {
                var tokenResponse = await oauth.ExchangeCodeAsync(code, ct);
                var user = await tokens.SaveTokensAsync(tokenResponse, ct);

                var identity = new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                    new Claim(ClaimTypes.Name, user.SuuntoUsername
                        ?? throw new InvalidOperationException("Suunto login did not provide a username.")),
                ], CookieAuthenticationDefaults.AuthenticationScheme);
                await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
                    new AuthenticationProperties { IsPersistent = true });

                logger.LogInformation("Signed in Suunto user {User}", user.SuuntoUsername);
                return Results.Content(AuthPopupHtml(home, "/", true), "text/html");
            }
            catch (SuuntoAuthException ex)
            {
                logger.LogWarning(ex, "Suunto code exchange failed");
                return Results.Content(AuthPopupHtml(home, "/login?error=token_exchange_failed", false, "token_exchange_failed"), "text/html");
            }
        });

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        auth.MapPost("/disconnect", async (HttpContext http, SuuntoTokenService tokens, CancellationToken ct) =>
        {
            await tokens.DisconnectAsync(http.User.GetUserId(), ct);
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).RequireAuthorization();

        app.MapGet("/api/me", async (
            ClaimsPrincipal user,
            IOptions<SuuntoOptions> suunto,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var account = await db.Users.AsNoTracking()
                .SingleOrDefaultAsync(u => u.Id == user.GetUserId(), ct);
            return Results.Ok(new MeResponse(
                user.Identity!.Name!,
                suunto.Value.Mode.ToString(),
                account is not null && account.RefreshTokenProtected.Length > 0));
        }).RequireAuthorization();
    }

    public static Guid GetUserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? throw new InvalidOperationException("No user id claim."));

    public static string GoogleAuthPopupHtml(string home, string redirectPath, bool success, string? error = null)
    {
        var redirect = $"{home.TrimEnd('/')}{redirectPath}";
        var targetOrigin = new Uri(home).GetLeftPart(UriPartial.Authority);
        var payload = JsonSerializer.Serialize(new
        {
            type = "rpm-google-auth",
            status = success ? "success" : "error",
            redirect,
            error,
        });

        return $$"""
<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signing in…</title>
<script>
  const payload = {{payload}};
  if (window.opener) {
    window.opener.postMessage(payload, '*');
    window.close();
  } else {
    window.location.replace(payload.redirect);
  }
</script>
<body></body>
</html>
""";
    }

    private static string AuthPopupHtml(string home, string redirectPath, bool success, string? error = null)
    {
        var redirect = $"{home.TrimEnd('/')}{redirectPath}";
        var payload = JsonSerializer.Serialize(new
        {
            type = "rpm-suunto-auth",
            status = success ? "success" : "error",
            redirect,
            error,
        });

        return $$"""
<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signing in…</title>
<script>
  const payload = {{payload}};
  if (window.opener) {
    window.opener.postMessage(payload, '*');
    window.close();
  } else {
    window.location.replace(payload.redirect);
  }
</script>
<body></body>
</html>
""";
    }

    private static bool StateMatches(string? expected, string? actual) =>
        !string.IsNullOrEmpty(expected) && !string.IsNullOrEmpty(actual) &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(actual));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed record MeResponse(string Username, string SuuntoMode, bool SuuntoConnected);
