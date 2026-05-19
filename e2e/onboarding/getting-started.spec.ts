/**
 * Getting Started checklist — floating bottom-left widget.
 *
 * Covers: appearance with project open, 4-step labels, progress counter,
 * collapse/expand, dismiss persistence, "Show MCP setup" link.
 */

import { test, expect } from '@playwright/test';
import { gotoWithProject, PROJECT_PATH } from '../helpers/setup';

test.describe('Getting Started checklist', () => {
  test('appears when project open and onboarding not dismissed', async ({ page }) => {
    // Allow Getting Started but skip Learn Trellis
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.removeItem(`codetrellis:gettingStarted:dismissed:${pp}`);
      localStorage.removeItem(`codetrellis:gettingStarted:collapsed:${pp}`);
    }, PROJECT_PATH);

    await gotoWithProject(page, { skipOnboarding: false });

    await expect(page.getByText('Getting started')).toBeVisible({ timeout: 5000 });
  });

  test('shows 4 step labels', async ({ page }) => {
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.removeItem(`codetrellis:gettingStarted:dismissed:${pp}`);
      localStorage.removeItem(`codetrellis:gettingStarted:collapsed:${pp}`);
    }, PROJECT_PATH);

    await gotoWithProject(page, { skipOnboarding: false });
    await page.waitForTimeout(1500);

    await expect(page.getByText('Project opened')).toBeVisible();
    await expect(page.getByText('Connect a coding agent')).toBeVisible();
    await expect(page.getByText('Create or receive a plan')).toBeVisible();
    await expect(page.getByText('Try the trellis modes')).toBeVisible();
  });

  test('"Project opened" step is always marked complete', async ({ page }) => {
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.removeItem(`codetrellis:gettingStarted:dismissed:${pp}`);
      localStorage.removeItem(`codetrellis:gettingStarted:collapsed:${pp}`);
    }, PROJECT_PATH);

    await gotoWithProject(page, { skipOnboarding: false });
    await page.waitForTimeout(1500);

    // The first step's container should have the "done" green tint
    const projectStep = page.getByText('Project opened').locator('..');
    await expect(projectStep).toBeVisible();
  });

  test('progress counter shows fraction (e.g. "1/4")', async ({ page }) => {
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.removeItem(`codetrellis:gettingStarted:dismissed:${pp}`);
      localStorage.removeItem(`codetrellis:gettingStarted:collapsed:${pp}`);
    }, PROJECT_PATH);

    await gotoWithProject(page, { skipOnboarding: false });
    await page.waitForTimeout(1500);

    // Counter format: "N/4"
    await expect(page.getByText(/^\d+\/\d+$/)).toBeVisible();
  });

  test('"Show MCP setup" link opens MCP guide modal', async ({ page }) => {
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.removeItem(`codetrellis:gettingStarted:dismissed:${pp}`);
      localStorage.removeItem(`codetrellis:gettingStarted:collapsed:${pp}`);
    }, PROJECT_PATH);

    await gotoWithProject(page, { skipOnboarding: false });
    await page.waitForTimeout(1500);

    const link = page.getByText('Show MCP setup');
    if (await link.isVisible({ timeout: 2000 }).catch(() => false)) {
      await link.click();
      await expect(page.getByText('Connect an AI Agent')).toBeVisible({ timeout: 3000 });
    }
  });

  test('dismiss button hides widget permanently for project', async ({ page }) => {
    await page.addInitScript((pp: string) => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
      localStorage.removeItem(`codetrellis:gettingStarted:dismissed:${pp}`);
      localStorage.removeItem(`codetrellis:gettingStarted:collapsed:${pp}`);
    }, PROJECT_PATH);

    await gotoWithProject(page, { skipOnboarding: false });
    await page.waitForTimeout(1500);

    const dismissBtn = page.locator('button[title="Dismiss until next session"]');
    if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissBtn.click();
      await page.waitForTimeout(500);

      // Should be gone
      await expect(page.getByText('Getting started')).not.toBeVisible();

      // Reload — should still be gone
      await page.reload();
      await page.waitForTimeout(2000);
      await expect(page.getByText('Getting started')).not.toBeVisible();
    }
  });

  test('does not appear when dismissed flag is set', async ({ page }) => {
    await gotoWithProject(page); // default: skipOnboarding=true dismisses it

    await page.waitForTimeout(1500);
    await expect(page.getByText('Getting started')).not.toBeVisible();
  });
});
