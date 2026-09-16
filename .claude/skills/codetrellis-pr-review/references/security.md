# Security

Portable across repos. Tune the stack notes at the end; the rest travels.

Report only what the diff introduces or newly exposes. A pre-existing weakness
the diff merely touches is not this PR's finding.

## Authorization, not just authentication

The most common real finding. A new endpoint checks *who you are* and forgets
*whether this is yours*.

- New route reading an object by id with no ownership or membership check.
- A resource id taken from the request body or path and trusted.
- Role checked in the UI but not on the server.
- An `is_admin`-style check on some branches of a handler but not all.
- Permission derived from a client-supplied field rather than the session.

For every new handler, ask: what does a valid, logged-in user of a *different*
tenant get if they call this with someone else's id? If the answer is "the
object", that is the finding.

## Secrets and exposure

- Keys, tokens, passwords or connection strings in source, tests, fixtures or
  committed `.env`. Check example env files for real values rather than
  placeholders.
- A secret moved into a client bundle — anything a frontend build inlines is
  public, whatever it is named.
- Secrets in logs, error messages, or exception payloads sent to the client.
- Internal hostnames, stack traces or query text in a response body.
- A new `.env`-shaped file not covered by `.gitignore`.

## Injection

- **NoSQL/Mongo:** a request value reaching a query as an object rather than a
  scalar permits `{"$ne": null}` and friends. Coerce, or validate the type.
- **SQL:** string interpolation into a query. Parameterise.
- **Command:** user data reaching `exec`, `system`, `subprocess` with
  `shell=True`, or a shell string built by concatenation.
- **Path traversal:** a filename or key from the request joined onto a base
  path with no normalisation and containment check. `../` still works.
- **Template:** user data rendered as a template rather than passed as data.

## Untrusted input crossing a boundary

- **SSRF:** the server fetching a user-supplied URL. Needs an allowlist; a
  blocklist of `localhost`/`169.254.*` is not enough, DNS rebinding defeats it.
- **Deserialisation:** `pickle`, `yaml.load` without `SafeLoader`, `eval`.
- **File upload:** missing type, size or extension validation; storing under a
  user-controlled path; trusting a client-supplied content type.
- **Redirects:** a `next`/`redirect` parameter used unvalidated is an open
  redirect and a phishing vector.

## Output

- `innerHTML`, `dangerouslySetInnerHTML`, `v-html` or `|safe` with data that
  can carry user content.
- User content in an inline `<script>` or an event handler attribute.
- A `Content-Type` that lets an uploaded file execute in the site's origin.

## Sessions and tokens

- JWT decoded without verifying signature, expiry, issuer and algorithm.
  Accepting `alg: none` or a caller-chosen algorithm is critical.
- Long-lived or non-expiring tokens where a short one would do.
- Session cookie missing `HttpOnly`, `Secure` or `SameSite`.
- A share or invite token that is guessable, sequential, or not scoped to the
  resource it grants.
- Logout or password change that does not invalidate existing sessions.

## Transport and config

- CORS reflecting an arbitrary `Origin`, or `*` alongside credentials.
- TLS verification disabled on an outbound call.
- Debug mode, verbose errors, or a permissive CORS origin behind a check that
  could be true in production.
- A new port published in compose that did not need to be.

## Rate limiting

New unauthenticated endpoints — login, register, password reset, share-token
redemption, anything sending mail — need a limit. Absence is a finding.

## Dependencies

A new direct dependency is worth a sentence: is it maintained, is it doing
something the stdlib or an existing dep already does, does it pull a large
transitive tree. Not a blocker, but say it.

---

## Stack notes

CodeTrellis runs on a developer workstation with network reach into the systems
it maps. That is a higher trust tier than most desktop tooling, and it sets the
bar for everything below.

**Loopback is not an authorisation boundary.** Any page in any browser on the
machine can reach `127.0.0.1`. A handler that is safe "because the server binds
to loopback" is not safe. Every local transport — Express, WebSocket, MCP —
authenticates with the per-launch capability token.

- **CORS must be an exact allowlist.** A reflected `Origin`, and especially a
  reflected origin with `Access-Control-Allow-Credentials: true`, is a finding
  every time. `Origin: null` is rejected, never trusted. `Host` is validated on
  every request, because DNS rebinding defeats an origin check alone.

- **Filesystem access goes through the single confined-file helper.** Lexical
  `path.resolve` / `path.relative` containment is insufficient — a junction or
  symlink under the allowed root reaches outside it, and that defeats every
  string-comparison check. Canonicalise both root and target, reject links at
  sensitive boundaries, open no-follow, and re-check the resolved target
  immediately before mutation. A check that happens before an `await` and a
  write that happens after it is a link-swap race.

- **Never accept `projectRoot` or `projectPath` from a request body.** Roots
  come from the stored item, plan, or opened-project record. This one rule
  removes the amplifier behind a whole class of traversal findings; a PR that
  reintroduces a caller-supplied root is a finding regardless of what
  validation it adds afterwards.

- **Validate before you write.** A write that lands before its validation fails
  has already mutated the filesystem — the later error does not undo it.

- **Peer identity comes from the DTLS transport**, never from a fingerprint in
  a request body or parsed out of SDP text with a regex. SDP is parsed
  structurally; multiple or conflicting `a=fingerprint` attributes are rejected,
  and a media-level attribute may not override a session-level one.

- **MCP tools authorise per tool by capability**, not per connection. A tool
  that executes because the connection was authenticated is a finding — the
  question is whether *this* caller holds *this* capability.

- **Peer RPC is deny-by-default.** A method dispatched without an explicit
  capability grant is a finding, and command-capable methods additionally
  require completed confirmation plus user consent.

- **Remote surfaces are off by default.** Discovery (mDNS) and API exposure are
  separate switches; enabling one must not enable the other.

- **Terminal I/O is privileged.** Inventory, scrollback and live output do not
  leave the device without explicit per-device, per-terminal approval.

- **Outbound fetch is SSRF surface.** Webhooks and config-driven URLs re-resolve
  DNS at connect time, so a host allowlist checked earlier is a time-of-check
  gap. Pin the resolved address or route through an approved egress, and keep
  TLS hostname verification.

- **Git arguments are argv, never a string.** Commit identifiers and refs are
  validated at every entry point, and `--` separates options from operands —
  an unvalidated ref that starts with `-` is an option-injection finding.

- **Parser input needs a budget.** tree-sitter parses before any downstream cap
  applies, so a size limit enforced later does not protect the parse itself.
