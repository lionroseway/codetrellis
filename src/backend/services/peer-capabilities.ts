/**
 * What a paired device is allowed to ask the desktop to do.
 *
 * Phase 19, findings 17 and 15.
 *
 * WHAT WAS WRONG
 *
 * The mobile RPC router dispatched on a method name and executed whatever it
 * matched. There was no authorisation step of any kind: a connected peer
 * could create terminals, write to them, open and close projects, change
 * settings, delete plans and read file content. "Connected" was the only
 * check, and the connection itself was reachable by anyone on the LAN
 * (finding A3) with an identity nobody verified (finding 2).
 *
 * DENY BY DEFAULT
 *
 * Every method must appear in the matrix below with an explicit capability.
 * A method that is not listed is REFUSED — so adding an RPC method without
 * thinking about authorisation fails closed rather than shipping open. The
 * test asserts the matrix covers every method the router handles, so the two
 * cannot drift apart silently.
 *
 * WHY TERMINAL IS ITS OWN CAPABILITY
 *
 * `terminal.create` and `terminal.write` are arbitrary command execution on
 * the user's machine. That is categorically different from reading a plan,
 * and the review requires explicit user consent for it rather than it riding
 * along with everything else a paired phone can do. It is therefore NOT in
 * the default grant: a device gets it only when the user turns it on for
 * that device.
 *
 * `settings` is separated for the same reason in miniature — settings
 * includes the switch that exposes the mobile API to the network, and a
 * device should not be able to widen its own reach.
 */

/** Capability classes. Ordered roughly by how much damage they permit. */
export type PeerCapability =
  | 'read'      // look at plans, graph, docs, channels
  | 'write'     // change plans, docs, comments, channels
  | 'project'   // open / close / rescan projects
  | 'files'     // read file CONTENT and browse the filesystem
  | 'settings'  // change desktop settings — includes network exposure
  | 'terminal'; // create and drive terminals — COMMAND EXECUTION

/** Every capability name, for validating what the settings UI sends. */
export const ALL_CAPABILITIES: readonly PeerCapability[] = Object.freeze([
  'read', 'write', 'project', 'files', 'settings', 'terminal',
]);

/**
 * Every RPC method the router handles, mapped to the capability it needs.
 *
 * Keep this in the same order as the router's switch so the two can be
 * eyeballed side by side.
 */
export const METHOD_CAPABILITIES: Readonly<Record<string, PeerCapability>> = Object.freeze({
  // ── read ────────────────────────────────────────────────────────────
  'changes.summary': 'read',
  'channel.events': 'read',
  'channel.eventsSinceSeq': 'read',
  'channel.get': 'read',
  'channel.thread': 'read',
  'deviation.list': 'read',
  'graph.directory': 'read',
  'graph.file': 'read',
  'graph.fileSearch': 'read',
  'graph.overview': 'read',
  'graph.scene': 'read',
  'graph.search': 'read',
  'plan.copyAsPrompt': 'read',
  'plan.document': 'read',
  'plan.get': 'read',
  'plan.item.get': 'read',
  'plan.items': 'read',
  'plan.list': 'read',
  'plan.template.list': 'read',
  'power.status': 'read',
  'project.active': 'read',
  'project.list': 'read',
  'settings.get': 'read',
  'sysdoc.list': 'read',
  'sysdoc.read': 'read',
  'diagnostics.flush': 'read',

  // ── write ───────────────────────────────────────────────────────────
  'channel.post': 'write',
  'channel.resolve': 'write',
  'comment.add': 'write',
  'deviation.resolve': 'write',
  'input.respond': 'write',
  'item.ref.add': 'write',
  'item.ref.remove': 'write',
  'plan.create': 'write',
  'plan.delete': 'write',
  'plan.file.discover': 'write',
  'plan.file.export': 'write',
  'plan.file.import': 'write',
  'plan.item.create': 'write',
  'plan.item.update': 'write',
  'plan.template.create': 'write',
  'plan.update': 'write',
  'sysdoc.create': 'write',
  'sysdoc.delete': 'write',
  'sysdoc.update': 'write',
  'sysdoc.verify': 'write',

  // ── project ─────────────────────────────────────────────────────────
  'project.alias': 'project',
  'project.close': 'project',
  'project.open': 'project',
  'project.pin': 'project',
  'project.remove': 'project',
  'project.rescan': 'project',

  // ── files ───────────────────────────────────────────────────────────
  // Separated from `read` because these return file CONTENT and enumerate
  // directories, rather than the plan/graph metadata `read` covers.
  'fs.browse': 'files',
  'graph.fileSource': 'files',

  // ── settings ────────────────────────────────────────────────────────
  // Includes `device.exposeMobileApi`. A device must not be able to widen
  // its own reach, so this is not granted by default.
  'settings.update': 'settings',

  // ── terminal — COMMAND EXECUTION ────────────────────────────────────
  'terminal.create': 'terminal',
  'terminal.history': 'terminal',
  'terminal.kill': 'terminal',
  'terminal.list': 'terminal',
  'terminal.read': 'terminal',
  'terminal.resize': 'terminal',
  'terminal.stream': 'terminal',
  'terminal.write': 'terminal',
});

/**
 * What a newly-paired device may do before the user grants anything more.
 *
 * Deliberately excludes `settings` and `terminal`. Pairing a phone to see
 * your plans should not also hand it a shell — those are separate decisions
 * and the user gets to make them separately.
 */
export const DEFAULT_GRANTS: readonly PeerCapability[] = Object.freeze([
  'read',
  'write',
  'project',
  'files',
]);

export class PeerAuthorizationError extends Error {
  readonly code = 'EPEER_FORBIDDEN';
  constructor(message: string) {
    super(message);
    this.name = 'PeerAuthorizationError';
  }
}

/**
 * Authorise one RPC call, or throw.
 *
 * `confirmed` is whether the pairing ceremony completed for this device.
 * Command-capable methods are refused for an unconfirmed connection
 * regardless of grants, which is the review's "do not process
 * command-capable RPC for a connection that has not completed confirmation".
 */
export function assertPeerMayCall(
  method: string,
  grants: readonly PeerCapability[] | undefined,
  opts: { confirmed: boolean; alias?: string } = { confirmed: false },
): PeerCapability {
  const required = METHOD_CAPABILITIES[method];

  if (!required) {
    // DENY BY DEFAULT. An unlisted method is refused rather than allowed,
    // so a new RPC method that nobody classified fails closed.
    throw new PeerAuthorizationError(
      `Method "${method}" is not authorised for peers. ` +
        'Every method must be listed in METHOD_CAPABILITIES; unlisted methods are refused.',
    );
  }

  const held = grants ?? [];
  if (!held.includes(required)) {
    throw new PeerAuthorizationError(
      `Device${opts.alias ? ` "${opts.alias}"` : ''} does not hold the "${required}" capability required by "${method}"`,
    );
  }

  if (required === 'terminal' && !opts.confirmed) {
    throw new PeerAuthorizationError(
      `"${method}" runs commands on this machine and requires a confirmed pairing`,
    );
  }

  return required;
}

/** Every method the matrix knows about — used by the coverage test. */
export function listAuthorisedMethods(): string[] {
  return Object.keys(METHOD_CAPABILITIES);
}
