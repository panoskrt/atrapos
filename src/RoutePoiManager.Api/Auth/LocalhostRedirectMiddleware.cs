using System.Net;
using Microsoft.Extensions.Options;

namespace RoutePoiManager.Api.Auth;

/// <summary>Google and Suunto only accept the redirect URIs registered for <c>localhost</c>, and the sign-in cookies
/// and popup messages are tied to the host. Opened as <c>127.0.0.1</c> or <c>[::1]</c>, sign-in fails (Google:
/// redirect_uri_mismatch), so page loads on a loopback IP are sent to <c>localhost</c> on the same port.
/// Only applies while <see cref="AppOptions.PublicBaseUrl"/> is on localhost.</summary>
public sealed class LocalhostRedirectMiddleware(RequestDelegate next, IOptions<AppOptions> app)
{
    private readonly bool _publicHostIsLocalhost =
        string.Equals(new Uri(app.Value.PublicBaseUrl).Host, "localhost", StringComparison.OrdinalIgnoreCase);

    public Task InvokeAsync(HttpContext http)
    {
        var request = http.Request;
        if (_publicHostIsLocalhost &&
            (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)) &&
            !request.Path.StartsWithSegments("/healthz") &&
            IPAddress.TryParse(request.Host.Host, out var ip) && IPAddress.IsLoopback(ip))
        {
            var host = request.Host.Port is { } port ? new HostString("localhost", port) : new HostString("localhost");
            http.Response.Redirect(
                $"{request.Scheme}://{host}{request.PathBase}{request.Path}{request.QueryString}", permanent: false, preserveMethod: true);
            return Task.CompletedTask;
        }

        return next(http);
    }
}
