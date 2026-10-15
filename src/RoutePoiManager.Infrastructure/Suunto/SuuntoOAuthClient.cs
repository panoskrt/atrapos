using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;

namespace RoutePoiManager.Infrastructure.Suunto;

public sealed record SuuntoTokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("token_type")] string? TokenType,
    [property: JsonPropertyName("refresh_token")] string RefreshToken,
    [property: JsonPropertyName("expires_in")] int ExpiresIn,
    [property: JsonPropertyName("scope")] string? Scope);

public sealed class SuuntoAuthException(string message, int? statusCode = null) : Exception(message)
{
    public int? StatusCode { get; } = statusCode;
}

/// <summary>Suunto OAuth2 authorization-code flow (cloudapi-oauth.suunto.com).</summary>
public sealed class SuuntoOAuthClient(HttpClient http, IOptions<SuuntoOptions> options)
{
    public const string HttpClientName = "suunto-oauth";

    private readonly SuuntoOptions _o = options.Value;

    public string BuildAuthorizeUrl(string state)
    {
        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = _o.ClientId,
            ["redirect_uri"] = _o.RedirectUri,
            ["state"] = state,
        };
        return $"{_o.AuthorizeBaseUrl.TrimEnd('/')}/oauth/authorize?{ToQuery(query)}";
    }

    public Task<SuuntoTokenResponse> ExchangeCodeAsync(string code, CancellationToken ct) =>
        RequestTokenAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = _o.RedirectUri,
        }, ct);

    public Task<SuuntoTokenResponse> RefreshAsync(string refreshToken, CancellationToken ct) =>
        RequestTokenAsync(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
        }, ct);

    /// <summary>Disconnects the user from this app on the Suunto side.</summary>
    public async Task DeauthorizeAsync(string accessToken, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get,
            $"{_o.OAuthBaseUrl.TrimEnd('/')}/oauth/deauthorize?client_id={Uri.EscapeDataString(_o.ClientId)}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
            throw new SuuntoAuthException($"Suunto deauthorize failed ({(int)res.StatusCode}).", (int)res.StatusCode);
    }

    /// <summary>Reads the Suunto username from the access token's <c>user</c> claim.</summary>
    public static string ReadUsername(string accessToken)
    {
        var jwt = new JsonWebTokenHandler().ReadJsonWebToken(accessToken);
        return jwt.TryGetPayloadValue<string>("user", out var user) && !string.IsNullOrWhiteSpace(user)
            ? user
            : throw new SuuntoAuthException("Suunto access token has no 'user' claim.");
    }

    private async Task<SuuntoTokenResponse> RequestTokenAsync(Dictionary<string, string> form, CancellationToken ct)
    {
        // Suunto documents the token parameters both as query string and as a form body;
        // the how-to-start curl example sends a form body, which is the OAuth2 standard.
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{_o.OAuthBaseUrl.TrimEnd('/')}/oauth/token")
        {
            Content = new FormUrlEncodedContent(form),
        };
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_o.ClientId}:{_o.ClientSecret}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);

        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var body = await res.Content.ReadAsStringAsync(ct);
            throw new SuuntoAuthException(
                $"Suunto token request failed ({(int)res.StatusCode}): {Truncate(body, 300)}", (int)res.StatusCode);
        }

        return await res.Content.ReadFromJsonAsync<SuuntoTokenResponse>(ct)
               ?? throw new SuuntoAuthException("Empty token response from Suunto.");
    }

    private static string ToQuery(Dictionary<string, string> q) =>
        string.Join('&', q.Select(kv => $"{kv.Key}={Uri.EscapeDataString(kv.Value)}"));

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";
}
