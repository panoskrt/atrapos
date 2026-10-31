using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RoutePoiManager.Api.Admin;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Api.Auth;

public static class AuthEndpoints
{
    public const string StateCookie = "rpm.oauth_state";
    public const string ConnectCookie = "rpm.oauth_connect";

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
        }).AllowAnonymous();

        auth.MapGet("/google-popup-complete", (IOptions<AppOptions> appOptions) =>
                Results.Content(GoogleAuthPopupHtml(appOptions.Value.PublicBaseUrl, "/", true), "text/html"))
            .RequireAuthorization();

        auth.MapGet("/login", (HttpContext http, SuuntoOAuthClient oauth) =>
        {
            http.Response.Cookies.Delete(ConnectCookie, new CookieOptions { Path = "/auth" });
            var state = Base64Url(RandomNumberGenerator.GetBytes(32));
            http.Response.Cookies.Append(StateCookie, state, OAuthCookie(http));
            return Results.Redirect(oauth.BuildAuthorizeUrl(state));
        }).AllowAnonymous();

        auth.MapGet("/connect", async (
            HttpContext http,
            SuuntoOAuthClient oauth,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            var account = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct);
            if (account?.GoogleSubject is null)
                return Results.Forbid();
            if (account.RefreshTokenProtected.Length > 0)
                return Results.Conflict(new { code = "suunto_already_connected", title = "This account is already connected to Suunto." });

            var state = Base64Url(RandomNumberGenerator.GetBytes(32));
            http.Response.Cookies.Append(StateCookie, state, OAuthCookie(http));
            http.Response.Cookies.Append(ConnectCookie, userId.ToString(), OAuthCookie(http));
            return Results.Redirect(oauth.BuildAuthorizeUrl(state));
        }).RequireAuthorization();

        auth.MapGet("/callback", async (
            HttpContext http,
            string? code,
            string? state,
            string? error,
            SuuntoOAuthClient oauth,
            SuuntoTokenService tokens,
            SignInAllowlist allowlist,
            IOptions<AppOptions> app,
            ILogger<Program> logger,
            CancellationToken ct) =>
        {
            var home = app.Value.PublicBaseUrl.TrimEnd('/');
            var connectUserId = http.Request.Cookies[ConnectCookie];
            var connecting = !string.IsNullOrEmpty(connectUserId);
            var expectedState = http.Request.Cookies[StateCookie];
            http.Response.Cookies.Delete(StateCookie, new CookieOptions { Path = "/auth" });
            http.Response.Cookies.Delete(ConnectCookie, new CookieOptions { Path = "/auth" });

            if (!string.IsNullOrEmpty(error))
                return Results.Content(SuuntoPopupHtml(home, connecting ? "/" : $"/login?error={Uri.EscapeDataString(error)}", false, error, connecting), "text/html");

            if (string.IsNullOrEmpty(code))
                return Results.Content(SuuntoPopupHtml(home, connecting ? "/" : "/login?error=missing_code", false, "missing_code", connecting), "text/html");

            if (app.Value.RequireOAuthState && !StateMatches(expectedState, state))
            {
                logger.LogWarning("OAuth callback rejected: state mismatch");
                return Results.Content(SuuntoPopupHtml(home, connecting ? "/" : "/login?error=state_mismatch", false, "state_mismatch", connecting), "text/html");
            }

            try
            {
                var tokenResponse = await oauth.ExchangeCodeAsync(code, ct);
                if (connecting)
                {
                    if (http.User.Identity?.IsAuthenticated != true ||
                        !Guid.TryParse(connectUserId, out var expectedUserId) ||
                        http.User.GetUserId() != expectedUserId)
                    {
                        return Results.Content(SuuntoPopupHtml(home, "/", false, "connection_session_changed", true), "text/html");
                    }

                    await tokens.ConnectToGoogleAccountAsync(expectedUserId, tokenResponse, ct);
                    return Results.Content(SuuntoPopupHtml(home, "/", true, null, true), "text/html");
                }

                // Checked before the tokens are stored, so a refused sign-in leaves nothing behind.
                var username = SuuntoOAuthClient.ReadUsername(tokenResponse.AccessToken);
                if (!allowlist.AllowsSuunto(username))
                {
                    logger.LogWarning("Suunto sign-in refused: {User} is not on the allowlist", username);
                    return Results.Content(
                        SuuntoPopupHtml(home, $"/login?error={SignInNotAllowedException.Code}", false, SignInNotAllowedException.Code, false),
                        "text/html");
                }

                var user = await tokens.SaveTokensAsync(tokenResponse, ct);

                var identity = new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                    new Claim(ClaimTypes.Name, user.SuuntoUsername
                        ?? throw new InvalidOperationException("Suunto login did not provide a username.")),
                    new Claim(SignInClaims.SuuntoUsername, username),
                ], CookieAuthenticationDefaults.AuthenticationScheme);
                await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
                    new AuthenticationProperties { IsPersistent = true });

                logger.LogInformation("Signed in Suunto user {User}", user.SuuntoUsername);
                return Results.Content(AuthPopupHtml(home, "/", true), "text/html");
            }
            catch (SuuntoAuthException ex)
            {
                logger.LogWarning(ex, "Suunto code exchange failed");
                return Results.Content(
                    SuuntoPopupHtml(
                        home,
                        connecting ? "/" : "/login?error=token_exchange_failed",
                        false,
                        "token_exchange_failed",
                        connecting),
                    "text/html");
            }
            catch (SuuntoAccountLinkException ex)
            {
                logger.LogWarning("Suunto connection to Google account was rejected: {Code}", ex.Code);
                return Results.Content(SuuntoPopupHtml(home, "/", false, ex.Code, true), "text/html");
            }
        }).AllowAnonymous();

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        }).AllowAnonymous();

        auth.MapPost("/disconnect", async (HttpContext http, SuuntoTokenService tokens, AppDbContext db, CancellationToken ct) =>
        {
            var userId = http.User.GetUserId();
            await tokens.DisconnectAsync(userId, ct);
            var preserveSession = await db.Users.AnyAsync(u => u.Id == userId && u.GoogleSubject != null, ct);
            if (!preserveSession)
                await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.Ok(new DisconnectResponse(preserveSession));
        }).RequireAuthorization();

        app.MapGet("/api/me", async (
            ClaimsPrincipal user,
            IOptions<SuuntoOptions> suunto,
            AdminAccess admin,
            AppDbContext db,
            CancellationToken ct) =>
        {
            var account = await db.Users.AsNoTracking()
                .SingleOrDefaultAsync(u => u.Id == user.GetUserId(), ct);
            return Results.Ok(new MeResponse(
                user.Identity!.Name!,
                suunto.Value.Mode.ToString(),
                account is not null && account.RefreshTokenProtected.Length > 0,
                account?.GoogleSubject is not null,
                account?.SuuntoUsername,
                user.FindFirstValue(SignInClaims.GoogleEmail),
                admin.IsAdmin(user)));
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
    window.opener.postMessage(payload, {{JsonSerializer.Serialize(targetOrigin)}});
    window.close();
  } else {
    window.location.replace(payload.redirect);
  }
</script>
<body></body>
</html>
""";
    }

    private static string SuuntoPopupHtml(string home, string redirectPath, bool success, string? error, bool connecting) =>
        AuthPopupHtml(
            home,
            connecting && !success
                ? $"/?suunto_connect_error={Uri.EscapeDataString(error ?? "connection_failed")}"
                : redirectPath,
            success,
            error,
            connecting ? "rpm-suunto-connect" : "rpm-suunto-auth");

    private static string AuthPopupHtml(string home, string redirectPath, bool success, string? error = null, string type = "rpm-suunto-auth")
    {
        var redirect = $"{home.TrimEnd('/')}{redirectPath}";
        var targetOrigin = new Uri(home).GetLeftPart(UriPartial.Authority);
        var payload = JsonSerializer.Serialize(new
        {
            type,
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
    window.opener.postMessage(payload, {{JsonSerializer.Serialize(targetOrigin)}});
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

    private static CookieOptions OAuthCookie(HttpContext http) => new()
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Secure = http.Request.IsHttps,
        Path = "/auth",
        MaxAge = TimeSpan.FromMinutes(10),
    };
}

public sealed record MeResponse(
    string Username,
    string SuuntoMode,
    bool SuuntoConnected,
    bool GoogleAccount,
    string? SuuntoUsername,
    string? GoogleEmail,
    bool IsAdmin);
public sealed record DisconnectResponse(bool SessionPreserved);
