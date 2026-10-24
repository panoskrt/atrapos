using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using RoutePoiManager.Api.Auth;

namespace RoutePoiManager.Api;

/// <summary>Settings for running behind a reverse proxy on the internet. Defaults keep local use unchanged.</summary>
public sealed class HostingOptions
{
    public const string Section = "Hosting";

    /// <summary>Trust <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> from a reverse proxy, so the client address and
    /// the https scheme (and so <c>Secure</c> cookies) are right. Only enable when the proxy is the sole way in.</summary>
    public bool ForwardedHeaders { get; set; }

    /// <summary>Comma-separated proxy IP addresses to trust. Empty trusts any sender, which is right only when
    /// the app isn't reachable except through the proxy.</summary>
    public string TrustedProxies { get; set; } = "";

    /// <summary>Send <c>Strict-Transport-Security</c> on https responses. Turn on only once the site is served over https.</summary>
    public bool Hsts { get; set; }

    /// <summary>Content-Security-Policy for the web app. Empty turns it off. Not applied to <c>/auth</c>, Swagger or OpenAPI pages.</summary>
    public string ContentSecurityPolicy { get; set; } = DefaultContentSecurityPolicy;

    public RateLimitOptions RateLimit { get; set; } = new();

    public const string DefaultContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: blob: https:; connect-src 'self' https://nominatim.openstreetmap.org; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
}

public sealed class RateLimitOptions
{
    public bool Enabled { get; set; } = true;

    /// <summary>Requests per minute for each signed-in user (or client address when signed out), all endpoints.</summary>
    public int PerMinute { get; set; } = 600;

    /// <summary>Requests per minute for routing, elevation and weather, which call public services on the user's behalf.</summary>
    public int ExternalPerMinute { get; set; } = 120;

    /// <summary>Requests per minute per client address for sign-in endpoints (<c>/auth</c>).</summary>
    public int AuthPerMinute { get; set; } = 30;
}

public static class Hardening
{
    private static readonly string[] ExternalPrefixes = ["/api/routing", "/api/elevation", "/api/weather"];

    public static void AddHardening(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(HostingOptions.Section).Get<HostingOptions>() ?? new();
        services.Configure<HostingOptions>(configuration.GetSection(HostingOptions.Section));

        if (options.ForwardedHeaders)
        {
            services.Configure<ForwardedHeadersOptions>(o =>
            {
                o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
                var proxies = options.TrustedProxies
                    .Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                // The defaults trust loopback only; a proxy elsewhere is otherwise ignored.
                o.KnownIPNetworks.Clear();
                o.KnownProxies.Clear();
                foreach (var proxy in proxies)
                    o.KnownProxies.Add(IPAddress.Parse(proxy));
            });
        }

        if (options.Hsts)
            services.AddHsts(o => { o.MaxAge = TimeSpan.FromDays(365); });

        if (options.RateLimit.Enabled)
        {
            var limits = options.RateLimit;
            services.AddRateLimiter(o =>
            {
                o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
                o.GlobalLimiter = PartitionedRateLimiter.CreateChained(
                    Limiter(http => IsAuth(http) ? $"auth:{Address(http)}" : null, limits.AuthPerMinute),
                    Limiter(http => IsExternal(http) ? $"ext:{Caller(http)}" : null, limits.ExternalPerMinute),
                    Limiter(http => IsAuth(http) ? null : $"all:{Caller(http)}", limits.PerMinute));
                o.OnRejected = (context, _) =>
                {
                    context.HttpContext.Response.Headers.RetryAfter = "60";
                    return ValueTask.CompletedTask;
                };
            });
        }
    }

    public static void UseHardening(this WebApplication app)
    {
        var options = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<HostingOptions>>().Value;

        if (options.ForwardedHeaders)
            app.UseForwardedHeaders();
        if (options.Hsts)
            app.UseHsts();

        app.Use(async (http, next) =>
        {
            var headers = http.Response.Headers;
            headers.XContentTypeOptions = "nosniff";
            headers.XFrameOptions = "DENY";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";
            if (!string.IsNullOrWhiteSpace(options.ContentSecurityPolicy) && !SkipsCsp(http.Request.Path))
                headers.ContentSecurityPolicy = options.ContentSecurityPolicy;
            await next(http);
        });
    }

    /// <summary>After authentication, so limits are per user rather than per address.</summary>
    public static void UseRequestLimits(this WebApplication app)
    {
        var options = app.Services.GetRequiredService<Microsoft.Extensions.Options.IOptions<HostingOptions>>().Value;
        if (options.RateLimit.Enabled)
            app.UseRateLimiter();
    }

    private static bool SkipsCsp(PathString path) =>
        path.StartsWithSegments("/auth") || path.StartsWithSegments("/swagger") || path.StartsWithSegments("/openapi");

    private static bool IsAuth(HttpContext http) => http.Request.Path.StartsWithSegments("/auth");

    private static bool IsExternal(HttpContext http) =>
        ExternalPrefixes.Any(prefix => http.Request.Path.StartsWithSegments(prefix));

    private static string Address(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static string Caller(HttpContext http) =>
        http.User.Identity?.IsAuthenticated == true ? $"user:{http.User.GetUserId()}" : $"ip:{Address(http)}";

    private static PartitionedRateLimiter<HttpContext> Limiter(Func<HttpContext, string?> key, int perMinute) =>
        PartitionedRateLimiter.Create<HttpContext, string>(http =>
            key(http) is { } partition
                ? RateLimitPartition.GetFixedWindowLimiter(partition, _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = Math.Max(1, perMinute),
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                })
                : RateLimitPartition.GetNoLimiter("none"));
}
