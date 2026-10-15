using Dynastream.Fit;
using RoutePoiManager.Domain;
using FitFile = Dynastream.Fit.File;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>Reads FIT course files (planned route + course points) and activity files (recorded track + laps).</summary>
public static class FitParser
{
    private const double SemicirclesToDegrees = 180.0 / 2147483648.0;

    public static bool LooksLikeFit(ReadOnlySpan<byte> header) =>
        header.Length >= 12 && header[8] == '.' && header[9] == 'F' && header[10] == 'I' && header[11] == 'T';

    public static ParsedFile Parse(Stream stream)
    {
        var decoder = new Decode();
        var listener = new FitListener();
        decoder.MesgEvent += listener.OnMesg;
        try
        {
            if (!decoder.IsFIT(stream))
                throw new ImportException("The file isn't a FIT file.");
            stream.Position = 0;
            // Integrity (CRC) failures are common on files cut short; read what's there rather than reject.
            decoder.Read(stream, DecodeMode.Normal);
        }
        catch (FitException ex)
        {
            throw new ImportException("The FIT file couldn't be read.", ex);
        }

        var m = listener.FitMessages;
        var fileType = m.FileIdMesgs.FirstOrDefault()?.GetType();
        var isCourse = fileType == FitFile.Course || (fileType is null && m.CourseMesgs.Count > 0);

        var points = m.RecordMesgs
            .Select(r => ToPosition(r.GetPositionLat(), r.GetPositionLong(), r.GetEnhancedAltitude() ?? r.GetAltitude()))
            .OfType<GeoPosition>()
            .ToList();
        if (points.Count == 0)
            throw new ImportException(isCourse
                ? "The FIT course has no track points."
                : "The FIT file has no GPS track (indoor activity?).");

        var waypoints = new List<ParsedWaypoint>();
        string? name;
        Sport? sport;
        SubSport? subSport;

        if (isCourse)
        {
            var course = m.CourseMesgs.FirstOrDefault();
            name = Clean(course?.GetNameAsString());
            sport = course?.GetSport();
            subSport = course?.GetSubSport();
            foreach (var cp in m.CoursePointMesgs)
            {
                if (ToPosition(cp.GetPositionLat(), cp.GetPositionLong(), null) is not { } p)
                    continue;
                var typeName = cp.GetType() is { } t ? t.ToString() : "Generic";
                var (poiType, include) = PoiTypeMapping.FromFitCoursePoint(typeName);
                var label = Clean(cp.GetNameAsString());
                waypoints.Add(new ParsedWaypoint(string.IsNullOrWhiteSpace(label) ? typeName : label.Trim(), typeName, poiType, include, p));
            }
        }
        else
        {
            var session = m.SessionMesgs.FirstOrDefault();
            name = null;
            sport = session?.GetSport() ?? m.SportMesgs.FirstOrDefault()?.GetSport();
            subSport = session?.GetSubSport() ?? m.SportMesgs.FirstOrDefault()?.GetSubSport();
            // Lap markers can become POIs, but most activities have auto-laps every km, so they're off by default.
            var lapNo = 0;
            foreach (var lap in m.LapMesgs)
            {
                lapNo++;
                if (ToPosition(lap.GetEndPositionLat(), lap.GetEndPositionLong(), null) is { } p && lapNo < m.LapMesgs.Count)
                    waypoints.Add(new ParsedWaypoint($"Lap {lapNo}", "Lap", PoiTypes.Poi, false, p));
            }
        }

        return new ParsedFile(
            isCourse ? RouteSource.FitCourse : RouteSource.FitActivity,
            string.IsNullOrWhiteSpace(name) ? null : name.Trim(),
            ActivityMapping.FromSport(sport?.ToString(), subSport?.ToString()),
            [new ParsedTrack(name, points)],
            waypoints);
    }

    /// <summary>FIT strings are fixed-size fields; writers pad them with NULs.</summary>
    private static string? Clean(string? s) => s?.Replace("\0", "", StringComparison.Ordinal).Trim() is { Length: > 0 } t ? t : null;

    private static GeoPosition? ToPosition(int? lat, int? lon, float? ele)
    {
        // 0x7FFFFFFF is FIT's "invalid" marker; the SDK returns it for missing positions.
        if (lat is null || lon is null || lat == int.MaxValue || lon == int.MaxValue)
            return null;
        var latDeg = lat.Value * SemicirclesToDegrees;
        var lonDeg = lon.Value * SemicirclesToDegrees;
        if (!Geo.IsValid(lonDeg, latDeg))
            return null;
        double? e = ele is { } v && float.IsFinite(v) ? Math.Round(v, 1) : null;
        return new GeoPosition(lonDeg, latDeg, e);
    }
}
