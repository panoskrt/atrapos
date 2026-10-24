namespace RoutePoiManager.Domain;

/// <summary>A WGS84 position with optional elevation in metres.</summary>
public readonly record struct GeoPosition(double Lon, double Lat, double? Ele = null);

public sealed record RouteStats(double DistanceM, double AscentM, double DescentM);

/// <summary>Geometry helpers shared by import, editing and sync. The web client mirrors
/// <see cref="Stats"/> in <c>src/web/src/features/editor/geo.ts</c>; keep them in step.</summary>
public static class Geo
{
    private const double EarthRadiusM = 6371008.8;
    private const double ClimbComparisonEpsilonM = 1e-9;
    private const double ElevationNoiseFilterWindowM = 100;
    private const double ElevationNoiseRmsThresholdM = 3;
    private const double ElevationNoiseFilterMinRouteLengthM = 10_000;

    /// <summary>Elevation changes smaller than this are treated as noise when summing ascent/descent.</summary>
    public const double ClimbHysteresisM = 20;

    public static double DistanceM(GeoPosition a, GeoPosition b)
    {
        var dLat = double.DegreesToRadians(b.Lat - a.Lat);
        var dLon = double.DegreesToRadians(b.Lon - a.Lon);
        var h = Math.Pow(Math.Sin(dLat / 2), 2) +
                Math.Cos(double.DegreesToRadians(a.Lat)) * Math.Cos(double.DegreesToRadians(b.Lat)) *
                Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * EarthRadiusM * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    public static double LengthM(IReadOnlyList<GeoPosition> line)
    {
        double total = 0;
        for (var i = 1; i < line.Count; i++)
            total += DistanceM(line[i - 1], line[i]);
        return total;
    }

    /// <summary>Distance plus hysteresis-filtered ascent and descent. Long, noisy profiles are smoothed for
    /// the totals only; points without elevation are skipped for climb, not for distance.</summary>
    public static RouteStats Stats(IReadOnlyList<GeoPosition> line)
    {
        var cumulative = CumulativeDistances(line);
        var elevations = line.Select(p => p.Ele).ToArray();
        if (cumulative.Length > 1 && cumulative[^1] >= ElevationNoiseFilterMinRouteLengthM &&
            elevations.All(e => e is not null))
        {
            // Smooth high-frequency DEM noise for totals without changing the stored elevation profile.
            var smoothed = SmoothElevations(elevations.Select(e => e!.Value).ToArray(), cumulative);
            var residualRms = Math.Sqrt(elevations
                .Select((e, i) => Math.Pow(e!.Value - smoothed[i], 2))
                .Average());
            if (residualRms > ElevationNoiseRmsThresholdM)
                elevations = smoothed.Select(e => (double?)e).ToArray();
        }

        double ascent = 0, descent = 0;
        double? anchor = null;
        foreach (var elevation in elevations)
        {
            if (elevation is not { } ele)
                continue;
            if (anchor is null)
            {
                anchor = ele;
                continue;
            }
            var diff = ele - anchor.Value;
            if (Math.Abs(diff) < ClimbHysteresisM - ClimbComparisonEpsilonM)
                continue;
            if (diff > 0) ascent += diff;
            else descent -= diff;
            anchor = ele;
        }
        return new RouteStats(cumulative.Length > 0 ? cumulative[^1] : 0, ascent, descent);
    }

    private static double[] CumulativeDistances(IReadOnlyList<GeoPosition> line)
    {
        var cumulative = new double[line.Count];
        for (var i = 1; i < line.Count; i++)
            cumulative[i] = cumulative[i - 1] + DistanceM(line[i - 1], line[i]);
        return cumulative;
    }

    private static double[] SmoothElevations(double[] elevations, double[] cumulative)
    {
        var smoothed = new double[elevations.Length];
        var halfWindow = ElevationNoiseFilterWindowM / 2;
        var left = 0;
        var right = 0;
        var count = 0;
        double sum = 0;

        for (var i = 0; i < elevations.Length; i++)
        {
            var start = cumulative[i] - halfWindow;
            var end = cumulative[i] + halfWindow;
            while (right < elevations.Length && cumulative[right] <= end)
            {
                sum += elevations[right++];
                count++;
            }
            while (left < elevations.Length && cumulative[left] < start)
            {
                sum -= elevations[left++];
                count--;
            }
            smoothed[i] = sum / count;
        }

        return smoothed;
    }

    /// <summary>Fills missing elevations by linear interpolation along distance; ends take the nearest known
    /// value. Returns the input unchanged if no point has an elevation.</summary>
    public static IReadOnlyList<GeoPosition> FillMissingElevation(IReadOnlyList<GeoPosition> line)
    {
        if (line.All(p => p.Ele is not null) || line.All(p => p.Ele is null))
            return line;

        var cumulative = new double[line.Count];
        for (var i = 1; i < line.Count; i++)
            cumulative[i] = cumulative[i - 1] + DistanceM(line[i - 1], line[i]);

        var result = line.ToArray();
        int? prevKnown = null;
        for (var i = 0; i < result.Length; i++)
        {
            if (result[i].Ele is null)
                continue;
            if (prevKnown is null)
            {
                for (var j = 0; j < i; j++) result[j] = result[j] with { Ele = result[i].Ele };
            }
            else if (prevKnown.Value < i - 1)
            {
                var a = prevKnown.Value;
                var span = cumulative[i] - cumulative[a];
                for (var j = a + 1; j < i; j++)
                {
                    var t = span > 0 ? (cumulative[j] - cumulative[a]) / span : 0;
                    result[j] = result[j] with { Ele = result[a].Ele + t * (result[i].Ele - result[a].Ele) };
                }
            }
            prevKnown = i;
        }
        for (var j = prevKnown!.Value + 1; j < result.Length; j++)
            result[j] = result[j] with { Ele = result[prevKnown.Value].Ele };
        return result;
    }

    /// <summary>Douglas–Peucker in metres (local equirectangular projection). Returns the kept indices in order,
    /// always including the first and last point. Mirrors <c>simplifyIndices</c> in the web import dialog.</summary>
    public static List<int> SimplifyIndices(IReadOnlyList<GeoPosition> line, double toleranceM)
    {
        if (line.Count <= 2 || toleranceM <= 0)
            return [.. Enumerable.Range(0, line.Count)];

        var (xs, ys) = Project(line);
        var keep = new bool[line.Count];
        keep[0] = keep[^1] = true;
        var stack = new Stack<(int A, int B)>();
        stack.Push((0, line.Count - 1));
        var tolSq = toleranceM * toleranceM;

        while (stack.Count > 0)
        {
            var (a, b) = stack.Pop();
            double maxSq = 0;
            var idx = -1;
            for (var i = a + 1; i < b; i++)
            {
                var d = SegmentDistanceSq(xs[i], ys[i], xs[a], ys[a], xs[b], ys[b]);
                if (d > maxSq)
                {
                    maxSq = d;
                    idx = i;
                }
            }
            if (idx >= 0 && maxSq > tolSq)
            {
                keep[idx] = true;
                stack.Push((a, idx));
                stack.Push((idx, b));
            }
        }

        var result = new List<int>();
        for (var i = 0; i < keep.Length; i++)
            if (keep[i]) result.Add(i);
        return result;
    }

    /// <summary>Where a point lies relative to a line: distance along it to the nearest spot, and how far off it is.</summary>
    public static (double AlongM, double OffsetM) Locate(IReadOnlyList<GeoPosition> line, GeoPosition point)
    {
        if (line.Count == 0)
            return (0, double.PositiveInfinity);
        if (line.Count == 1)
            return (0, DistanceM(line[0], point));

        var k = Math.Cos(double.DegreesToRadians(point.Lat)) * MetresPerDegree;
        double px = point.Lon * k, py = point.Lat * MetresPerDegree;
        double bestSq = double.PositiveInfinity, bestAlong = 0, along = 0;
        for (var i = 1; i < line.Count; i++)
        {
            double ax = line[i - 1].Lon * k, ay = line[i - 1].Lat * MetresPerDegree;
            double bx = line[i].Lon * k, by = line[i].Lat * MetresPerDegree;
            var segLen = DistanceM(line[i - 1], line[i]);
            var t = ProjectT(px, py, ax, ay, bx, by);
            var dx = ax + t * (bx - ax) - px;
            var dy = ay + t * (by - ay) - py;
            var dSq = dx * dx + dy * dy;
            if (dSq < bestSq)
            {
                bestSq = dSq;
                bestAlong = along + t * segLen;
            }
            along += segLen;
        }
        return (bestAlong, Math.Sqrt(bestSq));
    }

    /// <summary>The point at <paramref name="alongM"/> metres along the line (clamped), elevation interpolated.</summary>
    public static GeoPosition PositionAt(IReadOnlyList<GeoPosition> line, double alongM)
    {
        if (line.Count == 0)
            throw new ArgumentException("Empty line.", nameof(line));
        if (alongM <= 0 || line.Count == 1)
            return line[0];

        double walked = 0;
        for (var i = 1; i < line.Count; i++)
        {
            var seg = DistanceM(line[i - 1], line[i]);
            if (walked + seg >= alongM)
            {
                var t = seg > 0 ? (alongM - walked) / seg : 0;
                var a = line[i - 1];
                var b = line[i];
                double? ele = a.Ele is { } ea && b.Ele is { } eb ? ea + (eb - ea) * t : a.Ele ?? b.Ele;
                return new GeoPosition(a.Lon + (b.Lon - a.Lon) * t, a.Lat + (b.Lat - a.Lat) * t, ele);
            }
            walked += seg;
        }
        return line[^1];
    }

    private const double MetresPerDegree = Math.PI * EarthRadiusM / 180;

    private static (double[] Xs, double[] Ys) Project(IReadOnlyList<GeoPosition> line)
    {
        var lat0 = line.Average(p => p.Lat);
        var k = Math.Cos(double.DegreesToRadians(lat0)) * MetresPerDegree;
        var xs = new double[line.Count];
        var ys = new double[line.Count];
        for (var i = 0; i < line.Count; i++)
        {
            xs[i] = line[i].Lon * k;
            ys[i] = line[i].Lat * MetresPerDegree;
        }
        return (xs, ys);
    }

    private static double ProjectT(double px, double py, double ax, double ay, double bx, double by)
    {
        double dx = bx - ax, dy = by - ay;
        var lenSq = dx * dx + dy * dy;
        return lenSq == 0 ? 0 : Math.Clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
    }

    private static double SegmentDistanceSq(double px, double py, double ax, double ay, double bx, double by)
    {
        var t = ProjectT(px, py, ax, ay, bx, by);
        var dx = ax + t * (bx - ax) - px;
        var dy = ay + t * (by - ay) - py;
        return dx * dx + dy * dy;
    }

    public static bool IsValid(double lon, double lat) =>
        double.IsFinite(lon) && double.IsFinite(lat) && lon is >= -180 and <= 180 && lat is >= -90 and <= 90;
}
