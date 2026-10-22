namespace RoutePoiManager.Api.Auth;

/// <summary>Who may sign in. Lists are comma-separated so they work the same in JSON and in .env.
/// Both empty (the default): any Google or Suunto account may sign in.</summary>
public sealed class AuthOptions
{
    public const string Section = "Auth";

    /// <summary>Optional: only these verified Google account emails may sign in with Google.</summary>
    public string AllowedGoogleEmails { get; set; } = "";

    /// <summary>Optional: only these Suunto usernames may sign in with Suunto. A Google account connecting Suunto doesn't need one.</summary>
    public string AllowedSuuntoUsernames { get; set; } = "";

    /// <summary>How long a sign-in lasts. Sliding: each request in the second half of the lifetime renews it.</summary>
    public TimeSpan SessionLifetime { get; set; } = TimeSpan.FromDays(60);

    /// <summary>How often a session cookie is checked against the database and the allowlists.</summary>
    public TimeSpan SessionRevalidationInterval { get; set; } = TimeSpan.FromMinutes(5);

    internal bool HasAllowlist =>
        !string.IsNullOrWhiteSpace(AllowedGoogleEmails) || !string.IsNullOrWhiteSpace(AllowedSuuntoUsernames);
}
