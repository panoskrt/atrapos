using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Infrastructure.Diagnostics;

/// <summary>Writes errors to the <c>error_logs</c> table. It uses its own scope and context, so it works even when
/// the request's context is broken, and it never throws: a failure to log must not hide the original error.</summary>
public sealed class ErrorLogService(IServiceScopeFactory scopes, TimeProvider clock, ILogger<ErrorLogService> logger)
{
    private const int MaxMessage = 4000;
    private const int MaxStackTrace = 20000;

    public async Task LogAsync(
        string operation,
        Exception? exception,
        string? message = null,
        Guid? userId = null,
        string? username = null,
        int? httpStatus = null,
        string? requestPath = null)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            if (username is null && userId is { } id)
            {
                var account = await db.Users.AsNoTracking()
                    .Where(u => u.Id == id)
                    .Select(u => new { u.SuuntoUsername, u.GoogleSubject })
                    .SingleOrDefaultAsync();
                username = account?.SuuntoUsername ?? (account?.GoogleSubject is { } sub ? $"google:{sub}" : null);
            }

            db.ErrorLogs.Add(new ErrorLog
            {
                At = clock.GetUtcNow(),
                UserId = userId,
                Username = Truncate(username, 200),
                Operation = Truncate(operation, 200)!,
                ExceptionType = Truncate(exception?.GetType().FullName, 200),
                Message = Truncate(message ?? exception?.Message ?? "", MaxMessage)!,
                StackTrace = Truncate(exception?.ToString(), MaxStackTrace),
                HttpStatus = httpStatus,
                RequestPath = Truncate(requestPath, 500),
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Couldn't write to error_logs (operation {Operation})", operation);
        }
    }

    private static string? Truncate(string? value, int max) => value is not null && value.Length > max ? value[..max] : value;
}
