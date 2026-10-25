using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using Dynastream.Fit;
using RoutePoiManager.Domain;
using FitDateTime = Dynastream.Fit.DateTime;
using FitFile = Dynastream.Fit.File;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>Converts the first track of a parsed file, point for point (no simplification), with its recorded times
/// and the waypoints an import would include by default.</summary>
public static class RouteFileConverter
{
    private const double DegreesToSemicircles = 2147483648.0 / 180.0;
    private static readonly XNamespace Gpx = "http://www.topografix.com/GPX/1/1";

    public static byte[] ToGpx(ParsedFile parsed)
    {
        var track = FirstTrack(parsed);
        var trk = new XElement(Gpx + "trk",
            new XElement(Gpx + "name", parsed.Name ?? track.Name ?? "Converted route"),
            new XElement(Gpx + "trkseg", track.Points.Select((point, index) => PointElement(point, track.Times?[index]))));
        var root = new XElement(Gpx + "gpx",
            new XAttribute("version", "1.1"),
            new XAttribute("creator", "Atrapos"),
            new XElement(Gpx + "metadata", new XElement(Gpx + "name", parsed.Name ?? track.Name ?? "Converted route")),
            IncludedWaypoints(parsed).Select(waypoint =>
            {
                var point = new XElement(Gpx + "wpt",
                    new XAttribute("lat", Fmt(waypoint.Position.Lat)),
                    new XAttribute("lon", Fmt(waypoint.Position.Lon)),
                    PointChildren(waypoint.Position),
                    new XElement(Gpx + "name", waypoint.Name));
                if (!string.IsNullOrWhiteSpace(waypoint.Description))
                    point.Add(new XElement(Gpx + "desc", waypoint.Description));
                return point;
            }),
            trk);
        return Encoding.UTF8.GetBytes(new XDocument(new XDeclaration("1.0", "UTF-8", null), root).ToString(SaveOptions.DisableFormatting));
    }

    /// <summary>Writes a FIT course: file id, course, lap, timer start, records (with cumulative distance) interleaved
    /// with course points in time order, timer stop.</summary>
    public static byte[] ToFit(ParsedFile parsed)
    {
        var track = FirstTrack(parsed);
        var points = track.Points;
        var now = System.DateTime.UtcNow;
        // Recorded times are kept when every point has one and they never go backwards; otherwise 1 s per point.
        var times = RecordedTimes(track) ?? Enumerable.Range(0, points.Count).Select(i => now.AddSeconds(i)).ToList();
        var distances = new double[points.Count];
        for (var i = 1; i < points.Count; i++)
            distances[i] = distances[i - 1] + Geo.DistanceM(points[i - 1], points[i]);

        // Each course point takes the time and distance of the first record at or past its spot along the track.
        var coursePoints = IncludedWaypoints(parsed)
            .Select(waypoint =>
            {
                var along = Geo.Locate(points, waypoint.Position).AlongM;
                var index = Array.BinarySearch(distances, along);
                return (Waypoint: waypoint, Index: Math.Min(index < 0 ? ~index : index, points.Count - 1), AlongM: along);
            })
            .OrderBy(c => c.Index)
            .ThenBy(c => c.AlongM)
            .ToList();

        using var stream = new MemoryStream();
        var encoder = new Encode(stream, ProtocolVersion.V20);
        var fileId = new FileIdMesg();
        fileId.SetType(FitFile.Course);
        fileId.SetManufacturer(Manufacturer.Development);
        fileId.SetTimeCreated(new FitDateTime(now));
        encoder.Write(fileId);

        var course = new CourseMesg();
        course.SetName((parsed.Name ?? track.Name ?? "Converted route")[..Math.Min((parsed.Name ?? track.Name ?? "Converted route").Length, 15)]);
        course.SetSport(Sport.Generic);
        course.SetSubSport(SubSport.Generic);
        encoder.Write(course);

        var duration = (float)(times[^1] - times[0]).TotalSeconds;
        var lap = new LapMesg();
        lap.SetMessageIndex(0);
        lap.SetTimestamp(new FitDateTime(times[^1]));
        lap.SetStartTime(new FitDateTime(times[0]));
        lap.SetStartPositionLat(ToSemicircles(points[0].Lat));
        lap.SetStartPositionLong(ToSemicircles(points[0].Lon));
        lap.SetEndPositionLat(ToSemicircles(points[^1].Lat));
        lap.SetEndPositionLong(ToSemicircles(points[^1].Lon));
        lap.SetTotalElapsedTime(duration);
        lap.SetTotalTimerTime(duration);
        lap.SetTotalDistance((float)distances[^1]);
        encoder.Write(lap);

        encoder.Write(TimerEvent(times[0], EventType.Start));

        var nextCoursePoint = 0;
        for (var i = 0; i < points.Count; i++)
        {
            var point = points[i];
            var record = new RecordMesg();
            record.SetTimestamp(new FitDateTime(times[i]));
            record.SetPositionLat(ToSemicircles(point.Lat));
            record.SetPositionLong(ToSemicircles(point.Lon));
            record.SetDistance((float)distances[i]);
            if (point.Ele is { } elevation && float.IsFinite((float)elevation))
                record.SetAltitude((float)elevation);
            encoder.Write(record);

            for (; nextCoursePoint < coursePoints.Count && coursePoints[nextCoursePoint].Index == i; nextCoursePoint++)
            {
                var waypoint = coursePoints[nextCoursePoint].Waypoint;
                var coursePoint = new CoursePointMesg();
                coursePoint.SetMessageIndex((ushort)nextCoursePoint);
                coursePoint.SetTimestamp(new FitDateTime(times[i]));
                coursePoint.SetPositionLat(ToSemicircles(waypoint.Position.Lat));
                coursePoint.SetPositionLong(ToSemicircles(waypoint.Position.Lon));
                coursePoint.SetDistance((float)distances[i]);
                coursePoint.SetType(CoursePoint.Generic);
                coursePoint.SetName(waypoint.Name[..Math.Min(waypoint.Name.Length, 15)]);
                encoder.Write(new MesgDefinition(coursePoint));
                encoder.Write(coursePoint);
            }
        }

        encoder.Write(TimerEvent(times[^1], EventType.StopDisableAll));
        encoder.Close();
        return stream.ToArray();
    }

