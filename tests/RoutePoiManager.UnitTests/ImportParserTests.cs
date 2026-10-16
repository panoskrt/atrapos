using System.Text;
using Dynastream.Fit;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import;
using FitDateTime = Dynastream.Fit.DateTime;
using FitFile = Dynastream.Fit.File;

namespace RoutePoiManager.UnitTests;

public sealed class ImportParserTests
{
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
        var bytes = FitFixtures.Course("Pyhä loop", Sport.Hiking, SubSport.Generic,
            [(67.00, 27.10, 300f), (67.01, 27.11, 350f), (67.02, 27.12, 420f)],
            [(67.01, 27.11, CoursePoint.Summit, "Top"), (67.02, 27.12, CoursePoint.Left, "Turn left"), (67.00, 27.10, CoursePoint.Water, "")]);

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
        var bytes = FitFixtures.Activity(Sport.Running, SubSport.Trail,
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
    private static readonly System.DateTime Start = new(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc);

    public static byte[] Course(string name, Sport sport, SubSport subSport,
        (double Lat, double Lon, float Ele)[] points, (double Lat, double Lon, CoursePoint Type, string Name)[] coursePoints)
    {
        return Write(enc =>
        {
            enc.Write(FileId(FitFile.Course));
            var course = new CourseMesg();
            course.SetName(name);
            course.SetSport(sport);
            course.SetSubSport(subSport);
            enc.Write(course);
            WriteRecords(enc, points);
            var i = 0;
            foreach (var (lat, lon, type, cpName) in coursePoints)
            {
                var cp = new CoursePointMesg();
                cp.SetTimestamp(new FitDateTime(Start.AddMinutes(i++)));
                cp.SetPositionLat(Semi(lat));
                cp.SetPositionLong(Semi(lon));
                cp.SetType(type);
                if (cpName.Length > 0) cp.SetName(cpName);
                // The SDK reuses the previous definition when it "supports" a message, which garbles string
                // fields of different lengths; an explicit definition per message avoids that.
                enc.Write(new MesgDefinition(cp));
                enc.Write(cp);
            }
        });
    }

    public static byte[] Activity(Sport sport, SubSport subSport, (double Lat, double Lon, float Ele)[] points, (double Lat, double Lon)[] laps)
    {
        return Write(enc =>
        {
            enc.Write(FileId(FitFile.Activity));
            WriteRecords(enc, points);
            var i = 0;
            foreach (var (lat, lon) in laps)
            {
                var lap = new LapMesg();
                lap.SetTimestamp(new FitDateTime(Start.AddMinutes(++i)));
                lap.SetEndPositionLat(Semi(lat));
                lap.SetEndPositionLong(Semi(lon));
                enc.Write(lap);
            }
            var session = new SessionMesg();
            session.SetTimestamp(new FitDateTime(Start.AddMinutes(10)));
            session.SetSport(sport);
            session.SetSubSport(subSport);
            enc.Write(session);
        });
    }

    private static FileIdMesg FileId(FitFile type)
    {
        var id = new FileIdMesg();
        id.SetType(type);
        id.SetManufacturer(Manufacturer.Development);
        id.SetTimeCreated(new FitDateTime(Start));
        return id;
    }

    private static void WriteRecords(Encode enc, (double Lat, double Lon, float Ele)[] points)
    {
        var i = 0;
        foreach (var (lat, lon, ele) in points)
        {
            var r = new RecordMesg();
            r.SetTimestamp(new FitDateTime(Start.AddSeconds(10 * i++)));
            r.SetPositionLat(Semi(lat));
            r.SetPositionLong(Semi(lon));
            r.SetEnhancedAltitude(ele);
            enc.Write(r);
        }
    }

    private static int Semi(double degrees) => (int)Math.Round(degrees * DegreesToSemicircles);

    private static byte[] Write(Action<Encode> body)
    {
        using var ms = new MemoryStream();
        var enc = new Encode(ms, ProtocolVersion.V20);
        body(enc);
        enc.Close();
        return ms.ToArray();
    }
}
