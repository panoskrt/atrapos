using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>Drops track points that don't change the route's shape: every point removed lies within the tolerance of
/// the kept line. Recorded times stay with the points they belong to.</summary>
public static class RouteFileShrinker
{
    /// <summary>The first track, simplified the way an import does it (<see cref="ImportService.BaseToleranceM"/>, then
    /// <paramref name="toleranceM"/>), so the GPX tools' point count matches the file. Waypoints are kept.</summary>
    public static ParsedFile Shrink(ParsedFile parsed, double toleranceM)
    {
        var track = parsed.Tracks.FirstOrDefault();
        if (track is null || track.Points.Count < 2)
            throw new ImportException("The file needs a track with at least two GPS points.");

        var baseIndices = Geo.SimplifyIndices(track.Points, ImportService.BaseToleranceM);
        var baseTrack = baseIndices.Select(i => track.Points[i]).ToList();
        var kept = Geo.SimplifyIndices(baseTrack, Math.Clamp(toleranceM, ImportService.BaseToleranceM, ImportService.MaxToleranceM))
            .Select(i => baseIndices[i])
            .ToList();

        var shrunk = new ParsedTrack(
            track.Name,
            kept.Select(i => track.Points[i]).ToList(),
            track.Times is { } times && times.Count == track.Points.Count ? kept.Select(i => times[i]).ToList() : null);
        return parsed with { Tracks = [shrunk] };
    }
}
