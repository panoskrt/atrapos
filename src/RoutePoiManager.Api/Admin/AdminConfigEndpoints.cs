using System.Security.Claims;
using Microsoft.Extensions.Options;
using Npgsql;
using RoutePoiManager.Api.Auth;

namespace RoutePoiManager.Api.Admin;

/// <summary>An editable list: its effective value and where that value comes from.</summary>
public sealed record EditableSetting(string Value, string ConfiguredValue, bool Overridden);

public sealed record ConfigEntry(string Key, string? Value, bool Secret);

public sealed record AdminConfig(
    EditableSetting AllowedGoogleEmails,
    EditableSetting AllowedSuuntoUsernames,
    string AdminGoogleEmails,
    string AdminSuuntoUsernames,
    List<ConfigEntry> Entries);

/// <summary>Each field: null leaves the setting unchanged, "" removes the restriction, any other text sets the list.
/// <see cref="ResetGoogleEmails"/> / <see cref="ResetSuuntoUsernames"/> drop the override and use the configured value.</summary>
public sealed record AdminAuthConfigUpdate(
    string? GoogleEmails, string? SuuntoUsernames, bool ResetGoogleEmails = false, bool ResetSuuntoUsernames = false);

public static class AdminConfigEndpoints
{
    /// <summary>Shown read-only: these come from appsettings or the environment and need a restart to change.</summary>
    private static readonly string[] ReadOnlyKeys =
    [
        "App:PublicBaseUrl", "App:RequireOAuthState",
        "Auth:SessionLifetime", "Auth:SessionRevalidationInterval",
        "Google:ClientId", "Google:ClientSecret",
        "Suunto:Mode", "Suunto:ClientId", "Suunto:ClientSecret", "Suunto:SubscriptionKey",
        "Suunto:AuthorizeBaseUrl", "Suunto:OAuthBaseUrl", "Suunto:ApiBaseUrl", "Suunto:RedirectUri",
        "Uploads:MaxFileSizeMb",
        "Elevation:Provider",
        "Hosting:ForwardedHeaders", "Hosting:TrustedProxies", "Hosting:Hsts",
        "Hosting:RateLimit:Enabled", "Hosting:RateLimit:PerMinute", "Hosting:RateLimit:ExternalPerMinute", "Hosting:RateLimit:AuthPerMinute",
        "Database:MigrateOnStartup", "ConnectionStrings:Db",
    ];

    private static readonly string[] SecretMarkers = ["secret", "subscriptionkey", "password", "token"];

    public static void MapAdminConfigEndpoints(this RouteGroupBuilder admin)
    {
        var config = admin.MapGroup("/config");

        config.MapGet("/", (IConfiguration configuration, SignInAllowlist allowlist, IOptionsMonitor<AuthOptions> auth,
            IOptionsMonitor<AdminOptions> admins, RuntimeSettings runtime) =>
            Results.Ok(Build(configuration, allowlist, auth.CurrentValue, admins.CurrentValue, runtime)));

        config.MapPut("/auth", async (AdminAuthConfigUpdate body, ClaimsPrincipal user, IConfiguration configuration,
            SignInAllowlist allowlist, IOptionsMonitor<AuthOptions> auth, IOptionsMonitor<AdminOptions> admins,
            RuntimeSettings runtime, CancellationToken ct) =>
        {
            var google = Resolve(body.GoogleEmails, body.ResetGoogleEmails, allowlist.GoogleEmails, auth.CurrentValue.AllowedGoogleEmails);
            var suunto = Resolve(body.SuuntoUsernames, body.ResetSuuntoUsernames, allowlist.SuuntoUsernames, auth.CurrentValue.AllowedSuuntoUsernames);

            // Saving a list that excludes the admin making the change would end their own session at the next check.
            if (!SignInAllowlist.AllowsSession(user, google, suunto))
                return Results.Problem(
                    "That would remove your own account from the sign-in allowlist. Add yourself first.",
                    statusCode: StatusCodes.Status409Conflict);

            var by = user.Identity?.Name;
            if (body.ResetGoogleEmails) await runtime.SetAsync(RuntimeSettings.AllowedGoogleEmails, null, by, ct);
            else if (body.GoogleEmails is not null) await runtime.SetAsync(RuntimeSettings.AllowedGoogleEmails, Normalize(body.GoogleEmails), by, ct);
            if (body.ResetSuuntoUsernames) await runtime.SetAsync(RuntimeSettings.AllowedSuuntoUsernames, null, by, ct);
            else if (body.SuuntoUsernames is not null) await runtime.SetAsync(RuntimeSettings.AllowedSuuntoUsernames, Normalize(body.SuuntoUsernames), by, ct);

            return Results.Ok(Build(configuration, allowlist, auth.CurrentValue, admins.CurrentValue, runtime));
        });
    }

    /// <summary>The list that will be in force after the update, for the lockout check.</summary>
    private static string Resolve(string? requested, bool reset, string current, string configured) =>
        reset ? configured : requested is null ? current : Normalize(requested);

    /// <summary>Comma-separated, trimmed, without blanks or duplicates.</summary>
    private static string Normalize(string list) => string.Join(", ",
        list.Split([',', ';', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase));

    private static AdminConfig Build(IConfiguration configuration, SignInAllowlist allowlist, AuthOptions auth,
        AdminOptions admins, RuntimeSettings runtime) =>
        new(
            new EditableSetting(allowlist.GoogleEmails, auth.AllowedGoogleEmails, runtime.Get(RuntimeSettings.AllowedGoogleEmails) is not null),
            new EditableSetting(allowlist.SuuntoUsernames, auth.AllowedSuuntoUsernames, runtime.Get(RuntimeSettings.AllowedSuuntoUsernames) is not null),
            admins.GoogleEmails, admins.SuuntoUsernames,
            ReadOnlyKeys.Select(key => Entry(configuration, key)).ToList());

    private static ConfigEntry Entry(IConfiguration configuration, string key)
    {
        var value = configuration[key];
        if (key == "ConnectionStrings:Db" && !string.IsNullOrEmpty(value))
        {
            var b = new NpgsqlConnectionStringBuilder(value);
            return new ConfigEntry(key, $"Host={b.Host};Port={b.Port};Database={b.Database};Username={b.Username}", false);
        }
        var secret = SecretMarkers.Any(m => key.Contains(m, StringComparison.OrdinalIgnoreCase));
        // Secrets are never sent to the browser; only whether one is set.
        return secret ? new ConfigEntry(key, string.IsNullOrEmpty(value) ? null : "set", true) : new ConfigEntry(key, value, false);
    }
}
