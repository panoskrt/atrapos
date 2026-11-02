using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>What the user chose in the import dialog.</summary>
public sealed record ImportOptions(
    int TrackIndex,
    double ToleranceM,
    string? Name,
    int[] ActivityIds,
    List<WaypointChoice> Waypoints);

/// <summary>Index refers to <see cref="ParsedFile.Waypoints"/>.</summary>
public sealed record WaypointChoice(int Index, bool Include, string Name, int PoiType);

public sealed class ImportService(AppDbContext db, TimeProvider clock)
{
    public const double MaxToleranceM = 50;

    /// <summary>Lossless-in-practice pre-simplification shared by preview and import, so the dialog's point
    /// counts match what gets saved (the client runs the same Douglas–Peucker on the same input).</summary>
    public const double BaseToleranceM = 1;

    public static ParsedFile Parse(byte[] content, string fileName)
    {
        if (content.Length == 0)
            throw new ImportException("The file is empty.");

        if (FitParser.LooksLikeFit(content.AsSpan(0, Math.Min(content.Length, 14))))
            return FitParser.Parse(content);
        if (fileName.EndsWith(".fit", StringComparison.OrdinalIgnoreCase))
            throw new ImportException("The file has a .fit extension but isn't a FIT file.");
        using var stream = new MemoryStream(content, writable: false);
        return GpxParser.Parse(stream);
    }

    /// <summary>The track as previewed and imported: pre-simplified at <see cref="BaseToleranceM"/>.</summary>
    public static List<GeoPosition> BaseTrack(ParsedTrack track) =>
        Geo.SimplifyIndices(track.Points, BaseToleranceM).Select(i => track.Points[i]).ToList();

    public async Task<Route> CreateRouteAsync(Guid userId, byte[] content, string fileName, ImportOptions options, CancellationToken ct)
    {
        var parsed = Parse(content, fileName);
        if (options.TrackIndex < 0 || options.TrackIndex >= parsed.Tracks.Count)
            throw new ImportException("Unknown track index.");

        var tolerance = Math.Clamp(options.ToleranceM, 0, MaxToleranceM);
        var baseTrack = BaseTrack(parsed.Tracks[options.TrackIndex]);
        var detailed = Geo.SimplifyIndices(baseTrack, tolerance).Select(i => baseTrack[i]).ToList();

        var now = clock.GetUtcNow();
        var activityIds = options.ActivityIds.Where(ActivityTypes.IsValid).Distinct().Take(10).ToArray();
        var route = new Route
        {
            Id = Guid.CreateVersion7(),
            UserId = userId,
            Name = Trimmed(options.Name) ?? parsed.Name ?? Path.GetFileNameWithoutExtension(fileName),
            ActivityIds = activityIds.Length > 0 ? activityIds : parsed.SuggestedActivityIds,
            Source = parsed.Kind,
            SimplifyToleranceM = tolerance,
            CreatedAt = now,
        };
        route.Name = route.Name.Length > 200 ? route.Name[..200] : route.Name;
        route.ApplyDrawing(ImportShaping.BuildControlPoints(detailed), now);
        db.Routes.Add(route);

        var line = RouteDrawing.FromLineString(route.Geometry, route.HasElevation);
        foreach (var choice in options.Waypoints.Where(c => c.Include).DistinctBy(c => c.Index))
        {
            if (choice.Index < 0 || choice.Index >= parsed.Waypoints.Count)
                continue;
            var wp = parsed.Waypoints[choice.Index];
            var (along, offset) = Geo.Locate(line, wp.Position);
            var onRoute = offset <= PoiBehaviour.OnRouteMaxOffsetM;
            var ele = wp.Position.Ele ?? (onRoute ? NearestElevation(line, wp.Position) : null);

            db.Pois.Add(new Poi
            {
                Id = Guid.CreateVersion7(),
                UserId = userId,
                RouteId = route.Id,
                Name = Trimmed(choice.Name) is { } n ? (n.Length > 200 ? n[..200] : n) : wp.Name,
                Description = wp.Description,
                PoiType = PoiTypes.IsValid(choice.PoiType) ? choice.PoiType : PoiTypes.Poi,
                Location = PoiBehaviour.CreateLocation(wp.Position.Lon, wp.Position.Lat),
                ElevationM = ele,
                DistanceAlongM = onRoute ? along : null,
                ActivityId = route.ActivityIds.FirstOrDefault(),
                CreatedAt = now,
                LocalModifiedAt = now,
            });
        }

        db.SourceFiles.Add(new SourceFile
        {
            Id = Guid.CreateVersion7(),
            RouteId = route.Id,
            FileName = fileName.Length > 260 ? fileName[..260] : fileName,
            Kind = parsed.Kind,
            Content = content,
            UploadedAt = now,
        });

        await db.SaveChangesAsync(ct);
        return route;
    }

    private static double? NearestElevation(List<GeoPosition> line, GeoPosition p)
    {
        var withEle = line.Where(q => q.Ele is not null).ToList();
        return withEle.Count == 0 ? null : withEle.MinBy(q => Geo.DistanceM(q, p)).Ele;
    }

    private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
