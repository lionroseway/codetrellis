/**
 * One phone screen, in a phone-sized frame (Phase 32 A4.5a).
 *
 * `?screen=<name>` picks the screen; `?params={...}` are its route params.
 * The test puts the desktop's side on the page before it loads:
 * `window.__PHONE__ = { state, rpc }` — `state` merged into the live
 * snapshot, `rpc` the answers to the phone's calls (see stubs/rpc.ts).
 * `#phone[data-ready]` is set once the screen has mounted.
 */
import { StrictMode, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { Text, View } from 'react-native';
import { useWorkspaceStore } from '../../mobile/lib/store';
import type { WorkspaceSnapshot } from '../../mobile/lib/types';

/**
 * The screens the preview can show, by name, with the title the app's
 * layouts give them (app/_layout.tsx, app/(tabs)/_layout.tsx).
 */
const SCREENS: Record<string, { title: string; load: () => Promise<{ default: ComponentType }> }> = {
  home: { title: 'Home', load: () => import('../../mobile/app/(tabs)/index') },
  activity: { title: 'Activity', load: () => import('../../mobile/app/(tabs)/activity') },
  plans: { title: 'Plans', load: () => import('../../mobile/app/(tabs)/plans') },
  breakpoints: { title: 'Waiting on you', load: () => import('../../mobile/app/breakpoints') },
  approvals: { title: 'Waiting for you', load: () => import('../../mobile/app/approvals') },
  'signal-detail': { title: 'Overlap', load: () => import('../../mobile/app/signal-detail') },
  workstreams: { title: 'Lines of work', load: () => import('../../mobile/app/workstreams') },
  'workstream-detail': { title: 'Line of work', load: () => import('../../mobile/app/workstream-detail') },
  'review-queue': { title: 'Review queue', load: () => import('../../mobile/app/review-queue') },
  'plan-review': { title: 'Review', load: () => import('../../mobile/app/plan-review') },
};

const phone = (window as unknown as { __PHONE__?: { state?: Partial<WorkspaceSnapshot> } }).__PHONE__ ?? {};
useWorkspaceStore.getState().setConnectionState('connected', 'preview');
useWorkspaceStore.getState().applySnapshot({ ...(phone.state ?? {}) } as WorkspaceSnapshot);

function Preview() {
  const name = new URLSearchParams(window.location.search).get('screen') ?? 'home';
  const [Screen, setScreen] = useState<ComponentType | null>(null);
  const [title, setTitle] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (window as unknown as { __PHONE_TITLE__?: (t: string | undefined) => void }).__PHONE_TITLE__ = setTitle;
    const entry = SCREENS[name];
    if (!entry) { setError(`No screen named ${name}`); return; }
    entry.load().then((m) => setScreen(() => m.default)).catch((e: unknown) => setError(String(e)));
  }, [name]);
  return (
    <div id="phone" data-screen={name} data-ready={Screen ? '1' : undefined}
      style={{ width: 390, height: 844, margin: '0 auto', display: 'flex', flexDirection: 'column', background: '#09090b', overflow: 'hidden' }}>
      <View style={{ height: 52, justifyContent: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#27272a' }}>
        <Text style={{ color: '#fafafa', fontSize: 17, fontWeight: '600' }}>{title ?? SCREENS[name]?.title ?? name}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {error ? <Text style={{ color: '#f87171', padding: 16 }}>{error}</Text> : Screen ? <Screen /> : null}
      </View>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
