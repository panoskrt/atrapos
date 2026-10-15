using System.Security.Claims;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace RoutePoiManager.MockSuunto;

/// <summary>Mimics cloudapi-oauth.suunto.com: authorize page, token endpoint, deauthorize.</summary>
public static class OAuthEndpoints
{
    public static void MapMockOAuth(this IEndpointRouteBuilder app)
    {
        app.MapGet("/oauth/authorize", (HttpRequest req, IOptions<MockOptions> opt) =>
        {
            var q = req.Query;
            if (q["response_type"] != "code")
                return Results.BadRequest(new { error = "unsupported_response_type" });
            if (q["client_id"] != opt.Value.ClientId)
                return Results.BadRequest(new { error = "invalid_client" });
            if (string.IsNullOrEmpty(q["redirect_uri"]))
                return Results.BadRequest(new { error = "invalid_request", error_description = "redirect_uri is required" });

            return Results.Content(AuthorizePage(q["client_id"]!, q["redirect_uri"]!, q["state"]), "text/html; charset=utf-8");
        });

        app.MapPost("/oauth/authorize", async (HttpRequest req, MockStore store, IOptions<MockOptions> opt) =>
        {
            var f = await req.ReadFormAsync();
            var redirectUri = f["redirect_uri"].ToString();
            var state = f["state"].ToString();
            if (f["client_id"] != opt.Value.ClientId || string.IsNullOrEmpty(redirectUri))
                return Results.BadRequest(new { error = "invalid_request" });

            var stateSuffix = string.IsNullOrEmpty(state) ? "" : $"&state={Uri.EscapeDataString(state)}";
            if (f["decision"] != "allow")
                return Results.Redirect($"{redirectUri}{Sep(redirectUri)}error=access_denied{stateSuffix}");

            var username = f["username"].ToString().Trim();
            if (username.Length == 0) username = "mockuser";

            var code = MockStore.NewOpaqueToken()[..12];
            store.Codes[code] = new AuthCode(username, opt.Value.ClientId, redirectUri, store.Now.AddMinutes(5));
            return Results.Redirect($"{redirectUri}{Sep(redirectUri)}code={Uri.EscapeDataString(code)}{stateSuffix}");
        });

        app.MapPost("/oauth/token", async (HttpRequest req, MockStore store, IOptions<MockOptions> opt) =>
        {
            if (!ClientAuthenticated(req, opt.Value))
                return Results.Json(new { error = "invalid_client" }, statusCode: 401);

            // Accept parameters from the query string (as the API Zone spec lists them) or a form body.
            var form = req.HasFormContentType ? await req.ReadFormAsync() : null;
            string? P(string name) => form?[name].FirstOrDefault() ?? req.Query[name].FirstOrDefault();

            string username;
            switch (P("grant_type"))
            {
                case "authorization_code":
                    var code = P("code") ?? "";
                    if (!store.Codes.TryRemove(code, out var auth) || auth.ExpiresAt < store.Now)
                        return Results.BadRequest(new { error = "invalid_grant", error_description = "Unknown or expired code" });
                    if (auth.RedirectUri != P("redirect_uri"))
                        return Results.BadRequest(new { error = "invalid_grant", error_description = "redirect_uri mismatch" });
                    username = auth.Username;
                    break;

                case "refresh_token":
                    if (!store.RefreshTokens.TryRemove(P("refresh_token") ?? "", out var refreshUser))
                        return Results.BadRequest(new { error = "invalid_grant", error_description = "Unknown refresh token" });
                    username = refreshUser;
                    break;

                default:
                    return Results.BadRequest(new { error = "unsupported_grant_type" });
            }

            var lifetime = opt.Value.AccessTokenLifetimeSeconds;
            var expires = store.Now.AddSeconds(lifetime);
            var access = CreateJwt(username, expires, opt.Value);
            var refresh = MockStore.NewOpaqueToken();
            store.AccessTokens[access] = new AccessSession(username, expires);
            store.RefreshTokens[refresh] = username;

            return Results.Json(new
            {
                access_token = access,
                token_type = "bearer",
                refresh_token = refresh,
                expires_in = lifetime,
                scope = "workout",
            });
        });

        app.MapGet("/oauth/deauthorize", (HttpRequest req, MockStore store, IOptions<MockOptions> opt) =>
        {
            if (req.Query["client_id"] != opt.Value.ClientId)
                return Results.BadRequest(new { error = "invalid_client" });
            var session = MockAuth.FindSession(req, store);
            if (session is null)
                return Results.Unauthorized();
            store.RevokeUser(session.Username);
            return Results.Ok();
        });
    }

