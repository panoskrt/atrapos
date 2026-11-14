namespace RoutePoiManager.Domain;

/// <summary>Turns an imported track into the editor's model: a manageable number of control points whose
/// track segments carry the original detail. Dragging a control point then redraws only its two segments.</summary>
public static class ImportShaping
{
    /// <summary>Tolerance for picking control points from the (already simplified) track.</summary>
    public const double ControlPointToleranceM = 60;

    /// <summary>Never leave more than this between control points, so long straight stretches stay editable.</summary>
    public const double MaxControlPointSpacingM = 2000;

    public const int MaxControlPoints = 300;

    public static List<ControlPoint> BuildControlPoints(IReadOnlyList<GeoPosition> track)
    {
        if (track.Count == 0)
            return [];
        if (track.Count == 1)
            return [new ControlPoint(track[0].Lon, track[0].Lat, SegmentMode.Track)];

        var indices = PickIndices(track, ControlPointToleranceM);
        for (var tol = ControlPointToleranceM * 2; indices.Count > MaxControlPoints; tol *= 2)
            indices = PickIndices(track, tol, enforceSpacing: false);

        var points = new List<ControlPoint>(indices.Count);
        for (var k = 0; k < indices.Count; k++)
        {
            var p = track[indices[k]];
            double?[][]? segment = k < indices.Count - 1
                ? track.Skip(indices[k]).Take(indices[k + 1] - indices[k] + 1)
                    .Select(q => new double?[] { q.Lon, q.Lat, q.Ele })
                    .ToArray()
                : null;
            points.Add(new ControlPoint(p.Lon, p.Lat, SegmentMode.Track, segment));
        }
        return points;
    }

    private static List<int> PickIndices(IReadOnlyList<GeoPosition> track, double toleranceM, bool enforceSpacing = true)
    {
        var picked = Geo.SimplifyIndices(track, toleranceM);
        if (!enforceSpacing)
            return picked;

        var result = new List<int> { picked[0] };
        var cumulative = new double[track.Count];
        for (var i = 1; i < track.Count; i++)
            cumulative[i] = cumulative[i - 1] + Geo.DistanceM(track[i - 1], track[i]);

        foreach (var next in picked.Skip(1))
        {
            var last = result[^1];
            // Add intermediate points on long stretches.
            for (var i = last + 1; i < next; i++)
            {
                if (cumulative[i] - cumulative[result[^1]] >= MaxControlPointSpacingM)
                    result.Add(i);
            }
            result.Add(next);
        }
        return result;
    }
}
