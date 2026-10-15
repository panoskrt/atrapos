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
    public void Climb_ignores_noise_below_hysteresis()
    {
        var line = new[] { 100.0, 101, 99.5, 102, 110, 109, 120, 118.5, 100 }
            .Select((e, i) => new GeoPosition(24 + i * 0.001, 60, e)).ToList();

        var stats = Geo.Stats(line);

        // Anchors: 100 → 110 (+10) → 120 (+10) → 100 (−20); the ±1-2 m wiggles are noise.
        Assert.Equal(20, stats.AscentM, 6);
        Assert.Equal(20, stats.DescentM, 6);
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
