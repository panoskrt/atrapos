namespace RoutePoiManager.Domain;

public static class RouteSplitting
{
    /// <summary>Splits at control point <paramref name="index"/> (which ends the first part and starts the second).
    /// Returns the two control point lists and the distance along the original line where the split happens.</summary>
    public static (List<ControlPoint> Head, List<ControlPoint> Tail, double SplitAlongM) Split(IReadOnlyList<ControlPoint> points, int index)
    {
        if (index < 1 || index > points.Count - 2)
            throw new ArgumentOutOfRangeException(nameof(index), "Split at an inner point (not the start or end).");

        var head = points.Take(index + 1).ToList();
        // The last point of the first part leads nowhere now.
        head[^1] = head[^1] with { Segment = null };
        var tail = points.Skip(index).ToList();
        var splitAlong = Geo.LengthM(RouteDrawing.BuildLine(head));
        return (head, tail, splitAlong);
    }
}
