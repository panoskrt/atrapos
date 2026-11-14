using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoutePoiManager.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UserRoutingPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "default_routing_profile",
                table: "users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int[]>(
                name: "favorite_activity_ids",
                table: "users",
                type: "integer[]",
                nullable: false,
                defaultValueSql: "ARRAY[11, 22, 1, 70, 10, 2, 0, 99, 31, 3]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "default_routing_profile",
                table: "users");

            migrationBuilder.DropColumn(
                name: "favorite_activity_ids",
                table: "users");
        }
    }
}
