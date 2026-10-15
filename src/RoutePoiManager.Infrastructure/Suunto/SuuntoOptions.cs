using System.ComponentModel.DataAnnotations;

namespace RoutePoiManager.Infrastructure.Suunto;

public enum SuuntoMode
{
    Mock,
    Live,
}

public sealed class SuuntoOptions
{
    public const string Section = "Suunto";

    public SuuntoMode Mode { get; set; } = SuuntoMode.Live;

    [Required(ErrorMessage = "Suunto:ClientId is not set. Put SUUNTO_CLIENT_ID in .env (docker) or appsettings.Local.json (dotnet run).")]
    public string ClientId { get; set; } = "";

    [Required(ErrorMessage = "Suunto:ClientSecret is not set. Put SUUNTO_CLIENT_SECRET in .env (docker) or appsettings.Local.json (dotnet run).")]
    public string ClientSecret { get; set; } = "";

    [Required(ErrorMessage = "Suunto:SubscriptionKey is not set. Put SUUNTO_SUBSCRIPTION_KEY in .env (docker) or appsettings.Local.json (dotnet run).")]
    public string SubscriptionKey { get; set; } = "";

    /// <summary>OAuth host as the browser reaches it (the authorize page).</summary>
    [Required, Url] public string AuthorizeBaseUrl { get; set; } = "https://cloudapi-oauth.suunto.com";

    /// <summary>OAuth host as the backend reaches it (token, deauthorize). Differs from
    /// <see cref="AuthorizeBaseUrl"/> only when running the mock inside Docker.</summary>
    [Required, Url] public string OAuthBaseUrl { get; set; } = "https://cloudapi-oauth.suunto.com";

    [Required, Url] public string ApiBaseUrl { get; set; } = "https://cloudapi.suunto.com";

    /// <summary>Must exactly match the redirect URI registered in the Suunto API Zone profile.</summary>
    [Required, Url] public string RedirectUri { get; set; } = "";

    /// <summary>Logs the shape of Suunto responses (status, size, a truncated body; never tokens or keys) to verify
    /// the undocumented parts of the API against the live service. Off by default.</summary>
    public bool DiagnosticLogging { get; set; }

    /// <summary>Refresh the access token when it expires within this window.</summary>
    public TimeSpan RefreshSkew { get; set; } = TimeSpan.FromMinutes(5);
}
