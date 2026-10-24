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
        Assert.Equal(new UserSettingsDto("topo", "metric", "dark"), initial);

        var updated = new UserSettingsDto("cyclosm", "imperial", "light");
        var response = await browser.PutAsJsonAsync("/api/settings", updated);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(updated, await response.Content.ReadFromJsonAsync<UserSettingsDto>());
        Assert.Equal(updated, await browser.GetFromJsonAsync<UserSettingsDto>("/api/settings"));

        await using var scope = api.Services.CreateAsyncScope();
        var user = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.SingleAsync();
        Assert.Equal("cyclosm", user.DefaultMap);
        Assert.Equal("imperial", user.Units);
        Assert.Equal("light", user.Theme);
    }

    [Theory]
    [InlineData("unknown", "metric", "dark")]
    [InlineData("topo", "kelvin", "dark")]
    [InlineData("topo", "metric", "system")]
    public async Task Settings_reject_unknown_values(string defaultMap, string units, string theme)
    {
        await using var suunto = new MockSuuntoFactory();
        await using var api = new ApiFactory(pg, suunto);
        using var browser = await TestAuth.SignInAsync(api, suunto, "invalid-settings-user");

        var response = await browser.PutAsJsonAsync("/api/settings", new UserSettingsDto(defaultMap, units, theme));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
