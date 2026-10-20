using NetTopologySuite.Geometries;

namespace RoutePoiManager.Domain;

/// <summary>Sync status of a route or POI relative to the user's Suunto account.</summary>
public enum SyncState
{
    /// <summary>Never pushed to Suunto.</summary>
    LocalOnly = 0,
    /// <summary>Local copy matches what was last pushed or pulled.</summary>
    Synced = 1,
    /// <summary>Edited locally since the last push.</summary>
    LocalChanges = 2,
    /// <summary>Changed in the Suunto app since the last sync; local copy is untouched.</summary>
    RemoteNewer = 3,
    /// <summary>Changed on both sides; the user has to pick a resolution.</summary>
    Conflict = 4,
    /// <summary>The last push failed.</summary>
    Error = 5,
}

public enum RouteSource
{
    Drawn = 0,
    Gpx = 1,
    FitCourse = 2,
    FitActivity = 3,
    Suunto = 4,
}

public enum SegmentMode
{
    Snap = 0,
    Freehand = 1,
}

public sealed class User
{
    public Guid Id { get; set; }

    /// <summary>The Suunto app username from the access token's <c>user</c> claim, when connected.</summary>
    public string? SuuntoUsername { get; set; }

    /// <summary>Stable Google subject identifier for Google-authenticated app accounts.</summary>
    public string? GoogleSubject { get; set; }

    /// <summary>Access token encrypted with ASP.NET Data Protection.</summary>
    public required string AccessTokenProtected { get; set; }

    /// <summary>Refresh token encrypted with ASP.NET Data Protection.</summary>
    public required string RefreshTokenProtected { get; set; }

    public DateTimeOffset AccessTokenExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastSuuntoRefreshAt { get; set; }
}

/// <summary>A point the user placed while drawing. <see cref="Segment"/> caches the computed line from this
/// point to the next one (lon, lat, ele?) so reopening a route never re-routes or re-fetches elevation.</summary>
public sealed record ControlPoint(double Lon, double Lat, SegmentMode ModeToNext, double?[][]? Segment = null);

public sealed class Route
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }

    /// <summary>Suunto activity IDs (see <see cref="ActivityTypes"/>).</summary>
    public int[] ActivityIds { get; set; } = [ActivityTypes.Hiking];

    public bool TurnWaypointsEnabled { get; set; }
    public string RoutingProfile { get; set; } = RoutingProfiles.Default;

    /// <summary>Full computed line in WGS84 with elevation as Z (0 when <see cref="HasElevation"/> is false).</summary>
    public LineString? Geometry { get; set; }

    public bool HasElevation { get; set; }

    public List<ControlPoint> ControlPoints { get; set; } = [];

    public double SimplifyToleranceM { get; set; } = 5;
    public double DistanceM { get; set; }
    public double AscentM { get; set; }
    public double DescentM { get; set; }
    public RouteSource Source { get; set; }

    public string? SuuntoRouteId { get; set; }
    public long? SuuntoRevision { get; set; }
    public DateTimeOffset? SuuntoModifiedAt { get; set; }
    public string? LastPushedHash { get; set; }
    public DateTimeOffset? LastPushedAt { get; set; }
    public SyncState SyncState { get; set; } = SyncState.LocalOnly;

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LocalModifiedAt { get; set; }

    public List<Poi> Pois { get; set; } = [];
}

public sealed class Poi
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }

    /// <summary>Route the POI belongs to; null for a standalone POI.</summary>
    public Guid? RouteId { get; set; }

    public required string Name { get; set; }
    public string? Description { get; set; }

    /// <summary>Suunto POI type (see <see cref="PoiTypes"/>).</summary>
    public int PoiType { get; set; } = PoiTypes.Poi;

    /// <summary>WGS84 position (2D; elevation is <see cref="ElevationM"/>).</summary>
    public required Point Location { get; set; }

    /// <summary>Metres above sea level; null when unknown.</summary>
    public double? ElevationM { get; set; }

    /// <summary>Distance along the route in metres, when the POI is on a route.</summary>
    public double? DistanceAlongM { get; set; }

    public int? ActivityId { get; set; }

    public string? SuuntoPoiKey { get; set; }
    public DateTimeOffset? SuuntoModifiedAt { get; set; }
    public string? LastPushedHash { get; set; }
    public DateTimeOffset? LastPushedAt { get; set; }
    public SyncState SyncState { get; set; } = SyncState.LocalOnly;

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LocalModifiedAt { get; set; }

    /// <summary>Soft delete. Kept so that undoing a delete restores the POI with its Suunto key,
    /// instead of creating a duplicate on Suunto at the next push.</summary>
    public DateTimeOffset? DeletedAt { get; set; }
}

public sealed class SourceFile
{
    public Guid Id { get; set; }
    public Guid RouteId { get; set; }
    public required string FileName { get; set; }
    public RouteSource Kind { get; set; }
    public required byte[] Content { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
}

public sealed class SyncLogEntry
{
    public long Id { get; set; }
    public Guid UserId { get; set; }
    public required string Entity { get; set; }
    public Guid? EntityId { get; set; }
    public required string Operation { get; set; }
    public int? HttpStatus { get; set; }
    public string? Message { get; set; }
    public DateTimeOffset At { get; set; }
}
