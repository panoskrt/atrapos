using System.Text;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import;
using RoutePoiManager.Infrastructure.Import.Fit;

namespace RoutePoiManager.UnitTests;

public sealed class ImportParserTests
{
    [Fact]
    public void Route_file_conversion_preserves_track_elevation_and_waypoints()
    {
        const string gpx = """
            <gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
              <metadata><name>Forest route</name></metadata>
              <wpt lat="60.31" lon="24.51"><ele>29</ele><name>Water</name></wpt>
              <trk><name>Forest route</name><trkseg>
                <trkpt lat="60.30" lon="24.50"><ele>10</ele></trkpt>
                <trkpt lat="60.31" lon="24.512"><ele>20</ele></trkpt>
                <trkpt lat="60.32" lon="24.52"><ele>30</ele></trkpt>
              </trkseg></trk>
            </gpx>
            """;
        var parsed = ImportService.Parse(Encoding.UTF8.GetBytes(gpx), "forest.gpx");

        var fit = RouteFileConverter.ToFit(parsed);
        var fromFit = ImportService.Parse(fit, "forest.fit");
        Assert.Equal(3, fromFit.Tracks[0].Points.Count);
        Assert.Equal(20, fromFit.Tracks[0].Points[1].Ele);
        Assert.Contains(fromFit.Waypoints, waypoint => waypoint.Name == "Water");

        var gpxAgain = RouteFileConverter.ToGpx(fromFit);
        var fromGpx = ImportService.Parse(gpxAgain, "forest.gpx");
        Assert.Equal(3, fromGpx.Tracks[0].Points.Count);
        Assert.Equal(20, fromGpx.Tracks[0].Points[1].Ele);
        Assert.Contains(fromGpx.Waypoints, waypoint => waypoint.Name == "Water");
    }

    [Fact]
    public void Gpx_to_fit_writes_a_complete_course_with_course_points_at_their_place()
    {
        const string gpx = """
            <gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
              <wpt lat="60.3201" lon="24.52"><name>Water</name></wpt>
              <wpt lat="60.30" lon="24.50"><name>Start</name><type>Begin</type></wpt>
              <trk><name>Forest route</name><trkseg>
                <trkpt lat="60.30" lon="24.50"><time>2026-10-01T08:00:00Z</time></trkpt>
                <trkpt lat="60.31" lon="24.51"><time>2026-10-01T08:05:00Z</time></trkpt>
                <trkpt lat="60.32" lon="24.52"><time>2026-10-01T08:10:00Z</time></trkpt>
              </trkseg></trk>
            </gpx>
            """;

        var fit = RouteFileConverter.ToFit(ImportService.Parse(Encoding.UTF8.GetBytes(gpx), "forest.gpx"));
        var m = FitReader.Read(fit);
        var records = m.Where(r => r.Number == FitMessages.Record).ToList();

        Assert.Equal(0, FitProtocol.Crc(fit));
        Assert.Equal(FitMessages.FileId, m[0].Number);
        Assert.Equal<long?>(FitProfile.FileCourse, m[0].Raw(FileIdField.Type));
        var lap = Assert.Single(m, r => r.Number == FitMessages.Lap);
        Assert.Equal(600, lap.Value(LapField.TotalElapsedTime, 1000));
        Assert.True(lap.Value(LapField.TotalDistance, 100) > 2000);
        Assert.Equal(new long?[] { FitProfile.EventTypeStart, FitProfile.EventTypeStopDisableAll },
            m.Where(r => r.Number == FitMessages.Event).Select(e => e.Raw(EventField.EventType)));
        Assert.Equal(lap.Value(LapField.TotalDistance, 100), records[^1].Value(RecordField.Distance, 100));
        Assert.Equal(new DateTime(2026, 10, 1, 8, 5, 0, DateTimeKind.Utc), records[1].Time());
        Assert.All(records, r => Assert.Null(r.Raw(RecordField.Altitude)));   // the GPX has no elevation

        // Only the included waypoint becomes a course point, timed and placed at the end of the track, not the start.
        var coursePoint = Assert.Single(m, r => r.Number == FitMessages.CoursePoint);
        Assert.Equal("Water", coursePoint.Text(CoursePointField.Name));
        Assert.Equal(records[^1].Time(), coursePoint.Time(CoursePointField.Timestamp));
        Assert.Equal(records[^1].Value(RecordField.Distance, 100), coursePoint.Value(CoursePointField.Distance, 100));
    }

    [Fact]
    public void Fit_to_gpx_keeps_every_point_and_its_time_but_not_lap_markers()
    {
        var bytes = FitFixtures.Activity("Running", "Trail",
            [(60.30, 24.50, 10f), (60.305, 24.50, 10f), (60.31, 24.50, 10f)],
            laps: [(60.305, 24.50), (60.31, 24.50)]);

        var gpx = RouteFileConverter.ToGpx(ImportService.Parse(bytes, "run.fit"));
        var doc = System.Xml.Linq.XDocument.Parse(Encoding.UTF8.GetString(gpx));

        // The middle point is collinear, so a simplified conversion would drop it.
        var times = doc.Descendants().Where(e => e.Name.LocalName == "trkpt")
            .Select(p => p.Elements().Single(e => e.Name.LocalName == "time").Value).ToArray();
        Assert.Equal(["2026-10-01T08:00:00Z", "2026-10-01T08:00:10Z", "2026-10-01T08:00:20Z"], times);
        Assert.DoesNotContain(doc.Descendants(), e => e.Name.LocalName == "wpt");
    }

