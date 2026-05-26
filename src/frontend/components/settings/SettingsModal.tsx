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
  Info,
  Download,
  AlertCircle,
  Smartphone,
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

type Section = 'identity' | 'mcp' | 'plans' | 'data' | 'devices' | 'sync' | 'logs' | 'telemetry' | 'updates' | 'about';

const SECTIONS: { key: Section; label: string; Icon: typeof User }[] = [
  { key: 'identity', label: 'Identity', Icon: User },
  { key: 'mcp', label: 'MCP Server', Icon: Plug },
  { key: 'plans', label: 'Plans', Icon: ClipboardList },
  { key: 'data', label: 'Data', Icon: HardDrive },
  { key: 'devices', label: 'Devices', Icon: Smartphone },
  { key: 'sync', label: 'Sync', Icon: RefreshCw },
  { key: 'logs', label: 'Logs', Icon: Terminal },
  { key: 'telemetry', label: 'Telemetry', Icon: Eye },
  { key: 'updates', label: 'Updates', Icon: Download },
  { key: 'about', label: 'About', Icon: Info },
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
            {section === 'sync' && (
              <SyncSection settings={settings} onChange={update} />
            )}
            {section === 'data' && (
              <DataSection settings={settings} onChange={update} />
            )}
            {section === 'devices' && (
              <DevicesSection settings={settings} onChange={update} />
            )}
            {section === 'telemetry' && <TelemetrySection />}
            {section === 'updates' && <UpdatesSection />}
            {section === 'about' && <AboutSection onJumpToSection={setSection} />}
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
              onClick={() => onChange({ plans: { ...settings.plans, defaultVisibility: v } })}
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

      <Field label="Attachment storage">
        <div className="flex gap-2">
          {(['project', 'user'] as const).map((v) => (
            <button
              key={v}
              onClick={() => onChange({ plans: { ...settings.plans, attachmentLocation: v } })}
              className={`px-3 py-1.5 text-[11.5px] rounded-md border transition-colors ${
                settings.plans.attachmentLocation === v
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
              }`}
              title={v === 'project'
                ? 'Attached images / videos / files land in <project>/.codetrellis/attachments/<item-uid>/ — they ride with the plan in git'
                : 'Attached images / videos / files land in your user data dir — out of git, lighter repos, but does not follow plans across machines'}
            >
              {v === 'project' ? 'Project (commit with plan)' : 'User data (out of git)'}
            </button>
          ))}
        </div>
      </Field>

      <p className="text-[10px] text-foreground-subtle">
        Pasted / dropped / picked image + video bytes write here. URLs and project-file refs are
        unaffected (they store paths, not bytes).
      </p>

    </>
  );
}

// --- Sync (Phase 5.3) ---

interface SyncStatusData {
  configured: boolean;
  mode: string;
  syncPath: string;
  syncDirExists: boolean;
  lastExportAt: string | null;
  lastImportAvailable: boolean;
  remoteMachine: string | null;
}

function SyncSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [syncPath, setSyncPath] = useState(settings.data.personalSyncPath);
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sync/status').then((r) => r.json()).then(setSyncStatus).catch(() => {});
  }, [settings.data.personalSyncPath, settings.data.personalSyncMode]);

  const save = () => {
    onChange({ data: { ...settings.data, personalSyncPath: syncPath.trim() } });
    // Refresh status after saving.
    setTimeout(() => {
      fetch('/api/sync/status').then((r) => r.json()).then(setSyncStatus).catch(() => {});
    }, 300);
  };

  const doExport = async () => {
    setExporting(true);
    setResultMsg(null);
    try {
      const res = await fetch('/api/sync/export', { method: 'POST' });
      const data = await res.json();
      setResultMsg(data.exported ? 'Exported successfully.' : `Export failed: ${data.error || 'unknown'}`);
    } catch {
      setResultMsg('Export failed — network error.');
    }
    setExporting(false);
    fetch('/api/sync/status').then((r) => r.json()).then(setSyncStatus).catch(() => {});
  };

  const doImport = async () => {
    setImporting(true);
    setResultMsg(null);
    try {
      const res = await fetch('/api/sync/import', { method: 'POST' });
      const data = await res.json();
      setResultMsg(data.imported
        ? `Imported${data.settingsImported ? ' settings' : ''}${data.recentProjects?.length ? ` + ${data.recentProjects.length} project(s)` : ''}.`
        : `Import failed: ${data.error || 'unknown'}`);
    } catch {
      setResultMsg('Import failed — network error.');
    }
    setImporting(false);
  };

  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Sync your identity, preferences, and project list across machines.
        Point this at a personal git repo, an iCloud Drive folder, a Dropbox directory — anything that syncs.
        CodeTrellis reads and writes files; you control the transport.
      </p>

      <Field label="Sync directory">
        <input
          type="text"
          value={syncPath}
          onChange={(e) => setSyncPath(e.target.value)}
          onBlur={save}
          placeholder="/path/to/your/synced-folder"
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] font-mono text-foreground focus:outline-none focus:border-accent/40"
        />
      </Field>

      <Field label="Sync mode">
        <div className="flex gap-2">
          {(['none', 'selective'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChange({ data: { ...settings.data, personalSyncMode: mode } })}
              className={`px-3 py-1.5 text-[11.5px] rounded-md border transition-colors ${
                settings.data.personalSyncMode === mode
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04]'
              }`}
            >
              {mode === 'none' ? 'Off' : 'Settings + projects'}
            </button>
          ))}
        </div>
      </Field>

      {syncStatus?.configured && (
        <div className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${syncStatus.syncDirExists ? 'bg-green-400' : 'bg-amber-400'}`} />
            <span className="text-foreground-muted">
              {syncStatus.syncDirExists ? 'Sync directory exists' : 'Sync directory not found'}
            </span>
          </div>
          {syncStatus.lastExportAt && (
            <div className="text-[10.5px] text-foreground-subtle">
              Last exported: {new Date(syncStatus.lastExportAt).toLocaleString()}
              {syncStatus.remoteMachine ? ` (from ${syncStatus.remoteMachine})` : ''}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={doExport}
              disabled={exporting || settings.data.personalSyncMode === 'none'}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {exporting ? 'Exporting…' : 'Export now'}
            </button>
            {syncStatus.lastImportAvailable && (
              <button
                onClick={doImport}
                disabled={importing}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-md border border-accent/30 text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {importing ? 'Importing…' : `Import from ${syncStatus.remoteMachine ?? 'other machine'}`}
              </button>
            )}
          </div>
        </div>
      )}

      {resultMsg && (
        <p className="text-[10.5px] text-foreground-muted">{resultMsg}</p>
      )}

      <p className="text-[10px] text-foreground-subtle leading-relaxed">
        Never synced: live tool-call streams, open terminal sessions, cached graph computations.
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
          onBlur={() => onChange({ data: { ...settings.data, dataDirOverride: dir.trim() } })}
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

// --- Devices ---

function DevicesSection({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [name, setName] = useState(settings.device.deviceName);

  return (
    <>
      <p className="text-[11px] text-foreground-muted leading-relaxed">
        Control how this CodeTrellis instance appears to other devices on your network.
        Paired devices can view your workspace remotely via WebRTC.
      </p>

      <Field label="Device name (empty = hostname)">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onChange({ device: { ...settings.device, deviceName: name.trim() } })}
          placeholder="e.g. Saif's iMac"
          className="w-full bg-white/[0.02] border border-white/[0.08] rounded-md px-3 py-1.5 text-[12px] text-foreground focus:outline-none focus:border-accent/40"
        />
      </Field>

      <Field label="">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.device.advertise}
            onChange={(e) => onChange({ device: { ...settings.device, advertise: e.target.checked } })}
            className="accent-accent"
          />
          <span className="text-[12px]">Advertise on local network (mDNS)</span>
        </label>
        <p className="text-[10px] text-foreground-subtle mt-1 ml-5">
          When enabled, nearby devices can discover this instance for pairing.
          Disable if you don&apos;t want to appear in discovery lists.
        </p>
      </Field>

      <Field label="">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.device.shareAudio}
            onChange={(e) => onChange({ device: { ...settings.device, shareAudio: e.target.checked } })}
            className="accent-accent"
          />
          <span className="text-[12px]">Share audio capture with paired devices</span>
        </label>
        <p className="text-[10px] text-foreground-subtle mt-1 ml-5">
          When enabled, agents on paired devices can access audio captured on this machine.
        </p>
      </Field>
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

// --- About ---

interface BuildInfo {
  version: string;
  buildTime: string;
  buildNumber: number;
  commit: string;
  commitShort: string;
  branch: string;
  dirty: boolean;
}

function AboutSection({ onJumpToSection }: { onJumpToSection: (section: Section) => void }) {
  const [info, setInfo] = useState<BuildInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/build-info')
      .then((r) => r.json())
      .then((data: BuildInfo) => setInfo(data))
      .catch(() => setInfo(null));
  }, []);

  const copyAll = () => {
    if (!info) return;
    const txt = [
      `CodeTrellis v${info.version} (build #${info.buildNumber})`,
      `Built: ${info.buildTime}`,
      `Commit: ${info.commitShort}${info.dirty ? ' (dirty)' : ''} (${info.branch})`,
    ].join('\n');
    navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!info) {
    return <p className="text-[11px] text-foreground-subtle">Loading build info…</p>;
  }

  const buildDate = new Date(info.buildTime);
  const buildAge = formatRelativeTime(buildDate);

  return (
    <>
      <div className="flex items-start gap-3">
        <img src="./icon.png" alt="" className="w-12 h-12 rounded-xl shadow-[0_0_12px_rgba(59,130,246,0.2)] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-foreground">CodeTrellis</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-foreground-muted font-mono">v{info.version}</span>
            <span className="text-[10px] text-foreground-subtle">·</span>
            <span className="text-[10px] text-foreground-subtle">build #{info.buildNumber}</span>
            {info.dirty && (
              <span className="text-[9px] text-amber-300 bg-amber-500/[0.1] border border-amber-500/20 px-1.5 py-0.5 rounded">
                dirty
              </span>
            )}
          </div>
        </div>
        <button
          onClick={copyAll}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-white/[0.08] text-foreground-muted hover:text-foreground hover:bg-white/[0.04] shrink-0"
          title="Copy build info to clipboard (paste when reporting issues)"
        >
          {copied ? <CheckCircle2 size={11} className="text-green-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="space-y-1 text-[11px] text-foreground-muted">
        <KV label="Built" value={`${buildDate.toLocaleString()} (${buildAge})`} />
        <KV label="Commit" value={info.commitShort + (info.branch && info.branch !== 'HEAD' ? ` · ${info.branch}` : '')} mono />
        <KV label="Build #" value={String(info.buildNumber)} mono />
      </div>

      <p className="text-[10.5px] text-foreground-subtle leading-relaxed pt-2 border-t border-white/[0.04]">
        Looking for a newer build?{' '}
        <button
          onClick={() => onJumpToSection('updates')}
          className="text-accent hover:text-accent-hover underline underline-offset-2"
        >
          Open Updates →
        </button>
      </p>

      <p className="text-[10px] text-amber-200/80 leading-relaxed">
        <strong>Installing on macOS:</strong> open the <code className="font-mono bg-white/[0.05] px-1 rounded">.dmg</code> file, then drag the <code className="font-mono bg-white/[0.05] px-1 rounded">CodeTrellis.app</code> icon onto the <code className="font-mono bg-white/[0.05] px-1 rounded">Applications</code> shortcut in the same window. Don't run the .app from the DMG mount or your Downloads folder — it won't update cleanly.
      </p>
    </>
  );
}

interface UpdateDownload {
  url: string;
  filename: string;
  size?: number;
  sha256?: string;
}

interface UpdateResultData {
  available: boolean;
  latest: string;
  current: string;
  publishedAt?: string;
  download?: UpdateDownload;
  releaseNotes?: { url?: string; markdown?: string };
  source: 'website' | 'github' | 'cache';
}

interface UpdateStateData {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'error';
  lastCheckedAt: number | null;
  result: UpdateResultData | null;
  lastError: string | null;
  platform: string;
  currentVersion: string;
}

/**
 * Updates section — its own panel in the Settings sidebar.
 *
 * Polls `/api/updates/status` (cheap, cached on the backend) on
 * mount, surfaces the result, and exposes a prominent
 * **Check for Updates** button. v1 doesn't auto-download — click
 * Download → opens the platform installer URL in the system
 * browser. Auto-apply on quit waits for code-signing.
 */
function UpdatesSection() {
  const [state, setState] = useState<UpdateStateData | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch('/api/updates/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setState(data))
      .catch(() => {
        // ignore — backend may still be booting; user can hit Check
      });
  }, []);

  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/updates/check', { method: 'POST' });
      if (res.ok) {
        const fresh = (await res.json()) as UpdateStateData;
        setState(fresh);
      }
    } catch {
      // surfaces via the lastError that comes back in state
    } finally {
      setChecking(false);
    }
  };

  const status = state?.status ?? 'idle';
  const result = state?.result ?? null;
  const lastError = state?.lastError ?? null;
  const lastCheckedAt = state?.lastCheckedAt ?? null;
  const currentVersion = state?.currentVersion ?? '—';
  const platform = state?.platform ?? '—';
  const isChecking = checking || status === 'checking';

  return (
    <>
      {/* Hero card — current version + the big Check button */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">
              You're running
            </div>
            <div className="text-[18px] font-semibold text-foreground tracking-tight mt-0.5">
              CodeTrellis v{currentVersion}
            </div>
            <div className="text-[11px] text-foreground-subtle font-mono mt-0.5">
              {platform}
            </div>
          </div>
          <button
            onClick={checkNow}
            disabled={isChecking}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium rounded-lg bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 hover:border-accent/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={isChecking ? 'animate-spin' : ''} />
            {isChecking ? 'Checking…' : 'Check for Updates'}
          </button>
        </div>
        <div className="text-[10.5px] text-foreground-subtle mt-3">
          {lastCheckedAt
            ? `Last checked ${formatRelativeTime(new Date(lastCheckedAt))}`
            : "Haven't checked yet — auto-checks once a day in the background."}
        </div>
      </div>

      {/* Status panel — flips based on the latest check result */}
      {status === 'available' && result?.download ? (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 shrink-0">
              <Download size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-foreground">
                v{result.latest} is available
              </div>
              <div className="text-[11px] text-foreground-muted mt-0.5">
                You're on v{result.current}
                {result.publishedAt
                  ? ` · released ${formatRelativeTime(new Date(result.publishedAt))}`
                  : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={result.download.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-lg bg-accent/20 border border-accent/50 text-accent hover:bg-accent/30 transition-colors"
            >
              <Download size={12} />
              Download {result.download.filename}
            </a>
            {result.releaseNotes?.url && (
              <a
                href={result.releaseNotes.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Release notes
                <ExternalLink size={11} />
              </a>
            )}
          </div>
          {result.download.size !== undefined && (
            <div className="text-[10px] text-foreground-subtle font-mono pl-12">
              {formatBytes(result.download.size)}
              {result.download.sha256 ? ` · sha256 ${result.download.sha256.slice(0, 12)}…` : ''}
            </div>
          )}
        </div>
      ) : status === 'up-to-date' ? (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-400/[0.08] border border-green-400/20 shrink-0">
            <CheckCircle2 size={16} className="text-green-400/80" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-foreground">
              You're on the latest version.
            </div>
            <div className="text-[11px] text-foreground-subtle mt-0.5">
              v{result?.current ?? currentVersion}
              {result?.publishedAt
                ? ` · released ${formatRelativeTime(new Date(result.publishedAt))}`
                : ''}
            </div>
          </div>
        </div>
      ) : status === 'error' ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 flex items-start gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-amber-500/[0.1] border border-amber-500/30 shrink-0">
            <AlertCircle size={16} className="text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-foreground">
              Couldn't reach the update server.
            </div>
            <div className="text-[11px] text-foreground-muted mt-0.5">
              {lastError ?? 'Unknown error'} —{' '}
              <button onClick={checkNow} className="underline hover:text-foreground">
                retry
              </button>
              .
            </div>
          </div>
        </div>
      ) : null}

      {/* Footer note */}
      <p className="text-[10.5px] text-foreground-subtle leading-relaxed pt-1">
        CodeTrellis checks <span className="text-foreground-muted">codetrellis.dev</span> for new
        builds, and falls back to the GitHub Releases feed if the website's API is unreachable.
        Updates open in your browser — install the new DMG / EXE / AppImage to upgrade.
        Auto-download will land once builds are code-signed.
      </p>
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-foreground-subtle w-16 shrink-0">{label}</span>
      <span className={mono ? 'font-mono text-foreground' : 'text-foreground'}>{value}</span>
    </div>
  );
}

function formatRelativeTime(d: Date): string {
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 60_000) return 'just now';
  if (ageMs < 3600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86400_000) return `${Math.floor(ageMs / 3600_000)}h ago`;
  return `${Math.floor(ageMs / 86400_000)}d ago`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider text-foreground-subtle mb-1.5">{label}</label>
      {children}
    </div>
  );
}
