/**
 * Every scene group, in the order `--all` runs them. A group is one module
 * under `groups/`; add it here and to `docs/DEMO-JOURNEYS.md`, which
 * `src/backend/demo-catalogue.test.ts` checks.
 */
import type { Group } from './types';
import { mainGroup } from './groups/main';

export const GROUPS: Group[] = [mainGroup];

/** The group `npm run demo` runs when none is named. */
export const DEFAULT_GROUP = 'main';
