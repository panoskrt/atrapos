# Build context: repository root.

FROM node:24-alpine AS web
WORKDIR /web
COPY src/web/package.json src/web/package-lock.json ./
RUN npm ci
COPY src/web/ ./
RUN rm -rf node_modules && npm ci
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY src/RoutePoiManager.Domain/RoutePoiManager.Domain.csproj src/RoutePoiManager.Domain/
COPY src/RoutePoiManager.Infrastructure/RoutePoiManager.Infrastructure.csproj src/RoutePoiManager.Infrastructure/
COPY src/RoutePoiManager.Api/RoutePoiManager.Api.csproj src/RoutePoiManager.Api/
RUN dotnet restore src/RoutePoiManager.Api/RoutePoiManager.Api.csproj
COPY src/RoutePoiManager.Domain/ src/RoutePoiManager.Domain/
COPY src/RoutePoiManager.Infrastructure/ src/RoutePoiManager.Infrastructure/
COPY src/RoutePoiManager.Api/ src/RoutePoiManager.Api/
RUN dotnet publish src/RoutePoiManager.Api/RoutePoiManager.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
COPY --from=web /web/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "RoutePoiManager.Api.dll"]
