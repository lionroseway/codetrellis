/**
 * Phase 33 follow-up — commands a file runs and environment variables it
 * reads, in every language with callsites, as call entries a rule can hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProcessAndEnv, programOf } from './process-env';
import { callEntry, callProblem, callWords } from '../../../shared/lib/call-entry';
import { reachWords } from '../../../shared/lib/check-words';
import type { SupportedLanguage } from '../../../shared/types';

const entries = (language: SupportedLanguage, content: string) =>
  extractProcessAndEnv(language, content).map((cs) => `${cs.line} ${callEntry(cs)}`);

test('TypeScript and JavaScript: child_process and execa with a literal; process.env, import.meta.env and Deno.env', () => {
  const src = [
    "import { execFile, spawnSync } from 'node:child_process';",
    "execFile('git', ['status']);",
    "spawnSync('/usr/bin/ffmpeg', ['-i', input]);",
    "child_process.exec('curl -s https://example.com');",
    'const key = process.env.STRIPE_SECRET_KEY;',
    "const url = process.env['DATABASE_URL'];",
    'const mode = import.meta.env.VITE_MODE;',
    "const t = Deno.env.get('TOKEN');",
    // Nothing a rule could hold: a variable command, a computed name, a regex's exec.
    'spawn(cmd);',
    'process.env[name];',
    're.exec(text);',
  ].join('\n');
  assert.deepEqual(entries('typescript', src), [
    '2 exec:git', '3 exec:ffmpeg', '4 exec:curl',
    '5 env:STRIPE_SECRET_KEY', '6 env:DATABASE_URL', '7 env:VITE_MODE', '8 env:TOKEN',
  ]);
  assert.deepEqual(entries('javascript', "require('child_process').execSync('npm test');"), ['1 exec:npm']);
  // Only the program must be literal: the rest of the command may hold quotes and interpolation.
  assert.deepEqual(entries('typescript', 'execSync(`curl -s -H "Authorization: Bearer ${key}" https://api.stripe.com`);\nspawn(`${bin} --watch`);'), ['1 exec:curl']);
});

test('Python, Go, Ruby, C#, Kotlin, Java, Swift, Rust and PHP each name their commands and variables', () => {
  assert.deepEqual(entries('python', [
    "subprocess.run(['git', 'log'])",
    "subprocess.check_output('docker ps', shell=True)",
    "os.system('rm -rf build')",
    "token = os.environ['GITHUB_TOKEN']",
    "debug = os.environ.get('DEBUG')",
    "home = os.getenv('HOME')",
  ].join('\n')), ['1 exec:git', '2 exec:docker', '3 exec:rm', '4 env:GITHUB_TOKEN', '5 env:DEBUG', '6 env:HOME']);
  assert.deepEqual(entries('go', 'cmd := exec.Command("git", "status")\nc := exec.CommandContext(ctx, "kubectl", "apply")\nk := os.Getenv("API_KEY")\nv, ok := os.LookupEnv("REGION")'),
    ['1 exec:git', '2 exec:kubectl', '3 env:API_KEY', '4 env:REGION']);
  assert.deepEqual(entries('ruby', "system('make build')\nout, s = Open3.capture2('git rev-parse HEAD')\nx = %x(uname -a)\nkey = ENV['SECRET_KEY_BASE']\nhost = ENV.fetch('HOST')\nobj.exec('not a process')"),
    ['1 exec:make', '2 exec:git', '3 exec:uname', '4 env:SECRET_KEY_BASE', '5 env:HOST']);
  assert.deepEqual(entries('csharp', 'Process.Start("notepad.exe");\nvar psi = new ProcessStartInfo("dotnet", "build");\nvar c = Environment.GetEnvironmentVariable("CONN");'),
    ['1 exec:notepad', '2 exec:dotnet', '3 env:CONN']);
  assert.deepEqual(entries('kotlin', 'ProcessBuilder(listOf("git", "pull")).start()\nRuntime.getRuntime().exec("ls -la")\nval k = System.getenv("KOTLIN_KEY")'),
    ['1 exec:git', '2 exec:ls', '3 env:KOTLIN_KEY']);
  assert.deepEqual(entries('java', 'new ProcessBuilder("mvn", "test").start();\nString h = System.getenv("JAVA_HOME");'), ['1 exec:mvn', '2 env:JAVA_HOME']);
  assert.deepEqual(entries('swift', 'p.executableURL = URL(fileURLWithPath: "/usr/bin/swift")\nlet t = ProcessInfo.processInfo.environment["TOKEN"]'), ['1 exec:swift', '2 env:TOKEN']);
  assert.deepEqual(entries('rust', 'Command::new("cargo").arg("build");\nlet k = env::var("RUST_LOG");'), ['1 exec:cargo', '2 env:RUST_LOG']);
  assert.deepEqual(entries('php', "shell_exec('whoami');\n$k = getenv('PHP_KEY');\n$d = $_ENV['DB_HOST'];"), ['1 exec:whoami', '2 env:PHP_KEY', '3 env:DB_HOST']);
});

test('a command is its program, without its folder; what a shell would expand is no program', () => {
  assert.equal(programOf('/usr/local/bin/git status'), 'git');
  assert.equal(programOf('  npm  run build'), 'npm');
  assert.equal(programOf('C:/Tools/notepad.exe'), 'notepad');
  assert.equal(programOf('${CMD} --flag'), null);
  assert.equal(programOf('`which git`'), null);
});

test('the entries are calls a rule names, in words', () => {
  assert.equal(callEntry({ kind: 'subprocess', urlPattern: 'git' }), 'exec:git');
  assert.equal(callEntry({ kind: 'env_lookup', urlPattern: 'STRIPE_SECRET_KEY' }), 'env:STRIPE_SECRET_KEY');
  assert.equal(callProblem('exec:git'), null);
  assert.equal(callProblem('env:STRIPE_SECRET_KEY'), null);
  assert.equal(callWords('exec:git'), 'the command git');
  assert.equal(callWords('exec:*'), 'any command');
  assert.equal(callWords('env:*'), 'any environment variable');
  assert.equal(callWords('env:STRIPE_SECRET_KEY'), 'the environment variable STRIPE_SECRET_KEY');
  assert.equal(reachWords('exec:curl'), 'runs curl');
  assert.equal(reachWords('env:STRIPE_SECRET_KEY'), 'reads the environment variable STRIPE_SECRET_KEY');
});
