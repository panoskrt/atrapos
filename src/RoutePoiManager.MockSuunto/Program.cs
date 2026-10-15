using RoutePoiManager.MockSuunto;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<MockOptions>(builder.Configuration.GetSection("Mock"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<MockStore>();

var app = builder.Build();

app.MapGet("/", () => Results.Text(
    "Mock Suunto cloud for local development. OAuth: /oauth/*, Cloud API: /v2/route, /v2/poi."));
app.MapMockOAuth();
app.MapMockCloudApi();

await app.RunAsync();

public partial class Program;
