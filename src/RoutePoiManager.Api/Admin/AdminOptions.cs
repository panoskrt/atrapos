namespace RoutePoiManager.Api.Admin;

/// <summary>Who may use the admin UI. Lists are comma-separated, like the sign-in allowlists.
/// Both empty (the default): nobody is an admin and the admin API answers 403 to everyone.</summary>
public sealed class AdminOptions
{
    public const string Section = "Admin";

    /// <summary>Verified Google account emails that are admins.</summary>
    public string GoogleEmails { get; set; } = "";

    /// <summary>Suunto usernames that are admins.</summary>
    public string SuuntoUsernames { get; set; } = "";
}
