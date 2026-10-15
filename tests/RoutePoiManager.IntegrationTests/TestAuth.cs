using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;

namespace RoutePoiManager.IntegrationTests;

public static class TestAuth
{
    /// <summary>Plays the browser: /auth/login → Suunto authorize page → consent → returns the callback path.</summary>
    public static async Task<string> AuthorizeAtSuuntoAsync(HttpClient browser, MockSuuntoFactory suunto, string username, bool allow)
    {
        var login = await browser.GetAsync("/auth/login");
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        var authorizeUrl = login.Headers.Location!;
        Assert.StartsWith($"{ApiFactory.MockHost}/oauth/authorize", authorizeUrl.ToString(), StringComparison.Ordinal);

        var q = QueryHelpers.ParseQuery(authorizeUrl.Query);
        var suuntoBrowser = suunto.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var page = await suuntoBrowser.GetAsync(authorizeUrl.PathAndQuery);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);

        var consent = await suuntoBrowser.PostAsync("/oauth/authorize", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = q["client_id"]!,
            ["redirect_uri"] = q["redirect_uri"]!,
            ["state"] = q["state"]!,
            ["username"] = username,
            ["decision"] = allow ? "allow" : "deny",
        }));
        Assert.Equal(HttpStatusCode.Redirect, consent.StatusCode);

        var callback = consent.Headers.Location!;
        Assert.StartsWith(ApiFactory.RedirectUri, callback.ToString(), StringComparison.Ordinal);
        return callback.PathAndQuery;
    }

    /// <summary>A browser client that is signed in to the API as <paramref name="username"/>.</summary>
    public static async Task<HttpClient> SignInAsync(ApiFactory api, MockSuuntoFactory suunto, string username)
    {
        var browser = api.CreateBrowser();
        var res = await browser.GetAsync(await AuthorizeAtSuuntoAsync(browser, suunto, username, allow: true));
        Assert.Equal(HttpStatusCode.Redirect, res.StatusCode);
        browser.DefaultRequestHeaders.Add("X-RPM-CSRF", "1");
        return browser;
    }
}
