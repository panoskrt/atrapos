using System.ComponentModel.DataAnnotations;

namespace RoutePoiManager.Infrastructure.Import;

/// <summary>Limits on route files uploaded to the import and GPX tools endpoints.</summary>
public sealed class UploadOptions
{
    public const string Section = "Uploads";

    /// <summary>Largest GPX or FIT file accepted, in megabytes (MiB). The whole file is held in memory while it's
    /// parsed, and a preview sends every track point back to the browser.</summary>
    [Range(1, 500)] public int MaxFileSizeMb { get; set; } = 20;

    public long MaxFileBytes => MaxFileSizeMb * 1024L * 1024L;
}
