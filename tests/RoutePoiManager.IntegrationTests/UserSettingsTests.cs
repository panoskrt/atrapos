using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.IntegrationTests;

[Collection(IntegrationCollection.Name)]
public sealed class UserSettingsTests(PostgresFixture pg)
{
    [Fact]
    public async Task Settings_are_authenticated_and_persisted_for_the_user()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        using var anonymous = api.CreateBrowser();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/settings")).StatusCode);

        using var browser = await TestAuth.SignInAsync(api, suunto, "settings-user");
        var initial = await browser.GetFromJsonAsync<UserSettingsDto>("/api/settings");
        AssertSettings(initial, new UserSettingsDto("topo", "metric", "dark", "classic", [11, 22, 1, 70, 10, 2, 0, 99, 31, 3], null, "left"));

        var updated = new UserSettingsDto("cyclosm", "imperial", "light", "alpine", [2, 99], "gravel", "top");
        var response = await browser.PutAsJsonAsync("/api/settings", updated);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertSettings(await response.Content.ReadFromJsonAsync<UserSettingsDto>(), updated);
        AssertSettings(await browser.GetFromJsonAsync<UserSettingsDto>("/api/settings"), updated);

        await using var scope = api.Services.CreateAsyncScope();
        var user = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.SingleAsync();
        Assert.Equal("cyclosm", user.DefaultMap);
        Assert.Equal("imperial", user.Units);
        Assert.Equal("light", user.Theme);
        Assert.Equal("alpine", user.Design);
        Assert.Equal([2, 99], user.FavoriteActivityIds);
        Assert.Equal("gravel", user.DefaultRoutingProfile);
        Assert.Equal("top", user.MenuPosition);

        // A client that doesn't know about the menu position keeps the stored choice.
        var withoutMenu = await browser.PutAsJsonAsync("/api/settings", updated with { MenuPosition = null });
        Assert.Equal("top", (await withoutMenu.Content.ReadFromJsonAsync<UserSettingsDto>())!.MenuPosition);
    }

    [Fact]
    public async Task Settings_reject_invalid_favorite_sports_and_routing_profiles()
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        using var browser = await TestAuth.SignInAsync(api, suunto, "invalid-routing-settings-user");

        var invalidFavorite = await browser.PutAsJsonAsync(
            "/api/settings", new UserSettingsDto("topo", "metric", "dark", "classic", [999]));
        var invalidProfile = await browser.PutAsJsonAsync(
            "/api/settings", new UserSettingsDto("topo", "metric", "dark", "classic", [], "unknown"));
        var invalidMenu = await browser.PutAsJsonAsync(
            "/api/settings", new UserSettingsDto("topo", "metric", "dark", "classic", [], null, "bottom"));

        Assert.Equal(HttpStatusCode.BadRequest, invalidFavorite.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidProfile.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidMenu.StatusCode);
    }

    private static void AssertSettings(UserSettingsDto? actual, UserSettingsDto expected)
    {
        Assert.NotNull(actual);
        Assert.Equal(expected.DefaultMap, actual.DefaultMap);
        Assert.Equal(expected.Units, actual.Units);
        Assert.Equal(expected.Theme, actual.Theme);
        Assert.Equal(expected.Design, actual.Design);
        Assert.Equal(expected.FavoriteActivityIds, actual.FavoriteActivityIds);
        Assert.Equal(expected.DefaultRoutingProfile, actual.DefaultRoutingProfile);
        Assert.Equal(expected.MenuPosition, actual.MenuPosition);
    }

    [Theory]
    [InlineData("unknown", "metric", "dark", "classic")]
    [InlineData("topo", "kelvin", "dark", "classic")]
    [InlineData("topo", "metric", "system", "classic")]
    [InlineData("topo", "metric", "dark", "neon")]
    public async Task Settings_reject_unknown_values(string defaultMap, string units, string theme, string design)
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        using var browser = await TestAuth.SignInAsync(api, suunto, "invalid-settings-user");

        var response = await browser.PutAsJsonAsync("/api/settings", new UserSettingsDto(defaultMap, units, theme, design));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
