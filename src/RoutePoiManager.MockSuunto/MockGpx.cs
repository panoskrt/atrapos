using System.Globalization;
using System.Xml.Linq;

namespace RoutePoiManager.MockSuunto;

public sealed record GeoPoint(double Lat, double Lon, double Ele);

/// <summary>The bits of Suunto's GPX handling the mock needs: splitting routes, naming, stats, id/revision.</summary>
public static class MockGpx
{
    public static readonly XNamespace Gpx = "http://www.topografix.com/GPX/1/1";
    public static readonly XNamespace Suunto = "http://www.suunto.com/xmlschemas/RouteExtension/v1";

    /// <summary>Each <c>rte</c>/<c>trk</c> becomes its own route; returns one document per route.</summary>
    public static List<XDocument> SplitRoutes(XDocument doc)
    {
        var root = doc.Root ?? throw new FormatException("Empty GPX.");
        var routeElements = root.Elements(Gpx + "rte").Concat(root.Elements(Gpx + "trk")).ToList();
        var result = new List<XDocument>();
        foreach (var keep in routeElements)
        {
            var copy = new XDocument(doc);
            var copyRoot = copy.Root!;
            var index = routeElements.IndexOf(keep);
            var copyRoutes = copyRoot.Elements(Gpx + "rte").Concat(copyRoot.Elements(Gpx + "trk")).ToList();
            for (var i = 0; i < copyRoutes.Count; i++)
                if (i != index) copyRoutes[i].Remove();
            result.Add(copy);
        }
        return result;
    }

    public static int CountRoutes(XDocument doc) =>
        doc.Root?.Elements(Gpx + "rte").Count() + doc.Root?.Elements(Gpx + "trk").Count() ?? 0;

    /// <summary>Name precedence documented by Suunto: rte/trk name, rte/trk desc, metadata name, metadata desc.</summary>
    public static string RouteName(XDocument doc)
    {
        var root = doc.Root!;
        var route = root.Element(Gpx + "rte") ?? root.Element(Gpx + "trk");
        var metadata = root.Element(Gpx + "metadata");
        return new[]
        {
            route?.Element(Gpx + "name")?.Value, route?.Element(Gpx + "desc")?.Value,
            metadata?.Element(Gpx + "name")?.Value, metadata?.Element(Gpx + "desc")?.Value,
        }.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s))?.Trim() ?? "Unnamed route";
    }

    public static List<GeoPoint> Points(XDocument doc) =>
        doc.Root!.Descendants()
            .Where(e => e.Name == Gpx + "rtept" || e.Name == Gpx + "trkpt")
            .Select(e => new GeoPoint(
                Attr(e, "lat"), Attr(e, "lon"),
                double.TryParse(e.Element(Gpx + "ele")?.Value, CultureInfo.InvariantCulture, out var ele) ? ele : 0))
            .ToList();

    public static double DistanceMeters(IReadOnlyList<GeoPoint> pts)
    {
        double total = 0;
        for (var i = 1; i < pts.Count; i++)
            total += Haversine(pts[i - 1], pts[i]);
        return total;
    }

    public static int[]? ActivityIds(XDocument doc) =>
        SuuntoRoute(doc, create: false)?.Element(Suunto + "activityIds")?.Elements(Suunto + "activityId")
            .Select(e => int.Parse(e.Value, CultureInfo.InvariantCulture)).ToArray() is { Length: > 0 } ids
            ? ids
            : null;

    public static bool TurnWaypointsEnabled(XDocument doc) =>
        bool.TryParse(SuuntoRoute(doc, create: false)?.Element(Suunto + "turnWaypointsEnabled")?.Value, out var b) && b;

    public static (string? Id, long? Revision) ReadIdentity(XDocument doc)
    {
        var sr = SuuntoRoute(doc, create: false);
        var id = sr?.Element(Suunto + "id")?.Value;
        long? rev = long.TryParse(sr?.Element(Suunto + "revision")?.Value, CultureInfo.InvariantCulture, out var r) ? r : null;
        return (id, rev);
    }

    /// <summary>Returns a copy with <c>suunto:id</c> and <c>suunto:revision</c> set, as Suunto's export does.</summary>
    public static XDocument WithIdentity(XDocument doc, string id, long revision, int[] activityIds)
    {
        var copy = new XDocument(doc);
        if (copy.Root!.GetNamespaceOfPrefix("suunto") is null)
            copy.Root.SetAttributeValue(XNamespace.Xmlns + "suunto", Suunto.NamespaceName);

        var sr = SuuntoRoute(copy, create: true)!;
        sr.Element(Suunto + "id")?.Remove();
        sr.Element(Suunto + "revision")?.Remove();
        sr.AddFirst(new XElement(Suunto + "id", id), new XElement(Suunto + "revision", revision));

        sr.Element(Suunto + "activityIds")?.Remove();
        sr.Element(Suunto + "revision")!.AddAfterSelf(new XElement(Suunto + "activityIds",
            activityIds.Select(a => new XElement(Suunto + "activityId", a))));
        return copy;
    }

    private static XElement? SuuntoRoute(XDocument doc, bool create)
    {
        var root = doc.Root!;
        var metadata = root.Element(Gpx + "metadata");
        if (metadata is null)
        {
            if (!create) return null;
            metadata = new XElement(Gpx + "metadata");
            root.AddFirst(metadata);
        }
        var ext = metadata.Element(Gpx + "extensions");
        if (ext is null)
        {
            if (!create) return null;
            ext = new XElement(Gpx + "extensions");
            metadata.Add(ext);
        }
        var sr = ext.Element(Suunto + "route");
        if (sr is null && create)
        {
            sr = new XElement(Suunto + "route");
            ext.Add(sr);
        }
        return sr;
    }

    private static double Attr(XElement e, string name) =>
        double.Parse(e.Attribute(name)?.Value ?? throw new FormatException($"Missing {name}"), CultureInfo.InvariantCulture);

    private static double Haversine(GeoPoint a, GeoPoint b)
    {
        const double r = 6371008.8;
        var dLat = double.DegreesToRadians(b.Lat - a.Lat);
        var dLon = double.DegreesToRadians(b.Lon - a.Lon);
        var h = Math.Pow(Math.Sin(dLat / 2), 2) +
                Math.Cos(double.DegreesToRadians(a.Lat)) * Math.Cos(double.DegreesToRadians(b.Lat)) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * r * Math.Asin(Math.Sqrt(h));
    }
}
