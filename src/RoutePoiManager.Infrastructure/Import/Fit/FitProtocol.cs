namespace RoutePoiManager.Infrastructure.Import.Fit;

/// <summary>FIT base types: the low five bits of the base-type byte in a field definition.</summary>
public enum FitBaseType : byte
{
    Enum = 0,
    SInt8 = 1,
    UInt8 = 2,
    SInt16 = 3,
    UInt16 = 4,
    SInt32 = 5,
    UInt32 = 6,
    String = 7,
    Float32 = 8,
    Float64 = 9,
    UInt8Z = 10,
    UInt16Z = 11,
    UInt32Z = 12,
    Byte = 13,
    SInt64 = 14,
    UInt64 = 15,
    UInt64Z = 16,
}

/// <summary>The byte-level parts of the FIT protocol shared by <see cref="FitReader"/> and <see cref="FitWriter"/>.</summary>
internal static class FitProtocol
{
    /// <summary>FIT times count seconds from 1989-12-31 00:00 UTC.</summary>
    private static readonly DateTime Epoch = new(1989, 12, 31, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>Size of one value in bytes; 0 for strings (sized by their field) and unknown types.</summary>
    public static int Size(FitBaseType type) => type switch
    {
        FitBaseType.Enum or FitBaseType.SInt8 or FitBaseType.UInt8 or FitBaseType.UInt8Z or FitBaseType.Byte => 1,
        FitBaseType.SInt16 or FitBaseType.UInt16 or FitBaseType.UInt16Z => 2,
        FitBaseType.SInt32 or FitBaseType.UInt32 or FitBaseType.UInt32Z or FitBaseType.Float32 => 4,
        FitBaseType.Float64 or FitBaseType.SInt64 or FitBaseType.UInt64 or FitBaseType.UInt64Z => 8,
        _ => 0,
    };

    /// <summary>The CRC-16 FIT uses (the CRC-16/ARC variant). The CRC of a file including its trailing CRC is 0.</summary>
    public static ushort Crc(ReadOnlySpan<byte> data, ushort crc = 0)
    {
        foreach (var b in data)
        {
            crc ^= b;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc & 1) != 0 ? (ushort)((crc >> 1) ^ 0xA001) : (ushort)(crc >> 1);
        }
        return crc;
    }

    public static DateTime ToDateTime(long seconds) => Epoch.AddSeconds(seconds);

    /// <summary>Times of unspecified kind are taken as UTC.</summary>
    public static uint ToSeconds(DateTime time)
    {
        var seconds = ((time.Kind == DateTimeKind.Local ? time.ToUniversalTime() : time) - Epoch).TotalSeconds;
        return (uint)Math.Clamp(Math.Floor(seconds), 0, uint.MaxValue - 1);
    }
}
