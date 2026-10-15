using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Xml.Linq;

namespace RoutePoiManager.MockSuunto;

public sealed class MockOptions
{
    public string ClientId { get; set; } = "mock-client";
    public string ClientSecret { get; set; } = "mock-secret";
    public string SubscriptionKey { get; set; } = "mock-subscription-key";
    public int AccessTokenLifetimeSeconds { get; set; } = 86400;
    public string SigningKey { get; set; } = "mock-suunto-signing-key-not-a-secret-0123456789";
}

public sealed record AuthCode(string Username, string ClientId, string RedirectUri, DateTimeOffset ExpiresAt);

public sealed record AccessSession(string Username, DateTimeOffset ExpiresAt);

public sealed class MockRoute
{
    public required string Id { get; init; }
    public required string Username { get; init; }
    public required XDocument Gpx { get; set; }
    public long Revision { get; set; }
    public long Created { get; init; }
    public long Modified { get; set; }
    public int[] ActivityIds { get; set; } = [1];
}

public sealed class MockPoi
{
    public required string Key { get; init; }
    public required string Username { get; init; }
    public required JsonObject Body { get; set; }
}

/// <summary>In-memory state of the fake Suunto cloud. Lost on restart, by design.</summary>
public sealed class MockStore(TimeProvider clock)
{
    public ConcurrentDictionary<string, AuthCode> Codes { get; } = new();
    public ConcurrentDictionary<string, AccessSession> AccessTokens { get; } = new();
    public ConcurrentDictionary<string, string> RefreshTokens { get; } = new();
    public ConcurrentDictionary<string, MockRoute> Routes { get; } = new();
    public ConcurrentDictionary<string, MockPoi> Pois { get; } = new();

    private int _rejectNextPoi;

    public void RejectNextPoi(int errorCode) => Interlocked.Exchange(ref _rejectNextPoi, errorCode);

    /// <summary>The pending rejection error code, if any (consumed).</summary>
    public int? TakePoiRejection() => Interlocked.Exchange(ref _rejectNextPoi, 0) is var c and not 0 ? c : null;

    private readonly Lock _revisionLock = new();
    private long _lastRevision;

    public DateTimeOffset Now => clock.GetUtcNow();

    /// <summary>Monotonic epoch-millisecond revision, like Suunto's <c>suunto:revision</c>.</summary>
    public long NextRevision()
    {
        lock (_revisionLock)
        {
            _lastRevision = Math.Max(Now.ToUnixTimeMilliseconds(), _lastRevision + 1);
            return _lastRevision;
        }
    }

    /// <summary>24 hex chars, the shape of Suunto route ids and POI keys.</summary>
    public static string NewObjectId() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(12));

    public static string NewOpaqueToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public void RevokeUser(string username)
    {
        foreach (var (token, session) in AccessTokens)
            if (session.Username == username) AccessTokens.TryRemove(token, out _);
        foreach (var (token, user) in RefreshTokens)
            if (user == username) RefreshTokens.TryRemove(token, out _);
    }
}
