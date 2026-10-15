namespace RoutePoiManager.Domain;

public sealed record RoutingProfileInfo(string Id, string Label, string Group);

/// <summary>BRouter profiles offered for snap-to-trail. Ids are BRouter profile names (brouter.de/brouter/profiles2).</summary>
public static class RoutingProfiles
{
    public const string Default = "hiking-mountain";

    public static IReadOnlyList<RoutingProfileInfo> All { get; } =
    [
        new("hiking-mountain", "Hiking (mountain)", "Foot"),
        new("hiking-beta", "Hiking (paths first)", "Foot"),
        new("shortest", "Shortest path", "Foot"),
        new("trekking", "Trekking bike", "Bike"),
        new("mtb", "Mountain bike", "Bike"),
        new("gravel", "Gravel bike", "Bike"),
        new("fastbike", "Road bike", "Bike"),
        new("safety", "Safe cycling", "Bike"),
    ];

    private static readonly HashSet<string> Ids = [.. All.Select(p => p.Id)];

    public static bool IsValid(string? id) => id is not null && Ids.Contains(id);
}
