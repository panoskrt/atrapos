using System.Security.Claims;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.EntityFrameworkCore;
using RoutePoiManager.Api;
using RoutePoiManager.Api.Auth;
using RoutePoiManager.Api.Routes;
using RoutePoiManager.Domain;
using RoutePoiManager.Infrastructure;
using RoutePoiManager.Infrastructure.Persistence;
using Serilog;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.AddSerilog((_, lc) => lc
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console(formatProvider: CultureInfo.InvariantCulture));

builder.Services.AddOptions<AppOptions>()
    .Bind(builder.Configuration.GetSection(AppOptions.Section))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddScoped<GoogleAccountService>();
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

var authentication = builder.Services
    .AddAuthentication(o =>
    {
        o.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    })
    .AddCookie(o =>
    {
        o.Cookie.Name = "rpm.session";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        o.ExpireTimeSpan = TimeSpan.FromDays(30);
        o.SlidingExpiration = true;
        // An API never redirects to a login page; the SPA handles 401/403.
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    });

var googleClientId = builder.Configuration["Google:ClientId"];
var googleClientSecret = builder.Configuration["Google:ClientSecret"];
if (!string.IsNullOrWhiteSpace(googleClientId) && !string.IsNullOrWhiteSpace(googleClientSecret))
{
    authentication.AddGoogle(GoogleDefaults.AuthenticationScheme, o =>
    {
        o.ClientId = googleClientId;
        o.ClientSecret = googleClientSecret;
        o.CallbackPath = "/auth/google-callback";
        o.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.Events.OnCreatingTicket = async context =>
        {
            var subject = context.Identity?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (string.IsNullOrWhiteSpace(subject))
                throw new InvalidOperationException("Google did not return a stable account identifier.");

            var email = context.Identity?.FindFirst(ClaimTypes.Email)?.Value;
            var name = context.Identity?.FindFirst(ClaimTypes.Name)?.Value;
            var accounts = context.HttpContext.RequestServices.GetRequiredService<GoogleAccountService>();
            var user = await accounts.GetOrCreateAsync(subject, context.HttpContext.RequestAborted);
            var displayName = !string.IsNullOrWhiteSpace(name) ? name : email;
            context.Principal = new ClaimsPrincipal(new ClaimsIdentity(
            [
                new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new Claim(ClaimTypes.Name, displayName ?? "Google user"),
            ], CookieAuthenticationDefaults.AuthenticationScheme));
        };
        o.Events.OnRemoteFailure = context =>
        {
            context.HttpContext.RequestServices.GetRequiredService<ILogger<Program>>()
                .LogWarning(context.Failure, "Google sign-in failed");
            context.HandleResponse();
            var home = context.HttpContext.RequestServices.GetRequiredService<Microsoft.Extensions.Options.IOptions<AppOptions>>()
                .Value.PublicBaseUrl;
            context.Response.ContentType = "text/html; charset=utf-8";
            return context.Response.WriteAsync(
                AuthEndpoints.GoogleAuthPopupHtml(home, "/login?error=google_auth_failed", false, "google_auth_failed"),
                context.HttpContext.RequestAborted);
        };
    });
}
builder.Services.AddAuthorization();
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<SuuntoReauthExceptionHandler>();
builder.Services.AddExceptionHandler<SyncExceptionHandler>();
if (!builder.Environment.IsProduction())
    builder.Services.AddOpenApi();

var app = builder.Build();

if (app.Configuration.GetValue("Database:MigrateOnStartup", false))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

// OpenAPI document at /openapi/v1.json and Swagger UI at /swagger; never exposed in Production.
if (!app.Environment.IsProduction())
{
    app.MapOpenApi();
    app.UseSwaggerUI(o =>
    {
        o.SwaggerEndpoint("/openapi/v1.json", "RoutePoiManager API v1");
        // "Try it out" on unsafe /api and /auth calls needs the CSRF header the SPA sends.
        // Swashbuckle only reads parameters from "(...)", so this must not be a bare-parameter arrow function.
        o.UseRequestInterceptor($"function (req) {{ req.headers['{CsrfHeaderMiddleware.HeaderName}'] = '1'; return req; }}");
    });
}

app.UseExceptionHandler();
app.UseSerilogRequestLogging();
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseMiddleware<CsrfHeaderMiddleware>();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/healthz", async (AppDbContext db, CancellationToken ct) =>
    await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ok" }) : Results.StatusCode(503));

app.MapAuthEndpoints();
app.MapRouteEndpoints();
app.MapWeatherEndpoints();
app.MapElevationEndpoints();
app.MapRoutingEndpoints();
app.MapImportEndpoints();
app.MapSyncEndpoints();
app.MapRouteToolEndpoints();

var lookups = app.MapGroup("/api/lookups");
lookups.MapGet("/poi-types", () => PoiTypes.All.Where(t => t.Id != PoiTypes.Unknown)
    .Select(t => new { t.Id, t.Name }));
lookups.MapGet("/activity-types", () => ActivityTypes.All);

// Unknown API routes are 404s, never the SPA shell.
app.Map("/api/{**rest}", () => Results.NotFound());
app.Map("/auth/{**rest}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

await app.RunAsync();
return 0;

public partial class Program;
