using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Acme.Reporting.Ledger;

namespace Acme.Reporting.Controllers;

/// <summary>
/// Serves /api/ledger — the route template comes from [controller],
/// which the extractor has to expand from the class name.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class LedgerController : ControllerBase
{
    private readonly HttpClient _http;
    private readonly IEntryReader _reader;

    public LedgerController(HttpClient http, IEntryReader reader)
    {
        _http = http;
        _reader = reader;
    }

    [HttpGet]
    public IActionResult Index() => Ok(_reader.Recent(50));

    [HttpGet("{id}")]
    public IActionResult Show(string id) => Ok(id);

    [HttpPost("reconcile")]
    public async Task<IActionResult> Reconcile()
    {
        // Calls the Python service — a cross-language edge.
        var orders = await _http.GetAsync("http://api.internal/api/orders");
        return Ok(orders.StatusCode);
    }
}
