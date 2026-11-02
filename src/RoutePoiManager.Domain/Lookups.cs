namespace RoutePoiManager.Domain;

public sealed record PoiTypeInfo(int Id, string Name)
{
    /// <summary>Waypoint type string used in route GPX (Suunto matches it case-insensitively).</summary>
    public string GpxTypeName => Name;
}

/// <summary>Suunto POI types: the <c>PoiType</c> enum of the Suunto POI API (v2/poi).</summary>
public static class PoiTypes
{
    public const int Unknown = -1;
    public const int Parking = 3;
    public const int Camp = 4;
    public const int Water = 12;
    public const int Begin = 23;
    public const int End = 24;
    public const int Poi = 26;
    public const int Peak = 34;
    public const int Danger = 73;

    public static IReadOnlyList<PoiTypeInfo> All { get; } =
    [
        new(-1, "Unknown"), new(0, "Building"), new(1, "Home"), new(2, "Car"), new(3, "Parking"),
        new(4, "Camp"), new(5, "Camping"), new(6, "Food"), new(7, "Restaurant"), new(8, "Cafe"),
        new(9, "Lodging"), new(10, "Hostel"), new(11, "Hotel"), new(12, "Water"), new(13, "River"),
        new(14, "Lake"), new(15, "Coast"), new(16, "Mountain"), new(17, "Hill"), new(18, "Valley"),
        new(19, "Cliff"), new(20, "Forest"), new(21, "Crossroads"), new(22, "Sight"), new(23, "Begin"),
        new(24, "End"), new(25, "Geocache"), new(26, "POI"), new(27, "Road"), new(28, "Trail"),
        new(29, "Rock"), new(30, "Meadow"), new(31, "Cave"), new(32, "Emergency"), new(33, "Information"),
        new(34, "Peak"), new(35, "Waterfall"), new(36, "FishingSpot"), new(37, "Bedding"), new(38, "Prints"),
        new(39, "Rub"), new(40, "Scrape"), new(41, "Stand"), new(42, "TrailCam"), new(43, "BigGame"),
        new(44, "SmallGame"), new(45, "Bird"), new(46, "Shot"), new(47, "Fish"), new(64, "BigFish"),
        new(65, "CoralReef"), new(66, "Beach"), new(67, "MarineMammals"), new(68, "KelpForest"), new(69, "Lagoon"),
        new(70, "Wreck"), new(71, "MarineReserve"), new(72, "Avalanche"), new(73, "Danger"), new(74, "AidStation"),
        new(75, "WaterPoint"), new(76, "Mushrooms"), new(77, "Campfire"),
    ];

    private static readonly Dictionary<int, PoiTypeInfo> ById = All.ToDictionary(t => t.Id);
    private static readonly Dictionary<string, PoiTypeInfo> ByName =
        All.ToDictionary(t => t.Name, StringComparer.OrdinalIgnoreCase);

    public static bool IsValid(int id) => ById.ContainsKey(id);

    public static PoiTypeInfo Get(int id) => ById.TryGetValue(id, out var t) ? t : ById[Unknown];

    /// <summary>Maps a GPX waypoint type string to a POI type; unknown strings become the generic POI type.</summary>
    public static PoiTypeInfo FromGpxType(string? type) =>
        type is not null && ByName.TryGetValue(type.Trim(), out var t) ? t : ById[Poi];
}

public sealed record ActivityTypeInfo(int Id, string Name, bool WatchSupported = true);

/// <summary>Suunto activity (sport) IDs, from Suunto's Activities.pdf.</summary>
public static class ActivityTypes
{
    public const int Walking = 0;
    public const int Running = 1;
    public const int Cycling = 2;
    public const int MountainBiking = 10;
    public const int Hiking = 11;
    public const int TrailRunning = 22;
    public const int Trekking = 70;

    public static IReadOnlyList<ActivityTypeInfo> All { get; } =
    [
        new(0, "Walking"), new(1, "Running"), new(2, "Cycling"), new(3, "Cross-country skiing"), new(4, "Sports"),
        new(10, "Mountain biking"), new(11, "Hiking"), new(12, "Roller skating"), new(13, "Downhill skiing"),
        new(14, "Paddling"), new(15, "Rowing"), new(16, "Golfing"), new(17, "Indoor sports"), new(18, "Parkouring"),
        new(19, "Ball games"), new(20, "Outdoor gym"), new(21, "Swimming"), new(22, "Trail running"), new(23, "Gym"),
        new(24, "Nordic walking"), new(25, "Horseback riding"), new(26, "Motorsports"), new(27, "Skateboarding"),
        new(28, "Water sports"), new(29, "Climbing"), new(30, "Snowboarding"), new(31, "Ski touring"),
        new(32, "Fitness class"), new(33, "Soccer"), new(34, "Tennis"), new(35, "Basketball"), new(36, "Badminton"),
        new(37, "Baseball"), new(38, "Volleyball"), new(39, "American football"), new(40, "Table tennis"),
        new(41, "Racquet ball"), new(42, "Squash"), new(43, "Floorball"), new(44, "Handball"), new(45, "Softball"),
        new(46, "Bowling"), new(47, "Cricket"), new(48, "Rugby"), new(49, "Ice skating"), new(50, "Ice hockey"),
        new(51, "Yoga/pilates"), new(52, "Indoor cycling"), new(53, "Treadmill"), new(54, "Crossfit"),
        new(55, "Crosstrainer"), new(56, "Roller skiing"), new(57, "Indoor rowing"), new(58, "Stretching"),
        new(59, "Track and field"), new(60, "Orienteering"), new(61, "Standup paddling"), new(62, "Combat sport"),
        new(63, "Kettlebell"), new(64, "Dancing"), new(65, "Snow shoeing"), new(66, "Frisbee golf"), new(67, "Futsal"),
        new(68, "Multisport"), new(69, "Aerobics"), new(70, "Trekking"), new(71, "Sailing"), new(72, "Kayaking"),
        new(73, "Circuit training"), new(74, "Triathlon"), new(75, "Padel"), new(76, "Cheerleading"), new(77, "Boxing"),
        new(78, "Scubadiving"), new(79, "Freediving"), new(80, "Adventure racing"), new(81, "Gymnastics"),
        new(82, "Canoeing"), new(83, "Mountaineering"), new(84, "Telemark skiing"), new(85, "Openwater swimming"),
        new(86, "Windsurfing"), new(87, "Kitesurfing"), new(88, "Paragliding"), new(90, "Snorkeling"),
        new(91, "Surfing"), new(92, "Swimrun", false), new(93, "Duathlon", false), new(94, "Aquathlon", false),
        new(95, "Obstacle racing"), new(96, "Fishing"), new(97, "Hunting"), new(98, "Transition"),
        new(99, "Gravel cycling"), new(100, "Mermaiding"), new(101, "Spearfishing"), new(102, "Jump rope"),
        new(103, "Track running"), new(104, "Calisthenics"), new(105, "E-biking"), new(106, "E-MTB"),
        new(107, "Backcountry skiing"), new(108, "Wheelchair sport"), new(109, "Hand cycling"),
        new(110, "Splitboarding"), new(111, "Biathlon"), new(112, "Meditation"), new(113, "Field hockey"),
        new(114, "Cyclocross"), new(115, "Vertical running"), new(116, "Ski mountaineering"),
        new(117, "Skate skiing"), new(118, "Classic skiing"), new(119, "Chores"), new(120, "Pilates"),
        new(121, "Yoga"),
    ];

    private static readonly HashSet<int> Ids = [.. All.Select(a => a.Id)];

    public static bool IsValid(int id) => Ids.Contains(id);
}
