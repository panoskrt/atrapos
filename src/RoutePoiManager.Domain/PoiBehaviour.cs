using NetTopologySuite.Geometries;

namespace RoutePoiManager.Domain;

public static class PoiBehaviour
{
    /// <summary>A POI further than this from its route's line is "off route": still a Suunto POI, but it can't be
    /// embedded as a route waypoint. Mirrors ON_ROUTE_MAX_OFFSET_M in the web client.</summary>
    public const double OnRouteMaxOffsetM = 200;

    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);

    public static Point CreateLocation(double lon, double lat) => Factory.CreatePoint(new Coordinate(lon, lat));

    public static void MarkLocallyModified(this Poi poi, DateTimeOffset now)
    {
        poi.LocalModifiedAt = now;
        poi.SyncState = poi.SyncState switch
        {
            SyncState.Synced => SyncState.LocalChanges,
            SyncState.RemoteNewer => SyncState.Conflict,
            var s => s,
        };
    }

    /// <summary>Recomputes where the POI sits along the route. Doesn't count as an edit of the POI: its Suunto POI
    /// is unchanged; only the route's waypoints move.</summary>
    public static void Relocate(this Poi poi, IReadOnlyList<GeoPosition> line)
    {
        if (line.Count < 2)
        {
            poi.DistanceAlongM = null;
            return;
        }
        var (along, offset) = Geo.Locate(line, new GeoPosition(poi.Location.X, poi.Location.Y));
        poi.DistanceAlongM = offset <= OnRouteMaxOffsetM ? Math.Round(along, 1) : null;
    }
}
