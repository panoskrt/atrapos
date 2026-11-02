using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RoutePoiManager.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateTable(
                name: "data_protection_keys",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    friendly_name = table.Column<string>(type: "text", nullable: true),
                    xml = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_data_protection_keys", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    suunto_username = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    access_token_protected = table.Column<string>(type: "text", nullable: false),
                    refresh_token_protected = table.Column<string>(type: "text", nullable: false),
                    access_token_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_suunto_refresh_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "routes",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    activity_ids = table.Column<int[]>(type: "integer[]", nullable: false),
                    turn_waypoints_enabled = table.Column<bool>(type: "boolean", nullable: false),
                    routing_profile = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    geometry = table.Column<LineString>(type: "geometry(LineStringZ,4326)", nullable: true),
                    simplify_tolerance_m = table.Column<double>(type: "double precision", nullable: false),
                    distance_m = table.Column<double>(type: "double precision", nullable: false),
                    ascent_m = table.Column<double>(type: "double precision", nullable: false),
                    descent_m = table.Column<double>(type: "double precision", nullable: false),
                    source = table.Column<int>(type: "integer", nullable: false),
                    suunto_route_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    suunto_revision = table.Column<long>(type: "bigint", nullable: true),
                    suunto_modified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_pushed_hash = table.Column<string>(type: "text", nullable: true),
                    last_pushed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    sync_state = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    local_modified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    control_points = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_routes", x => x.id);
                    table.ForeignKey(
                        name: "fk_routes_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sync_log",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    entity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    entity_id = table.Column<Guid>(type: "uuid", nullable: true),
                    operation = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    http_status = table.Column<int>(type: "integer", nullable: true),
                    message = table.Column<string>(type: "text", nullable: true),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_sync_log", x => x.id);
                    table.ForeignKey(
                        name: "fk_sync_log_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "pois",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    route_id = table.Column<Guid>(type: "uuid", nullable: true),
                    name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    poi_type = table.Column<int>(type: "integer", nullable: false),
                    location = table.Column<Point>(type: "geometry(PointZ,4326)", nullable: false),
                    distance_along_m = table.Column<double>(type: "double precision", nullable: true),
                    activity_id = table.Column<int>(type: "integer", nullable: true),
                    suunto_poi_key = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    suunto_modified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_pushed_hash = table.Column<string>(type: "text", nullable: true),
                    last_pushed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    sync_state = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    local_modified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_pois", x => x.id);
                    table.ForeignKey(
                        name: "fk_pois_routes_route_id",
                        column: x => x.route_id,
                        principalTable: "routes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_pois_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "source_files",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    route_id = table.Column<Guid>(type: "uuid", nullable: false),
                    file_name = table.Column<string>(type: "character varying(260)", maxLength: 260, nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    content = table.Column<byte[]>(type: "bytea", nullable: false),
                    uploaded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_source_files", x => x.id);
                    table.ForeignKey(
                        name: "fk_source_files_routes_route_id",
                        column: x => x.route_id,
                        principalTable: "routes",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_pois_route_id",
                table: "pois",
                column: "route_id");

            migrationBuilder.CreateIndex(
                name: "ix_pois_user_id",
                table: "pois",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_pois_user_id_suunto_poi_key",
                table: "pois",
                columns: new[] { "user_id", "suunto_poi_key" },
                unique: true,
                filter: "suunto_poi_key IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_routes_user_id",
                table: "routes",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_routes_user_id_suunto_route_id",
                table: "routes",
                columns: new[] { "user_id", "suunto_route_id" },
                unique: true,
                filter: "suunto_route_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_source_files_route_id",
                table: "source_files",
                column: "route_id");

            migrationBuilder.CreateIndex(
                name: "ix_sync_log_user_id_at",
                table: "sync_log",
                columns: new[] { "user_id", "at" });

            migrationBuilder.CreateIndex(
                name: "ix_users_suunto_username",
                table: "users",
                column: "suunto_username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "data_protection_keys");

            migrationBuilder.DropTable(
                name: "pois");

            migrationBuilder.DropTable(
                name: "source_files");

            migrationBuilder.DropTable(
                name: "sync_log");

            migrationBuilder.DropTable(
                name: "routes");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}
