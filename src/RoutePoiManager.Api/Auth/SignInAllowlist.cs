using System.Security.Claims;
using System.Text.Json;
using Microsoft.Extensions.Options;
using RoutePoiManager.Api.Admin;

namespace RoutePoiManager.Api.Auth;

/// <summary>Claims recording how a session signed in, so it can be re-checked against the allowlists later.</summary>
public static class SignInClaims
{
    public const string GoogleEmail = "rpm:google_email";
    public const string GoogleEmailVerified = "rpm:google_email_verified";
    public const string SuuntoUsername = "rpm:suunto_username";
}

/// <summary>Sign-in was refused because the account is not on the allowlist.</summary>
public sealed class SignInNotAllowedException(string message) : Exception(message)
{
    public const string Code = "not_allowed";
}

/// <summary>Decides which Google and Suunto accounts may sign in. Reads options live, so editing the lists
/// in appsettings.Local.json takes effect without a restart (and revokes sessions at the next revalidation).
/// A list set in the admin UI (<see cref="RuntimeSettings"/>) takes precedence over the configured one.</summary>
public sealed class SignInAllowlist(IOptionsMonitor<AuthOptions> options, RuntimeSettings runtime)
{
    public string GoogleEmails => runtime.Get(RuntimeSettings.AllowedGoogleEmails) ?? options.CurrentValue.AllowedGoogleEmails;
    public string SuuntoUsernames => runtime.Get(RuntimeSettings.AllowedSuuntoUsernames) ?? options.CurrentValue.AllowedSuuntoUsernames;

    /// <summary>No allowlist configured: every account may sign in.</summary>
    public bool IsOpen => IsOpenWith(GoogleEmails, SuuntoUsernames);

    public bool AllowsGoogle(string? email, bool emailVerified) =>
        IsOpen || (emailVerified && ListContains(GoogleEmails, email));

    public bool AllowsSuunto(string? username) =>
        IsOpen || ListContains(SuuntoUsernames, username);

    /// <summary>Re-checks an existing session by the identity it signed in with.</summary>
    public bool AllowsSession(ClaimsPrincipal principal) => AllowsSession(principal, GoogleEmails, SuuntoUsernames);

    /// <summary>Whether a session would still be allowed under the given lists; used to stop an admin locking themselves out.</summary>
    public static bool AllowsSession(ClaimsPrincipal principal, string googleEmails, string suuntoUsernames) =>
        IsOpenWith(googleEmails, suuntoUsernames) ||
        (principal.FindFirstValue(SignInClaims.GoogleEmailVerified) != "false" &&
         ListContains(googleEmails, principal.FindFirstValue(SignInClaims.GoogleEmail))) ||
        ListContains(suuntoUsernames, principal.FindFirstValue(SignInClaims.SuuntoUsername));

    private static bool IsOpenWith(string googleEmails, string suuntoUsernames) =>
        string.IsNullOrWhiteSpace(googleEmails) && string.IsNullOrWhiteSpace(suuntoUsernames);

    /// <summary>Google's userinfo v3 sends <c>email_verified</c>; v2 sent <c>verified_email</c>.</summary>
    public static bool IsGoogleEmailVerified(JsonElement user) =>
        (user.TryGetProperty("email_verified", out var v) || user.TryGetProperty("verified_email", out v)) &&
        (v.ValueKind == JsonValueKind.True ||
         (v.ValueKind == JsonValueKind.String && bool.TryParse(v.GetString(), out var verified) && verified));

    internal static bool ListContains(string list, string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        list.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(value.Trim(), StringComparer.OrdinalIgnoreCase);
}
