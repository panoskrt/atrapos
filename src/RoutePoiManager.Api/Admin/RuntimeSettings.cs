using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Admin;

/// <summary>Configuration the admin UI can change at runtime. Values live in the <c>app_settings</c> table and
/// override appsettings and environment variables; clearing one falls back to them. Held in memory so the
/// synchronous sign-in checks never touch the database. The app runs as a single instance, so the snapshot is
/// refreshed only by this process (at startup and on every write).</summary>
public sealed class RuntimeSettings(IServiceScopeFactory scopes, TimeProvider clock)
{
    public const string AllowedGoogleEmails = "Auth:AllowedGoogleEmails";
    public const string AllowedSuuntoUsernames = "Auth:AllowedSuuntoUsernames";

    /// <summary>The keys an admin may override.</summary>
    public static readonly IReadOnlyList<string> EditableKeys = [AllowedGoogleEmails, AllowedSuuntoUsernames];

    private volatile Dictionary<string, string> _values = [];

    /// <summary>The override for <paramref name="key"/>, or null when none is set.</summary>
    public string? Get(string key) => _values.TryGetValue(key, out var v) ? v : null;

    public async Task LoadAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        _values = await db.AppSettings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value, ct);
    }

    /// <summary>Sets an override, or removes it when <paramref name="value"/> is null.</summary>
    public async Task SetAsync(string key, string? value, string? updatedBy, CancellationToken ct)
    {
        if (!EditableKeys.Contains(key)) throw new ArgumentException($"'{key}' is not an editable setting.", nameof(key));
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.AppSettings.SingleOrDefaultAsync(s => s.Key == key, ct);
            if (value is null)
            {
                if (row is not null) db.AppSettings.Remove(row);
            }
            else if (row is null)
            {
                db.AppSettings.Add(new AppSetting { Key = key, Value = value, UpdatedAt = clock.GetUtcNow(), UpdatedBy = updatedBy });
            }
            else
            {
                row.Value = value;
                row.UpdatedAt = clock.GetUtcNow();
                row.UpdatedBy = updatedBy;
            }
            await db.SaveChangesAsync(ct);
        }
        await LoadAsync(ct);
    }
}
