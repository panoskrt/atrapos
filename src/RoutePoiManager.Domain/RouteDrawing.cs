using NetTopologySuite.Geometries;

namespace RoutePoiManager.Domain;

public static class RouteDrawing
{
    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);

    /// <summary>Points closer than this are the same joint; anything further apart is bridged by a straight
    /// connector (a snapped segment ends on the trail, a freehand one at the raw click).</summary>
    public const double JointToleranceM = 1;

    /// <summary>Joins the control points' cached segments into one line. A segment that is missing or has
    /// fewer than two valid points becomes a straight line between its control points.
    /// Mirrors <c>joinSegments</c> in src/web/src/features/editor/geo.ts.</summary>
    public static List<GeoPosition> BuildLine(IReadOnlyList<ControlPoint> controlPoints)
    {
        var line = new List<GeoPosition>();
        if (controlPoints.Count == 0)
            return line;
        if (controlPoints.Count == 1)
        {
            line.Add(new GeoPosition(controlPoints[0].Lon, controlPoints[0].Lat));
            return line;
        }

        for (var i = 0; i < controlPoints.Count - 1; i++)
        {
            var from = controlPoints[i];
            var to = controlPoints[i + 1];
            var segment = ParseSegment(from.Segment) ??
                          [new GeoPosition(from.Lon, from.Lat), new GeoPosition(to.Lon, to.Lat)];
            // Consecutive segments usually share their joint point.
            var sharesJoint = line.Count > 0 && Geo.DistanceM(line[^1], segment[0]) <= JointToleranceM;
            line.AddRange(sharesJoint ? segment.Skip(1) : segment);
        }
        return line;
    }

    public static LineString? ToLineString(IReadOnlyList<GeoPosition> line) =>
        line.Count < 2
            ? null
            : Factory.CreateLineString(line.Select(p => new CoordinateZ(p.Lon, p.Lat, p.Ele ?? 0)).ToArray());

    public static List<GeoPosition> FromLineString(LineString? geometry, bool hasElevation) =>
        geometry is null
            ? []
            : geometry.Coordinates.Select(c => new GeoPosition(c.X, c.Y, hasElevation && double.IsFinite(c.Z) ? c.Z : null)).ToList();

    private static List<GeoPosition>? ParseSegment(double?[][]? raw)
    {
        if (raw is null || raw.Length < 2)
            return null;
        var points = new List<GeoPosition>(raw.Length);
        foreach (var p in raw)
        {
            if (p.Length < 2 || p[0] is not { } lon || p[1] is not { } lat || !Geo.IsValid(lon, lat))
                return null;
            var ele = p.Length > 2 && p[2] is { } e && double.IsFinite(e) ? e : (double?)null;
            points.Add(new GeoPosition(lon, lat, ele));
        }
        return points;
    }
}

public static class RouteBehaviour
{
    /// <summary>Replaces the drawing and recomputes geometry and stats.</summary>
    public static void ApplyDrawing(this Route route, List<ControlPoint> controlPoints, DateTimeOffset now)
    {
        var line = Geo.FillMissingElevation(RouteDrawing.BuildLine(controlPoints));
        var stats = Geo.Stats(line);

        route.ControlPoints = controlPoints;
        route.Geometry = RouteDrawing.ToLineString(line);
        route.HasElevation = line.Any(p => p.Ele is not null);
        route.DistanceM = stats.DistanceM;
        route.AscentM = stats.AscentM;
        route.DescentM = stats.DescentM;
        route.MarkLocallyModified(now);
    }

    /// <summary>Records a local edit. Something already on Suunto now differs from it.</summary>
    public static void MarkLocallyModified(this Route route, DateTimeOffset now)
    {
        route.LocalModifiedAt = now;
        route.SyncState = route.SyncState switch
        {
            SyncState.Synced => SyncState.LocalChanges,
            SyncState.RemoteNewer => SyncState.Conflict,
            var s => s,
        };
    }
}
