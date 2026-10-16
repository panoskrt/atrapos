using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using RoutePoiManager.Infrastructure.Elevation;
using RoutePoiManager.Infrastructure.Import;
using RoutePoiManager.Infrastructure.Persistence;
using RoutePoiManager.Infrastructure.Routing;
using RoutePoiManager.Infrastructure.Suunto;
using RoutePoiManager.Infrastructure.Sync;
using RoutePoiManager.Infrastructure.Weather;

namespace RoutePoiManager.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        services.AddOptions<SuuntoOptions>()
            .Bind(config.GetSection(SuuntoOptions.Section))
            .ValidateDataAnnotations()
            .ValidateOnStart();

        var connectionString = config.GetConnectionString("Db")
            ?? throw new InvalidOperationException("Connection string 'Db' is not configured.");
        services.AddDbContext<AppDbContext>(o => o
            .UseNpgsql(connectionString, npg => npg.UseNetTopologySuite())
            .UseSnakeCaseNamingConvention());

        services.AddDataProtection()
            .SetApplicationName("RoutePoiManager")
            .PersistKeysToDbContext<AppDbContext>();

        services.AddSingleton(TimeProvider.System);

        // No resilience handler on OAuth: token exchange is not idempotent (codes are single-use).
        services.AddHttpClient<SuuntoOAuthClient>(SuuntoOAuthClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddScoped<SuuntoTokenService>();

        services.AddHttpClient<SuuntoApiClient>(SuuntoApiClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(60))
            .AddStandardResilienceHandler(o =>
            {
                // A retried POST /v2/route/import or /v2/poi/create could create duplicates on Suunto.
                o.Retry.DisableForUnsafeHttpMethods();
                o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(20);
                o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(55);
                o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(40);
            });
        services.AddScoped<RouteSyncService>();
        services.AddScoped<PoiSyncService>();
        services.AddScoped<SuuntoRefreshService>();

        services.AddOptions<ElevationOptions>().Bind(config.GetSection(ElevationOptions.Section));
        services.AddMemoryCache(o => o.SizeLimit = 500_000);
        services.AddSingleton<ElevationRateGate>();
        services.AddScoped<ElevationService>();
        if (config.GetValue(ElevationOptions.Section + ":Provider", ElevationProviderKind.OpenTopoData) == ElevationProviderKind.None)
        {
            services.AddSingleton<IElevationProvider, NoElevationProvider>();
        }
        else
        {
            services.AddHttpClient<IElevationProvider, OpenTopoDataProvider>(OpenTopoDataProvider.HttpClientName, c =>
                {
                    c.Timeout = TimeSpan.FromSeconds(60);
                    c.DefaultRequestHeaders.UserAgent.ParseAdd("RoutePoiManager/0.1 (personal route planner)");
                })
                .AddStandardResilienceHandler(o =>
                {
                    o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(15);
                    o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(45);
                    o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
                });
        }

        services.AddScoped<ImportService>();

        services.AddHttpClient<IWeatherProvider, OpenMeteoWeatherProvider>(OpenMeteoWeatherProvider.HttpClientName, c =>
            {
                c.BaseAddress = new Uri("https://api.open-meteo.com/");
                c.Timeout = TimeSpan.FromSeconds(15);
                c.DefaultRequestHeaders.UserAgent.ParseAdd("RoutePoiManager/0.1 (route weather forecast)");
            })
            .AddStandardResilienceHandler(o =>
            {
                o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(8);
                o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(25);
                o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
            });
        services.AddScoped<RouteWeatherService>();

        services.AddOptions<RoutingOptions>().Bind(config.GetSection(RoutingOptions.Section));
        services.AddSingleton<RoutingConcurrencyGate>();
        services.AddScoped<RoutingService>();
        // No resilience handler: a slow route should fail fast to a straight segment, not retry for a minute.
        services.AddHttpClient<IRoutingProvider, BRouterProvider>(BRouterProvider.HttpClientName, c =>
        {
            c.Timeout = TimeSpan.FromSeconds(30);
            c.DefaultRequestHeaders.UserAgent.ParseAdd("RoutePoiManager/0.1 (personal route planner)");
        });

        return services;
    }
}
