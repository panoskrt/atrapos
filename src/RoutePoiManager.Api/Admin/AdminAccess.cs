using System.Security.Claims;
using Microsoft.Extensions.Options;
using RoutePoiManager.Api.Auth;

namespace RoutePoiManager.Api.Admin;

/// <summary>Decides who is an admin from the identity a session signed in with. Reads options live.</summary>
public sealed class AdminAccess(IOptionsMonitor<AdminOptions> options)
{
    public const string Policy = "Admin";

    public bool IsAdmin(ClaimsPrincipal principal)
    {
        var o = options.CurrentValue;
        // An unverified Google email is never trusted for admin rights.
        if (principal.FindFirstValue(SignInClaims.GoogleEmailVerified) == "true" &&
            SignInAllowlist.ListContains(o.GoogleEmails, principal.FindFirstValue(SignInClaims.GoogleEmail)))
            return true;
        return SignInAllowlist.ListContains(o.SuuntoUsernames, principal.FindFirstValue(SignInClaims.SuuntoUsername));
    }
}