    [Fact]
    public void Gpx_track_waypoints_and_activity_hint_are_read()
    {
        const string gpx = """
            <?xml version="1.0" encoding="UTF-8"?>
            <gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="test">
              <metadata><name>Metadata name</name></metadata>
              <wpt lat="60.3121" lon="24.5032"><ele>34</ele><name>Kettle spring</name><sym>Drinking Water</sym></wpt>
              <wpt lat="60.33" lon="24.54"><name>Big view</name></wpt>
              <trk><name>Kettle loop</name><type>trail_running</type>
                <trkseg><trkpt lat="60.30" lon="24.50"><ele>10</ele></trkpt><trkpt lat="60.31" lon="24.50"><ele>20</ele></trkpt></trkseg>
                <trkseg><trkpt lat="60.32" lon="24.51"><ele>30</ele></trkpt></trkseg>
              </trk>
            </gpx>
            """;

        var parsed = ImportService.Parse(Encoding.UTF8.GetBytes(gpx), "loop.gpx");

        Assert.Equal(RouteSource.Gpx, parsed.Kind);
        Assert.Equal("Kettle loop", parsed.Name);
        Assert.Equal([ActivityTypes.TrailRunning], parsed.SuggestedActivityIds);
        var track = Assert.Single(parsed.Tracks);
        Assert.Equal(3, track.Points.Count);   // segments are joined
        Assert.Equal(30, track.Points[2].Ele);
        Assert.Equal(PoiTypes.Water, parsed.Waypoints[0].PoiType);   // from <sym>
        Assert.True(parsed.Waypoints[0].IsExplicitPoi);
        Assert.Equal(22, parsed.Waypoints[1].PoiType);               // "view" keyword → Sight
    }

    [Fact]
    public void Gpx_1_0_and_suunto_route_points_are_read()
    {
        const string gpx = """
            <gpx xmlns="http://www.topografix.com/GPX/1/0" xmlns:suunto="http://www.suunto.com/xmlschemas/RouteExtension/v1" version="1.0">
              <wpt lat="51.500866" lon="-0.12611513"><name>Begin</name><type>Begin</type></wpt>
              <rte>
                <rtept lat="51.500866" lon="-0.12611513"><ele>5.05</ele>
                  <extensions><suunto:routePoint><suunto:name>Big Ben</suunto:name><suunto:type>Sight</suunto:type></suunto:routePoint></extensions>
                </rtept>
                <rtept lat="51.5008" lon="-0.120"><name>Trail marker</name></rtept>
                <rtept lat="51.50072" lon="-0.11992768"><ele>2.74</ele></rtept>
              </rte>
            </gpx>
            """;

        var parsed = ImportService.Parse(Encoding.UTF8.GetBytes(gpx), "suunto.gpx");

        Assert.Equal(3, parsed.Tracks[0].Points.Count);
        var bigBen = parsed.Waypoints.Single(w => w.Name == "Big Ben");
        Assert.Equal(22, bigBen.PoiType);
        Assert.True(bigBen.IsExplicitPoi);
        Assert.False(parsed.Waypoints.Single(w => w.Name == "Trail marker").IsExplicitPoi);
        Assert.False(parsed.Waypoints.Single(w => w.Name == "Begin").IncludeByDefault);
    }

    [Fact]
    public void Gpx_with_dtd_is_rejected()
    {
        const string xxe = """
            <?xml version="1.0"?>
            <!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>
            <gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>&x;</name></trk></gpx>
            """;

        Assert.Throws<ImportException>(() => ImportService.Parse(Encoding.UTF8.GetBytes(xxe), "evil.gpx"));
    }

