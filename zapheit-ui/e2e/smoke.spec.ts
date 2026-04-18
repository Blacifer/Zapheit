import { test, expect, type Page } from '@playwright/test';

const E2E_EMAIL = process.env.E2E_DEMO_EMAIL || process.env.DEMO_EMAIL || '';
const E2E_PASSWORD = process.env.E2E_DEMO_PASSWORD || process.env.DEMO_PASSWORD || '';
const E2E_CHAT_PROVIDER_KEY = process.env.E2E_CHAT_PROVIDER_KEY || '';
const E2E_CHAT_PROVIDER = process.env.E2E_CHAT_PROVIDER || 'openrouter';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(E2E_EMAIL);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

async function openChat(page: Page) {
  await page.goto('/dashboard/chat');
  await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();
  await expect(page.getByText('Runtime source')).toBeVisible();
  await expect(page.getByRole('button', { name: /open governed mode|hide governed mode/i })).toBeVisible();
}

test.describe('Smoke tests', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/zapheit|rasi|synthetic/i);
    await expect(page.locator('body')).toBeVisible();
  });

  test('login page renders form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /sign in|log in/i })).toBeVisible();
  });

  test('signup page renders form', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('button', { name: /sign up|create|get started/i })).toBeVisible();
  });

  test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain('/login');
  });

  test('404 page on unknown route', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByRole('heading', { name: /not found/i })).toBeVisible();
  });

  test('pricing page loads', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Authenticated chat smoke', () => {
  test.skip(!E2E_EMAIL || !E2E_PASSWORD, 'E2E_DEMO_EMAIL/DEMO_EMAIL and E2E_DEMO_PASSWORD/DEMO_PASSWORD are required.');

  test('chat workspace loads and governed panel toggles', async ({ page }) => {
    await login(page);
    await openChat(page);

    await expect(page.getByRole('button', { name: 'New Chat' })).toBeVisible();
    await expect(page.getByPlaceholder('Start a new message...')).toBeVisible();

    await page.getByRole('button', { name: /open governed mode/i }).click();
    await expect(page.getByRole('heading', { name: 'Governed Mode' })).toBeVisible();
    await expect(page.getByText('Execution mode')).toBeVisible();
    await expect(page.getByText('Connected app')).toBeVisible();
  });

  test('manage chat keys modal opens from chat', async ({ page }) => {
    await login(page);
    await openChat(page);

    await page.getByRole('button', { name: /manage keys/i }).click();
    await expect(page.getByRole('heading', { name: 'Manage Chat Keys' })).toBeVisible();
    await expect(page.getByText(/stored server-side and encrypted at rest/i)).toBeVisible();
    await page.getByRole('button', { name: /close manage chat keys/i }).click();
    await expect(page.getByRole('heading', { name: 'Manage Chat Keys' })).toHaveCount(0);
  });

  test('can create and delete a backend-managed chat runtime profile when provider key env is available', async ({ page }) => {
    test.skip(!E2E_CHAT_PROVIDER_KEY, 'E2E_CHAT_PROVIDER_KEY is required for profile creation smoke.');

    const label = `Smoke Profile ${Date.now()}`;

    await login(page);
    await openChat(page);
    await page.getByRole('button', { name: /manage keys/i }).click();
    await expect(page.getByRole('heading', { name: 'Manage Chat Keys' })).toBeVisible();

    await page.getByLabel('Profile type').selectOption('provider');
    await page.getByLabel('Provider').selectOption(E2E_CHAT_PROVIDER);
    await page.getByLabel('Label').fill(label);
    await page.getByLabel('API key').fill(E2E_CHAT_PROVIDER_KEY);
    await page.getByRole('button', { name: /save profile/i }).click();

    await expect(page.getByText('Chat runtime profile saved securely')).toBeVisible();
    await expect(page.getByRole('button', { name: /manage keys/i })).toBeVisible();

    await page.getByRole('button', { name: /manage keys/i }).click();
    const profileCard = page.locator('div.rounded-2xl').filter({ hasText: label }).first();
    await expect(profileCard).toBeVisible();
    await profileCard.getByRole('button', { name: /delete/i }).click();
    await expect(profileCard).toHaveCount(0);
  });
});
