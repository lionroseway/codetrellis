using System;
using System.Collections.Generic;
using Acme.Reporting.Ledger;
using Acme.Reporting.Services;
using Fmt = System.Text;

namespace Acme.Reporting;

public static class Program
{
    public static void Main(string[] args)
    {
        var builder = new StatementBuilder(new EntryReader());
        Console.WriteLine(builder.Render());
    }
}
