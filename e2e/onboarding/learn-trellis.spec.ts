/**
 * Learn Trellis — 9-step fullscreen onboarding tutorial.
 *
 * Covers: auto-open on first visit, step navigation (buttons, dots,
 * keyboard arrows), Escape/backdrop close, MCP config copy, Done button.
 */

import { test, expect } from '@playwright/test';

test.describe('Learn Trellis tutorial', () => {
  test('auto-opens on first visit (no localStorage flag)', async ({ page }) => {
    // Clear any existing flag
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    // Dialog should appear
    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  });

  test('does NOT auto-open when seen flag is set', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('codetrellis:learn-trellis:seen', '1');
    });
    await page.goto('/');
    await page.waitForTimeout(2000);

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).not.toBeVisible();
  });

  test('shows step 1 with Welcome eyebrow', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Step counter should show "1 / 9"
    await expect(page.getByText('1 / 9')).toBeVisible();
    // Step 1 eyebrow
    await expect(page.getByRole('button', { name: 'Step 1: Welcome' })).toBeVisible();
  });

  test('Next button advances to step 2', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('2 / 9')).toBeVisible();
  });

  test('Back button returns to previous step', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Go to step 2
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('2 / 9')).toBeVisible();

    // Back to step 1
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('1 / 9')).toBeVisible();
  });

  test('Back button is disabled on step 1', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const backBtn = page.getByRole('button', { name: 'Back' });
    await expect(backBtn).toBeDisabled();
  });

  test('step dots are clickable — jump to step 5', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Click step 5 dot ("Adjusting")
    await page.getByRole('button', { name: 'Step 5: Adjusting' }).click();
    await expect(page.getByText('5 / 9')).toBeVisible();
  });

  test('Arrow Right advances, Arrow Left goes back', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('2 / 9')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('1 / 9')).toBeVisible();
  });

  test('Escape closes the tutorial', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('Skip button closes the tutorial', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Skip onboarding' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('Done button on step 9 closes tutorial', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Jump to step 9 via dot
    await page.getByRole('button', { name: /Step 9/ }).click();
    await expect(page.getByText('9 / 9')).toBeVisible();

    // Done button should be visible instead of Next
    const doneBtn = page.getByRole('button', { name: 'Done' });
    await expect(doneBtn).toBeVisible();
    await doneBtn.click();
    await expect(dialog).not.toBeVisible();
  });

  test('closing sets localStorage flag (does not reopen on reload)', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    // Verify the flag was set in localStorage
    const flag = await page.evaluate(() =>
      localStorage.getItem('codetrellis:learn-trellis:seen'),
    );
    expect(flag).toBe('1');
  });

  test('MCP config copy button on step 7', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('codetrellis:learn-trellis:seen');
    });
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Learn CodeTrellis' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Jump to "Pointing agents" (step 7)
    await page.getByRole('button', { name: /Step 7/ }).click();
    await expect(page.getByText('7 / 9')).toBeVisible();

    // Copy snippet button should exist
    const copyBtn = page.getByRole('button', { name: 'Copy snippet' });
    await expect(copyBtn).toBeVisible();
  });
});
