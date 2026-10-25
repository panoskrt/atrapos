#!/bin/sh
# Adapts Render's runtime environment to the app's configuration, then starts the API.
set -eu

# Render tells the service which port to listen on.
export ASPNETCORE_URLS="http://+:${PORT:-10000}"

# Render exposes the database as DATABASE_URL (postgres://user:pass@host[:port]/db); Npgsql needs key=value pairs.
if [ -z "${ConnectionStrings__Db:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  rest="${DATABASE_URL#*://}"
  userinfo="${rest%%@*}"
  hostpart="${rest#*@}"
  user="${userinfo%%:*}"
  pass="${userinfo#*:}"
  hostport="${hostpart%%/*}"
  db="${hostpart#*/}"
  db="${db%%\?*}"
  host="${hostport%%:*}"
  case "$hostport" in
    *:*) port="${hostport##*:}" ;;
    *) port=5432 ;;
  esac
  export ConnectionStrings__Db="Host=${host};Port=${port};Database=${db};Username=${user};Password=${pass}"
fi

# Accept the short .env names too (as in env.example); the double-underscore names win when both are set.
map_env() { # map_env SHORT_NAME Section__Name
  eval "short=\${$1:-}"
  eval "long=\${$2:-}"
  if [ -z "$long" ] && [ -n "$short" ]; then export "$2=$short"; fi
}
map_env SUUNTO_CLIENT_ID Suunto__ClientId
map_env SUUNTO_CLIENT_SECRET Suunto__ClientSecret
map_env SUUNTO_SUBSCRIPTION_KEY Suunto__SubscriptionKey
map_env SUUNTO_DIAGNOSTICS Suunto__DiagnosticLogging
map_env GOOGLE_CLIENT_ID Google__ClientId
map_env GOOGLE_CLIENT_SECRET Google__ClientSecret
map_env ALLOWED_GOOGLE_EMAILS Auth__AllowedGoogleEmails
map_env ALLOWED_SUUNTO_USERNAMES Auth__AllowedSuuntoUsernames
map_env REQUIRE_OAUTH_STATE App__RequireOAuthState
map_env MAX_UPLOAD_MB Uploads__MaxFileSizeMb
map_env FORWARDED_HEADERS Hosting__ForwardedHeaders
map_env TRUSTED_PROXIES Hosting__TrustedProxies
map_env HSTS Hosting__Hsts

# Default the public URLs to the service's own Render URL; set them explicitly when using a custom domain.
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export App__PublicBaseUrl="${App__PublicBaseUrl:-$RENDER_EXTERNAL_URL}"
  export Suunto__RedirectUri="${Suunto__RedirectUri:-${App__PublicBaseUrl}/auth/callback}"
fi

exec dotnet RoutePoiManager.Api.dll
