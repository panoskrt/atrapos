using System.Globalization;
using System.Xml;
using System.Xml.Linq;
using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>Reads GPX 1.0 and 1.1 (elements are matched by local name, so either namespace works).</summary>
public static class GpxParser
{
    private static readonly XNamespace SuuntoNs = "http://www.suunto.com/xmlschemas/RouteExtension/v1";

    public static ParsedFile Parse(Stream stream)
    {
        XDocument doc;
        try
        {
            // No DTDs and no external resolution: GPX files come from anywhere (XXE).
            var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
            using var reader = XmlReader.Create(stream, settings);
            doc = XDocument.Load(reader);
        }
        catch (XmlException ex)
        {
            throw new ImportException("The file isn't valid GPX (XML error).", ex);
        }

        var root = doc.Root;
        if (root is null || root.Name.LocalName != "gpx")
            throw new ImportException("The file isn't GPX: the root element must be <gpx>.");

        var metadata = Child(root, "metadata");
        var tracks = new List<ParsedTrack>();
        var waypoints = new List<ParsedWaypoint>();
        string? firstType = null;

        foreach (var trk in Children(root, "trk"))
        {
            var points = Children(trk, "trkseg").SelectMany(seg => Children(seg, "trkpt")).Select(ReadPoint).OfType<GeoPosition>().ToList();
            if (points.Count > 0)
                tracks.Add(new ParsedTrack(Text(trk, "name"), points));
            firstType ??= Text(trk, "type");
        }

        foreach (var rte in Children(root, "rte"))
        {
            var points = new List<GeoPosition>();
            foreach (var rtept in Children(rte, "rtept"))
            {
                if (ReadPoint(rtept) is not { } p)
                    continue;
                points.Add(p);
                // Named route points (and Suunto's routePoint extension) are waypoints too.
                var ext = rtept.Descendants(SuuntoNs + "routePoint").FirstOrDefault();
                var name = ext?.Element(SuuntoNs + "name")?.Value ?? Text(rtept, "name");
                if (!string.IsNullOrWhiteSpace(name))
                {
                    var type = ext?.Element(SuuntoNs + "type")?.Value ?? Text(rtept, "type");
                    waypoints.Add(new ParsedWaypoint(name.Trim(), type ?? "Route point",
                        PoiTypeMapping.FromGpx(type, Text(rtept, "sym"), name), true, p,
                        ext?.Element(SuuntoNs + "description")?.Value ?? Text(rtept, "desc")));
                }
            }
            if (points.Count > 0)
                tracks.Add(new ParsedTrack(Text(rte, "name"), points));
            firstType ??= Text(rte, "type");
        }

        foreach (var wpt in Children(root, "wpt"))
        {
            if (ReadPoint(wpt) is not { } p)
                continue;
            var name = Text(wpt, "name");
            var type = Text(wpt, "type");
            var sym = Text(wpt, "sym");
            // Suunto exports mark route ends as Begin/End waypoints; the route ends already say that.
            var isEndMarker = type is not null && (type.Equals("Begin", StringComparison.OrdinalIgnoreCase) ||
                                                   type.Equals("End", StringComparison.OrdinalIgnoreCase));
            waypoints.Add(new ParsedWaypoint(
                string.IsNullOrWhiteSpace(name) ? "Waypoint" : name.Trim(),
                type ?? sym ?? "Waypoint",
                PoiTypeMapping.FromGpx(type, sym, name),
                !isEndMarker,
                p,
                Text(wpt, "desc") ?? Text(wpt, "cmt")));
        }

        if (tracks.Count == 0)
            throw new ImportException("The GPX file has no track or route (<trk> or <rte>) with points.");

        var name0 = new[] { tracks[0].Name, Text(metadata, "name"), Text(root, "name") }
            .FirstOrDefault(s => !string.IsNullOrWhiteSpace(s));
        return new ParsedFile(RouteSource.Gpx, name0?.Trim(), ActivityMapping.FromGpxType(firstType), tracks, Dedupe(waypoints));
    }

    private static GeoPosition? ReadPoint(XElement e)
    {
        if (!double.TryParse(e.Attribute("lat")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat) ||
            !double.TryParse(e.Attribute("lon")?.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var lon) ||
            !Geo.IsValid(lon, lat))
            return null;
        double? ele = double.TryParse(Text(e, "ele"), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && double.IsFinite(v)
            ? v
            : null;
        return new GeoPosition(lon, lat, ele);
    }

    /// <summary>Suunto-style files list the same point as a named rtept and a matching wpt.</summary>
    private static List<ParsedWaypoint> Dedupe(List<ParsedWaypoint> waypoints) =>
        waypoints
            .GroupBy(w => (w.Name, Math.Round(w.Position.Lat, 5), Math.Round(w.Position.Lon, 5)))
            .Select(g => g.First())
            .ToList();

    private static IEnumerable<XElement> Children(XElement e, string localName) =>
        e.Elements().Where(x => x.Name.LocalName == localName);

    private static XElement? Child(XElement? e, string localName) => e?.Elements().FirstOrDefault(x => x.Name.LocalName == localName);

    private static string? Text(XElement? e, string localName) =>
        Child(e, localName)?.Value is { } v && !string.IsNullOrWhiteSpace(v) ? v.Trim() : null;
}
