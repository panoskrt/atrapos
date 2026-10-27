using System.Buffers.Binary;
using System.Text;

namespace RoutePoiManager.Infrastructure.Import.Fit;

/// <summary>A decoded data message. Fields holding FIT's "invalid" marker are left out, so they read as missing.
/// Array fields keep their first element; byte arrays and developer fields are skipped.</summary>
public sealed class FitMessage(ushort number)
{
    private readonly Dictionary<byte, object> fields = [];

    public ushort Number { get; } = number;

    public long? Raw(byte field) => fields.GetValueOrDefault(field) as long?;

    /// <summary>A numeric field in its unit: the stored value divided by <paramref name="scale"/>, minus <paramref name="offset"/>.</summary>
    public double? Value(byte field, double scale = 1, double offset = 0) => fields.GetValueOrDefault(field) switch
    {
        long raw => raw / scale - offset,
        double raw => raw / scale - offset,
        _ => null,
    };

    public string? Text(byte field) => fields.GetValueOrDefault(field) as string;

    public DateTime? Time(byte field = CommonField.Timestamp) =>
        Raw(field) is { } seconds ? FitProtocol.ToDateTime(seconds) : null;

    internal void Set(byte field, object value) => fields[field] = value;
}

/// <summary>Reads every data message of a FIT file in order, including those of FIT files chained after the first.
/// CRCs aren't checked, and a file cut short yields the messages before the cut: both are common in files copied
/// off a device mid-write.</summary>
public static class FitReader
{
    private const byte CompressedTimestampHeader = 0x80;
    private const byte DefinitionHeader = 0x40;
    private const byte DeveloperDataFlag = 0x20;

    public static bool IsFit(ReadOnlySpan<byte> data) =>
        data.Length >= 12 && data[0] >= 12 && data[8..12].SequenceEqual(".FIT"u8);

    /// <exception cref="InvalidDataException">The data isn't FIT, or its messages don't follow FIT's structure.</exception>
    public static List<FitMessage> Read(ReadOnlySpan<byte> data)
    {
        if (!IsFit(data))
            throw new InvalidDataException("The data doesn't start with a FIT file header.");

        var messages = new List<FitMessage>();
        for (var file = data; IsFit(file);)
        {
            int headerSize = file[0];
            var dataEnd = (int)Math.Min(file.Length, headerSize + (long)BinaryPrimitives.ReadUInt32LittleEndian(file[4..]));
            if (dataEnd < headerSize)
                break;
            ReadRecords(file[headerSize..dataEnd], messages);
            file = file[Math.Min(file.Length, dataEnd + 2)..];   // past the file CRC, to the next chained file if any
        }
        return messages;
    }

    private static void ReadRecords(ReadOnlySpan<byte> data, List<FitMessage> messages)
    {
        var definitions = new Definition?[16];
        long lastTimestamp = 0;
        var pos = 0;
        while (pos < data.Length)
        {
            var header = data[pos++];
            if ((header & (CompressedTimestampHeader | DefinitionHeader)) == DefinitionHeader)
            {
                if (ReadDefinition(data[pos..], (header & DeveloperDataFlag) != 0) is not { } definition)
                    return;
                definitions[header & 0x0F] = definition;
                pos += definition.Length;
                continue;
            }

            var compressed = (header & CompressedTimestampHeader) != 0;
            var local = compressed ? (header >> 5) & 0x03 : header & 0x0F;
            var def = definitions[local]
                ?? throw new InvalidDataException($"A data message uses local message type {local} before defining it.");
            if (pos + def.DataSize > data.Length)
                return;
            var message = Decode(def, data.Slice(pos, def.DataSize));
            pos += def.DataSize;

            if (compressed && message.Raw(CommonField.Timestamp) is null)
            {
                // The header carries the timestamp's low five bits; the rest come from the last full timestamp.
                var offset = header & 0x1F;
                var timestamp = (lastTimestamp & ~0x1FL) + offset;
                if (offset < (lastTimestamp & 0x1F))
                    timestamp += 0x20;
                message.Set(CommonField.Timestamp, timestamp);
            }
            if (message.Raw(CommonField.Timestamp) is { } seconds)
                lastTimestamp = seconds;
            messages.Add(message);
        }
    }

    private sealed record Definition(ushort Number, bool BigEndian, FieldDefinition[] Fields, int DataSize, int Length);

    private readonly record struct FieldDefinition(byte Number, byte Size, byte BaseType);

