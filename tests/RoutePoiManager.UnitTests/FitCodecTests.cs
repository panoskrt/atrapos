using System.Buffers.Binary;
using RoutePoiManager.Infrastructure.Import.Fit;

namespace RoutePoiManager.UnitTests;

public sealed class FitCodecTests
{
    private static readonly DateTime Start = new(2026, 10, 1, 8, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Crc_is_crc16_arc() => Assert.Equal(0xBB3D, FitProtocol.Crc("123456789"u8));

    [Fact]
    public void Written_messages_read_back_with_valid_crcs()
    {
        var fit = new FitWriter();
        fit.Write(FitMessages.Record,
            FitField.Time(CommonField.Timestamp, Start),
            FitField.SInt32(RecordField.PositionLat, -1_000_000),
            FitField.Scaled(RecordField.Altitude, FitBaseType.UInt16, -12.4, 5, 500),
            FitField.Scaled(RecordField.EnhancedAltitude, FitBaseType.UInt32, null, 5, 500));
        fit.Write(FitMessages.Record,
            FitField.Time(CommonField.Timestamp, Start.AddSeconds(1)),
            FitField.SInt32(RecordField.PositionLat, null),
            FitField.Scaled(RecordField.Altitude, FitBaseType.UInt16, 20_000, 5, 500),   // above uint16's range
            FitField.Scaled(RecordField.EnhancedAltitude, FitBaseType.UInt32, 20_000, 5, 500));
        var bytes = fit.ToArray();

        Assert.Equal(BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(12)), FitProtocol.Crc(bytes.AsSpan(0, 12)));
        Assert.Equal(0, FitProtocol.Crc(bytes));
        var m = FitReader.Read(bytes);
        Assert.Equal(2, m.Count);
        Assert.Equal(Start, m[0].Time());
        Assert.Equal(-1_000_000, m[0].Raw(RecordField.PositionLat));
        Assert.Equal(-12.4, m[0].Value(RecordField.Altitude, 5, 500)!.Value, 6);
        Assert.Null(m[0].Raw(RecordField.EnhancedAltitude));   // missing values are written as "invalid"
        Assert.Null(m[1].Raw(RecordField.PositionLat));
        Assert.Null(m[1].Raw(RecordField.Altitude));
        Assert.Equal(20_000, m[1].Value(RecordField.EnhancedAltitude, 5, 500));
    }

    [Fact]
    public void Strings_of_different_lengths_get_their_own_definitions()
    {
        var fit = new FitWriter();
        foreach (var name in new[] { "A", "Longer name", "Pyhä" })
            fit.Write(FitMessages.CoursePoint, FitField.String(CoursePointField.Name, name));

        Assert.Equal(["A", "Longer name", "Pyhä"], FitReader.Read(fit.ToArray()).Select(m => m.Text(CoursePointField.Name)));
    }

    [Fact]
    public void Long_strings_are_cut_to_fit_without_splitting_a_character()
    {
        var fit = new FitWriter();
        fit.Write(FitMessages.Course, FitField.String(CourseField.Name, "x" + new string('ä', 200)));   // 401 bytes of UTF-8

        Assert.Equal("x" + new string('ä', 126), Assert.Single(FitReader.Read(fit.ToArray())).Text(CourseField.Name));
    }

    /// <summary>Hand-assembled, so it doesn't depend on <see cref="FitWriter"/>: a 12-byte header (no header CRC), a
    /// big-endian definition, developer fields and compressed-timestamp headers, including one that rolls over.</summary>
    [Fact]
    public void Reads_big_endian_definitions_developer_fields_and_compressed_timestamps()
    {
        const int lat = 715_827_883;   // 60°
        const int lon = 298_261_618;   // 25°
        var records = new List<byte>();
        records.AddRange([0x40, 0, 1, 0, 20, 3, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85]);   // local 0: record, big-endian
        records.AddRange([0x00, .. BigEndian(1000), .. BigEndian(lat), .. BigEndian(lon)]);
        records.AddRange([0x61, 0, 0, 20, 0, 2, 0, 4, 0x85, 1, 4, 0x85, 1, 0, 2, 0]);   // local 1: record + one 2-byte developer field
        records.AddRange([0x80 | (1 << 5) | 10, .. LittleEndian(lat), .. LittleEndian(lon), 0x12, 0x34]);   // 1000 → 1002
        records.AddRange([0x80 | (1 << 5) | 3, .. LittleEndian(int.MaxValue), .. LittleEndian(lon), 0, 0]);   // rolls over: 1027
        byte[] file = [12, 0x10, 0x34, 0x08, .. LittleEndian(records.Count), .. ".FIT"u8, .. records, 0, 0];

        var m = FitReader.Read(file);

        Assert.All(m, message => Assert.Equal(FitMessages.Record, message.Number));
        Assert.Equal(new long?[] { 1000, 1002, 1027 }, m.Select(message => message.Raw(CommonField.Timestamp)));
        Assert.Equal(new long?[] { lat, lat, null }, m.Select(message => message.Raw(RecordField.PositionLat)));
        Assert.Equal(new long?[] { lon, lon, lon }, m.Select(message => message.Raw(RecordField.PositionLong)));
    }

    [Fact]
    public void A_file_cut_short_yields_the_messages_before_the_cut()
    {
        var fit = new FitWriter();
        for (var i = 0; i < 3; i++)
            fit.Write(FitMessages.Record, FitField.Time(CommonField.Timestamp, Start.AddSeconds(i)));
        var bytes = fit.ToArray();

        Assert.Equal(2, FitReader.Read(bytes.AsSpan(0, bytes.Length - 4)).Count);   // no CRC, half the last record
    }

    [Fact]
    public void Chained_files_are_read_one_after_another()
    {
        static byte[] Course(string name)
        {
            var fit = new FitWriter();
            fit.Write(FitMessages.Course, FitField.String(CourseField.Name, name));
            return fit.ToArray();
        }

        Assert.Equal(["First", "Second"], FitReader.Read([.. Course("First"), .. Course("Second")]).Select(m => m.Text(CourseField.Name)));
    }

    [Fact]
    public void A_data_message_without_a_definition_is_rejected()
    {
        byte[] file = [12, 0x10, 0x34, 0x08, 1, 0, 0, 0, .. ".FIT"u8, 0x00, 0, 0];
        Assert.Throws<InvalidDataException>(() => FitReader.Read(file));
    }

    [Fact]
    public void Enum_names_fall_back_to_the_number()
    {
        Assert.Equal("Hiking", FitProfile.Sport.Name(17));
        Assert.Equal("EBikeMountain", FitProfile.SubSport.Name(47));
        Assert.Equal("Campsite", FitProfile.CoursePoint.Name(27));
        Assert.Equal("26", FitProfile.CoursePoint.Name(26));   // a gap in the profile
        Assert.Equal("300", FitProfile.Sport.Name(300));
        Assert.Null(FitProfile.Sport.Name(null));
        Assert.Equal(53, FitProfile.CoursePoint["Info"]);
        Assert.Throws<ArgumentException>(() => FitProfile.Sport["Quidditch"]);
    }

    private static byte[] BigEndian(int value)
    {
        var bytes = new byte[4];
        BinaryPrimitives.WriteInt32BigEndian(bytes, value);
        return bytes;
    }

    private static byte[] LittleEndian(int value)
    {
        var bytes = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(bytes, value);
        return bytes;
    }
}
