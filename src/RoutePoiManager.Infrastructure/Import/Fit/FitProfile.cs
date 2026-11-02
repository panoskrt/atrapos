using System.Globalization;

namespace RoutePoiManager.Infrastructure.Import.Fit;

/// <summary>Global message numbers of the FIT messages Atrapos reads or writes.</summary>
public static class FitMessages
{
    public const ushort FileId = 0;
    public const ushort Sport = 12;
    public const ushort Session = 18;
    public const ushort Lap = 19;
    public const ushort Record = 20;
    public const ushort Event = 21;
    public const ushort Course = 31;
    public const ushort CoursePoint = 32;
}

/// <summary>Field numbers that mean the same in every message.</summary>
public static class CommonField
{
    public const byte Timestamp = 253;
    public const byte MessageIndex = 254;
}

public static class FileIdField
{
    public const byte Type = 0;
    public const byte Manufacturer = 1;
    public const byte TimeCreated = 4;
}

public static class SportField
{
    public const byte Sport = 0;
    public const byte SubSport = 1;
}

public static class SessionField
{
    public const byte Sport = 5;
    public const byte SubSport = 6;
}

/// <summary>Times are uint32 milliseconds (scale 1000) and distances uint32 centimetres (scale 100).</summary>
public static class LapField
{
    public const byte StartTime = 2;
    public const byte StartPositionLat = 3;
    public const byte StartPositionLong = 4;
    public const byte EndPositionLat = 5;
    public const byte EndPositionLong = 6;
    public const byte TotalElapsedTime = 7;
    public const byte TotalTimerTime = 8;
    public const byte TotalDistance = 9;
}

/// <summary>Altitudes are stored as (metres + 500) × 5: uint16 in <see cref="Altitude"/>, uint32 in
/// <see cref="EnhancedAltitude"/>. Distance is uint32 centimetres.</summary>
public static class RecordField
{
    public const byte PositionLat = 0;
    public const byte PositionLong = 1;
    public const byte Altitude = 2;
    public const byte Distance = 5;
    public const byte EnhancedAltitude = 78;
}

public static class EventField
{
    public const byte Event = 0;
    public const byte EventType = 1;
    public const byte EventGroup = 4;
}

public static class CourseField
{
    public const byte Sport = 4;
    public const byte Name = 5;
    public const byte SubSport = 7;
}

/// <summary>Course points keep their timestamp in field 1, not 253. Distance is uint32 centimetres.</summary>
public static class CoursePointField
{
    public const byte Timestamp = 1;
    public const byte PositionLat = 2;
    public const byte PositionLong = 3;
    public const byte Distance = 4;
    public const byte Type = 5;
    public const byte Name = 6;
}

/// <summary>The FIT enum values Atrapos writes, and the names of those it reads (as of profile 21.218).</summary>
public static class FitProfile
{
    public const byte FileActivity = 4;
    public const byte FileCourse = 6;
    public const ushort ManufacturerDevelopment = 255;
    public const byte EventTimer = 0;
    public const byte EventTypeStart = 0;
    public const byte EventTypeStopDisableAll = 9;

    public static FitNames Sport { get; } = new(
        "Generic", "Running", "Cycling", "Transition", "FitnessEquipment", "Swimming", "Basketball", "Soccer",
        "Tennis", "AmericanFootball", "Training", "Walking", "CrossCountrySkiing", "AlpineSkiing", "Snowboarding",
        "Rowing", "Mountaineering", "Hiking", "Multisport", "Paddling", "Flying", "EBiking", "Motorcycling",
        "Boating", "Driving", "Golf", "HangGliding", "HorsebackRiding", "Hunting", "Fishing", "InlineSkating",
        "RockClimbing", "Sailing", "IceSkating", "SkyDiving", "Snowshoeing", "Snowmobiling", "StandUpPaddleboarding",
        "Surfing", "Wakeboarding", "WaterSkiing", "Kayaking", "Rafting", "Windsurfing", "Kitesurfing", "Tactical",
        "Jumpmaster", "Boxing", "FloorClimbing", "Baseball", null, null, null, "Diving", null, null, "Shooting",
        null, "WinterSport", "Grinding", null, null, "Hiit", "VideoGaming", "Racket", "WheelchairPushWalk",
        "WheelchairPushRun", "Meditation", "ParaSport", "DiscGolf", "TeamSport", "Cricket", "Rugby", "Hockey",
        "Lacrosse", "Volleyball", "WaterTubing", "Wakesurfing", "WaterSport", "Archery", "MixedMartialArts",
        "MotorSports", "Snorkeling", "Dance", "JumpRope", "PoolApnea", "Mobility", "Geocaching", "Canoeing");

