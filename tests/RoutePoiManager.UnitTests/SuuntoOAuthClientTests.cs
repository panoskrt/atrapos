using System.Security.Claims;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using RoutePoiManager.Infrastructure.Suunto;

namespace RoutePoiManager.UnitTests;

public sealed class SuuntoOAuthClientTests
{
    private static SuuntoOAuthClient Client() => new(new HttpClient(), Options.Create(new SuuntoOptions
    {
        ClientId = "my client",
        ClientSecret = "s",
        SubscriptionKey = "k",
        AuthorizeBaseUrl = "https://cloudapi-oauth.suunto.com/",
        RedirectUri = "http://localhost:5080/auth/callback?x=1",
    }));

    [Fact]
    public void Authorize_url_escapes_parameters_and_includes_state()
    {
        var url = new Uri(Client().BuildAuthorizeUrl("st+/ate"));

        Assert.Equal("https://cloudapi-oauth.suunto.com/oauth/authorize", url.GetLeftPart(UriPartial.Path));
        Assert.Contains("response_type=code", url.Query, StringComparison.Ordinal);
        Assert.Contains("client_id=my%20client", url.Query, StringComparison.Ordinal);
        Assert.Contains("redirect_uri=http%3A%2F%2Flocalhost%3A5080%2Fauth%2Fcallback%3Fx%3D1", url.Query, StringComparison.Ordinal);
        Assert.Contains("state=st%2B%2Fate", url.Query, StringComparison.Ordinal);
    }

    [Fact]
    public void Reads_username_from_user_claim()
    {
        var token = Jwt(new Claim("user", "trailrunner_pk"));

        Assert.Equal("trailrunner_pk", SuuntoOAuthClient.ReadUsername(token));
    }

    [Fact]
    public void Token_without_user_claim_is_rejected()
    {
        var token = Jwt(new Claim("sub", "someone"));

        Assert.Throws<SuuntoAuthException>(() => SuuntoOAuthClient.ReadUsername(token));
    }

    private static string Jwt(params Claim[] claims) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Subject = new ClaimsIdentity(claims),
        SigningCredentials = new SigningCredentials(
            new SymmetricSecurityKey("unit-test-signing-key-0123456789-abcdef"u8.ToArray()), SecurityAlgorithms.HmacSha256),
    });
}
