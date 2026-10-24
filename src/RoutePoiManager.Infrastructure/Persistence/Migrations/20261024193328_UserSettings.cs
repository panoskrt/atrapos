using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoutePoiManager.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UserSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "default_map",
                table: "users",
                type: "text",
                nullable: false,
                defaultValue: "topo");

            migrationBuilder.AddColumn<string>(
                name: "units",
                table: "users",
                type: "text",
                nullable: false,
                defaultValue: "metric");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "default_map",
                table: "users");

            migrationBuilder.DropColumn(
                name: "units",
                table: "users");
        }
    }
}
