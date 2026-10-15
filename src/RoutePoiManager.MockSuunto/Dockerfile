# Build context: repository root.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props ./
COPY src/RoutePoiManager.MockSuunto/RoutePoiManager.MockSuunto.csproj src/RoutePoiManager.MockSuunto/
RUN dotnet restore src/RoutePoiManager.MockSuunto/RoutePoiManager.MockSuunto.csproj
COPY src/RoutePoiManager.MockSuunto/ src/RoutePoiManager.MockSuunto/
RUN dotnet publish src/RoutePoiManager.MockSuunto/RoutePoiManager.MockSuunto.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "RoutePoiManager.MockSuunto.dll"]