    /// <summary>Null when the data ends inside the definition.</summary>
    private static Definition? ReadDefinition(ReadOnlySpan<byte> data, bool hasDeveloperFields)
    {
        // Reserved byte, architecture (1 = big-endian), global message number, field count, then 3 bytes per field.
        if (data.Length < 5)
            return null;
        var bigEndian = data[1] == 1;
        var number = bigEndian ? BinaryPrimitives.ReadUInt16BigEndian(data[2..]) : BinaryPrimitives.ReadUInt16LittleEndian(data[2..]);
        var fields = new FieldDefinition[data[4]];
        var length = 5 + fields.Length * 3;
        if (data.Length < length)
            return null;

        var dataSize = 0;
        for (var i = 0; i < fields.Length; i++)
        {
            var field = data.Slice(5 + i * 3, 3);
            fields[i] = new FieldDefinition(field[0], field[1], field[2]);
            dataSize += field[1];
        }

        if (hasDeveloperFields)
        {
            // Developer fields are skipped, so only their sizes matter.
            if (data.Length < length + 1)
                return null;
            var developerStart = length + 1;
            length = developerStart + data[length] * 3;
            if (data.Length < length)
                return null;
            for (var i = developerStart; i < length; i += 3)
                dataSize += data[i + 1];
        }
        return new Definition(number, bigEndian, fields, dataSize, length);
    }

    private static FitMessage Decode(Definition definition, ReadOnlySpan<byte> data)
    {
        var message = new FitMessage(definition.Number);
        var pos = 0;
        foreach (var field in definition.Fields)
        {
            if (Value(data.Slice(pos, field.Size), (FitBaseType)(field.BaseType & 0x1F), definition.BigEndian) is { } value)
                message.Set(field.Number, value);
            pos += field.Size;
        }
        return message;
    }

    private static object? Value(ReadOnlySpan<byte> raw, FitBaseType type, bool bigEndian)
    {
        if (type == FitBaseType.String)
        {
            var end = raw.IndexOf((byte)0);
            var text = end < 0 ? raw : raw[..end];
            return text.IsEmpty ? null : Encoding.UTF8.GetString(text);
        }

        var size = FitProtocol.Size(type);
        if (size == 0 || type == FitBaseType.Byte || raw.Length < size || raw.Length % size != 0)
            return null;
        Span<byte> v = stackalloc byte[8];
        raw[..size].CopyTo(v);
        if (bigEndian)
            v[..size].Reverse();

        if (type is FitBaseType.Float32 or FitBaseType.Float64)
        {
            // The invalid marker (all bits set) is a NaN.
            var real = type == FitBaseType.Float32 ? BinaryPrimitives.ReadSingleLittleEndian(v) : BinaryPrimitives.ReadDoubleLittleEndian(v);
            return double.IsNaN(real) ? null : real;
        }

        // Integers are kept as long, whatever their width, so FitMessage.Raw can unbox them as one type.
        return type switch
        {
            FitBaseType.Enum or FitBaseType.UInt8 => Valid(v[0], byte.MaxValue),
            FitBaseType.UInt8Z => Valid(v[0], 0),
            FitBaseType.SInt8 => Valid((sbyte)v[0], sbyte.MaxValue),
            FitBaseType.SInt16 => Valid(BinaryPrimitives.ReadInt16LittleEndian(v), short.MaxValue),
            FitBaseType.UInt16 => Valid(BinaryPrimitives.ReadUInt16LittleEndian(v), ushort.MaxValue),
            FitBaseType.UInt16Z => Valid(BinaryPrimitives.ReadUInt16LittleEndian(v), 0),
            FitBaseType.SInt32 => Valid(BinaryPrimitives.ReadInt32LittleEndian(v), int.MaxValue),
            FitBaseType.UInt32 => Valid(BinaryPrimitives.ReadUInt32LittleEndian(v), uint.MaxValue),
            FitBaseType.UInt32Z => Valid(BinaryPrimitives.ReadUInt32LittleEndian(v), 0),
            FitBaseType.SInt64 => Valid(BinaryPrimitives.ReadInt64LittleEndian(v), long.MaxValue),
            FitBaseType.UInt64 => Valid(BinaryPrimitives.ReadUInt64LittleEndian(v), ulong.MaxValue),
            FitBaseType.UInt64Z => Valid(BinaryPrimitives.ReadUInt64LittleEndian(v), 0),
            _ => null,
        };
    }

    private static long? Valid(long value, long invalid) => value == invalid ? null : value;

    /// <summary>Unsigned 64-bit values above <see cref="long.MaxValue"/> are dropped; Atrapos reads none.</summary>
    private static long? Valid(ulong value, ulong invalid) => value == invalid || value > long.MaxValue ? null : (long)value;
}
