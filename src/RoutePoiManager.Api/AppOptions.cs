using System.ComponentModel.DataAnnotations;

namespace RoutePoiManager.Api;

public sealed class AppOptions
{
    public const string Section = "App";

    /// <summary>Origin the user's browser uses for the SPA; login redirects back here.</summary>
    [Required, Url] public string PublicBaseUrl { get; set; } = "http://localhost:5080";

    /// <summary>Reject OAuth callbacks whose <c>state</c> doesn't match. Only turn off if Suunto
    /// turns out not to echo <c>state</c> back (see PLAN.md, risks).</summary>
    public bool RequireOAuthState { get; set; } = true;
}
