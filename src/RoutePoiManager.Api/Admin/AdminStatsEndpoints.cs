using Microsoft.EntityFrameworkCore;
using Npgsql;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Admin;

public sealed record TimeSeriesMetric(string Key, string Label, List<long> Values, long Total);

/// <summary>Counts per bucket for each metric. <see cref="Buckets"/> are the bucket start dates (UTC), contiguous
/// from <see cref="From"/> to <see cref="To"/>, so a bucket with no activity is a zero and not a gap.</summary>
public sealed record AdminTimeSeries(DateOnly From, DateOnly To, string Bucket, List<DateOnly> Buckets, List<TimeSeriesMetric> Metrics);

public static class AdminStatsEndpoints
{
    internal const int MaxBuckets = 400;
    private const int MaxRangeDays = 3650;

    /// <summary>What is counted. Table, column and filter are compile-time constants, never user input: they are
    /// written into the SQL text, while the dates are bound as parameters.</summary>
    private sealed record Metric(string Key, string Label, string Table, string Column, string Where = "TRUE");

    private static readonly Metric[] Metrics =
    [
        new("users", "New users", "users", "created_at"),
        new("routes", "Routes created", "routes", "created_at"),
        new("pois", "POIs created", "pois", "created_at"),
        new("uploads", "Files imported", "source_files", "uploaded_at"),
        new("routePushes", "Routes pushed to Suunto", "sync_log", "at", "entity = 'route' AND operation IN ('import', 'update')"),
        new("poiPushes", "POIs pushed to Suunto", "sync_log", "at", "entity = 'poi' AND operation IN ('create', 'upsert')"),
        new("errors", "Errors logged", "error_logs", "at"),
    ];

    public sealed class BucketCount
    {
        public DateOnly Bucket { get; set; }
        public long Count { get; set; }
    }

    public static void MapAdminStatsEndpoints(this RouteGroupBuilder admin) =>
        admin.MapGet("/stats/timeseries", GetTimeSeries);

    private static async Task<IResult> GetTimeSeries(DateOnly? from, DateOnly? to, string? bucket, AppDbContext db,
        TimeProvider clock, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        var end = to ?? today;
        var start = from ?? end.AddDays(-29);

        var errors = new Dictionary<string, string[]>();
        if (start > end) errors["from"] = ["The start date must not be after the end date."];
        else if (end.DayNumber - start.DayNumber >= MaxRangeDays) errors["from"] = ["Choose a range of at most 10 years."];
        var unit = (bucket ?? "auto").ToLowerInvariant();
        if (unit is not ("auto" or "day" or "week" or "month")) errors["bucket"] = ["Choose day, week or month."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        if (unit == "auto")
        {
            var days = end.DayNumber - start.DayNumber + 1;
            unit = days <= 92 ? "day" : days <= 548 ? "week" : "month";
        }

        var buckets = BucketStarts(start, end, unit);
        if (buckets.Count > MaxBuckets)
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["bucket"] = [$"That range has {buckets.Count} {unit}s; choose a coarser bucket or a shorter range (at most {MaxBuckets})."],
            });

        var lower = new DateTimeOffset(start.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var upper = new DateTimeOffset(end.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var index = buckets.Select((b, i) => (b, i)).ToDictionary(x => x.b, x => x.i);

        var metrics = new List<TimeSeriesMetric>();
        foreach (var m in Metrics)
        {
            // Bucketing is done in UTC so the buckets match the dates the admin picked, wherever the server runs.
            var sql = $"""
                SELECT date_trunc('{unit}', {m.Column} AT TIME ZONE 'UTC')::date AS "Bucket", count(*)::bigint AS "Count"
                FROM {m.Table}
                WHERE {m.Column} >= @p_from AND {m.Column} < @p_to AND {m.Where}
                GROUP BY 1
                """;
            var rows = await db.Database
                .SqlQueryRaw<BucketCount>(sql, new NpgsqlParameter("p_from", lower), new NpgsqlParameter("p_to", upper))
                .ToListAsync(ct);
            var values = new long[buckets.Count];
            foreach (var r in rows)
                if (index.TryGetValue(r.Bucket, out var i)) values[i] += r.Count;
            metrics.Add(new TimeSeriesMetric(m.Key, m.Label, [.. values], values.Sum()));
        }

        return Results.Ok(new AdminTimeSeries(start, end, unit, buckets, metrics));
    }

    /// <summary>First day of each day / week (Monday, like Postgres) / month that overlaps the range.</summary>
    internal static List<DateOnly> BucketStarts(DateOnly from, DateOnly to, string unit)
    {
        DateOnly Floor(DateOnly d) => unit switch
        {
            "week" => d.AddDays(-(((int)d.DayOfWeek + 6) % 7)),
            "month" => new DateOnly(d.Year, d.Month, 1),
            _ => d,
        };
        DateOnly Next(DateOnly d) => unit switch
        {
            "week" => d.AddDays(7),
            "month" => d.AddMonths(1),
            _ => d.AddDays(1),
        };

        var list = new List<DateOnly>();
        for (var b = Floor(from); b <= to && list.Count <= MaxBuckets; b = Next(b)) list.Add(b);
        return list;
    }
}
