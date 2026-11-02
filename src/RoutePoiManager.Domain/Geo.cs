namespace RoutePoiManager.Domain;

/// <summary>A WGS84 position with optional elevation in metres.</summary>
public readonly record struct GeoPosition(double Lon, double Lat, double? Ele = null);

public sealed record RouteStats(double DistanceM, double AscentM, double DescentM);

/// <summary>Geometry helpers shared by import, editing and sync. The web client mirrors
/// <see cref="Stats"/> in <c>src/web/src/features/editor/geo.ts</c>; keep them in step.</summary>
public static class Geo
{
    private const double EarthRadiusM = 6371008.8;

    /// <summary>The elevation profile is resampled to this spacing before smoothing, so point density
    /// (a sparse import or a dense snapped trail) does not change the totals.</summary>
    private const double ElevationResampleStepM = 5;

    /// <summary>Moving-average half-width, in resampled steps (±50 m): removes DEM/GPS jitter.</summary>
    private const int ElevationSmoothingHalfWidthSteps = 10;

    /// <summary>A climb or descent only counts once the profile has reversed by this much from its extreme.</summary>
    public const double ClimbHysteresisM = 5;

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

    /// <summary>Distance plus ascent and descent. The elevation profile is resampled at a fixed spacing,
    /// smoothed, then summed between turning points that differ by at least <see cref="ClimbHysteresisM"/>.
    /// Points without elevation are skipped for climb, not for distance.</summary>
    public static RouteStats Stats(IReadOnlyList<GeoPosition> line)
    {
        var cumulative = CumulativeDistances(line);
        var (ascent, descent) = Climb(line, cumulative);
        return new RouteStats(cumulative.Length > 0 ? cumulative[^1] : 0, ascent, descent);
    }

    private static (double Ascent, double Descent) Climb(IReadOnlyList<GeoPosition> line, double[] cumulative)
    {
        var distances = new List<double>();
        var elevations = new List<double>();
        for (var i = 0; i < line.Count; i++)
        {
            if (line[i].Ele is not { } ele)
                continue;
            // Coincident points would make the interpolation ambiguous; keep the first.
            if (distances.Count > 0 && cumulative[i] <= distances[^1])
                continue;
            distances.Add(cumulative[i]);
            elevations.Add(ele);
        }
        if (distances.Count < 2)
            return (0, 0);

        var profile = SmoothElevations(Resample(distances, elevations));
        return SumClimb(profile);
    }

    /// <summary>Linear interpolation at a fixed spacing from the first to the last known point.</summary>
    private static double[] Resample(List<double> distances, List<double> elevations)
    {
        var span = distances[^1] - distances[0];
        var count = (int)Math.Ceiling(span / ElevationResampleStepM) + 1;
        var result = new double[count];
        var seg = 0;
        for (var j = 0; j < count; j++)
        {
            var d = j == count - 1 ? distances[^1] : distances[0] + j * ElevationResampleStepM;
            while (seg < distances.Count - 2 && distances[seg + 1] < d)
                seg++;
            var t = (d - distances[seg]) / (distances[seg + 1] - distances[seg]);
            result[j] = elevations[seg] + Math.Clamp(t, 0, 1) * (elevations[seg + 1] - elevations[seg]);
        }
        return result;
    }

    /// <summary>Moving average whose window shrinks symmetrically at the ends, so the start and end
    /// elevations (and straight ramps) are kept exactly.</summary>
    private static double[] SmoothElevations(double[] samples)
    {
        var prefix = new double[samples.Length + 1];
        for (var i = 0; i < samples.Length; i++)
            prefix[i + 1] = prefix[i] + samples[i];

        var smoothed = new double[samples.Length];
        for (var i = 0; i < samples.Length; i++)
        {
            var h = Math.Min(ElevationSmoothingHalfWidthSteps, Math.Min(i, samples.Length - 1 - i));
            smoothed[i] = (prefix[i + h + 1] - prefix[i - h]) / (2 * h + 1);
        }
        return smoothed;
    }

    /// <summary>Sums the legs between turning points. A leg is committed once the profile reverses by the
    /// hysteresis from its running extreme, so peaks and valleys count in full and the final leg is included.</summary>
    private static (double Ascent, double Descent) SumClimb(double[] profile)
    {
        double ascent = 0, descent = 0;
        var last = profile[0]; // last committed turning point
        var extreme = last;    // furthest point reached in the current direction
        var direction = 0;     // 1 climbing, -1 descending, 0 not yet decided
        foreach (var e in profile)
        {
            if (direction == 0)
            {
                if (e - last >= ClimbHysteresisM) { direction = 1; extreme = e; }
                else if (last - e >= ClimbHysteresisM) { direction = -1; extreme = e; }
            }
            else if (direction == 1)
            {
                if (e > extreme) extreme = e;
                else if (extreme - e >= ClimbHysteresisM)
                {
                    ascent += extreme - last;
                    last = extreme;
                    direction = -1;
                    extreme = e;
                }
            }
            else
            {
                if (e < extreme) extreme = e;
                else if (e - extreme >= ClimbHysteresisM)
                {
                    descent += last - extreme;
                    last = extreme;
                    direction = 1;
                    extreme = e;
                }
            }
        }
        if (direction == 1) ascent += extreme - last;
        else if (direction == -1) descent += last - extreme;
        return (ascent, descent);
    }

    private static double[] CumulativeDistances(IReadOnlyList<GeoPosition> line)
    {
        var cumulative = new double[line.Count];
        for (var i = 1; i < line.Count; i++)
            cumulative[i] = cumulative[i - 1] + DistanceM(line[i - 1], line[i]);
        return cumulative;
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
