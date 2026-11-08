namespace RoutePoiManager.Domain;

public static class RouteSplitting
{
    /// <summary>Finds control-point boundaries nearest to each requested distance. Every part contains at least two
    /// control points; split positions can therefore differ from the requested interval.</summary>
    public static List<(int Index, double SplitAlongM)> DistanceCuts(
        IReadOnlyList<ControlPoint> points,
        double distanceIntervalM)
    {
        if (points.Count < 3)
            throw new InvalidOperationException("The route needs at least three control points to split.");
        if (!double.IsFinite(distanceIntervalM) || distanceIntervalM <= 0)
            throw new ArgumentOutOfRangeException(nameof(distanceIntervalM), "Enter a split distance greater than zero.");

        var boundaryDistances = new double[points.Count];
        var line = new List<GeoPosition>();
        double totalDistance = 0;
        for (var index = 0; index < points.Count - 1; index++)
        {
            var segment = RouteDrawing.BuildLine([points[index], points[index + 1]]);
            var sharesJoint = line.Count > 0 && Geo.DistanceM(line[^1], segment[0]) <= RouteDrawing.JointToleranceM;
            var start = sharesJoint ? 1 : 0;
            for (var segmentIndex = start; segmentIndex < segment.Count; segmentIndex++)
            {
                var position = segment[segmentIndex];
                if (line.Count > 0)
                    totalDistance += Geo.DistanceM(line[^1], position);
                line.Add(position);
            }
            boundaryDistances[index + 1] = totalDistance;
        }

        if (distanceIntervalM >= totalDistance)
            throw new InvalidOperationException("The split distance must be shorter than the route to create multiple parts.");

        var cuts = new List<(int Index, double SplitAlongM)>();
        var lastPossibleIndex = points.Count - 2;
        for (var targetDistance = distanceIntervalM;
             targetDistance < totalDistance && (cuts.Count == 0 ? 1 : cuts[^1].Index + 1) <= lastPossibleIndex;
             targetDistance += distanceIntervalM)
        {
            var firstPossibleIndex = cuts.Count == 0 ? 1 : cuts[^1].Index + 1;
            var index = firstPossibleIndex;
            while (index < lastPossibleIndex && boundaryDistances[index + 1] < targetDistance)
                index++;

            var nextIndex = Math.Min(index + 1, lastPossibleIndex);
            if (Math.Abs(boundaryDistances[nextIndex] - targetDistance) < Math.Abs(boundaryDistances[index] - targetDistance))
                index = nextIndex;
            cuts.Add((index, boundaryDistances[index]));

            if (targetDistance + distanceIntervalM == targetDistance)
                break;
        }

        if (cuts.Count == 0)
            throw new InvalidOperationException("The route does not have enough control points to split at this distance.");
        return cuts;
    }

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
