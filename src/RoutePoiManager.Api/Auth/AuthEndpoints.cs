using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.Extensions.Options;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Api.Auth;

public static class AuthEndpoints
{
    public const string StateCookie = "rpm.oauth_state";

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/auth");

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
                return Results.Redirect($"{home}/login?error={Uri.EscapeDataString(error)}");

            if (string.IsNullOrEmpty(code))
                return Results.Redirect($"{home}/login?error=missing_code");

            if (app.Value.RequireOAuthState && !StateMatches(expectedState, state))
            {
                logger.LogWarning("OAuth callback rejected: state mismatch");
                return Results.Redirect($"{home}/login?error=state_mismatch");
            }

            try
            {
                var tokenResponse = await oauth.ExchangeCodeAsync(code, ct);
                var user = await tokens.SaveTokensAsync(tokenResponse, ct);

                var identity = new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                    new Claim(ClaimTypes.Name, user.SuuntoUsername),
                ], CookieAuthenticationDefaults.AuthenticationScheme);
                await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, new ClaimsPrincipal(identity),
                    new AuthenticationProperties { IsPersistent = true });

                logger.LogInformation("Signed in Suunto user {User}", user.SuuntoUsername);
                return Results.Redirect($"{home}/");
            }
            catch (SuuntoAuthException ex)
            {
                logger.LogWarning(ex, "Suunto code exchange failed");
                return Results.Redirect($"{home}/login?error=token_exchange_failed");
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

        app.MapGet("/api/me", (ClaimsPrincipal user, IOptions<SuuntoOptions> suunto) => Results.Ok(new MeResponse(
            user.Identity!.Name!,
            suunto.Value.Mode.ToString()))).RequireAuthorization();
    }

    public static Guid GetUserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? throw new InvalidOperationException("No user id claim."));

    private static bool StateMatches(string? expected, string? actual) =>
        !string.IsNullOrEmpty(expected) && !string.IsNullOrEmpty(actual) &&
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(actual));

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public sealed record MeResponse(string Username, string SuuntoMode);
