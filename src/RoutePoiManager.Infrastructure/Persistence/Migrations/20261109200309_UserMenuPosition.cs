using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoutePoiManager.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UserMenuPosition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "menu_position",
                table: "users",
                type: "text",
                nullable: false,
                defaultValue: "left");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "menu_position",
                table: "users");
        }
    }
}