    [Theory]
    [InlineData("<gpx xmlns=\"http://www.topografix.com/GPX/1/1\"><wpt lat=\"1\" lon=\"1\"/></gpx>", "no track")]
    [InlineData("<kml/>", "root")]
    [InlineData("not xml at all", "XML")]
    public void Unusable_gpx_explains_why(string content, string expectedInMessage)
    {
        var ex = Assert.Throws<ImportException>(() => ImportService.Parse(Encoding.UTF8.GetBytes(content), "x.gpx"));
        Assert.Contains(expectedInMessage, ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Fit_course_with_course_points()
    {
        var bytes = FitFixtures.Course("Pyhä loop", "Hiking", "Generic",
            [(67.00, 27.10, 300f), (67.01, 27.11, 350f), (67.02, 27.12, 420f)],
            [(67.01, 27.11, "Summit", "Top"), (67.02, 27.12, "Left", "Turn left"), (67.00, 27.10, "Water", "")]);

        var parsed = ImportService.Parse(bytes, "course.fit");

        Assert.Equal(RouteSource.FitCourse, parsed.Kind);
        Assert.Equal("Pyhä loop", parsed.Name);
        Assert.Equal([ActivityTypes.Hiking], parsed.SuggestedActivityIds);
        Assert.Equal(3, parsed.Tracks[0].Points.Count);
        Assert.Equal(67.01, parsed.Tracks[0].Points[1].Lat, 5);
        Assert.Equal(350, parsed.Tracks[0].Points[1].Ele!.Value, 1);

        var top = parsed.Waypoints.Single(w => w.Name == "Top");
        Assert.Equal((PoiTypes.Peak, true), (top.PoiType, top.IncludeByDefault));
        Assert.False(parsed.Waypoints.Single(w => w.Name == "Turn left").IncludeByDefault);   // turn instructions off
        Assert.Equal(PoiTypes.Water, parsed.Waypoints.Single(w => w.SourceType == "Water").PoiType);   // unnamed → type name
    }

    [Fact]
    public void Fit_activity_with_sport_and_laps()
    {
        var bytes = FitFixtures.Activity("Running", "Trail",
            [(60.30, 24.50, 10f), (60.31, 24.50, 20f), (60.32, 24.51, 30f)],
            laps: [(60.31, 24.50), (60.32, 24.51)]);

        var parsed = ImportService.Parse(bytes, "run.fit");

        Assert.Equal(RouteSource.FitActivity, parsed.Kind);
        Assert.Equal([ActivityTypes.TrailRunning], parsed.SuggestedActivityIds);
        var lap = Assert.Single(parsed.Waypoints);   // last lap ends at the finish, so it's skipped
        Assert.Equal("Lap 1", lap.Name);
        Assert.False(lap.IncludeByDefault);
    }

    [Fact]
    public void Fake_fit_is_rejected() =>
        Assert.Throws<ImportException>(() => ImportService.Parse("hello"u8.ToArray(), "x.fit"));
}

internal static class FitFixtures
{
    private const double DegreesToSemicircles = 2147483648.0 / 180.0;
    private static readonly DateTime Start = new(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc);

    public static byte[] Course(string name, string sport, string subSport,
        (double Lat, double Lon, float Ele)[] points, (double Lat, double Lon, string Type, string Name)[] coursePoints)
    {
        var fit = new FitWriter();
        fit.Write(FitMessages.FileId, FileId(FitProfile.FileCourse));
        fit.Write(FitMessages.Course,
            FitField.String(CourseField.Name, name),
            FitField.Enum(CourseField.Sport, FitProfile.Sport[sport]),
            FitField.Enum(CourseField.SubSport, FitProfile.SubSport[subSport]));
        WriteRecords(fit, points);
        var i = 0;
        foreach (var (lat, lon, type, cpName) in coursePoints)
            fit.Write(FitMessages.CoursePoint,
                FitField.Time(CoursePointField.Timestamp, Start.AddMinutes(i++)),
                FitField.SInt32(CoursePointField.PositionLat, Semi(lat)),
                FitField.SInt32(CoursePointField.PositionLong, Semi(lon)),
                FitField.Enum(CoursePointField.Type, FitProfile.CoursePoint[type]),
                FitField.String(CoursePointField.Name, cpName));   // an empty name reads back as none
        return fit.ToArray();
    }

    public static byte[] Activity(string sport, string subSport, (double Lat, double Lon, float Ele)[] points, (double Lat, double Lon)[] laps)
    {
        var fit = new FitWriter();
        fit.Write(FitMessages.FileId, FileId(FitProfile.FileActivity));
        WriteRecords(fit, points);
        var i = 0;
        foreach (var (lat, lon) in laps)
            fit.Write(FitMessages.Lap,
                FitField.Time(CommonField.Timestamp, Start.AddMinutes(++i)),
                FitField.SInt32(LapField.EndPositionLat, Semi(lat)),
                FitField.SInt32(LapField.EndPositionLong, Semi(lon)));
        fit.Write(FitMessages.Session,
            FitField.Time(CommonField.Timestamp, Start.AddMinutes(10)),
            FitField.Enum(SessionField.Sport, FitProfile.Sport[sport]),
            FitField.Enum(SessionField.SubSport, FitProfile.SubSport[subSport]));
        return fit.ToArray();
    }

    private static FitField[] FileId(byte type) =>
    [
        FitField.Enum(FileIdField.Type, type),
        FitField.UInt16(FileIdField.Manufacturer, FitProfile.ManufacturerDevelopment),
        FitField.Time(FileIdField.TimeCreated, Start),
    ];

    private static void WriteRecords(FitWriter fit, (double Lat, double Lon, float Ele)[] points)
    {
        var i = 0;
        foreach (var (lat, lon, ele) in points)
            fit.Write(FitMessages.Record,
                FitField.Time(CommonField.Timestamp, Start.AddSeconds(10 * i++)),
                FitField.SInt32(RecordField.PositionLat, Semi(lat)),
                FitField.SInt32(RecordField.PositionLong, Semi(lon)),
                FitField.Scaled(RecordField.EnhancedAltitude, FitBaseType.UInt32, ele, 5, 500));
    }

    public static int Semi(double degrees) => (int)Math.Round(degrees * DegreesToSemicircles);
}
