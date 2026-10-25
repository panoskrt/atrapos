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

# Default the public URLs to the service's own Render URL; set them explicitly when using a custom domain.
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export App__PublicBaseUrl="${App__PublicBaseUrl:-$RENDER_EXTERNAL_URL}"
  export Suunto__RedirectUri="${Suunto__RedirectUri:-${App__PublicBaseUrl}/auth/callback}"
fi

exec dotnet RoutePoiManager.Api.dll
