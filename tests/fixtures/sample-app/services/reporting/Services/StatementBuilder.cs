using System;
using System.Text;
using Acme.Reporting.Ledger;

namespace Acme.Reporting.Services
{
    public sealed class StatementBuilder
    {
        private readonly IEntryReader _reader;

        public StatementBuilder(IEntryReader reader)
        {
            _reader = reader;
        }

        public string Render()
        {
            var sb = new StringBuilder();
            foreach (var entry in _reader.Recent(50))
            {
                sb.AppendLine($"{entry.Id} {entry.Amount}");
            }
            return sb.ToString();
        }
    }
}
