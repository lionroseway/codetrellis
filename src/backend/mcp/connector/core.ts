/**
 * The connector's routing: a stdio MCP client on one side, the app's SSE
 * server on the other, and a connection in between that is allowed to die.
 *
 * ## Why this exists
 *
 * The capability token is minted fresh on every launch, by design — a token
 * that leaks in a screenshot stops working when the app restarts. Every copy
 * surface used to write THIS launch's token into the agent's config as a
 * static header. So every restart of CodeTrellis left every configured agent
 * holding a dead credential: Claude Code reconnected on its own, was refused
 * with 401, and stayed failed until the user re-ran `claude mcp add`. And
 * Claude Desktop could not connect at all, because it has no shell to read
 * the token file and only launches servers as stdio commands.
 *
 * Every MCP client can launch a stdio server. So the agent's config names a
 * command instead of a URL and a secret, and this process does what the
 * config could not: read the token and the endpoint on EVERY connect.
 *
 * ## What the client sees
 *
 * - App running: a normal MCP server. Messages pass through unchanged.
 * - App restarts: a pause. The connector reconnects, re-sends the client's
 *   original `initialize` to the new server (swallowing the reply the client
 *   already had), and tells the client its tool list changed. Requests in
 *   flight when the old server went away are answered with an error that
 *   says what happened, rather than left hanging.
 * - App not running: the connector still completes the handshake, lists no
 *   tools, and answers any call with one sentence saying to open the app.
 *   When the app appears, the tools do.
 *
 * ## What it is not
 *
 * Not an authority. It holds no state the server does not, makes no
 * authorisation decisions, and the client's own `clientInfo` reaches the
 * server untouched — so capability checks, project scope and the Timeline
 * all behave exactly as for a direct connection.
 *
 * This file is pure routing over injected transports, so it can be tested
 * without a network or a child process.
 */

export type JsonRpcId = string | number;

export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: JsonRpcId | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** One live connection to the app. Replaced wholesale when it dies. */
export interface Upstream {
  send(msg: JsonRpcMessage): Promise<void>;
  /** Tear down. Must result in `onclose` firing exactly once, even if called twice. */
  close(): void;
  onmessage?: (msg: JsonRpcMessage) => void;
  onclose?: () => void;
}

export interface ConnectorOptions {
  /** Write a message to the client (stdout). */
  send: (msg: JsonRpcMessage) => void;
  /**
   * Open a fresh connection to the app. Called on every (re)connect, and is
   * where the token and endpoint files are read — never cached.
   */
  connect: () => Promise<Upstream>;
  /** Diagnostics. Goes to stderr: stdout belongs to the protocol. */
  log?: (line: string) => void;
  version: string;
  /** How long `initialize` waits for a first connection before answering locally. */
  initialWaitMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  /** How long a replayed `initialize` may take before the connection is dropped. */
  replayTimeoutMs?: number;
}

/** Said to the agent whenever it asks for something the app is not there to do. */
export const NOT_RUNNING_MESSAGE =
  'CodeTrellis is not running, so its tools are unavailable. Open the CodeTrellis app — '
  + 'this connection picks it up automatically, with no change to your MCP settings.';

/** Said about a request that was in flight when the app went away. */
export const LOST_MESSAGE =
  'CodeTrellis stopped (or restarted) while this request was in flight. '
  + 'It reconnects automatically; try the request again in a moment.';

const REPLAY_ID_PREFIX = 'ct-connector-reinit-';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const idKey = (id: JsonRpcId): string => JSON.stringify(id);
const isRequest = (m: JsonRpcMessage): boolean =>
  typeof m.method === 'string' && m.id !== undefined && m.id !== null;
const isResponse = (m: JsonRpcMessage): boolean =>
  m.method === undefined && m.id !== undefined && m.id !== null;

export class ConnectorCore {
  private readonly opts: Required<Omit<ConnectorOptions, 'log'>> & { log: (line: string) => void };

