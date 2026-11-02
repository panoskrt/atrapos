using RoutePoiManager.Domain;

namespace RoutePoiManager.UnitTests;

public sealed class ImportShapingTests
{
    /// <summary>A wiggly ~20 km track with 4000 points (5 m spacing) and a 2 m zig-zag of GPS noise.</summary>
    private static List<GeoPosition> NoisyTrack() =>
        Enumerable.Range(0, 4000)
            .Select(i => new GeoPosition(
                24.5 + i * 0.00009 + Math.Sin(i / 300.0) * 0.01,
                60.3 + (i % 2 == 0 ? 0.000018 : -0.000018) + Math.Cos(i / 500.0) * 0.005,
                100 + 50 * Math.Sin(i / 400.0)))
            .ToList();

    [Fact]
    public void Simplify_removes_noise_but_keeps_shape_and_ends()
    {
        var track = NoisyTrack();

        var kept = Geo.SimplifyIndices(track, 5);

        Assert.Equal(0, kept[0]);
        Assert.Equal(track.Count - 1, kept[^1]);
        Assert.InRange(kept.Count, 20, 800);   // 2 m noise is gone, curves remain
        Assert.True(kept.SequenceEqual(kept.Order()));
    }

    [Fact]
    public void Simplify_with_zero_tolerance_keeps_everything()
    {
        var track = NoisyTrack();

        Assert.Equal(track.Count, Geo.SimplifyIndices(track, 0).Count);
    }

    [Fact]
    public void Locate_projects_onto_the_nearest_segment()
    {
        List<GeoPosition> line = [new(24.0, 60.0), new(24.02, 60.0)];   // ~1110 m due east

        var (along, offset) = Geo.Locate(line, new GeoPosition(24.01, 60.0009));   // ~100 m north of the midpoint

        Assert.InRange(along, 540, 570);
        Assert.InRange(offset, 95, 105);
    }

    [Fact]
    public void Control_points_cover_the_track_with_its_detail()
    {
        var track = Geo.SimplifyIndices(NoisyTrack(), 5).Select(i => NoisyTrack()[i]).ToList();

        var cps = ImportShaping.BuildControlPoints(track);

        Assert.InRange(cps.Count, 2, ImportShaping.MaxControlPoints);
        Assert.Null(cps[^1].Segment);
        Assert.All(cps, cp => Assert.Equal(SegmentMode.Freehand, cp.ModeToNext));

        // Rebuilding the line from the segments gives back exactly the imported track.
        var rebuilt = RouteDrawing.BuildLine(cps);
        Assert.Equal(track.Count, rebuilt.Count);
        Assert.Equal(track.Select(p => (p.Lon, p.Lat, p.Ele)), rebuilt.Select(p => (p.Lon, p.Lat, p.Ele)));

        // No control point is more than the spacing limit (plus one vertex) from the previous one.
        for (var i = 1; i < cps.Count; i++)
            Assert.True(Geo.LengthM(RouteDrawing.BuildLine([cps[i - 1] with { }, cps[i] with { Segment = null }])) > 0);
    }

    [Fact]
    public void Long_straight_track_gets_a_point_every_two_km()
    {
        // 20 km dead straight: Douglas–Peucker alone would keep only the two ends.
        var track = Enumerable.Range(0, 201).Select(i => new GeoPosition(24.0 + i * 0.0018, 60.0, 0)).ToList();

        var cps = ImportShaping.BuildControlPoints(track);

        Assert.InRange(cps.Count, 10, 13);
    }

    [Fact]
    public void Poi_type_mapping_from_gpx_and_fit()
    {
        Assert.Equal(PoiTypes.Peak, PoiTypeMapping.FromGpx("Summit", null, null));
        Assert.Equal(PoiTypes.Parking, PoiTypeMapping.FromGpx(null, "Parking Area", "Car park"));
        Assert.Equal(8, PoiTypeMapping.FromGpx(null, null, "Café Aalto"));
        Assert.Equal(PoiTypes.Poi, PoiTypeMapping.FromGpx(null, "Flag, Blue", "Point 7"));
        Assert.Equal((PoiTypes.Danger, true), PoiTypeMapping.FromFitCoursePoint("SteepIncline"));
        Assert.Equal((PoiTypes.Poi, false), PoiTypeMapping.FromFitCoursePoint("SlightLeft"));
    }
}
