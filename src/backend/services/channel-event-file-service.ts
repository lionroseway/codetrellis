/**
 * Channel event file service — Phase 1.3 of the CDev target architecture.
 *
 * Reads and writes channel events to the manifest at
 * `<projectRoot>/.codetrellis/plans/<slug>/channels/<event-uid>.yaml`.
 *
 * The plan-file watcher picks up changes to files under `.codetrellis/
 * plans/<slug>/` and routes channel-file changes here for re-import,
 * so events committed by a teammate's `git pull` appear locally.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { stampSelfWrite } from './self-write-tracker';
import { getPlan } from './plan-service';
import { makePlanSlug } from './plan-file-service';
import {
  postChannelEvent,
  eventToManifest,
  manifestToEventInput,
  type ChannelEventManifestRecord,
} from './channel-event-service';
import type { ChannelEvent } from '../../shared/types';

const CHANNELS_DIR_NAME = 'channels';

/**
 * Compute the absolute directory for a plan's channel events.
 * `<projectRoot>/.codetrellis/plans/<slug>/channels/`
 */
export function channelsDirFor(planUid: string, projectRoot: string): string {
  const plan = getPlan(planUid);
  const slug = plan ? makePlanSlug(plan) : planUid;
  return path.join(projectRoot, '.codetrellis', 'plans', slug, CHANNELS_DIR_NAME);
}

/**
 * Write a single channel event to disk. Creates the channels/
 * directory if missing. Stamps the file as a self-write so the
 * plan-file watcher doesn't re-import it as if it were external.
 */
export function exportChannelEvent(event: ChannelEvent, projectRoot: string): string {
  const dir = channelsDirFor(event.planUid, projectRoot);
  ensureDir(dir);
  const filePath = path.join(dir, `${event.uid}.yaml`);
  const record = eventToManifest(event);
  writeAtomic(filePath, stringifyYaml(record));
  return filePath;
}

/**
 * Remove a channel event file from disk. Used when an event is
 * deleted (rare — events are append-only in normal use; this exists
 * for test cleanup and operator overrides).
 */
export function removeChannelEventFile(eventUid: string, planUid: string, projectRoot: string): boolean {
  const filePath = path.join(channelsDirFor(planUid, projectRoot), `${eventUid}.yaml`);
  if (!fs.existsSync(filePath)) return false;
  stampSelfWrite(filePath);
  fs.unlinkSync(filePath);
  return true;
}

/**
 * Read a single channel event YAML file and upsert it into the DB.
 * Called by the file watcher when an event file changes (e.g., after
 * `git pull` brings in a teammate's event).
 *
 * Pass the containing plan directory; the planUid is read from
 * `plan.yaml` inside it. Returns null if the file or plan.yaml is
 * unreadable.
 */
export function importChannelEvent(filePath: string, planDir: string): ChannelEvent | null {
  if (!fs.existsSync(filePath)) return null;

  const planUid = readPlanUidFromDir(planDir);
  if (!planUid) {
    console.warn(`[ChannelEvents] Could not resolve plan UID from ${planDir} — skipping import.`);
    return null;
  }

  try {
    const raw = parseYaml(fs.readFileSync(filePath, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as ChannelEventManifestRecord;
    if (!record.uid || !record.eventType || !record.payload) return null;
    const input = manifestToEventInput(planUid, record);
    return postChannelEvent(input);
  } catch (err) {
    console.warn(`[ChannelEvents] Failed to import ${filePath}:`, err);
    return null;
  }
}

function readPlanUidFromDir(planDir: string): string | null {
  const planYaml = path.join(planDir, 'plan.yaml');
  if (!fs.existsSync(planYaml)) return null;
  try {
    const raw = parseYaml(fs.readFileSync(planYaml, 'utf-8'));
    if (raw && typeof raw === 'object' && typeof (raw as any).uid === 'string') {
      return (raw as any).uid as string;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * List every channel event YAML file under a plan's channels/ dir.
 * Used by the bulk re-importer to rebuild a plan's channel state from
 * disk (e.g., after a project clone).
 */
export function discoverChannelEventFiles(planDir: string): string[] {
  const dir = path.join(planDir, CHANNELS_DIR_NAME);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => path.join(dir, f));
}

/** True if `filePath` is a channel event YAML inside a plan dir. */
export function isChannelEventFile(filePath: string): boolean {
  return path.basename(path.dirname(filePath)) === CHANNELS_DIR_NAME && filePath.endsWith('.yaml');
}

// --- internals --------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filePath);
  stampSelfWrite(filePath);
}
