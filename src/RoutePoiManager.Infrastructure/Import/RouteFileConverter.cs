using System.Globalization;
using System.Text;
using System.Xml.Linq;
using Dynastream.Fit;
using RoutePoiManager.Domain;
using FitFile = Dynastream.Fit.File;

namespace RoutePoiManager.Infrastructure.Import;

public static class RouteFileConverter
{
    private const double DegreesToSemicircles = 2147483648.0 / 180.0;
    private static readonly XNamespace Gpx = "http://www.topografix.com/GPX/1/1";

    public static byte[] ToGpx(ParsedFile parsed)
    {
        var track = parsed.Tracks.FirstOrDefault();
        if (track is null || track.Points.Count < 2)
            throw new ImportException("The file needs a track with at least two GPS points.");

        var points = ImportService.BaseTrack(track);
        var trk = new XElement(Gpx + "trk",
            new XElement(Gpx + "name", parsed.Name ?? track.Name ?? "Converted route"),
            new XElement(Gpx + "trkseg", points.Select(PointElement)));
        var root = new XElement(Gpx + "gpx",
            new XAttribute("version", "1.1"),
            new XAttribute("creator", "Route & POI Manager"),
            new XElement(Gpx + "metadata", new XElement(Gpx + "name", parsed.Name ?? track.Name ?? "Converted route")),
            parsed.Waypoints.Select(waypoint =>
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

    public static byte[] ToFit(ParsedFile parsed)
    {
        var track = parsed.Tracks.FirstOrDefault();
        if (track is null || track.Points.Count < 2)
            throw new ImportException("The file needs a track with at least two GPS points.");

        using var stream = new MemoryStream();
        var encoder = new Encode(stream, ProtocolVersion.V20);
        var now = System.DateTime.UtcNow;
        var fileId = new FileIdMesg();
        fileId.SetType(FitFile.Course);
        fileId.SetManufacturer(Manufacturer.Development);
        fileId.SetTimeCreated(new Dynastream.Fit.DateTime(now));
        encoder.Write(fileId);

        var course = new CourseMesg();
        course.SetName((parsed.Name ?? track.Name ?? "Converted route")[..Math.Min((parsed.Name ?? track.Name ?? "Converted route").Length, 15)]);
        course.SetSport(Sport.Generic);
        course.SetSubSport(SubSport.Generic);
        encoder.Write(course);

        var timestamp = now;
        foreach (var point in ImportService.BaseTrack(track))
        {
            var record = new RecordMesg();
            record.SetTimestamp(new Dynastream.Fit.DateTime(timestamp));
            record.SetPositionLat(ToSemicircles(point.Lat));
            record.SetPositionLong(ToSemicircles(point.Lon));
            if (point.Ele is { } elevation && float.IsFinite((float)elevation))
                record.SetAltitude((float)elevation);
            encoder.Write(record);
            timestamp = timestamp.AddSeconds(1);
        }

        foreach (var (waypoint, index) in parsed.Waypoints.Select((waypoint, index) => (waypoint, index)))
        {
            var coursePoint = new CoursePointMesg();
            coursePoint.SetTimestamp(new Dynastream.Fit.DateTime(now.AddSeconds(index)));
            coursePoint.SetPositionLat(ToSemicircles(waypoint.Position.Lat));
            coursePoint.SetPositionLong(ToSemicircles(waypoint.Position.Lon));
            coursePoint.SetType(CoursePoint.Generic);
            coursePoint.SetName(waypoint.Name[..Math.Min(waypoint.Name.Length, 15)]);
            encoder.Write(new MesgDefinition(coursePoint));
            encoder.Write(coursePoint);
        }

        encoder.Close();
        return stream.ToArray();
    }

    private static XElement PointElement(GeoPosition point) =>
        new(Gpx + "trkpt",
            new XAttribute("lat", Fmt(point.Lat)),
            new XAttribute("lon", Fmt(point.Lon)),
            PointChildren(point));

    private static object?[] PointChildren(GeoPosition point) =>
        point.Ele is { } elevation
            ? [new XElement(Gpx + "ele", Fmt(elevation))]
            : [];

    private static string Fmt(double value) => value.ToString("0.######", CultureInfo.InvariantCulture);
    private static int ToSemicircles(double degrees) => (int)Math.Round(degrees * DegreesToSemicircles);
}
