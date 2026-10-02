/**
 * Show one section of Settings, photograph it, and close it again: the modal
 * covers the window, so a scene that left it open would spoil every shot
 * after it. Showing only — nothing in Settings is changed.
 */
import type { SettingsSection } from '../../../src/shared/types/settings';
import type { Ctx } from '../types';

export async function showSettings(c: Ctx, section: SettingsSection, shot: string, title: string, text: string): Promise<void> {
  await c.call('open_settings', { section });
  try {
    await c.say(title, text);
    await c.shot(shot, { settings: section });
  } finally {
    await c.call('close_settings', {});
  }
}
