/**
 * The terminal list fetched when the window connects never undoes what
 * happened while it was on its way: CI's browser suite opened the panel, its
 * shell started, and the older, empty list then replaced it (#387).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTerminalStore, type TerminalSessionInfo } from './terminal-store';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  useTerminalStore.setState({ sessions: [], activeSessionId: null, isOpen: false });
});

const session = (id: string): TerminalSessionInfo => ({ id, preset: 'shell', title: `Terminal ${id}`, cwd: '/p', pid: 1, createdAt: 0, alive: true });

/** fetch answering GET /api/terminals when told to, and POST at once. */
function backend(created: TerminalSessionInfo) {
  let answerList: (list: TerminalSessionInfo[]) => void = () => {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify(created), { status: 200 });
    const list = await new Promise<TerminalSessionInfo[]>((resolve) => { answerList = resolve; });
    return new Response(JSON.stringify(list), { status: 200 });
  }) as typeof fetch;
  return { answer: (list: TerminalSessionInfo[]) => answerList(list) };
}

test('a shell started while the list was on its way stays', async () => {
  const api = backend(session('t1'));
  const hydrating = useTerminalStore.getState().hydrate();
  await useTerminalStore.getState().createSession('shell');
  api.answer([]);
  await hydrating;
  const s = useTerminalStore.getState();
  assert.deepEqual(s.sessions.map((ss) => ss.id), ['t1']);
  assert.equal(s.activeSessionId, 't1');
});

test('a session closed while the list was on its way stays closed', async () => {
  useTerminalStore.setState({ sessions: [session('t1'), session('t2')], activeSessionId: 't1' });
  const api = backend(session('t3'));
  const hydrating = useTerminalStore.getState().hydrate();
  useTerminalStore.getState().onTerminalKilled('t1');
  api.answer([session('t1'), session('t2')]);
  await hydrating;
  const s = useTerminalStore.getState();
  assert.deepEqual(s.sessions.map((ss) => ss.id), ['t2']);
  assert.equal(s.activeSessionId, 't2');
});

test('otherwise the list is what the backend has', async () => {
  useTerminalStore.setState({ sessions: [session('gone')], activeSessionId: 'gone' });
  const api = backend(session('t9'));
  const hydrating = useTerminalStore.getState().hydrate();
  api.answer([session('a'), session('b')]);
  await hydrating;
  const s = useTerminalStore.getState();
  assert.deepEqual(s.sessions.map((ss) => ss.id), ['a', 'b']);
  assert.equal(s.activeSessionId, 'a');
});
