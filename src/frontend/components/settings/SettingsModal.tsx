import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  User,
  Plug,
  ClipboardList,
  HardDrive,
  Eye,
  Copy,
  CheckCircle2,
  RefreshCw,
  Terminal,
  ExternalLink,
} from 'lucide-react';
import type { AppSettings } from '@shared/types';

/**
 * Settings panel — Phase 13 §D.
 *
 * Sections:
 *   - Identity (display name + email; defaults from `git config`)
 *   - MCP server (port + autodetect; "Copy config" buttons; shows
 *     the actually-bound port if it differs from the configured one)
 *   - Plans (default visibility for newly-created plans)
 *   - Data (data dir override; reset hint)
 *   - Telemetry (off, explicit)
 *
 * Persisted via PUT /api/settings. The server broadcasts
 * `settings-changed` so other open instances stay in sync.
 */

type Section = 'identity' | 'mcp' | 'plans' | 'data' | 'logs' | 'telemetry';

const SECTIONS: { key: Section; label: string; Icon: typeof User }[] = [
  { key: 'identity', label: 'Identity', Icon: User },
  { key: 'mcp', label: 'MCP Server', Icon: Plug },
  { key: 'plans', label: 'Plans', Icon: ClipboardList },
  { key: 'data', label: 'Data', Icon: HardDrive },
  { key: 'logs', label: 'Logs', Icon: Terminal },
  { key: 'telemetry', label: 'Telemetry', Icon: Eye },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>('identity');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [boundPort, setBoundPort] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Load + reload on focus so external changes (or mcp-port-changed
  // events) reflect.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/settings').then((r) => r.json()),
      fetch('/api/mcp/status').then((r) => r.json()).catch(() => null),
    ])
      .then(([s, mcp]) => {
        if (cancelled) return;
        setSettings(s);
        if (mcp?.port) setBoundPort(mcp.port);
      });
    return () => { cancelled = true; };
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    if (!settings) return;
    setSaving(true);
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (res.ok) {
      const next = await res.json();
      setSettings(next);
    }
  };

  if (!settings) {
    return createPortal(
      <Backdrop onClose={onClose}>
        <div className="text-[11px] text-foreground-subtle p-6">Loading…</div>
      </Backdrop>,
      document.body,
    );
  }

  return createPortal(
    <Backdrop onClose={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex rounded-2xl border border-white/[0.08] bg-[#0b1020] shadow-[0_24px_80px_rgba(0,0,0,0.6)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-44 border-r border-white/[0.06] py-4 px-2 flex flex-col gap-0.5 bg-black/20">
          <div className="text-[9px] uppercase tracking-wider text-foreground-subtle px-3 mb-2">Settings</div>
          {SECTIONS.map((s) => {
            const active = section === s.key;
            return (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={`flex items-center gap-2 px-3 py-1.5 text-[11.5px] rounded-md text-left transition-colors ${
                  active
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'text-foreground-muted hover:text-foreground hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <s.Icon size={12} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]">
            <h3 className="text-[13px] font-semibold text-foreground">
              {SECTIONS.find((s) => s.key === section)?.label}
            </h3>
            <button onClick={onClose} className="p-1 rounded text-foreground-subtle hover:text-foreground hover:bg-white/[0.05]">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {section === 'identity' && (
              <IdentitySection settings={settings} onChange={update} />
            )}
            {section === 'mcp' && (
              <McpSection settings={settings} boundPort={boundPort} onChange={update} />
            )}
            {section === 'plans' && (
              <PlansSection settings={settings} onChange={update} />
            )}
            {section === 'logs' && <LogsSection />}
            {section === 'data' && (
              <DataSection settings={settings} onChange={update} />
            )}
            {section === 'telemetry' && <TelemetrySection />}
          </div>

          {saving && (
            <div className="px-5 py-2 text-[10px] text-foreground-subtle border-t border-white/[0.04]">Saving…</div>
          )}
        </div>
      </div>
    </Backdrop>,
    document.body,
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      {children}
    </div>
  );
}

// --- Identity ---

function IdentitySection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [displayName, setDisplayName] = useState(settings.identity.displayName);
  const [email, setEmail] = useState(settings.identity.email);

  const pullFromGit = async () => {
    const res = await fetch('/api/identity/git-defaults');
    if (!res.ok) return;
    const { name, email: gitEmail } = await res.json();
    if (name) setDisplayName(name);
    if (gitEmail) setEmail(gitEmail);
  };

  const save = () => onChange({ identity: { displayName: displayName.trim(), email: email.trim() } });

  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Used to attribute plans, tasks, and comments. Defaults from your active project's <code className="bg-white/[0.05] px-1 rounded">git config</code>.
        Stored in <code className="bg-white/[0.05] px-1 rounded">~/.codetrellis/settings.json</code> — never sent anywhere.
      </p>

      <Field label="Display name">
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={save}
          placeholder="Your name"
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12.5px] text-foreground focus:outline-none focus:border-accent/40"
        />
      </Field>

      <Field label="Email (used as the canonical author key)">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={save}
          placeholder="you@example.com"
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12.5px] font-mono text-foreground focus:outline-none focus:border-accent/40"
        />
      </Field>

      <button
        onClick={pullFromGit}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
      >
        <RefreshCw size={11} /> Pull from <code className="font-mono">git config</code>
      </button>
    </>
  );
}

// --- MCP ---

function McpSection({
  settings,
  boundPort,
  onChange,
}: {
  settings: AppSettings;
  boundPort: number | null;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [port, setPort] = useState(String(settings.mcp.port));
  const [autodetect, setAutodetect] = useState(settings.mcp.autodetectOnCollision);
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch('/api/mcp/config').then((r) => r.json()).then(setConfig).catch(() => {});
  }, [boundPort]);

  const save = () => {
    const n = parseInt(port, 10);
    if (!Number.isFinite(n)) return;
    onChange({ mcp: { port: n, autodetectOnCollision: autodetect } });
  };

  const copy = () => {
    if (!config) return;
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const driftedPort = boundPort != null && boundPort !== settings.mcp.port;

  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        The MCP SSE server agents connect to. Default port <span className="font-mono">19432</span>.
        If the port is taken (another tool, another CodeTrellis instance), enable autodetect to walk forward.
      </p>

      <Field label="Preferred port">
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          onBlur={save}
          min={1024}
          max={65535}
          className="w-32 bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12.5px] font-mono text-foreground focus:outline-none focus:border-accent/40"
        />
      </Field>

      <label className="flex items-center gap-2 text-[11.5px] text-foreground-muted">
        <input
          type="checkbox"
          checked={autodetect}
          onChange={(e) => { setAutodetect(e.target.checked); onChange({ mcp: { ...settings.mcp, autodetectOnCollision: e.target.checked } }); }}
          className="accent-accent"
        />
        Autodetect on collision (try next 10 ports)
      </label>

      {driftedPort && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/[0.05] px-3 py-2 text-[10.5px] text-amber-200/90">
          Currently bound to <span className="font-mono">{boundPort}</span> (configured port {settings.mcp.port} was unavailable).
          Restart the server to try the configured port again.
        </div>
      )}

      <Field label="Config snippet for your agent">
        <div className="flex items-start gap-2">
          <pre className="flex-1 bg-black/30 border border-white/[0.06] rounded-md px-3 py-2 text-[10.5px] font-mono text-foreground-muted overflow-x-auto">
{config ? JSON.stringify(config, null, 2) : 'Loading...'}
          </pre>
          <button
            onClick={copy}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10.5px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] shrink-0"
            title="Copy to clipboard"
          >
            {copied ? <CheckCircle2 size={11} className="text-green-400" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </Field>

      <p className="text-[10px] text-foreground-subtle leading-relaxed">
        Drop this into your agent's MCP config file
        (<code className="font-mono">~/.cursor/mcp.json</code>, <code className="font-mono">~/.codex/config.json</code>, or your tool's equivalent).
      </p>
    </>
  );
}

// --- Plans ---

function PlansSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Default visibility for plans you create. You can toggle this per-plan in the plan header (Phase 13 §A — coming).
      </p>

      <Field label="Default visibility">
        <div className="flex gap-2">
          {(['shared', 'local'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onChange({ plans: { defaultVisibility: v } })}
              className={`px-3 py-1.5 text-[11.5px] rounded-md border transition-colors ${
                settings.plans.defaultVisibility === v
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
              }`}
            >
              {v === 'shared' ? 'Shared (commit to .codetrellis/)' : 'Local (DB only)'}
            </button>
          ))}
        </div>
      </Field>

      <p className="text-[10px] text-foreground-subtle">
        Shared plans land at <code className="font-mono">&lt;project&gt;/.codetrellis/plans/&lt;slug&gt;/</code>. See [PLAN-EXPORT.md](docs/PLAN-EXPORT.md).
      </p>
    </>
  );
}

// --- Data ---

function DataSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [dir, setDir] = useState(settings.data.dataDirOverride);

  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Where CodeTrellis stores its database, snapshots, and settings. Defaults to <code className="font-mono">~/.codetrellis/</code>.
        Override only if you have a specific reason (network drive, encrypted volume, test isolation).
      </p>

      <Field label="Data directory override (empty = default)">
        <input
          type="text"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          onBlur={() => onChange({ data: { dataDirOverride: dir.trim() } })}
          placeholder="/path/to/your/codetrellis-data"
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
        />
      </Field>

      <p className="text-[10px] text-amber-200/80">
        ⚠️ Changes take effect on next server restart. The current session keeps using the previous path.
      </p>
    </>
  );
}

// --- Telemetry ---

// --- Logs ---

function LogsSection() {
  const [content, setContent] = useState<string>('');
  const [logFile, setLogFile] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/logs/tail?maxBytes=65536')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setContent(data.content || '(log file empty)');
        setLogFile(data.path || '');
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setContent('Failed to read logs.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tick]);

  const reveal = () => {
    const electronAPI = window.electronAPI;
    if (electronAPI?.revealLogs) {
      electronAPI.revealLogs().catch(() => {});
    } else {
      // Web mode — best we can do is copy the path so the user
      // can open it themselves.
      navigator.clipboard?.writeText(logFile).catch(() => {});
    }
  };

  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Backend logs (everything `console.log` / `console.warn` / `console.error` emits) mirrored to a daily file at:
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-white/[0.05] border border-white/[0.06] rounded px-2 py-1.5 text-[10.5px] font-mono text-foreground-muted truncate">
          {logFile || 'Loading…'}
        </code>
        <button
          onClick={reveal}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
          title="Reveal in Finder / Explorer"
        >
          <ExternalLink size={11} /> Reveal
        </button>
        <button
          onClick={() => setTick((n) => n + 1)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1.5">
          Recent log output (last 64 KB)
        </label>
        <pre className="max-h-[420px] overflow-auto bg-black/40 border border-white/[0.06] rounded-md px-3 py-2 text-[10.5px] font-mono text-foreground-muted whitespace-pre-wrap break-all">
{loading ? 'Loading…' : content}
        </pre>
      </div>

      <p className="text-[10px] text-foreground-subtle leading-relaxed">
        If the app stops responding, send the contents of this file when reporting the issue. Each day's logs roll over automatically.
      </p>
    </>
  );
}

function TelemetrySection() {
  return (
    <>
      <p className="text-[12px] text-foreground leading-relaxed">
        <span className="font-semibold">Off.</span> CodeTrellis does not collect or transmit any usage data, project paths, code, plans, or agent activity.
      </p>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Everything stays on your machine. Your project's plans live in your repo (committed via git, your transport).
        Your DB lives at <code className="font-mono">~/.codetrellis/data.db</code>. The MCP server binds to <code className="font-mono">127.0.0.1</code> only — no remote agents reach it.
      </p>
      <p className="text-[10px] text-foreground-subtle">
        This isn't a setting you can toggle — it's a property of how the tool's built. We mention it explicitly because trust matters for a tool you run on your own code.
      </p>
    </>
  );
}

// --- shared bits ---

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1.5">{label}</label>
      {children}
    </div>
  );
}
