extern alias mock;

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using RoutePoiManager.Infrastructure.Suunto;
using Testcontainers.PostgreSql;
using MockProgram = mock::Program;

namespace RoutePoiManager.IntegrationTests;

/// <summary>One PostGIS container for the whole test run.</summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgis/postgis:17-3.5")
        .WithDatabase("routepoi_tests")
        .Build();

    public string ConnectionString(string database) =>
        new Npgsql.NpgsqlConnectionStringBuilder(_container.GetConnectionString()) { Database = database }.ConnectionString;

    public Task InitializeAsync() => _container.StartAsync();

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();
}

[CollectionDefinition(Name)]
public sealed class IntegrationCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "integration";
}

public sealed class MockSuuntoFactory(int accessTokenLifetimeSeconds = 86400) : WebApplicationFactory<MockProgram>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseSetting("Mock:AccessTokenLifetimeSeconds", accessTokenLifetimeSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
}

/// <summary>The API wired to an in-memory mock Suunto and a fresh database per factory.</summary>
public sealed class ApiFactory(
    PostgresFixture pg,
    MockSuuntoFactory suunto,
    Action<IServiceCollection>? configureServices = null) : WebApplicationFactory<Program>
{
    public const string MockHost = "http://mock-suunto";
    public const string PublicBaseUrl = "http://localhost:5173";
    public const string RedirectUri = "http://localhost/auth/callback";

    private readonly string _database = "t_" + Guid.NewGuid().ToString("N")[..12];

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Db", pg.ConnectionString(_database));
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("App:PublicBaseUrl", PublicBaseUrl);
        // The app defaults to the real Suunto; tests always run against the in-memory mock.
        builder.UseSetting("Suunto:Mode", "Mock");
        builder.UseSetting("Suunto:ClientId", "mock-client");
        builder.UseSetting("Suunto:ClientSecret", "mock-secret");
        builder.UseSetting("Suunto:SubscriptionKey", "mock-subscription-key");
        builder.UseSetting("Suunto:DiagnosticLogging", "false");
        builder.UseSetting("Suunto:AuthorizeBaseUrl", MockHost);
        builder.UseSetting("Suunto:OAuthBaseUrl", MockHost);
        builder.UseSetting("Suunto:ApiBaseUrl", MockHost);
        builder.UseSetting("Suunto:RedirectUri", RedirectUri);
        // Never call the public elevation API from tests.
        builder.UseSetting("Elevation:Provider", "None");

        builder.ConfigureServices(services =>
        {
            services.AddHttpClient(SuuntoOAuthClient.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => suunto.Server.CreateHandler());
            services.AddHttpClient(SuuntoApiClient.HttpClientName)
                .ConfigurePrimaryHttpMessageHandler(() => suunto.Server.CreateHandler());
            configureServices?.Invoke(services);
        });
    }

    public HttpClient CreateBrowser() =>
        CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, HandleCookies = true });
}
