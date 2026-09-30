/**
 * Secrets kept for the person (Phase 32 C2.2a): a review host's token.
 *
 * CLAUDE.md and the shared-work doc (C-2 §5): credentials live in the OS
 * keychain, never in the repository, a plan file or the database. The
 * packaged app runs this backend inside Electron's main process, whose
 * `safeStorage` encrypts with a key the OS keychain holds (Keychain on
 * macOS, DPAPI on Windows, the Secret Service on Linux). Only the ciphertext
 * is written, one file per secret under `<dataDir>/secrets/`, mode 0600.
 *
 * Where there is no keychain to hold that key, a secret is kept in memory
 * only, until the app quits, and the store says so: under plain Node (dev,
 * the test harness), or on Linux where Electron falls back to its built-in
 * "basic_text" key, which protects nothing. A plain-text copy on disk is
 * never the fallback.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './persistence';

export interface SecretStore {
  /** `os-keychain` persists, encrypted; `memory` lasts until the app quits. */
  kind: 'os-keychain' | 'memory';
  /** Where a saved secret lives, in words for Settings. */
  where: string;
  has(key: string): boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface Cipher {
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

const KEY = /^[a-z][a-z0-9:._-]{0,127}$/;
function checkKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`Not a secret key: ${key}`);
}

export function memoryStore(why: string): SecretStore {
  const values = new Map<string, string>();
  return {
    kind: 'memory',
    where: `kept only until CodeTrellis quits: ${why}`,
    has: (key) => values.has(key),
    get: (key) => values.get(key) ?? null,
    set: (key, value) => { checkKey(key); values.set(key, value); },
    delete: (key) => { values.delete(key); },
  };
}

/** Ciphertext on disk, one file per secret, named by the key's hash so the file name says nothing. */
export function fileStore(dir: string, cipher: Cipher, where: string): SecretStore {
  const fileOf = (key: string) => path.join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.bin`);
  return {
    kind: 'os-keychain',
    where,
    has: (key) => fs.existsSync(fileOf(key)),
    get: (key) => {
      try { return cipher.decrypt(fs.readFileSync(fileOf(key))); } catch { return null; }
    },
    set: (key, value) => {
      checkKey(key);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = fileOf(key);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, cipher.encrypt(value), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
    delete: (key) => { fs.rmSync(fileOf(key), { force: true }); },
  };
}

interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
  getSelectedStorageBackend?(): string;
}

function electronSafeStorage(): SafeStorage | null {
  if (!process.versions.electron) return null;
  try {
    const { safeStorage } = require('electron') as { safeStorage?: SafeStorage };
    return safeStorage ?? null;
  } catch {
    return null;
  }
}

const KEYCHAIN_NAME: Record<string, string> = { darwin: 'the macOS Keychain', win32: 'Windows (DPAPI)', linux: 'the system keyring' };

/** The store this process can offer, decided once. */
export function openSecretStore(): SecretStore {
  const safe = electronSafeStorage();
  if (!safe) return memoryStore('this build has no OS keychain (it is not running inside the desktop app)');
  if (!safe.isEncryptionAvailable()) return memoryStore('the OS keychain is not available');
  if (process.platform === 'linux' && safe.getSelectedStorageBackend?.() === 'basic_text') {
    return memoryStore('no system keyring is running, so the token could not be encrypted');
  }
  return fileStore(
    path.join(getDataDir(), 'secrets'),
    { encrypt: (s) => safe.encryptString(s), decrypt: (b) => safe.decryptString(b) },
    `encrypted with a key held by ${KEYCHAIN_NAME[process.platform] ?? 'the OS keychain'}`,
  );
}

let store: SecretStore | null = null;

export function secretStore(): SecretStore {
  return (store ??= openSecretStore());
}
