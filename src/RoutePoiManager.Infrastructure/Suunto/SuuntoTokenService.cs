using System.Collections.Concurrent;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Infrastructure.Suunto;

/// <summary>The user must sign in with Suunto again (tokens revoked, missing or refresh rejected).</summary>
public sealed class SuuntoReauthRequiredException(string message) : Exception(message);

/// <summary>This app account has no linked Suunto connection.</summary>
public sealed class SuuntoNotConnectedException(string message) : Exception(message);

/// <summary>Stores Suunto tokens encrypted at rest and hands out a valid access token, refreshing when needed.</summary>
public sealed class SuuntoTokenService(
    AppDbContext db,
    SuuntoOAuthClient oauth,
    IDataProtectionProvider dataProtection,
    IOptions<SuuntoOptions> options,
    TimeProvider clock,
    ILogger<SuuntoTokenService> logger)
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> RefreshLocks = new();
    private readonly IDataProtector _protector = dataProtection.CreateProtector("Suunto.Tokens.v1");

    /// <summary>Creates or updates the user for a fresh token response and stores the tokens.</summary>
    public async Task<User> SaveTokensAsync(SuuntoTokenResponse tokens, CancellationToken ct)
    {
        var username = SuuntoOAuthClient.ReadUsername(tokens.AccessToken);
        var now = clock.GetUtcNow();
        if (options.Value.DiagnosticLogging)
            logger.LogInformation(
                "Suunto diagnostics token: type {TokenType}, expires_in {ExpiresIn}s, scope {Scope}, refresh token {HasRefresh}",
                tokens.TokenType, tokens.ExpiresIn, tokens.Scope, !string.IsNullOrEmpty(tokens.RefreshToken));

        var user = await db.Users.SingleOrDefaultAsync(u => u.SuuntoUsername == username, ct);
        if (user is null)
        {
            user = new User
            {
                Id = Guid.CreateVersion7(),
                SuuntoUsername = username,
                AccessTokenProtected = "",
                RefreshTokenProtected = "",
                CreatedAt = now,
            };
            db.Users.Add(user);
        }

        Apply(user, tokens, now);
        await db.SaveChangesAsync(ct);
        return user;
    }

    public async Task<string> GetAccessTokenAsync(Guid userId, CancellationToken ct)
    {
        var user = await LoadConnectedUserAsync(userId, ct);
        if (!NeedsRefresh(user))
            return _protector.Unprotect(user.AccessTokenProtected);

        var gate = RefreshLocks.GetOrAdd(userId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            // Another request may have refreshed while we waited.
            await db.Entry(user).ReloadAsync(ct);
            if (!NeedsRefresh(user))
                return _protector.Unprotect(user.AccessTokenProtected);

            SuuntoTokenResponse tokens;
            try
            {
                tokens = await oauth.RefreshAsync(_protector.Unprotect(user.RefreshTokenProtected), ct);
            }
            catch (SuuntoAuthException ex) when (ex.StatusCode is 400 or 401 or 403)
            {
                logger.LogWarning("Suunto refresh rejected for {User}: {Status}", user.SuuntoUsername, ex.StatusCode);
                throw new SuuntoReauthRequiredException("Suunto session expired. Sign in again.");
            }

            Apply(user, tokens, clock.GetUtcNow());
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Refreshed Suunto access token for {User}", user.SuuntoUsername);
            return tokens.AccessToken;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>Revokes this app's access on Suunto (best effort) and forgets the tokens.
    /// Local routes and POIs are kept.</summary>
    public async Task DisconnectAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            return;

        if (user.AccessTokenProtected.Length > 0)
        {
            try
            {
                var token = await GetAccessTokenAsync(userId, ct);
                await oauth.DeauthorizeAsync(token, ct);
            }
            catch (Exception ex) when (ex is SuuntoAuthException or SuuntoReauthRequiredException or HttpRequestException)
            {
                logger.LogWarning(ex, "Suunto deauthorize failed for {User}; clearing tokens anyway", user.SuuntoUsername);
            }
        }

        user.AccessTokenProtected = "";
        user.RefreshTokenProtected = "";
        user.AccessTokenExpiresAt = DateTimeOffset.MinValue;
        await db.SaveChangesAsync(ct);
    }

    private async Task<User> LoadConnectedUserAsync(Guid userId, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null)
            throw new SuuntoReauthRequiredException("Suunto account not found. Sign in again.");
        if (user.RefreshTokenProtected.Length == 0)
            throw new SuuntoNotConnectedException(
                "This app account isn't connected to Suunto. Suunto sign-in uses a separate app account.");
        return user;
    }

    private bool NeedsRefresh(User user) =>
        user.AccessTokenExpiresAt - options.Value.RefreshSkew <= clock.GetUtcNow();

    private void Apply(User user, SuuntoTokenResponse tokens, DateTimeOffset now)
    {
        user.AccessTokenProtected = _protector.Protect(tokens.AccessToken);
        // Keep the old refresh token if Suunto doesn't rotate it.
        if (!string.IsNullOrEmpty(tokens.RefreshToken))
            user.RefreshTokenProtected = _protector.Protect(tokens.RefreshToken);
        user.AccessTokenExpiresAt = now.AddSeconds(tokens.ExpiresIn);
    }
}
