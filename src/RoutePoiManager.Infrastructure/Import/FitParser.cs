using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import.Fit;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>Reads FIT course files (planned route + course points) and activity files (recorded track + laps).</summary>
public static class FitParser
{
    private const double SemicirclesToDegrees = 180.0 / 2147483648.0;

    public static bool LooksLikeFit(ReadOnlySpan<byte> header) => FitReader.IsFit(header);

    public static ParsedFile Parse(ReadOnlySpan<byte> content)
    {
        if (!FitReader.IsFit(content))
            throw new ImportException("The file isn't a FIT file.");
        ILookup<ushort, FitMessage> m;
        try
        {
            m = FitReader.Read(content).ToLookup(message => message.Number);
        }
        catch (InvalidDataException ex)
        {
            throw new ImportException("The FIT file couldn't be read.", ex);
        }

        var fileType = m[FitMessages.FileId].FirstOrDefault()?.Raw(FileIdField.Type);
        var isCourse = fileType == FitProfile.FileCourse || (fileType is null && m[FitMessages.Course].Any());

        var points = new List<GeoPosition>();
        var times = new List<DateTime?>();
        foreach (var r in m[FitMessages.Record])
        {
            var ele = r.Value(RecordField.EnhancedAltitude, 5, 500) ?? r.Value(RecordField.Altitude, 5, 500);
            if (ToPosition(r.Raw(RecordField.PositionLat), r.Raw(RecordField.PositionLong), ele) is not { } p)
                continue;
            points.Add(p);
            times.Add(r.Time());
        }
        if (points.Count == 0)
            throw new ImportException(isCourse
                ? "The FIT course has no track points."
                : "The FIT file has no GPS track (indoor activity?).");

        var waypoints = new List<ParsedWaypoint>();
        string? name;
        string? sport;
        string? subSport;

        if (isCourse)
        {
            var course = m[FitMessages.Course].FirstOrDefault();
            name = Clean(course?.Text(CourseField.Name));
            sport = FitProfile.Sport.Name(course?.Raw(CourseField.Sport));
            subSport = FitProfile.SubSport.Name(course?.Raw(CourseField.SubSport));
            foreach (var cp in m[FitMessages.CoursePoint])
            {
                if (ToPosition(cp.Raw(CoursePointField.PositionLat), cp.Raw(CoursePointField.PositionLong), null) is not { } p)
                    continue;
                var typeName = FitProfile.CoursePoint.Name(cp.Raw(CoursePointField.Type)) ?? "Generic";
                var (poiType, include) = PoiTypeMapping.FromFitCoursePoint(typeName);
                var label = Clean(cp.Text(CoursePointField.Name));
                waypoints.Add(new ParsedWaypoint(string.IsNullOrWhiteSpace(label) ? typeName : label.Trim(), typeName, poiType, include, p));
            }
        }
        else
        {
            var session = m[FitMessages.Session].FirstOrDefault();
            var sportMessage = m[FitMessages.Sport].FirstOrDefault();
            name = null;
            sport = FitProfile.Sport.Name(session?.Raw(SessionField.Sport) ?? sportMessage?.Raw(SportField.Sport));
            subSport = FitProfile.SubSport.Name(session?.Raw(SessionField.SubSport) ?? sportMessage?.Raw(SportField.SubSport));
            // Lap markers can become POIs, but most activities have auto-laps every km, so they're off by default.
            var laps = m[FitMessages.Lap].ToList();
            var lapNo = 0;
            foreach (var lap in laps)
            {
                lapNo++;
                if (ToPosition(lap.Raw(LapField.EndPositionLat), lap.Raw(LapField.EndPositionLong), null) is { } p && lapNo < laps.Count)
                    waypoints.Add(new ParsedWaypoint($"Lap {lapNo}", "Lap", PoiTypes.Poi, false, p));
            }
        }

        return new ParsedFile(
            isCourse ? RouteSource.FitCourse : RouteSource.FitActivity,
            string.IsNullOrWhiteSpace(name) ? null : name.Trim(),
            ActivityMapping.FromSport(sport, subSport),
            [new ParsedTrack(name, points, times)],
            waypoints);
    }

    private static string? Clean(string? s) => s?.Trim() is { Length: > 0 } t ? t : null;

    /// <summary>The reader leaves out FIT's "invalid" positions, so a missing coordinate means no fix.</summary>
    private static GeoPosition? ToPosition(long? lat, long? lon, double? ele)
    {
        if (lat is null || lon is null)
            return null;
        var latDeg = lat.Value * SemicirclesToDegrees;
        var lonDeg = lon.Value * SemicirclesToDegrees;
        if (!Geo.IsValid(lonDeg, latDeg))
            return null;
        double? e = ele is { } v && double.IsFinite(v) ? Math.Round(v, 1) : null;
        return new GeoPosition(lonDeg, latDeg, e);
    }
}