  private upstream: Upstream | null = null;
  /** The upstream has completed an `initialize` handshake of its own. */
  private ready = false;
  /** The client's `initialize`, kept so it can be replayed to a new server. */
  private initRequest: JsonRpcMessage | null = null;
  /** The id of the client's own `initialize`, while its reply is outstanding. */
  private clientInitInFlight: string | null = null;
  /** We completed the client's handshake ourselves, because no app was there. */
  private answeredLocally = false;
  /** The client's `initialize` is waiting to learn whether a server exists. */
  private deciding = false;
  /** Client requests forwarded upstream and not yet answered. */
  private readonly pending = new Set<string>();
  private readonly replayWaiters = new Map<string, (reply: JsonRpcMessage | null) => void>();
  private replaySeq = 0;

  private firstAttempt: Promise<void> = Promise.resolve();
  private retryMs: number;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Log "waiting for CodeTrellis" once per outage, not once per retry. */
  private announcedDown = false;

  constructor(options: ConnectorOptions) {
    this.opts = {
      initialWaitMs: 3000,
      retryMinMs: 500,
      retryMaxMs: 5000,
      replayTimeoutMs: 10_000,
      log: () => {},
      ...options,
    } as ConnectorCore['opts'];
    this.retryMs = this.opts.retryMinMs;
  }

  start(): void {
    this.firstAttempt = this.connectOnce();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const up = this.upstream;
    this.upstream = null;
    up?.close();
  }

  /** True while there is a connected, initialised server behind us. */
  get connected(): boolean {
    return this.upstream !== null && this.ready;
  }

  // ── From the client ───────────────────────────────────────────────

  async handleClientMessage(msg: JsonRpcMessage): Promise<void> {
    if (isRequest(msg) && msg.method === 'initialize') {
      await this.handleInitialize(msg);
      return;
    }

    if (msg.method === 'notifications/initialized' && !isRequest(msg)) {
      // Forward only when the server behind us is the one that answered
      // this client's initialize. After a local answer, or once a replay has
      // sent its own `initialized`, a second one would be a protocol error.
      if (this.upstream && this.ready && this.clientInitInFlight === null && !this.answeredLocally) {
        await this.forward(msg);
      }
      return;
    }

    if (isRequest(msg)) {
      if (this.connected) {
        this.pending.add(idKey(msg.id as JsonRpcId));
        await this.forward(msg);
      } else {
        this.answerLocally(msg);
      }
      return;
    }

    // A response to a server-initiated request, or a notification. Neither
    // has anywhere to go if the server is gone.
    if (this.upstream && (this.ready || isResponse(msg))) await this.forward(msg);
  }

