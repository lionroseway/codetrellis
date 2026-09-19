using System;
using System.Collections.Generic;

namespace Acme.Reporting.Ledger;

public interface IEntryReader
{
    IReadOnlyList<Entry> Recent(int limit);
}

public enum EntryKind
{
    Debit,
    Credit,
}

public record struct Entry(string Id, decimal Amount, EntryKind Kind);

public sealed class EntryReader : IEntryReader
{
    private readonly List<Entry> _entries = new();
    private int _reads;

    public int Reads => _reads;

    public EntryReader()
    {
    }

    public IReadOnlyList<Entry> Recent(int limit)
    {
        _reads++;
        return _entries.GetRange(0, Math.Min(limit, _entries.Count));
    }

    internal sealed class Cursor
    {
        public int Offset { get; set; }

        public void Advance(int by) => Offset += by;
    }
}
