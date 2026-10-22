using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Import;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class ImportApiTests(PostgresFixture pg)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    /// <summary>~5.5 km north-going track with 2 m GPS jitter, one waypoint on it and one 2 km away.</summary>
    private static string SampleGpx()
    {
        var pts = new StringBuilder();
        for (var i = 0; i <= 500; i++)
        {
            var lat = 60.30 + i * 0.0001;
            var lon = 24.50 + (i % 2 == 0 ? 0.00002 : -0.00002) + Math.Sin(i / 80.0) * 0.003;
            pts.Append(CultureInfo.InvariantCulture, $"<trkpt lat=\"{lat:F6}\" lon=\"{lon:F6}\"><ele>{100 + i * 0.2:F1}</ele></trkpt>");
        }
        return $"""
            <gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
              <wpt lat="60.32" lon="24.5005"><name>Spring</name><sym>Drinking Water</sym></wpt>
              <wpt lat="60.32" lon="24.54"><name>Far hut</name><type>Lodging</type></wpt>
              <trk><name>Jitter trail</name><type>hiking</type><trkseg>{pts}</trkseg></trk>
            </gpx>
            """;
    }

    [Fact]
    public async Task Preview_then_import_creates_route_pois_and_keeps_the_file()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "importer");
        var gpx = Encoding.UTF8.GetBytes(SampleGpx());

        var previewRes = await http.PostAsync("/api/imports/preview", Form(gpx, "jitter.gpx"));
        var preview = await Read<ImportPreviewDto>(previewRes);
        Assert.Equal(RouteSource.Gpx, preview.Kind);
        Assert.Equal("Jitter trail", preview.Name);
        Assert.Equal([ActivityTypes.Hiking], preview.SuggestedActivityIds);
        var track = Assert.Single(preview.Tracks);
        Assert.Equal(501, track.OriginalPointCount);
        Assert.True(track.HasElevation);
        Assert.Equal(2, preview.Waypoints.Count);
        Assert.Equal(PoiTypes.Water, preview.Waypoints[0].PoiType);

        var options = new ImportOptions(0, 5, "My jitter trail", [ActivityTypes.Hiking, ActivityTypes.TrailRunning],
        [
            new WaypointChoice(0, true, "Spring (refill)", PoiTypes.Water),
            new WaypointChoice(1, true, "Far hut", 9),
        ]);
        var created = await Read<RouteDetailDto>(await http.PostAsync("/api/imports", Form(gpx, "jitter.gpx", options)));

        Assert.Equal("My jitter trail", created.Name);
        Assert.Equal(RouteSource.Gpx, created.Source);
        Assert.InRange(created.DistanceM, 5000, 6500);
        Assert.True(created.HasElevation);
        Assert.InRange(created.ControlPoints.Count, 2, 30);
        Assert.All(created.ControlPoints[..^1], cp => Assert.True(cp.Segment!.Length >= 2));

        await using var scope = api.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var pois = await db.Pois.Where(p => p.RouteId == created.Id).OrderBy(p => p.Name).ToListAsync();
        Assert.Equal(2, pois.Count);
        var spring = pois.Single(p => p.Name == "Spring (refill)");
        Assert.InRange(spring.DistanceAlongM!.Value, 2000, 2600);   // ~2.2 km up the trail
        Assert.Null(pois.Single(p => p.Name == "Far hut").DistanceAlongM);   // 2 km off the track
        Assert.True(await db.SourceFiles.AnyAsync(f => f.RouteId == created.Id && f.Content.Length == gpx.Length));

        var summary = Assert.Single((await http.GetFromJsonAsync<List<RouteSummaryDto>>("/api/routes", Json))!);
        Assert.Equal(2, summary.PoiCount);
    }

    [Fact]
    public async Task Higher_tolerance_means_fewer_points()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "simplifier");
        var gpx = Encoding.UTF8.GetBytes(SampleGpx());

        async Task<int> PointsAt(double tol)
        {
            var r = await Read<RouteDetailDto>(await http.PostAsync("/api/imports",
                Form(gpx, "t.gpx", new ImportOptions(0, tol, null, [ActivityTypes.Hiking], []))));
            return RouteDrawing.BuildLine(r.ControlPoints).Count;
        }

        var fine = await PointsAt(0);
        var coarse = await PointsAt(20);
        Assert.True(coarse < fine / 3, $"0 m: {fine} points, 20 m: {coarse} points");
    }

    [Fact]
    public async Task Fit_course_imports_with_course_points_as_pois()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "fitter");
        var fit = FitCourse();

        var preview = await Read<ImportPreviewDto>(await http.PostAsync("/api/imports/preview", Form(fit, "pyha.fit")));
        Assert.Equal(RouteSource.FitCourse, preview.Kind);
        Assert.Equal("Pyhä ridge", preview.Name);
        Assert.Equal(["Summit", "SlightLeft"], preview.Waypoints.Select(w => w.SourceType));
        Assert.Equal([true, false], preview.Waypoints.Select(w => w.Include));

        var choices = preview.Waypoints.Select((w, i) => new WaypointChoice(i, w.Include, w.Name, w.PoiType)).ToList();
        var created = await Read<RouteDetailDto>(await http.PostAsync("/api/imports",
            Form(fit, "pyha.fit", new ImportOptions(0, 5, null, preview.SuggestedActivityIds, choices))));

        Assert.Equal(RouteSource.FitCourse, created.Source);
        Assert.Equal("Pyhä ridge", created.Name);
        await using var scope = api.Services.CreateAsyncScope();
        var poi = Assert.Single(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Pois.Where(p => p.RouteId == created.Id).ToListAsync());
        Assert.Equal(("Pyhä summit", PoiTypes.Peak), (poi.Name, poi.PoiType));
        Assert.NotNull(poi.DistanceAlongM);
    }

    /// <summary>A small FIT course: 60 records going north-east, a summit and a turn instruction.</summary>
    private static byte[] FitCourse()
    {
        static int Semi(double deg) => (int)Math.Round(deg * 2147483648.0 / 180.0);
        var t0 = new System.DateTime(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc);
        using var ms = new MemoryStream();
        var enc = new Dynastream.Fit.Encode(ms, Dynastream.Fit.ProtocolVersion.V20);
        var id = new Dynastream.Fit.FileIdMesg();
        id.SetType(Dynastream.Fit.File.Course);
        enc.Write(id);
        var course = new Dynastream.Fit.CourseMesg();
        course.SetName("Pyhä ridge");
        course.SetSport(Dynastream.Fit.Sport.Hiking);
        enc.Write(course);
        for (var i = 0; i < 60; i++)
        {
            var r = new Dynastream.Fit.RecordMesg();
            r.SetTimestamp(new Dynastream.Fit.DateTime(t0.AddSeconds(i * 20)));
            r.SetPositionLat(Semi(67.00 + i * 0.0005));
            r.SetPositionLong(Semi(27.10 + i * 0.0008));
            r.SetEnhancedAltitude(300 + i * 3);
            enc.Write(r);
        }
        foreach (var (lat, lon, type, name) in new[]
                 {
                     (67.015, 27.124, Dynastream.Fit.CoursePoint.Summit, "Pyhä summit"),
                     (67.025, 27.140, Dynastream.Fit.CoursePoint.SlightLeft, "Bear left"),
                 })
        {
            var cp = new Dynastream.Fit.CoursePointMesg();
            cp.SetTimestamp(new Dynastream.Fit.DateTime(t0));
            cp.SetPositionLat(Semi(lat));
            cp.SetPositionLong(Semi(lon));
            cp.SetType(type);
            cp.SetName(name);
            enc.Write(new Dynastream.Fit.MesgDefinition(cp));   // see FitFixtures: avoids reused string-field definitions
            enc.Write(cp);
        }
        enc.Close();
        return ms.ToArray();
    }

    [Fact]
    public async Task Unreadable_file_and_missing_file_are_rejected()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "careless");

        var bad = await http.PostAsync("/api/imports/preview", Form("this is not gpx"u8.ToArray(), "notes.gpx"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, bad.StatusCode);
        Assert.Contains("XML", (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("title").GetString(), StringComparison.Ordinal);

        var none = await http.PostAsync("/api/imports/preview", new MultipartFormDataContent());
        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
    }

    [Fact]
    public async Task Shrink_keeps_the_route_within_the_tolerance_in_the_same_format()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        var http = await TestAuth.SignInAsync(api, suunto, "shrinker");
        var gpx = Encoding.UTF8.GetBytes(SampleGpx());
        var original = ImportService.Parse(gpx, "trail.gpx");

        var res = await http.PostAsync("/api/imports/shrink", ShrinkForm(gpx, "Jitter trail.gpx", 10));
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        Assert.Equal("application/gpx+xml", res.Content.Headers.ContentType?.MediaType);
        Assert.Equal("Jitter-trail-shrunk.gpx", res.Content.Headers.ContentDisposition?.FileNameStar ?? res.Content.Headers.ContentDisposition?.FileName);
        var shrunkBytes = await res.Content.ReadAsByteArrayAsync();
        var shrunk = ImportService.Parse(shrunkBytes, "shrunk.gpx");

        var before = original.Tracks[0].Points;
        var after = shrunk.Tracks[0].Points;
        Assert.True(after.Count < before.Count / 3, $"{before.Count} → {after.Count} points");
        Assert.True(shrunkBytes.Length < gpx.Length);
        Assert.Equal((before[0], before[^1]), (after[0], after[^1]));
        Assert.All(before, p => Assert.True(Geo.Locate(after, p).OffsetM <= 10.5, $"{p} is {Geo.Locate(after, p).OffsetM:F1} m off"));
        Assert.Equal(["Spring", "Far hut"], shrunk.Waypoints.Select(w => w.Name));

        // The GPX tools count points on the preview's track; the file must have exactly that many.
        var preview = await Read<ImportPreviewDto>(await http.PostAsync("/api/imports/preview", Form(gpx, "trail.gpx")));
        var line = preview.Tracks[0].Coordinates.Select(c => new GeoPosition(c[0]!.Value, c[1]!.Value)).ToList();
        Assert.Equal(Geo.SimplifyIndices(line, 10).Count, after.Count);

        // FIT stays FIT, with recorded times kept on the points that remain.
        var fitRes = await http.PostAsync("/api/imports/shrink", ShrinkForm(FitCourse(), "pyha.fit", 5));
        Assert.True(fitRes.IsSuccessStatusCode, await fitRes.Content.ReadAsStringAsync());
        Assert.Equal("application/vnd.ant.fit", fitRes.Content.Headers.ContentType?.MediaType);
        var fit = ImportService.Parse(await fitRes.Content.ReadAsByteArrayAsync(), "shrunk.fit");
        Assert.Equal(RouteSource.FitCourse, fit.Kind);
        Assert.InRange(fit.Tracks[0].Points.Count, 2, 59);
        Assert.All(fit.Tracks[0].Times!, t => Assert.NotNull(t));

        var badTolerance = await http.PostAsync("/api/imports/shrink", ShrinkForm(gpx, "trail.gpx", 500));
        Assert.Equal(HttpStatusCode.BadRequest, badTolerance.StatusCode);
    }

    private static MultipartFormDataContent ShrinkForm(byte[] file, string name, double toleranceM)
    {
        var form = Form(file, name);
        form.Add(new StringContent(toleranceM.ToString(CultureInfo.InvariantCulture)), "toleranceM");
        return form;
    }

    private static MultipartFormDataContent Form(byte[] file, string name, ImportOptions? options = null)
    {
        var form = new MultipartFormDataContent();
        var content = new ByteArrayContent(file);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        form.Add(content, "file", name);
        if (options is not null)
            form.Add(new StringContent(JsonSerializer.Serialize(options, JsonSerializerOptions.Web)), "options");
        return form;
    }

    private static async Task<T> Read<T>(HttpResponseMessage res)
    {
        Assert.True(res.IsSuccessStatusCode, $"{(int)res.StatusCode}: {await res.Content.ReadAsStringAsync()}");
        return (await res.Content.ReadFromJsonAsync<T>(Json))!;
    }
}
