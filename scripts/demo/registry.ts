/**
 * Every scene group, in the order `--all` runs them. A group is one module
 * under `groups/`; add it here and to `docs/DEMO-JOURNEYS.md`, which
 * `src/backend/demo-catalogue.test.ts` checks.
 */
import type { Group } from './types';
import { mainGroup } from './groups/main';
import { parallelGroup } from './groups/parallel';
import { observeGroup } from './groups/observe';
import { recordGroup } from './groups/record';
import { codeHistoryGroup } from './groups/code-history';
import { teamsGroup } from './groups/teams';
import { phoneGroup } from './groups/phone';
import { heroGroup } from './groups/hero';

export const GROUPS: Group[] = [mainGroup, parallelGroup, observeGroup, recordGroup, codeHistoryGroup, teamsGroup, phoneGroup, heroGroup];

/** The group `npm run demo` runs when none is named. */
export const DEFAULT_GROUP = 'main';