    private static ParsedTrack FirstTrack(ParsedFile parsed)
    {
        var track = parsed.Tracks.FirstOrDefault();
        if (track is null || track.Points.Count < 2)
            throw new ImportException("The file needs a track with at least two GPS points.");
        return track;
    }

    /// <summary>Lap markers and route-end markers are off by default on import, so they aren't converted either.</summary>
    private static IEnumerable<ParsedWaypoint> IncludedWaypoints(ParsedFile parsed) =>
        parsed.Waypoints.Where(waypoint => waypoint.IncludeByDefault);

    private static List<System.DateTime>? RecordedTimes(ParsedTrack track)
    {
        if (track.Times is not { } times || times.Count != track.Points.Count || times.Any(t => t is null))
            return null;
        var result = times.Select(t => t!.Value).ToList();
        for (var i = 1; i < result.Count; i++)
            if (result[i] < result[i - 1])
                return null;
        return result;
    }

    private static EventMesg TimerEvent(System.DateTime time, EventType type)
    {
        var mesg = new EventMesg();
        mesg.SetTimestamp(new FitDateTime(time));
        mesg.SetEvent(Event.Timer);
        mesg.SetEventType(type);
        mesg.SetEventGroup(0);
        return mesg;
    }

    private static XElement PointElement(GeoPosition point, System.DateTime? time)
    {
        var element = new XElement(Gpx + "trkpt",
            new XAttribute("lat", Fmt(point.Lat)),
            new XAttribute("lon", Fmt(point.Lon)),
            PointChildren(point));
        if (time is { } t)
            element.Add(new XElement(Gpx + "time", XmlConvert.ToString(t, XmlDateTimeSerializationMode.Utc)));
        return element;
    }

    private static object?[] PointChildren(GeoPosition point) =>
        point.Ele is { } elevation
            ? [new XElement(Gpx + "ele", Fmt(elevation))]
            : [];

    private static string Fmt(double value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static int ToSemicircles(double degrees) => (int)Math.Round(degrees * DegreesToSemicircles);
}