  private async handleInitialize(msg: JsonRpcMessage): Promise<void> {
    this.initRequest = msg;

    if (!this.upstream) {
      // While we wait, a connection that arrives must NOT replay this
      // initialize — we are about to forward it ourselves, and a server
      // that is initialised twice on one session is a server in a bad state.
      this.deciding = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.firstAttempt,
        new Promise((r) => { timer = setTimeout(r, this.opts.initialWaitMs); }),
      ]);
      clearTimeout(timer);
      this.deciding = false;
    }

    if (this.upstream) {
      this.clientInitInFlight = idKey(msg.id as JsonRpcId);
      this.pending.add(this.clientInitInFlight);
      this.answeredLocally = false;
      await this.forward(msg);
      return;
    }

    // Complete the handshake ourselves. Refusing it would make the client
    // mark the server as failed, and most clients do not retry a failed
    // server until the user intervenes — which is precisely the frustration
    // this process exists to remove.
    this.answeredLocally = true;
    const params = (msg.params ?? {}) as { protocolVersion?: string };
    this.opts.send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: params.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
        serverInfo: { name: 'codetrellis', version: this.opts.version },
        instructions: NOT_RUNNING_MESSAGE,
      },
    });
  }

  /** What a request gets when there is no server to ask. */
  private answerLocally(msg: JsonRpcMessage): void {
    const reply = (result: unknown) => this.opts.send({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: [] });
      case 'resources/list': return reply({ resources: [] });
      case 'resources/templates/list': return reply({ resourceTemplates: [] });
      case 'prompts/list': return reply({ prompts: [] });
      case 'tools/call':
        // A tool RESULT, not a protocol error: the model reads a result and
        // can tell the user what to do; a protocol error is often shown as
        // an opaque failure.
        return reply({ content: [{ type: 'text', text: NOT_RUNNING_MESSAGE }], isError: true });
      default:
        this.opts.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: NOT_RUNNING_MESSAGE } });
    }
  }

  // ── From the server ───────────────────────────────────────────────

  private handleUpstreamMessage(up: Upstream, msg: JsonRpcMessage): void {
    if (up !== this.upstream) return;

    if (isResponse(msg)) {
      const id = msg.id as JsonRpcId;
      if (typeof id === 'string' && id.startsWith(REPLAY_ID_PREFIX)) {
        this.replayWaiters.get(id)?.(msg);
        return;
      }
      const key = idKey(id);
      this.pending.delete(key);
      if (key === this.clientInitInFlight) {
        this.clientInitInFlight = null;
        if (!msg.error) this.ready = true;
      }
    }
    this.opts.send(msg);
  }

  private handleUpstreamClosed(up: Upstream): void {
    if (up !== this.upstream) return;
    this.upstream = null;
    this.ready = false;

    // Nothing the client asked for is left hanging.
    for (const key of this.pending) {
      this.opts.send({ jsonrpc: '2.0', id: JSON.parse(key) as JsonRpcId, error: { code: -32000, message: LOST_MESSAGE } });
    }
    this.pending.clear();
    this.clientInitInFlight = null;
    for (const resolve of this.replayWaiters.values()) resolve(null);
    this.replayWaiters.clear();

    this.opts.log('Lost the connection to CodeTrellis; reconnecting.');
    this.scheduleRetry();
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  private async connectOnce(): Promise<void> {
    if (this.stopped || this.upstream) return;

    let up: Upstream;
    try {
      up = await this.opts.connect();
    } catch (err) {
      if (!this.announcedDown) {
        this.opts.log(`Waiting for CodeTrellis (${err instanceof Error ? err.message : String(err)}).`);
        this.announcedDown = true;
      }
      this.scheduleRetry();
      return;
    }
    if (this.stopped) {
      up.close();
      return;
    }

    this.upstream = up;
    this.ready = false;
    this.retryMs = this.opts.retryMinMs;
    this.announcedDown = false;
    up.onmessage = (m) => this.handleUpstreamMessage(up, m);
    up.onclose = () => this.handleUpstreamClosed(up);
    this.opts.log('Connected to CodeTrellis.');

    // The client initialised before this server existed — against a local
    // answer, or against a server that has since gone. Bring the new one up
    // to the same point.
    if (this.initRequest && this.clientInitInFlight === null && !this.deciding) {
      await this.replayInitialize(up);
    }
  }

  private async replayInitialize(up: Upstream): Promise<void> {
    const id = `${REPLAY_ID_PREFIX}${++this.replaySeq}`;
    const reply = new Promise<JsonRpcMessage | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), this.opts.replayTimeoutMs);
      this.replayWaiters.set(id, (m) => {
        clearTimeout(timer);
        this.replayWaiters.delete(id);
        resolve(m);
      });
    });

    try {
      await up.send({ jsonrpc: '2.0', id, method: 'initialize', params: this.initRequest!.params });
    } catch {
      up.close();
      return;
    }

    const answer = await reply;
    if (up !== this.upstream) return; // died while we waited; the close path retries
    if (!answer || answer.error) {
      this.opts.log(`CodeTrellis refused the handshake${answer?.error ? `: ${answer.error.message}` : ' (timed out)'}; retrying.`);
      up.close();
      return;
    }

    try {
      await up.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch {
      up.close();
      return;
    }
    this.ready = true;

    // Whatever the client listed before — nothing, if we answered locally,
    // or the previous server's tools — it should list again.
    this.opts.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    this.opts.send({ jsonrpc: '2.0', method: 'notifications/resources/list_changed' });
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, this.opts.retryMaxMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connectOnce();
    }, wait);
  }

  private async forward(msg: JsonRpcMessage): Promise<void> {
    const up = this.upstream;
    if (!up) return;
    try {
      await up.send(msg);
    } catch {
      // A failed POST means the server is gone even if the stream has not
      // noticed yet. Closing routes everything through one recovery path.
      up.close();
      this.handleUpstreamClosed(up);
    }
  }
}
