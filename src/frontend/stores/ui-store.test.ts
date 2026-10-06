import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useUiStore } from './ui-store';

const panels = () => {
  const s = useUiStore.getState();
  return { sidebar: s.sidebarVisible, inspector: s.inspectorVisible, planPanel: s.agentPanelVisible };
};

test('full screen hides the three panels and puts back exactly the ones that were showing (G4)', () => {
  useUiStore.setState({ sidebarVisible: true, inspectorVisible: false, agentPanelVisible: true, fullScreenFrom: null });
  useUiStore.getState().toggleFullScreen();
  assert.deepEqual(panels(), { sidebar: false, inspector: false, planPanel: false });
  assert.deepEqual(useUiStore.getState().fullScreenFrom, { sidebar: true, inspector: false, planPanel: true });
  useUiStore.getState().toggleFullScreen();
  assert.deepEqual(panels(), { sidebar: true, inspector: false, planPanel: true });
  assert.equal(useUiStore.getState().fullScreenFrom, null);
});