    private static string Sep(string uri) => uri.Contains('?', StringComparison.Ordinal) ? "&" : "?";

    private static bool ClientAuthenticated(HttpRequest req, MockOptions o)
    {
        var header = req.Headers.Authorization.ToString();
        if (!header.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
            return false;
        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(header["Basic ".Length..].Trim()));
            return decoded == $"{o.ClientId}:{o.ClientSecret}";
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static string CreateJwt(string username, DateTimeOffset expires, MockOptions o) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Subject = new ClaimsIdentity([new Claim("user", username)]),
            Claims = new Dictionary<string, object> { ["client_id"] = o.ClientId, ["jti"] = Guid.NewGuid().ToString() },
            Expires = expires.UtcDateTime,
            IssuedAt = DateTime.UtcNow,
            NotBefore = DateTime.UtcNow.AddSeconds(-5),
            Issuer = "mock-suunto",
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.SigningKey)), SecurityAlgorithms.HmacSha256),
        });

    private static string AuthorizePage(string clientId, string redirectUri, string? state)
    {
        var e = HtmlEncoder.Default;
        return $$"""
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>Mock Suunto sign-in</title>
              <style>
                body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #101316; color: #e9edf1;
                       font: 15px/1.5 system-ui, sans-serif; }
                main { width: min(380px, calc(100% - 32px)); padding: 28px; border-radius: 12px; background: #181c21;
                       border: 1px solid #2a3139; }
                h1 { margin: 0 0 4px; font-size: 20px; }
                p { margin: 0 0 20px; color: #9aa4af; font-size: 13px; }
                label { display: block; font-size: 13px; color: #9aa4af; margin-bottom: 6px; }
                input { width: 100%; box-sizing: border-box; height: 42px; padding: 0 12px; border-radius: 8px;
                        border: 1px solid #2a3139; background: #101316; color: inherit; font: inherit; }
                .row { display: flex; gap: 8px; margin-top: 20px; }
                button { flex: 1; height: 44px; border-radius: 8px; border: 1px solid #2a3139; background: transparent;
                         color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
                button[value=allow] { background: #33b5f0; border-color: #33b5f0; color: #04131c; }
                .badge { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: #f5b841;
                         margin-bottom: 12px; }
              </style>
            </head>
            <body>
              <main>
                <div class="badge">MOCK SUUNTO · DEVELOPMENT ONLY</div>
                <h1>Authorize app access</h1>
                <p>Client <strong>{{e.Encode(clientId)}}</strong> wants access to your routes and POIs. No password
                   is needed in the mock; type any username.</p>
                <form method="post" action="/oauth/authorize">
                  <input type="hidden" name="client_id" value="{{e.Encode(clientId)}}">
                  <input type="hidden" name="redirect_uri" value="{{e.Encode(redirectUri)}}">
                  <input type="hidden" name="state" value="{{e.Encode(state ?? "")}}">
                  <label for="username">Suunto username</label>
                  <input id="username" name="username" value="mockuser" autocomplete="off">
                  <div class="row">
                    <button type="submit" name="decision" value="deny">Deny</button>
                    <button type="submit" name="decision" value="allow">Allow</button>
                  </div>
                </form>
              </main>
            </body>
            </html>
            """;
    }
}

public static class MockAuth
{
    /// <summary>Bearer token → session. Suunto's own curl examples omit the "Bearer" prefix, so accept both.</summary>
    public static AccessSession? FindSession(HttpRequest req, MockStore store)
    {
        var header = req.Headers.Authorization.ToString().Trim();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            header = header["Bearer ".Length..].Trim();
        return header.Length > 0 && store.AccessTokens.TryGetValue(header, out var s) && s.ExpiresAt > store.Now
            ? s
            : null;
    }
}
