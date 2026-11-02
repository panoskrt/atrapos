using RoutePoiManager.Domain;

namespace RoutePoiManager.UnitTests;

public sealed class LookupTests
{
    [Fact]
    public void Poi_types_match_the_suunto_enum()
    {
        // PoiType in the POI API schema: -1..47 and 64..77.
        var expected = new[] { -1 }.Concat(Enumerable.Range(0, 48)).Concat(Enumerable.Range(64, 14));

        Assert.Equal(expected, PoiTypes.All.Select(t => t.Id));
    }

    [Theory]
    [InlineData("Water", PoiTypes.Water)]
    [InlineData("peak", PoiTypes.Peak)]
    [InlineData(" Danger ", PoiTypes.Danger)]
    [InlineData("Left_turn", PoiTypes.Poi)]   // route waypoint type with no POI equivalent
    [InlineData(null, PoiTypes.Poi)]
    public void Gpx_type_maps_case_insensitively_with_fallback(string? gpxType, int expected) =>
        Assert.Equal(expected, PoiTypes.FromGpxType(gpxType).Id);

    [Fact]
    public void Unknown_poi_type_id_resolves_to_unknown() =>
        Assert.Equal(PoiTypes.Unknown, PoiTypes.Get(55).Id);

    [Fact]
    public void Activity_ids_are_unique_and_include_common_route_sports()
    {
        Assert.Equal(ActivityTypes.All.Count, ActivityTypes.All.Select(a => a.Id).Distinct().Count());
        Assert.True(ActivityTypes.IsValid(ActivityTypes.Hiking));
        Assert.True(ActivityTypes.IsValid(ActivityTypes.TrailRunning));
        Assert.False(ActivityTypes.IsValid(89));   // not in Suunto's list
    }
}
