using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Admin;

public sealed record AdminSyncLogRow(
    long Id, Guid UserId, string? Owner, string Entity, Guid? EntityId, string Operation, int? HttpStatus, string? Message, DateTimeOffset At);

public sealed record AdminErrorLogRow(
    long Id, DateTimeOffset At, Guid? UserId, string? Username, string Operation, string? ExceptionType,
    string Message, int? HttpStatus, string? RequestPath);

public sealed record AdminErrorLogDetail(AdminErrorLogRow Row, string? StackTrace);

public sealed record PurgeRequest(int OlderThanDays);

public sealed record PurgeResponse(int Deleted);

public static class AdminLogEndpoints
{
    public static void MapAdminLogEndpoints(this RouteGroupBuilder admin)
    {
        var sync = admin.MapGroup("/sync-log");
        sync.MapGet("/", async (string? q, Guid? userId, string? entity, string? operation, int? page, int? pageSize,
            AppDbContext db, CancellationToken ct) =>
        {
            var log = db.SyncLog.AsNoTracking().AsQueryable();
            if (userId is { } uid) log = log.Where(l => l.UserId == uid);
            if (!string.IsNullOrWhiteSpace(entity)) log = log.Where(l => l.Entity == entity);
            if (!string.IsNullOrWhiteSpace(operation)) log = log.Where(l => l.Operation == operation);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var like = AdminEndpoints.Like(q);
                log = log.Where(l => (l.Message != null && EF.Functions.ILike(l.Message, like, "\\")) ||
                                     (l.EntityId != null && EF.Functions.ILike(l.EntityId.Value.ToString(), like, "\\")));
            }
            var rows = from l in log.OrderByDescending(l => l.At).ThenByDescending(l => l.Id)
                       join u in db.Users on l.UserId equals u.Id
                       select new AdminSyncLogRow(l.Id, l.UserId, u.SuuntoUsername, l.Entity, l.EntityId, l.Operation, l.HttpStatus, l.Message, l.At);
            return Results.Ok(await AdminEndpoints.ToPageAsync(rows, page, pageSize, ct));
        });
        sync.MapDelete("/{id:long}", async (long id, AppDbContext db, CancellationToken ct) =>
            await db.SyncLog.Where(l => l.Id == id).ExecuteDeleteAsync(ct) == 0 ? Results.NotFound() : Results.NoContent());
        sync.MapPost("/purge", async (PurgeRequest body, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            if (Validate(body) is { } errors) return Results.ValidationProblem(errors);
            var cutoff = clock.GetUtcNow().AddDays(-body.OlderThanDays);
            return Results.Ok(new PurgeResponse(await db.SyncLog.Where(l => l.At < cutoff).ExecuteDeleteAsync(ct)));
        });

        var errors = admin.MapGroup("/error-logs");
        errors.MapGet("/", async (string? q, Guid? userId, int? status, int? page, int? pageSize, AppDbContext db, CancellationToken ct) =>
        {
            var log = db.ErrorLogs.AsNoTracking().AsQueryable();
            if (userId is { } uid) log = log.Where(e => e.UserId == uid);
            if (status is { } s) log = log.Where(e => e.HttpStatus == s);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var like = AdminEndpoints.Like(q);
                log = log.Where(e => EF.Functions.ILike(e.Message, like, "\\") || EF.Functions.ILike(e.Operation, like, "\\") ||
                                     (e.ExceptionType != null && EF.Functions.ILike(e.ExceptionType, like, "\\")) ||
                                     (e.Username != null && EF.Functions.ILike(e.Username, like, "\\")));
            }
            var rows = log.OrderByDescending(e => e.At).ThenByDescending(e => e.Id).Select(e => ErrorRow(e));
            return Results.Ok(await AdminEndpoints.ToPageAsync(rows, page, pageSize, ct));
        });
        errors.MapGet("/{id:long}", async (long id, AppDbContext db, CancellationToken ct) =>
        {
            var e = await db.ErrorLogs.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id, ct);
            return e is null ? Results.NotFound() : Results.Ok(new AdminErrorLogDetail(ErrorRow(e), e.StackTrace));
        });
        errors.MapDelete("/{id:long}", async (long id, AppDbContext db, CancellationToken ct) =>
            await db.ErrorLogs.Where(e => e.Id == id).ExecuteDeleteAsync(ct) == 0 ? Results.NotFound() : Results.NoContent());
        errors.MapPost("/purge", async (PurgeRequest body, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            if (Validate(body) is { } problems) return Results.ValidationProblem(problems);
            var cutoff = clock.GetUtcNow().AddDays(-body.OlderThanDays);
            return Results.Ok(new PurgeResponse(await db.ErrorLogs.Where(e => e.At < cutoff).ExecuteDeleteAsync(ct)));
        });
    }

    private static AdminErrorLogRow ErrorRow(ErrorLog e) =>
        new(e.Id, e.At, e.UserId, e.Username, e.Operation, e.ExceptionType, e.Message, e.HttpStatus, e.RequestPath);

    private static Dictionary<string, string[]>? Validate(PurgeRequest body) =>
        body.OlderThanDays is < 0 or > 3650
            ? new Dictionary<string, string[]> { ["olderThanDays"] = ["Enter a number of days from 0 to 3650."] }
            : null;
}
