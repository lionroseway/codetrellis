/**
 * Welcome screen — landing page when no project is open.
 *
 * Covers: branding, CTA, layout chrome (TopBar, Sidebar, depth selector,
 * Connect Agent), and the 4-step onboarding cards.
 */

import { test, expect } from '@playwright/test';
import { gotoWelcome } from '../helpers/setup';

test.describe('Welcome screen', () => {
  test('renders CodeTrellis heading and subtitle', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await expect(page.getByRole('heading', { name: 'CodeTrellis', level: 1 })).toBeVisible();
    await expect(page.getByText('Visualize your codebase architecture')).toBeVisible();
  });

  test('shows "Open Project" CTA button', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await expect(page.getByRole('button', { name: 'Open Project' }).first()).toBeVisible();
  });

  test('shows 4-step onboarding cards when no recents', async ({ page }) => {
    // Clear recents so the cards show instead of the project list
    await page.addInitScript(() => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
    });
    await page.goto('/');
    await page.waitForTimeout(1500);

    // Which of three the screen leads with depends on shared state: the
    // step cards (nothing yet), recent projects, or — when an agent is
    // live on a project, as another spec's session may be — "an agent is
    // working here", which takes that project out of recents and hides
    // the cards. It must lead with one of them.
    const openCard = page.getByText('Open a project', { exact: true });
    const recentSection = page.getByText('Recent projects', { exact: true });
    const liveAgents = page.getByText(/^(An agent is|Agents are) working here$/);
    await expect(openCard.or(recentSection).or(liveAgents).first()).toBeVisible({ timeout: 5000 });
  });

  test('TopBar renders with depth selector', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await expect(page.getByRole('button', { name: 'Clusters' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Symbols' })).toBeVisible();
  });

  test('Sidebar renders with Explorer heading', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await expect(page.getByText('Explorer')).toBeVisible();
  });

  test('Connect Agent button is visible', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await expect(page.getByRole('button', { name: 'Connect Agent' })).toBeVisible();
  });

  test('StatusBar shows "No project" when idle', async ({ page }) => {
    await gotoWelcome(page, { skipLearnTrellis: true });

    await expect(page.getByText('No project')).toBeVisible();
  });
});
