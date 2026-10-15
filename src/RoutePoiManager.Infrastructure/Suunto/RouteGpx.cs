using System.Globalization;
using System.Text;
using System.Xml;
using System.Xml.Linq;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import;

namespace RoutePoiManager.Infrastructure.Suunto;

/// <summary>A route as Suunto exports it: what we need to update our copy.</summary>
public sealed record SuuntoRouteContent(
    string? Name,
    int[] ActivityIds,
    bool TurnWaypointsEnabled,
    List<GeoPosition> Points,
    List<ParsedWaypoint> Waypoints);

/// <summary>Builds and reads Suunto route GPX (GPX 1.1 + the suunto RouteExtension namespace).</summary>
public static class RouteGpx
{
    public static readonly XNamespace Gpx = "http://www.topografix.com/GPX/1/1";
    public static readonly XNamespace Suunto = "http://www.suunto.com/xmlschemas/RouteExtension/v1";

    /// <summary>Points the watch doesn't need: 2 m keeps the shape while dropping our 50 m freehand sampling and
    /// BRouter's dense output.</summary>
    public const double PushToleranceM = 2;

    /// <summary>Builds the GPX to push. On-route POIs become route points with a <c>suunto:routePoint</c> extension
    /// at their spot on the line (Suunto's own export format). Pass <paramref name="suuntoId"/> and
    /// <paramref name="revision"/> for an update.</summary>
    public static string Build(Route route, IReadOnlyList<Poi> pois, string? suuntoId = null, long? revision = null) =>
        Build(route, pois, suuntoId, revision, forDownload: false);

    /// <summary>GPX for other apps: the route as Suunto gets it, plus every POI (off-route ones too) as a plain
    /// <c>&lt;wpt&gt;</c> at its own position, which most tools understand.</summary>
    public static string BuildForDownload(Route route, IReadOnlyList<Poi> pois) =>
        Build(route, pois, null, null, forDownload: true);

    private static string Build(Route route, IReadOnlyList<Poi> pois, string? suuntoId, long? revision, bool forDownload)
    {
        var line = RouteDrawing.FromLineString(route.Geometry, route.HasElevation);
        if (line.Count < 2)
            throw new InvalidOperationException("The route needs at least two points.");

        var rte = new XElement(Gpx + "rte", new XElement(Gpx + "name", route.Name));
        foreach (var (p, poi) in WithWaypoints(line, pois))
        {
            var pt = new XElement(Gpx + "rtept",
                new XAttribute("lat", Fmt(p.Lat, 7)), new XAttribute("lon", Fmt(p.Lon, 7)));
            if (p.Ele is { } ele)
                pt.Add(new XElement(Gpx + "ele", Fmt(ele, 1)));
            if (poi is not null)
            {
                var rp = new XElement(Suunto + "routePoint",
                    new XElement(Suunto + "name", poi.Name),
                    new XElement(Suunto + "type", PoiTypes.Get(poi.PoiType).GpxTypeName));
                if (!string.IsNullOrWhiteSpace(poi.Description))
                    rp.Add(new XElement(Suunto + "description", poi.Description));
                pt.Add(new XElement(Gpx + "extensions", rp));
            }
            rte.Add(pt);
        }

        var suuntoRoute = new XElement(Suunto + "route");
        if (suuntoId is not null)
            suuntoRoute.Add(new XElement(Suunto + "id", suuntoId), new XElement(Suunto + "revision", revision));
        suuntoRoute.Add(
            new XElement(Suunto + "activityIds", route.ActivityIds.Select(a => new XElement(Suunto + "activityId", a))),
            new XElement(Suunto + "turnWaypointsEnabled", route.TurnWaypointsEnabled ? "true" : "false"));

        var metadata = new XElement(Gpx + "metadata", new XElement(Gpx + "name", route.Name));
        if (!string.IsNullOrWhiteSpace(route.Description))
            metadata.Add(new XElement(Gpx + "desc", route.Description));
        metadata.Add(new XElement(Gpx + "extensions", suuntoRoute));

        var gpx = new XElement(Gpx + "gpx",
            new XAttribute("version", "1.1"),
            new XAttribute("creator", "Route & POI Manager"),
            new XAttribute(XNamespace.Xmlns + "suunto", Suunto.NamespaceName),
            metadata);
        if (forDownload)
        {
            // GPX requires wpt before rte.
            foreach (var poi in pois.OrderBy(p => p.DistanceAlongM ?? double.MaxValue))
            {
                var wpt = new XElement(Gpx + "wpt",
                    new XAttribute("lat", Fmt(poi.Location.Y, 7)), new XAttribute("lon", Fmt(poi.Location.X, 7)));
                if (poi.ElevationM is { } e)
                    wpt.Add(new XElement(Gpx + "ele", Fmt(e, 1)));
                wpt.Add(new XElement(Gpx + "name", poi.Name));
                if (!string.IsNullOrWhiteSpace(poi.Description))
                    wpt.Add(new XElement(Gpx + "desc", poi.Description));
                wpt.Add(new XElement(Gpx + "type", PoiTypes.Get(poi.PoiType).GpxTypeName));
                gpx.Add(wpt);
            }
        }
        gpx.Add(rte);
        var doc = new XDocument(new XDeclaration("1.0", "UTF-8", null), gpx);

        var sb = new StringBuilder();
        using (var w = XmlWriter.Create(new Utf8StringWriter(sb), new XmlWriterSettings { Indent = false, Encoding = Encoding.UTF8 }))
            doc.Save(w);
        return sb.ToString();
    }

