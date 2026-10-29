using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import.Fit;

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
        var now = DateTime.UtcNow;
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

        var fit = new FitWriter();
        fit.Write(FitMessages.FileId,
            FitField.Enum(FileIdField.Type, FitProfile.FileCourse),
            FitField.UInt16(FileIdField.Manufacturer, FitProfile.ManufacturerDevelopment),
            FitField.Time(FileIdField.TimeCreated, now));

        var name = parsed.Name ?? track.Name ?? "Converted route";
        fit.Write(FitMessages.Course,
            FitField.String(CourseField.Name, name[..Math.Min(name.Length, 15)]),
            FitField.Enum(CourseField.Sport, FitProfile.Sport["Generic"]),
            FitField.Enum(CourseField.SubSport, FitProfile.SubSport["Generic"]));

        var duration = (times[^1] - times[0]).TotalSeconds;
        fit.Write(FitMessages.Lap,
            FitField.UInt16(CommonField.MessageIndex, 0),
            FitField.Time(CommonField.Timestamp, times[^1]),
            FitField.Time(LapField.StartTime, times[0]),
            FitField.SInt32(LapField.StartPositionLat, ToSemicircles(points[0].Lat)),
            FitField.SInt32(LapField.StartPositionLong, ToSemicircles(points[0].Lon)),
            FitField.SInt32(LapField.EndPositionLat, ToSemicircles(points[^1].Lat)),
            FitField.SInt32(LapField.EndPositionLong, ToSemicircles(points[^1].Lon)),
            FitField.Scaled(LapField.TotalElapsedTime, FitBaseType.UInt32, duration, 1000),
            FitField.Scaled(LapField.TotalTimerTime, FitBaseType.UInt32, duration, 1000),
            FitField.Scaled(LapField.TotalDistance, FitBaseType.UInt32, distances[^1], 100));

        fit.Write(FitMessages.Event, TimerEvent(times[0], FitProfile.EventTypeStart));

        var nextCoursePoint = 0;
        for (var i = 0; i < points.Count; i++)
        {
            var point = points[i];
            fit.Write(FitMessages.Record,
                FitField.Time(CommonField.Timestamp, times[i]),
                FitField.SInt32(RecordField.PositionLat, ToSemicircles(point.Lat)),
                FitField.SInt32(RecordField.PositionLong, ToSemicircles(point.Lon)),
                FitField.Scaled(RecordField.Distance, FitBaseType.UInt32, distances[i], 100),
                FitField.Scaled(RecordField.Altitude, FitBaseType.UInt16, point.Ele, 5, 500));

            for (; nextCoursePoint < coursePoints.Count && coursePoints[nextCoursePoint].Index == i; nextCoursePoint++)
            {
                var waypoint = coursePoints[nextCoursePoint].Waypoint;
                fit.Write(FitMessages.CoursePoint,
                    FitField.UInt16(CommonField.MessageIndex, (ushort)nextCoursePoint),
                    FitField.Time(CoursePointField.Timestamp, times[i]),
                    FitField.SInt32(CoursePointField.PositionLat, ToSemicircles(waypoint.Position.Lat)),
                    FitField.SInt32(CoursePointField.PositionLong, ToSemicircles(waypoint.Position.Lon)),
                    FitField.Scaled(CoursePointField.Distance, FitBaseType.UInt32, distances[i], 100),
                    FitField.Enum(CoursePointField.Type, FitProfile.CoursePoint["Generic"]),
                    FitField.String(CoursePointField.Name, waypoint.Name[..Math.Min(waypoint.Name.Length, 15)]));
            }
        }

        fit.Write(FitMessages.Event, TimerEvent(times[^1], FitProfile.EventTypeStopDisableAll));
        return fit.ToArray();
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

    private static List<DateTime>? RecordedTimes(ParsedTrack track)
    {
        if (track.Times is not { } times || times.Count != track.Points.Count || times.Any(t => t is null))
            return null;
        var result = times.Select(t => t!.Value).ToList();
        for (var i = 1; i < result.Count; i++)
            if (result[i] < result[i - 1])
                return null;
        return result;
    }

    private static FitField[] TimerEvent(DateTime time, byte type) =>
    [
        FitField.Time(CommonField.Timestamp, time),
        FitField.Enum(EventField.Event, FitProfile.EventTimer),
        FitField.Enum(EventField.EventType, type),
        FitField.UInt8(EventField.EventGroup, 0),
    ];

    private static XElement PointElement(GeoPosition point, DateTime? time)
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
