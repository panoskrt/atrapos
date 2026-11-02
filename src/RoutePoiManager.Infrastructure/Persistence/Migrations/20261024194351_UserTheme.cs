using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoutePoiManager.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class UserTheme : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "theme",
                table: "users",
                type: "text",
                nullable: false,
                defaultValue: "dark");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "theme",
                table: "users");
        }
    }
}
