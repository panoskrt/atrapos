using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure.Persistence;

namespace RoutePoiManager.Api.Auth;

public sealed class GoogleAccountService(AppDbContext db, TimeProvider clock)
{
    public async Task<User> GetOrCreateAsync(string subject, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.GoogleSubject == subject, ct);
        if (user is not null)
            return user;

        user = new User
        {
            Id = Guid.CreateVersion7(),
            GoogleSubject = subject,
            AccessTokenProtected = "",
            RefreshTokenProtected = "",
            AccessTokenExpiresAt = DateTimeOffset.MinValue,
            CreatedAt = clock.GetUtcNow(),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return user;
    }
}
