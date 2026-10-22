using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace RoutePoiManager.Api.Auth;

/// <summary>Claims recording how a session signed in, so it can be re-checked against the allowlists later.</summary>
public static class SignInClaims
{
    public const string GoogleEmail = "rpm:google_email";
    public const string SuuntoUsername = "rpm:suunto_username";
}

/// <summary>Sign-in was refused because the account is not on the allowlist.</summary>
public sealed class SignInNotAllowedException(string message) : Exception(message)
{
    public const string Code = "not_allowed";
}

/// <summary>Decides which Google and Suunto accounts may sign in. Reads options live, so editing the lists
/// in appsettings.Local.json takes effect without a restart (and revokes sessions at the next revalidation).</summary>
public sealed class SignInAllowlist(IOptionsMonitor<AuthOptions> options)
{
    /// <summary>No allowlist configured: every account may sign in.</summary>
    public bool IsOpen => !options.CurrentValue.HasAllowlist;

    public bool AllowsGoogle(string? email, bool emailVerified) =>
        IsOpen || (emailVerified && Contains(options.CurrentValue.AllowedGoogleEmails, email));

    public bool AllowsSuunto(string? username) =>
        IsOpen || Contains(options.CurrentValue.AllowedSuuntoUsernames, username);

    /// <summary>Re-checks an existing session by the identity it signed in with.</summary>
    public bool AllowsSession(ClaimsPrincipal principal) =>
        IsOpen ||
        AllowsGoogle(principal.FindFirstValue(SignInClaims.GoogleEmail), emailVerified: true) ||
        AllowsSuunto(principal.FindFirstValue(SignInClaims.SuuntoUsername));

    /// <summary>Google's userinfo v3 sends <c>email_verified</c>; v2 sent <c>verified_email</c>.</summary>
    public static bool IsGoogleEmailVerified(JsonElement user) =>
        (user.TryGetProperty("email_verified", out var v) || user.TryGetProperty("verified_email", out v)) &&
        (v.ValueKind == JsonValueKind.True ||
         (v.ValueKind == JsonValueKind.String && bool.TryParse(v.GetString(), out var verified) && verified));

    private static bool Contains(string list, string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        list.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(value.Trim(), StringComparer.OrdinalIgnoreCase);
}
