/**
 * The demo's command-line options, parsed once into a plain object. Nothing
 * here reads `process.argv` itself, so a test can build options and import
 * the scene groups without running anything.
 */
import os from 'node:os';
import path from 'node:path';

export interface DemoOptions {
  argv: string[];
  /** This repository: the sample fixture, and the connector run from source. */
  repo: string;
  pace: 'slow' | 'normal' | 'fast';
  /** Milliseconds a beat lasts at this pace. */
  beat: number;
  project: string;
  dataDir: string;
  mcpPort: number;
  apiPort: number;
  /** `--scene=<id>`: one scene, looked for in every group. */
  scene?: string;
  /** `--group=<id>[,<id>]`: those groups. */
  groups?: string[];
  shots?: string;
  /**
   * The brief scene needs a person to decide in the window — send back,
   * approve: MCP cannot, by design. `--decide` stands in for them through the
   * desktop's own HTTP route, which a packaged build does not serve, so
   * there it waits for a person.
   */
  decide: boolean;
  personWaitS: number;
  /**
   * The connector bundle a packaged app ships. Without it, the connector
   * runs from source — the same code, against the same running app.
   */
  connector?: string;
  list: boolean;
}

export function parseOptions(argv: string[], repo: string): DemoOptions {
  const flag = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const has = (name: string) => argv.includes(`--${name}`);
  const pace = (flag('pace') ?? 'normal') as DemoOptions['pace'];
  const groups = flag('group')?.split(',').map((g) => g.trim()).filter(Boolean);
  return {
    argv,
    repo,
    pace,
    beat: { slow: 4200, normal: 2400, fast: 900 }[pace] ?? 2400,
    project: path.resolve(flag('project') ?? path.join(repo, 'tests/fixtures/sample-app')),
    dataDir: flag('data-dir') ?? process.env.CODETRELLIS_DATA_DIR ?? path.join(os.homedir(), '.codetrellis'),
    mcpPort: Number(flag('port') ?? 19432),
    apiPort: Number(flag('api-port') ?? 3001),
    scene: flag('scene'),
    groups: groups?.length ? groups : undefined,
    shots: flag('shots'),
    decide: has('decide'),
    personWaitS: Number(flag('person-wait') ?? 180),
    connector: flag('connector'),
    list: has('list'),
  };
}
