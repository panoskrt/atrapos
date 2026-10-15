namespace RoutePoiManager.Domain;

/// <summary>Best-guess Suunto POI types for waypoints from other tools. The user can change every guess in the
/// import dialog, so this only has to be sensible, not perfect.</summary>
public static class PoiTypeMapping
{
    // Garmin/Basecamp symbol names and common GPX <type> values.
    private static readonly Dictionary<string, int> Symbols = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Drinking Water"] = PoiTypes.Water, ["Water Source"] = PoiTypes.Water, ["Spring"] = PoiTypes.Water,
        ["Campground"] = PoiTypes.Camp, ["Campsite"] = PoiTypes.Camp, ["Shelter"] = 9 /* Lodging */,
        ["Summit"] = PoiTypes.Peak, ["Parking Area"] = PoiTypes.Parking, ["Danger Area"] = PoiTypes.Danger,
        ["Restaurant"] = 7, ["Fast Food"] = 6, ["Pizza"] = 6, ["Bar"] = 6, ["Lodging"] = 9, ["Hotel"] = 11,
        ["Scenic Area"] = 22, ["Information"] = 33, ["Medical Facility"] = 32, ["First Aid"] = 32,
        ["Geocache"] = 25, ["Trail Head"] = 28, ["Bridge"] = 21, ["Waterfall"] = 35, ["Cave"] = 31,
        ["Beach"] = 66, ["Fishing Area"] = 36, ["Forest"] = 20, ["Lake"] = 14, ["Car"] = 2, ["Residence"] = 1,
    };

    // Keyword fallback, checked in order against type, symbol and name.
    private static readonly (string Keyword, int Type)[] Keywords =
    [
        ("water", PoiTypes.Water), ("spring", PoiTypes.Water), ("fountain", PoiTypes.Water),
        ("camp", PoiTypes.Camp), ("summit", PoiTypes.Peak), ("peak", PoiTypes.Peak), ("parking", PoiTypes.Parking),
        ("danger", PoiTypes.Danger), ("caution", PoiTypes.Danger), ("cafe", 8), ("café", 8), ("coffee", 8),
        ("restaurant", 7), ("food", 6), ("hostel", 10), ("hotel", 11), ("hut", 9), ("lodg", 9), ("shelter", 9),
        ("view", 22), ("sight", 22), ("info", 33), ("aid", 74), ("waterfall", 35), ("lake", 14), ("river", 13),
    ];

    /// <summary>GPX waypoint: <c>type</c>, then <c>sym</c>, then keywords in type/sym/name. Unknown → generic POI.</summary>
    public static int FromGpx(string? type, string? sym, string? name)
    {
        foreach (var candidate in new[] { type, sym })
        {
            if (string.IsNullOrWhiteSpace(candidate))
                continue;
            var direct = PoiTypes.FromGpxType(candidate);
            if (direct.Id != PoiTypes.Poi)
                return direct.Id;
            if (Symbols.TryGetValue(candidate.Trim(), out var s))
                return s;
        }
        return FromKeywords(type, sym, name) ?? PoiTypes.Poi;
    }

    /// <summary>FIT course point type (by enum name, so the domain doesn't depend on the FIT SDK).</summary>
    public static (int PoiType, bool IncludeByDefault) FromFitCoursePoint(string fitType) => fitType switch
    {
        "Summit" => (PoiTypes.Peak, true),
        "Valley" => (18, true),
        "Water" or "SportsDrink" => (PoiTypes.Water, true),
        "Food" or "EnergyGel" or "Store" => (6, true),
        "Danger" or "Alert" or "SharpCurve" or "SteepIncline" or "Obstacle" => (PoiTypes.Danger, true),
        "FirstAid" => (32, true),
        "Campsite" => (PoiTypes.Camp, true),
        "AidStation" or "Service" => (74, true),
        "Shelter" or "RestArea" => (9, true),
        "Overlook" => (22, true),
        "Info" or "Navaid" => (33, true),
        "Bridge" or "Tunnel" or "Crossing" => (21, true),
        "Generic" or "Checkpoint" or "MeetingSpot" or "Toilet" or "Shower" or "Gear" or "Transport" or "Transition" => (PoiTypes.Poi, true),
        // Turn instructions and markers: Suunto generates its own turn-by-turn, so these are off by default.
        _ => (PoiTypes.Poi, false),
    };

    private static int? FromKeywords(params string?[] texts)
    {
        foreach (var (keyword, poiType) in Keywords)
            foreach (var text in texts)
                if (text is not null && text.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                    return poiType;
        return null;
    }
}

/// <summary>Suggested Suunto activities for an imported file, from FIT sport/sub-sport names or a GPX track type.</summary>
public static class ActivityMapping
{
    public static int[] FromSport(string? sport, string? subSport)
    {
        var sub = subSport ?? "";
        return sport switch
        {
            "Running" => sub is "Trail" or "Mountain" ? [ActivityTypes.TrailRunning] : sub == "Track" ? [59] : [ActivityTypes.Running],
            "Cycling" or "EBiking" => sub switch
            {
                "Mountain" or "EBikeMountain" or "Downhill" => [ActivityTypes.MountainBiking],
                "GravelCycling" => [99],
                _ => [ActivityTypes.Cycling],
            },
            "Hiking" => [ActivityTypes.Hiking],
            "Walking" => [ActivityTypes.Walking],
            "Mountaineering" => [83],
            "CrossCountrySkiing" => sub == "Backcountry" ? [107] : [3],
            "AlpineSkiing" => sub == "Backcountry" ? [31] : [13],
            "Snowshoeing" => [65],
            "Paddling" or "Kayaking" => [14],
            _ => [ActivityTypes.Hiking],
        };
    }

    /// <summary>Strava/Komoot-style <c>trk/type</c> values: "running", "hiking", "cycling", "9" …</summary>
    public static int[] FromGpxType(string? type)
    {
        var t = (type ?? "").Trim().ToLowerInvariant();
        return t switch
        {
            _ when t.Contains("trail", StringComparison.Ordinal) => [ActivityTypes.TrailRunning],
            _ when t.Contains("run", StringComparison.Ordinal) => [ActivityTypes.Running],
            _ when t.Contains("mountain", StringComparison.Ordinal) || t.Contains("mtb", StringComparison.Ordinal) => [ActivityTypes.MountainBiking],
            _ when t.Contains("gravel", StringComparison.Ordinal) => [99],
            _ when t.Contains("cycl", StringComparison.Ordinal) || t.Contains("bik", StringComparison.Ordinal) || t.Contains("ride", StringComparison.Ordinal) => [ActivityTypes.Cycling],
            _ when t.Contains("walk", StringComparison.Ordinal) => [ActivityTypes.Walking],
            _ when t.Contains("ski", StringComparison.Ordinal) => [3],
            _ => [ActivityTypes.Hiking],
        };
    }
}
