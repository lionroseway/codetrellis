/**
 * expo-router in the preview (Phase 32 A4.5a): one screen at a time, so
 * navigation is recorded (`window.__PHONE_NAV__`) rather than performed, and
 * the route's params come from the page's query (`?params={...}`).
 */
import { useEffect, type ReactNode } from 'react';

type Nav = { action: string; to?: unknown };
function record(action: string, to?: unknown): void {
  const w = window as unknown as { __PHONE_NAV__?: Nav[] };
  (w.__PHONE_NAV__ ??= []).push({ action, to });
}

export const router = {
  push: (to: unknown) => record('push', to),
  replace: (to: unknown) => record('replace', to),
  navigate: (to: unknown) => record('navigate', to),
  back: () => record('back'),
  canGoBack: () => false,
  setParams: () => {},
};
export function useRouter() { return router; }
export function useNavigation() { return { setOptions: () => {}, goBack: () => record('back'), addListener: () => () => {} }; }
export function useLocalSearchParams<T = Record<string, string>>(): T {
  try { return JSON.parse(new URLSearchParams(window.location.search).get('params') ?? '{}') as T; } catch { return {} as T; }
}
export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(() => effect(), [effect]);
}

/** The header a screen asks for is shown above it, so a screenshot has the title. */
function Screen({ options }: { name?: string; options?: { title?: string; headerRight?: () => ReactNode } }) {
  useEffect(() => {
    const w = window as unknown as { __PHONE_TITLE__?: (t: string | undefined) => void };
    w.__PHONE_TITLE__?.(options?.title);
  }, [options?.title]);
  return null;
}
export const Stack = Object.assign(({ children }: { children?: ReactNode }) => <>{children}</>, { Screen });
export const Tabs = Object.assign(({ children }: { children?: ReactNode }) => <>{children}</>, { Screen });
export function Link({ children }: { children?: ReactNode; href?: unknown }) { return <>{children}</>; }
export const ThemeProvider = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const DarkTheme = {};
