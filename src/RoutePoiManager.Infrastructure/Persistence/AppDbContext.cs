using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using RoutePoiManager.Domain;

namespace RoutePoiManager.Infrastructure.Persistence;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options)
    : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Route> Routes => Set<Route>();
    public DbSet<Poi> Pois => Set<Poi>();
    public DbSet<SourceFile> SourceFiles => Set<SourceFile>();
    public DbSet<SyncLogEntry> SyncLog => Set<SyncLogEntry>();
    public DbSet<ErrorLog> ErrorLogs => Set<ErrorLog>();
    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var b = modelBuilder;
        b.HasPostgresExtension("postgis");

        b.Entity<User>(e =>
        {
            e.HasIndex(u => u.SuuntoUsername).IsUnique();
            e.Property(u => u.SuuntoUsername).HasMaxLength(200);
            e.HasIndex(u => u.GoogleSubject).IsUnique();
            e.Property(u => u.GoogleSubject).HasMaxLength(255);
        });

        b.Entity<Route>(e =>
        {
            e.Property(r => r.Name).HasMaxLength(200);
            e.Property(r => r.RoutingProfile).HasMaxLength(64);
            e.Property(r => r.SuuntoRouteId).HasMaxLength(64);
            e.Property(r => r.Geometry).HasColumnType("geometry(LineStringZ,4326)");
            // Plain jsonb: segments are nested arrays, which EF's owned-JSON mapping doesn't support.
            e.Property(r => r.ControlPoints)
                .HasColumnType("jsonb")
                .HasConversion(
                    v => JsonSerializer.Serialize(v, JsonOptions),
                    v => JsonSerializer.Deserialize<List<ControlPoint>>(v, JsonOptions) ?? new List<ControlPoint>(),
                    new ValueComparer<List<ControlPoint>>(
                        (a, b) => JsonSerializer.Serialize(a, JsonOptions) == JsonSerializer.Serialize(b, JsonOptions),
                        v => JsonSerializer.Serialize(v, JsonOptions).GetHashCode(StringComparison.Ordinal),
                        v => JsonSerializer.Deserialize<List<ControlPoint>>(JsonSerializer.Serialize(v, JsonOptions), JsonOptions)!));
            e.HasIndex(r => r.UserId);
            e.HasIndex(r => new { r.UserId, r.SuuntoRouteId }).IsUnique().HasFilter("suunto_route_id IS NOT NULL");
            e.HasOne<User>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(r => r.Pois).WithOne().HasForeignKey(p => p.RouteId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Poi>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(200);
            e.Property(p => p.SuuntoPoiKey).HasMaxLength(64);
            e.Property(p => p.Location).HasColumnType("geometry(Point,4326)");
            e.HasQueryFilter(p => p.DeletedAt == null);
            e.HasIndex(p => p.UserId);
            e.HasIndex(p => new { p.UserId, p.SuuntoPoiKey }).IsUnique().HasFilter("suunto_poi_key IS NOT NULL");
            e.HasOne<User>().WithMany().HasForeignKey(p => p.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SourceFile>(e =>
        {
            e.Property(s => s.FileName).HasMaxLength(260);
            e.HasOne<Route>().WithMany().HasForeignKey(s => s.RouteId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<SyncLogEntry>(e =>
        {
            e.Property(s => s.Entity).HasMaxLength(16);
            e.Property(s => s.Operation).HasMaxLength(32);
            e.HasIndex(s => new { s.UserId, s.At });
            e.HasOne<User>().WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<ErrorLog>(e =>
        {
            e.Property(x => x.Username).HasMaxLength(200);
            e.Property(x => x.Operation).HasMaxLength(200);
            e.Property(x => x.ExceptionType).HasMaxLength(200);
            e.Property(x => x.RequestPath).HasMaxLength(500);
            e.HasIndex(x => x.At);
            e.HasIndex(x => x.UserId);
        });
    }
}
