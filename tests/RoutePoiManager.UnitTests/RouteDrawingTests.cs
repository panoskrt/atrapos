using RoutePoiManager.Domain;

namespace RoutePoiManager.UnitTests;

public sealed class RouteDrawingTests
{
    [Fact]
    public void Segments_join_without_duplicating_shared_points()
    {
        var line = RouteDrawing.BuildLine(
        [
            new ControlPoint(24.0, 60.0, SegmentMode.Freehand, [[24.0, 60.0, 1], [24.05, 60.0, 2], [24.1, 60.0, 3]]),
            new ControlPoint(24.1, 60.0, SegmentMode.Snap, [[24.1, 60.0, 3], [24.2, 60.0, 4]]),
            new ControlPoint(24.2, 60.0, SegmentMode.Freehand),
        ]);

        Assert.Equal([24.0, 24.05, 24.1, 24.2], line.Select(p => p.Lon));
        Assert.Equal([1.0, 2, 3, 4], line.Select(p => p.Ele!.Value));
    }

    [Fact]
    public void Gap_between_snapped_and_freehand_segment_is_bridged()
    {
        // Snapped segment ends on the trail ~70 m from the clicked point; the freehand one starts at the click.
        var line = RouteDrawing.BuildLine(
        [
            new ControlPoint(24.0, 60.0, SegmentMode.Snap, [[24.0, 60.0, 1], [24.0987, 60.0, 2]]),
            new ControlPoint(24.1, 60.0, SegmentMode.Freehand, [[24.1, 60.0, 3], [24.2, 60.0, 4]]),
            new ControlPoint(24.2, 60.0, SegmentMode.Freehand),
        ]);

        Assert.Equal([24.0, 24.0987, 24.1, 24.2], line.Select(p => p.Lon));
    }

    [Fact]
    public void Missing_or_invalid_segment_falls_back_to_straight_line()
    {
        var line = RouteDrawing.BuildLine(
        [
            new ControlPoint(24.0, 60.0, SegmentMode.Freehand, [[24.0, 60.0]]),           // too short
            new ControlPoint(24.1, 60.0, SegmentMode.Freehand, [[500, 60.0], [24.2, 60.0]]), // invalid lon
            new ControlPoint(24.2, 60.0, SegmentMode.Freehand),
        ]);

        Assert.Equal([24.0, 24.1, 24.2], line.Select(p => p.Lon));
        Assert.All(line, p => Assert.Null(p.Ele));
    }

    [Theory]
    [InlineData(SyncState.LocalOnly, SyncState.LocalOnly)]
    [InlineData(SyncState.Synced, SyncState.LocalChanges)]
    [InlineData(SyncState.LocalChanges, SyncState.LocalChanges)]
    [InlineData(SyncState.RemoteNewer, SyncState.Conflict)]
    [InlineData(SyncState.Error, SyncState.Error)]
    public void Local_edit_moves_sync_state(SyncState before, SyncState after)
    {
        var route = new Route { Name = "r", SyncState = before };

        route.MarkLocallyModified(DateTimeOffset.UnixEpoch);

        Assert.Equal(after, route.SyncState);
    }

    [Fact]
    public void Apply_drawing_sets_geometry_and_stats()
    {
        var route = new Route { Name = "r" };
        var now = new DateTimeOffset(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);

        route.ApplyDrawing(
        [
            new ControlPoint(24.0, 60.0, SegmentMode.Freehand, [[24.0, 60.0, 100], [24.01, 60.0, null], [24.02, 60.0, 140]]),
            new ControlPoint(24.02, 60.0, SegmentMode.Freehand),
        ], now);

        Assert.NotNull(route.Geometry);
        Assert.Equal(3, route.Geometry!.NumPoints);
        Assert.Equal(120, route.Geometry.Coordinates[1].Z, 1);   // interpolated
        Assert.True(route.HasElevation);
        Assert.Equal(40, route.AscentM, 6);
        Assert.Equal(now, route.LocalModifiedAt);
    }

    [Fact]
    public void Single_control_point_has_no_geometry()
    {
        var route = new Route { Name = "r" };

        route.ApplyDrawing([new ControlPoint(24.0, 60.0, SegmentMode.Freehand)], DateTimeOffset.UnixEpoch);

        Assert.Null(route.Geometry);
        Assert.Equal(0, route.DistanceM);
    }
}
