using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Routes;

public sealed record ImportTrackDto(string? Name, int OriginalPointCount, double DistanceM, bool HasElevation, double?[][] Coordinates);

public sealed record ImportWaypointDto(
    string Name,
    string SourceType,
    int PoiType,
    bool Include,
    double Lon,
    double Lat,
    double? Ele,
    string? Description);

public sealed record ImportPreviewDto(
    string FileName,
    RouteSource Kind,
    string? Name,
    int[] SuggestedActivityIds,
    double BaseToleranceM,
    List<ImportTrackDto> Tracks,
    List<ImportWaypointDto> Waypoints);

public static class ImportEndpoints
{
    private const int MaxWaypoints = 2000;

    public static void MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        // Multipart endpoints: CsrfHeaderMiddleware protects them, so ASP.NET's form antiforgery is off.
        var g = app.MapGroup("/api/imports").RequireAuthorization().DisableAntiforgery()
            .WithMetadata(new RequestSizeLimitAttribute(ImportService.MaxFileBytes + 1024 * 1024));

        g.MapPost("/preview", async (IFormFile? file, CancellationToken ct) =>
        {
            var (content, error) = await ReadAsync(file, ct);
            if (error is not null)
                return error;

            ParsedFile parsed;
            try
            {
                parsed = ImportService.Parse(content!, file!.FileName);
            }
            catch (ImportException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 422, extensions: new Dictionary<string, object?> { ["code"] = "import_failed" });
            }

            var tracks = parsed.Tracks.Select(t =>
            {
                var baseTrack = ImportService.BaseTrack(t);
                return new ImportTrackDto(
                    t.Name,
                    t.Points.Count,
                    Math.Round(Geo.LengthM(baseTrack), 1),
                    baseTrack.Any(p => p.Ele is not null),
                    baseTrack.Select(p => new double?[] { Math.Round(p.Lon, 6), Math.Round(p.Lat, 6), p.Ele is { } e ? Math.Round(e, 1) : null }).ToArray());
            }).ToList();

            return Results.Ok(new ImportPreviewDto(
                file.FileName,
                parsed.Kind,
                parsed.Name,
                parsed.SuggestedActivityIds,
                ImportService.BaseToleranceM,
                tracks,
                parsed.Waypoints.Take(MaxWaypoints).Select(w => new ImportWaypointDto(
                    w.Name, w.SourceType, w.PoiType, w.IncludeByDefault,
                    Math.Round(w.Position.Lon, 6), Math.Round(w.Position.Lat, 6), w.Position.Ele, w.Description)).ToList()));
        });

        g.MapPost("/convert", async (IFormFile? file, CancellationToken ct) =>
        {
            var (content, error) = await ReadAsync(file, ct);
            if (error is not null)
                return error;

            var extension = Path.GetExtension(file!.FileName);
            if (!extension.Equals(".fit", StringComparison.OrdinalIgnoreCase) &&
                !extension.Equals(".gpx", StringComparison.OrdinalIgnoreCase))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["Choose a .fit or .gpx file."] });

            var isFit = extension.Equals(".fit", StringComparison.OrdinalIgnoreCase);
            var outputExtension = isFit ? ".gpx" : ".fit";
            ParsedFile parsed;
            try
            {
                parsed = ImportService.Parse(content!, file.FileName);
                var output = isFit ? RouteFileConverter.ToGpx(parsed) : RouteFileConverter.ToFit(parsed);
                var name = Path.GetFileNameWithoutExtension(file.FileName);
                var safeName = string.Concat(name.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-')).Trim('-');
                if (string.IsNullOrWhiteSpace(safeName))
                    safeName = "converted-route";
                return Results.File(output, isFit ? "application/gpx+xml" : "application/vnd.ant.fit", safeName + outputExtension);
            }
            catch (ImportException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 422, extensions: new Dictionary<string, object?> { ["code"] = "conversion_failed" });
            }
            catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
            {
                return Results.Problem(title: "The route could not be converted.", statusCode: 422, extensions: new Dictionary<string, object?> { ["code"] = "conversion_failed" });
            }
        });

        g.MapPost("/", async (HttpContext http, IFormFile? file, [FromForm] string? options, ImportService imports, AppDbContext db,
            CancellationToken ct) =>
        {
            var (content, error) = await ReadAsync(file, ct);
            if (error is not null)
                return error;

            ImportOptions? opts;
            try
            {
                opts = string.IsNullOrWhiteSpace(options)
                    ? null
                    : JsonSerializer.Deserialize<ImportOptions>(options, JsonSerializerOptions.Web);
            }
            catch (JsonException)
            {
                opts = null;
            }
            if (opts is null || opts.Waypoints is null || opts.ActivityIds is null)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["options"] = ["Import options are missing or malformed."] });

            try
            {
                var route = await imports.CreateRouteAsync(http.User.GetUserId(), content!, file!.FileName, opts, ct);
                return Results.Created($"/api/routes/{route.Id}", RouteEndpoints.ToDetail(route, await RoutePois.ActiveAsync(db, route.Id, ct)));
            }
            catch (ImportException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 422, extensions: new Dictionary<string, object?> { ["code"] = "import_failed" });
            }
        });
    }

    private static async Task<(byte[]? Content, IResult? Error)> ReadAsync(IFormFile? file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
            return (null, Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["Choose a GPX or FIT file."] }));
        if (file.Length > ImportService.MaxFileBytes)
            return (null, Results.Problem(title: "The file is larger than 20 MB.", statusCode: 413));

        using var ms = new MemoryStream((int)file.Length);
        await file.CopyToAsync(ms, ct);
        return (ms.ToArray(), null);
    }
}
