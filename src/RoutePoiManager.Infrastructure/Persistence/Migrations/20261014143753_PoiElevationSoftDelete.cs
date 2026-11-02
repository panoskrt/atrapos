using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace RoutePoiManager.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PoiElevationSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "deleted_at",
                table: "pois",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "elevation_m",
                table: "pois",
                type: "double precision",
                nullable: true);

            // Keep imported elevations (stored as Z, 0 meaning unknown), then drop Z. A plain ALTER TYPE
            // can't convert PointZ to Point without the USING clause.
            migrationBuilder.Sql("UPDATE pois SET elevation_m = NULLIF(ST_Z(location), 0);");
            migrationBuilder.Sql(
                "ALTER TABLE pois ALTER COLUMN location TYPE geometry(Point,4326) USING ST_Force2D(location);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE pois ALTER COLUMN location TYPE geometry(PointZ,4326) USING ST_Force3DZ(location, COALESCE(elevation_m, 0));");

            migrationBuilder.DropColumn(
                name: "deleted_at",
                table: "pois");

            migrationBuilder.DropColumn(
                name: "elevation_m",
                table: "pois");
        }
    }
}