    public static FitNames SubSport { get; } = new(
        "Generic", "Treadmill", "Street", "Trail", "Track", "Spin", "IndoorCycling", "Road", "Mountain", "Downhill",
        "Recumbent", "Cyclocross", "HandCycling", "TrackCycling", "IndoorRowing", "Elliptical", "StairClimbing",
        "LapSwimming", "OpenWater", "FlexibilityTraining", "StrengthTraining", "WarmUp", "Match", "Exercise",
        "Challenge", "IndoorSkiing", "CardioTraining", "IndoorWalking", "EBikeFitness", "Bmx", "CasualWalking",
        "SpeedWalking", "BikeToRunTransition", "RunToBikeTransition", "SwimToBikeTransition", "Atv", "Motocross",
        "Backcountry", "Resort", "RcDrone", "Wingsuit", "Whitewater", "SkateSkiing", "Yoga", "Pilates",
        "IndoorRunning", "GravelCycling", "EBikeMountain", "Commuting", "MixedSurface", "Navigate", "TrackMe", "Map",
        "SingleGasDiving", "MultiGasDiving", "GaugeDiving", "ApneaDiving", "ApneaHunting", "VirtualActivity",
        "Obstacle", null, null, "Breathing", "CcrDiving", null, "SailRace", "Expedition", "Ultra", "IndoorClimbing",
        "Bouldering", "Hiit", "IndoorGrinding", "HuntingWithDogs", "Amrap", "Emom", "Tabata", null, "Esport",
        "Triathlon", "Duathlon", "Brick", "SwimRun", "AdventureRace", "TruckerWorkout", "Pickleball", "Padel",
        "IndoorWheelchairWalk", "IndoorWheelchairRun", "IndoorHandCycling", null, "Field", "Ice", "Ultimate",
        "Platform", "Squash", "Badminton", "Racquetball", "TableTennis", "Overland", "TrollingMotor", null, null,
        null, null, null, null, null, null, null, null, "FlyCanopy", "FlyParaglide", "FlyParamotor",
        "FlyPressurized", "FlyNavigate", "FlyTimer", "FlyAltimeter", "FlyWx", "FlyVfr", "FlyIfr", null,
        "DynamicApnea", null, "Enduro", "Rucking", "Rally", "PoolTriathlon", "EBikeEnduro");

    public static FitNames CoursePoint { get; } = new(
        "Generic", "Summit", "Valley", "Water", "Food", "Danger", "Left", "Right", "Straight", "FirstAid",
        "FourthCategory", "ThirdCategory", "SecondCategory", "FirstCategory", "HorsCategory", "Sprint", "LeftFork",
        "RightFork", "MiddleFork", "SlightLeft", "SharpLeft", "SlightRight", "SharpRight", "UTurn", "SegmentStart",
        "SegmentEnd", null, "Campsite", "AidStation", "RestArea", "GeneralDistance", "Service", "EnergyGel",
        "SportsDrink", "MileMarker", "Checkpoint", "Shelter", "MeetingSpot", "Overlook", "Toilet", "Shower", "Gear",
        "SharpCurve", "SteepIncline", "Tunnel", "Bridge", "Obstacle", "Crossing", "Store", "Transition", "Navaid",
        "Transport", "Alert", "Info");
}

/// <summary>A FIT enum's names, indexed by value (null where the profile skips a value).</summary>
public sealed class FitNames(params string?[] names)
{
    /// <summary>The value's name; a value missing from the table comes back as its number.</summary>
    public string? Name(long? value) => value switch
    {
        null => null,
        >= 0 when value < names.Length && names[value.Value] is { } name => name,
        _ => value.Value.ToString(CultureInfo.InvariantCulture),
    };

    public byte this[string name] => Array.IndexOf(names, name) is var value and >= 0
        ? (byte)value
        : throw new ArgumentException($"No FIT value is named {name}.", nameof(name));
}
