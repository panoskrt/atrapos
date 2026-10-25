using Microsoft.AspNetCore.Diagnostics;
using System.Security.Claims;
using RoutePoiManager.Infrastructure.Diagnostics;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.Api;

/// <summary>Records every exception that reaches the exception middleware in <c>error_logs</c>, then lets the
/// next handler produce the response (so it is registered first and always returns false).</summary>
public sealed class ErrorLogExceptionHandler(ErrorLogService errors) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        // A client that went away is not an error worth keeping.
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
            return false;

        var request = httpContext.Request;
        var pattern = (httpContext.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? request.Path.Value;
        var user = httpContext.User;
        await errors.LogAsync(
            $"{request.Method} {pattern}",
            exception,
            userId: Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null,
            username: user.Identity?.IsAuthenticated == true ? user.Identity.Name : null,
            httpStatus: StatusFor(exception),
            requestPath: request.Path + request.QueryString);
        return false;
    }

    /// <summary>The status the handlers below will answer with (kept in step with them).</summary>
    private static int StatusFor(Exception exception) => exception switch
    {
        SuuntoNotConnectedException => StatusCodes.Status409Conflict,
        SuuntoReauthRequiredException => StatusCodes.Status401Unauthorized,
        SuuntoApiException { StatusCode: 429 } => 429,
        SuuntoApiException => 502,
        Infrastructure.Sync.SyncException => 422,
        KeyNotFoundException => 404,
        _ => 500,
    };
}

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