    /// <summary>suunto:id and suunto:revision from an exported or updated route.</summary>
    public static (string? Id, long? Revision) ReadIdentity(string gpx)
    {
        var route = SuuntoRouteElement(Load(gpx));
        long? rev = long.TryParse(route?.Element(Suunto + "revision")?.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var r)
            ? r
            : null;
        return (route?.Element(Suunto + "id")?.Value, rev);
    }

    public static SuuntoRouteContent Read(string gpx)
    {
        var parsed = GpxParser.Parse(new MemoryStream(Encoding.UTF8.GetBytes(gpx)));
        var route = SuuntoRouteElement(Load(gpx));
        var activities = route?.Element(Suunto + "activityIds")?.Elements(Suunto + "activityId")
            .Select(e => int.TryParse(e.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var a) ? a : -1)
            .Where(ActivityTypes.IsValid).ToArray() ?? [];
        var turn = bool.TryParse(route?.Element(Suunto + "turnWaypointsEnabled")?.Value, out var t) && t;
        // Suunto marks route ends as Begin/End waypoints; they aren't POIs.
        var waypoints = parsed.Waypoints.Where(w => w.IncludeByDefault).ToList();
        return new SuuntoRouteContent(parsed.Name, activities.Length > 0 ? activities : [ActivityTypes.Running], turn,
            parsed.Tracks[0].Points, waypoints);
    }

    /// <summary>Line vertices (lightly simplified) merged with one vertex per on-route POI, in route order.</summary>
    private static List<(GeoPosition Point, Poi? Poi)> WithWaypoints(List<GeoPosition> line, IReadOnlyList<Poi> pois)
    {
        var cumulative = new double[line.Count];
        for (var i = 1; i < line.Count; i++)
            cumulative[i] = cumulative[i - 1] + Geo.DistanceM(line[i - 1], line[i]);

        var anchors = pois.Where(p => p.DistanceAlongM is not null)
            .OrderBy(p => p.DistanceAlongM)
            .Select(p => (Along: Math.Clamp(p.DistanceAlongM!.Value, 0, cumulative[^1]), Poi: p))
            .ToList();

        var result = new List<(GeoPosition, Poi?)>();
        var start = 0;
        GeoPosition? previousAnchor = null;
        foreach (var (along, poi) in anchors.Append((cumulative[^1] + 1, null!)))
        {
            var end = start;
            while (end < line.Count && cumulative[end] < along) end++;
            var anchor = poi is null ? (GeoPosition?)null : Geo.PositionAt(line, along);

            // Simplify the vertices between two anchors together with the anchors themselves, so the run's own
            // ends are only kept when the shape needs them (the anchors are emitted separately).
            var run = new List<GeoPosition>();
            if (previousAnchor is { } pa) run.Add(pa);
            var offset = run.Count;
            run.AddRange(line.Skip(start).Take(end - start));
            if (anchor is { } na) run.Add(na);
            var lastVertex = offset + (end - start) - 1;
            foreach (var i in Geo.SimplifyIndices(run, PushToleranceM).Where(i => i >= offset && i <= lastVertex))
                result.Add((run[i], null));

            if (poi is not null)
                result.Add((anchor!.Value, poi));
            previousAnchor = anchor;
            start = end;
        }
        return result;
    }

    private static XDocument Load(string gpx)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using var reader = XmlReader.Create(new StringReader(gpx), settings);
        return XDocument.Load(reader);
    }

    private static XElement? SuuntoRouteElement(XDocument doc) =>
        doc.Root?.Elements().FirstOrDefault(e => e.Name.LocalName == "metadata")
            ?.Elements().FirstOrDefault(e => e.Name.LocalName == "extensions")
            ?.Element(Suunto + "route");

    private static string Fmt(double v, int digits) => Math.Round(v, digits).ToString(CultureInfo.InvariantCulture);

    private sealed class Utf8StringWriter(StringBuilder sb) : StringWriter(sb, CultureInfo.InvariantCulture)
    {
        public override Encoding Encoding => Encoding.UTF8;
    }
}
