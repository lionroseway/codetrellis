import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { useToastStore } from './toast-store';

test('a toast with the key of one showing replaces it in place, and its timer starts again', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { addToast } = useToastStore.getState();
    useToastStore.setState({ toasts: [] });
    addToast({ type: 'info', title: 'Unrelated', duration: 5000 });
    addToast({ type: 'info', title: 'Plan reloaded from disk', message: '3 files changed.', key: 'plan-reload', duration: 5000 });
    mock.timers.tick(4000);
    addToast({ type: 'info', title: '2 plans reloaded from disk', message: '9 files changed.', key: 'plan-reload', duration: 5000 });

    const shown = useToastStore.getState().toasts;
    assert.deepEqual(shown.map((t) => t.title), ['Unrelated', '2 plans reloaded from disk'], 'replaced in its place, not stacked');

    mock.timers.tick(1500);
    assert.deepEqual(useToastStore.getState().toasts.map((t) => t.title), ['2 plans reloaded from disk'], 'the unrelated one went at 5 s; the replaced one started again');
    mock.timers.tick(4000);
    assert.deepEqual(useToastStore.getState().toasts, []);
  } finally {
    mock.timers.reset();
  }
});

test('toasts without a key still stack, five at most', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    useToastStore.setState({ toasts: [] });
    for (let i = 1; i <= 7; i++) useToastStore.getState().addToast({ type: 'info', title: `T${i}` });
    assert.deepEqual(useToastStore.getState().toasts.map((t) => t.title), ['T3', 'T4', 'T5', 'T6', 'T7']);
  } finally {
    mock.timers.reset();
    useToastStore.setState({ toasts: [] });
  }
});
