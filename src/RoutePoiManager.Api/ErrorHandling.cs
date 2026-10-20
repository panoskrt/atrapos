using Microsoft.AspNetCore.Diagnostics;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Api;

/// <summary>Maps "Suunto needs a new sign-in" to 401 with a code the SPA recognises.</summary>
public sealed class SuuntoReauthExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var notConnected = exception is SuuntoNotConnectedException;
        if (!notConnected && exception is not SuuntoReauthRequiredException)
            return false;

        var status = notConnected ? StatusCodes.Status409Conflict : StatusCodes.Status401Unauthorized;
        httpContext.Response.StatusCode = status;
        await httpContext.Response.WriteAsJsonAsync(new
        {
            type = "about:blank",
            title = exception.Message,
            status,
            code = notConnected ? "suunto_not_connected" : "suunto_reauth",
        }, cancellationToken);
        return true;
    }
}

/// <summary>Sync failures as problem details the SPA can show: Suunto errors (502, or 429 when rate-limited),
/// requests that can't go ahead (422) and unknown ids (404).</summary>
public sealed class SyncExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (status, code) = exception switch
        {
            Infrastructure.Suunto.SuuntoApiException { StatusCode: 429 } => (429, "suunto_rate_limited"),
            Infrastructure.Suunto.SuuntoApiException => (502, "suunto_error"),
            Infrastructure.Sync.SyncException => (422, "sync_rejected"),
            KeyNotFoundException => (404, "not_found"),
            _ => (0, null),
        };
        if (status == 0)
            return false;

        httpContext.Response.StatusCode = status;
        await httpContext.Response.WriteAsJsonAsync(new { type = "about:blank", title = exception.Message, status, code }, cancellationToken);
        return true;
    }
}

/// <summary>Unsafe requests must carry a custom header. A cross-site form can't add one, and a
/// cross-origin fetch that tries is stopped by CORS preflight (no CORS is configured).</summary>
public sealed class CsrfHeaderMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-RPM-CSRF";

    public Task InvokeAsync(HttpContext http)
    {
        var unsafeMethod = !(HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method) ||
                             HttpMethods.IsOptions(http.Request.Method));
        var protectedPath = http.Request.Path.StartsWithSegments("/api") || http.Request.Path.StartsWithSegments("/auth");

        if (unsafeMethod && protectedPath && !http.Request.Headers.ContainsKey(HeaderName))
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            return http.Response.WriteAsJsonAsync(new { title = $"Missing {HeaderName} header.", status = 400 });
        }

        return next(http);
    }
}
