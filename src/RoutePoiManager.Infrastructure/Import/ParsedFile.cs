using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary><paramref name="Times"/>, when present, holds each point's UTC recording time (null where the file has none).</summary>
public sealed record ParsedTrack(string? Name, List<GeoPosition> Points, List<DateTime?>? Times = null);

/// <summary>A point of interest found in the file: GPX waypoint, named route point, FIT course point or lap.</summary>
public sealed record ParsedWaypoint(
    string Name,
    string SourceType,
    int PoiType,
    bool IncludeByDefault,
    GeoPosition Position,
    string? Description = null,
    bool IsExplicitPoi = true);

public sealed record ParsedFile(
    RouteSource Kind,
    string? Name,
    int[] SuggestedActivityIds,
    List<ParsedTrack> Tracks,
    List<ParsedWaypoint> Waypoints);

/// <summary>The file can't be read as a route (not GPX/FIT, corrupt, or no track in it).</summary>
public sealed class ImportException(string message, Exception? inner = null) : Exception(message, inner);
