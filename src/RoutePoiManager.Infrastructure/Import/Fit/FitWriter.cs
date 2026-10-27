using System.Buffers;
using System.Buffers.Binary;
using System.Text;

namespace RoutePoiManager.Infrastructure.Import.Fit;

/// <summary>One field of a message to write. A missing or out-of-range value is written as the type's "invalid" marker.</summary>
public readonly struct FitField
{
    private FitField(byte number, FitBaseType type, long? raw, string? text) =>
        (Number, Type, Raw, Text) = (number, type, raw, text);

    public byte Number { get; }
    public FitBaseType Type { get; }
    internal long? Raw { get; }
    internal string? Text { get; }

    public static FitField Enum(byte number, byte? value) => new(number, FitBaseType.Enum, value, null);
    public static FitField UInt8(byte number, byte? value) => new(number, FitBaseType.UInt8, value, null);
    public static FitField UInt16(byte number, ushort? value) => new(number, FitBaseType.UInt16, value, null);
    public static FitField SInt32(byte number, int? value) => new(number, FitBaseType.SInt32, value, null);
    public static FitField UInt32(byte number, uint? value) => new(number, FitBaseType.UInt32, value, null);
    public static FitField String(byte number, string? value) => new(number, FitBaseType.String, null, value);
    public static FitField Time(byte number, DateTime time) => UInt32(number, FitProtocol.ToSeconds(time));

    /// <summary>Stores <c>(value + offset) × scale</c>, rounded, as <paramref name="type"/> (UInt16 or UInt32).</summary>
    public static FitField Scaled(byte number, FitBaseType type, double? value, double scale, double offset = 0) =>
        new(number, type, value is { } v && Math.Round((v + offset) * scale) is var raw && raw >= long.MinValue && raw <= long.MaxValue ? (long)raw : null, null);
}

/// <summary>Writes a FIT file (protocol 1.0, little-endian) message by message. Each message's definition is written
/// before its first data message and again whenever its fields change, string lengths included.</summary>
public sealed class FitWriter
{
    // Protocol 1.0: nothing written here needs 2.0 (developer fields, 64-bit types), and every FIT reader accepts 1.0.
    private const byte ProtocolVersion = 0x10;
    private const ushort ProfileVersion = 2100;   // 21.00
    private const int HeaderSize = 14;

    private readonly ArrayBufferWriter<byte> records = new();
    private readonly List<ushort> messageNumbers = [];   // a message's local type is its index here, modulo 16
    private readonly byte[]?[] definitions = new byte[]?[16];

    public void Write(ushort message, params ReadOnlySpan<FitField> fields)
    {
        var index = messageNumbers.IndexOf(message);
        if (index < 0)
        {
            index = messageNumbers.Count;
            messageNumbers.Add(message);
        }
        var local = (byte)(index % 16);

        // Reserved byte, architecture (0 = little-endian), global message number, field count, then 3 bytes per field.
        var values = new byte[fields.Length][];
        var definition = new byte[5 + fields.Length * 3];
        BinaryPrimitives.WriteUInt16LittleEndian(definition.AsSpan(2), message);
        definition[4] = (byte)fields.Length;
        for (var i = 0; i < fields.Length; i++)
        {
            values[i] = Encode(fields[i]);
            definition[5 + i * 3] = fields[i].Number;
            definition[6 + i * 3] = (byte)values[i].Length;
            definition[7 + i * 3] = (byte)(FitProtocol.Size(fields[i].Type) > 1 ? 0x80 | (byte)fields[i].Type : (byte)fields[i].Type);
        }

        if (definitions[local] is not { } previous || !previous.AsSpan().SequenceEqual(definition))
        {
            records.Write([(byte)(0x40 | local)]);
            records.Write(definition);
            definitions[local] = definition;
        }
        records.Write([local]);
        foreach (var value in values)
            records.Write(value);
    }

    public byte[] ToArray()
    {
        var file = new byte[HeaderSize + records.WrittenCount + 2];
        var span = file.AsSpan();
        span[0] = HeaderSize;
        span[1] = ProtocolVersion;
        BinaryPrimitives.WriteUInt16LittleEndian(span[2..], ProfileVersion);
        BinaryPrimitives.WriteUInt32LittleEndian(span[4..], (uint)records.WrittenCount);
        ".FIT"u8.CopyTo(span[8..]);
        BinaryPrimitives.WriteUInt16LittleEndian(span[12..], FitProtocol.Crc(span[..12]));
        records.WrittenSpan.CopyTo(span[HeaderSize..]);
        BinaryPrimitives.WriteUInt16LittleEndian(span[^2..], FitProtocol.Crc(span[..^2]));
        return file;
    }

    private static byte[] Encode(FitField field)
    {
        if (field.Type == FitBaseType.String)
        {
            // NUL-terminated UTF-8. A field holds at most 255 bytes, so longer text is cut at a character boundary.
            var text = Encoding.UTF8.GetBytes(field.Text ?? "");
            var length = Math.Min(text.Length, 254);
            while (length < text.Length && (text[length] & 0xC0) == 0x80)
                length--;
            var terminated = new byte[length + 1];
            text.AsSpan(0, length).CopyTo(terminated);
            return terminated;
        }

        var value = field.Raw;
        var bytes = new byte[FitProtocol.Size(field.Type)];
        switch (field.Type)
        {
            case FitBaseType.Enum or FitBaseType.UInt8:
                bytes[0] = value is >= 0 and < byte.MaxValue ? (byte)value.Value : byte.MaxValue;
                break;
            case FitBaseType.UInt16:
                BinaryPrimitives.WriteUInt16LittleEndian(bytes, value is >= 0 and < ushort.MaxValue ? (ushort)value.Value : ushort.MaxValue);
                break;
            case FitBaseType.SInt32:
                BinaryPrimitives.WriteInt32LittleEndian(bytes, value is >= int.MinValue and < int.MaxValue ? (int)value.Value : int.MaxValue);
                break;
            case FitBaseType.UInt32:
                BinaryPrimitives.WriteUInt32LittleEndian(bytes, value is >= 0 and < uint.MaxValue ? (uint)value.Value : uint.MaxValue);
                break;
            default:
                throw new NotSupportedException($"Writing {field.Type} fields isn't supported.");
        }
        return bytes;
    }
}
