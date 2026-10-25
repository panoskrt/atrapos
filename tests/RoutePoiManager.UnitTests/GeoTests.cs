using RoutePoiManager.Domain;

namespace RoutePoiManager.UnitTests;

public sealed class GeoTests
{
    [Fact]
    public void Distance_matches_known_value()
    {
        // Helsinki Cathedral → Tampere Cathedral: ~160.6 km great-circle.
        var d = Geo.DistanceM(new GeoPosition(24.9522, 60.1704), new GeoPosition(23.7690, 61.5004));

        Assert.InRange(d, 159_500, 161_500);
    }

    [Fact]
    public void Climb_counts_peaks_and_valleys_in_full()
    {
        // ~55 m between points at ~10 % grade: up 60 m, down 60 m. The turning point must not be lost.
        var line = new[] { 100.0, 105.5, 111, 116.5, 122, 127.5, 133, 138.5, 144, 149.5, 155, 160, 154.5, 149, 143.5, 138, 132.5, 127, 121.5, 116, 110.5, 105, 100 }
            .Select((e, i) => new GeoPosition(24 + i * 0.001, 60, e)).ToList();

        var stats = Geo.Stats(line);

        Assert.InRange(stats.AscentM, 55, 60);
        Assert.InRange(stats.DescentM, 55, 60);
    }

    [Fact]
    public void Climb_includes_the_final_partial_leg()
    {
        // Climbing in small steps never reverses; the whole 40 m must still count.
        var line = Enumerable.Range(0, 9)
            .Select(i => new GeoPosition(24 + i * 0.001, 60, 100 + i * 5.0)).ToList();

        var stats = Geo.Stats(line);

        Assert.Equal(40, stats.AscentM, 6);
        Assert.Equal(0, stats.DescentM, 6);
    }

    [Fact]
    public void Climb_ignores_small_elevation_jitter()
    {
        var line = new[] { 100.0, 102, 100, 102, 100, 102, 100, 102, 100 }
            .Select((e, i) => new GeoPosition(24 + i * 0.0002, 60, e)).ToList();

        var stats = Geo.Stats(line);

        Assert.Equal(0, stats.AscentM, 6);
        Assert.Equal(0, stats.DescentM, 6);
    }

    [Fact]
    public void Climb_counts_rolling_hills_below_the_old_20m_threshold()
    {
        // 15 m hills with a ~400 m period; four of them.
        var line = Enumerable.Range(0, 33)
            .Select(i => new GeoPosition(24 + i * 0.00180, 60, 100 + 7.5 - 7.5 * Math.Cos(i * Math.PI / 4)))
            .ToList();

        var stats = Geo.Stats(line);

        Assert.InRange(stats.AscentM, 40, 60);
        Assert.InRange(stats.DescentM, 40, 60);
    }

    [Fact]
    public void Climb_is_the_same_whatever_the_point_density()
    {
        // The same 200 m climb followed by a 200 m descent, described with 3 points and with 400.
        double Ele(double t) => t < 0.5 ? 100 + 400 * t : 300 - 400 * (t - 0.5);
        List<GeoPosition> Make(int n) => Enumerable.Range(0, n)
            .Select(i => { var t = i / (double)(n - 1); return new GeoPosition(24 + t * 0.2, 60, Ele(t)); }).ToList();

        var sparse = Geo.Stats(Make(3));
        var dense = Geo.Stats(Make(400));

        Assert.InRange(dense.AscentM, 195, 201);
        Assert.InRange(dense.DescentM, 195, 201);
        Assert.Equal(dense.AscentM, sparse.AscentM, 0);
        Assert.Equal(dense.DescentM, sparse.DescentM, 0);
    }

    [Fact]
    public void Climb_smooths_high_frequency_noise()
    {
        var line = Enumerable.Range(0, 2001)
            .Select(i => new GeoPosition(24 + i * 0.00009, 60, 100 + i * 0.1 + (i % 2 == 0 ? 12 : -12)))
            .ToList();

        var stats = Geo.Stats(line);

        Assert.InRange(stats.AscentM, 195, 215);
        Assert.InRange(stats.DescentM, 0, 15);
    }

    [Fact]
    public void Short_routes_get_the_same_smoothing_as_long_ones()
    {
        // 1.5 km of noisy flat terrain must not read as climbing.
        var line = Enumerable.Range(0, 151)
            .Select(i => new GeoPosition(24 + i * 0.00018, 60, 100 + (i % 2 == 0 ? 3 : -3)))
            .ToList();

        var stats = Geo.Stats(line);

        Assert.InRange(stats.AscentM, 0, 5);
        Assert.InRange(stats.DescentM, 0, 5);
    }

    [Fact]
    public void Points_without_elevation_count_for_distance_only()
    {
        var line = new List<GeoPosition> { new(24, 60, 100), new(24.01, 60), new(24.02, 60, 150) };

        var stats = Geo.Stats(line);

        Assert.Equal(50, stats.AscentM, 6);
        Assert.True(stats.DistanceM > 1000);
    }

    [Fact]
    public void Missing_elevation_is_interpolated_by_distance_and_ends_are_extended()
    {
        var line = new List<GeoPosition>
        {
            new(24.000, 60), new(24.001, 60, 100), new(24.002, 60), new(24.004, 60, 130), new(24.005, 60),
        };

        var filled = Geo.FillMissingElevation(line);

        Assert.Equal(100, filled[0].Ele);
        Assert.Equal(110, filled[2].Ele!.Value, 1);   // a third of the way from 100 to 130
        Assert.Equal(130, filled[4].Ele);
    }

    [Fact]
    public void Line_without_any_elevation_stays_unknown() =>
        Assert.All(Geo.FillMissingElevation([new(24, 60), new(24.1, 60)]), p => Assert.Null(p.Ele));
}
