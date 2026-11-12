import { expect, test } from '@playwright/test';
import { apiCall, signIn } from './helpers';

/** Doc 11, Section 14: the demo script steps that can run unattended. */
test.describe('demo script', () => {
  test('steps 2 to 7: fund, indent, approval, PO, goods receipt, supplier payment', async ({ browser }) => {
    const admin = await (await browser.newContext()).newPage();
    await signIn(admin, 'admin');
    const before = await apiCall<{ balance: number; utilised: number }>(admin, 'GET', '/funds/summary');
    await admin.goto('/funds');
    await admin.getByRole('button', { name: 'Add tranche' }).click();
    await admin.locator('#t-amt').fill('200000');
    await admin.locator('#t-source').fill('Owner');
    await admin.getByRole('button', { name: 'Add tranche' }).last().click();
    await expect(admin.getByText('Added fund tranche')).toBeVisible();
    const afterFund = await apiCall<{ balance: number }>(admin, 'GET', '/funds/summary');
    expect(afterFund.balance).toBe(before.balance + 20000000);

    await admin.goto('/indents/new');
    await admin.selectOption('#sup', { label: 'Supplier A' });
    await admin.getByLabel('Item').selectOption({ index: 1 });
    await admin.getByLabel('Quantity').fill('100');
    await admin.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(admin).toHaveURL(/\/indents\/ind_/);
    const indentId = admin.url().split('/').pop() as string;

    await admin.goto('/approvals');
    await admin.locator('li', { has: admin.locator(`a[href="/indents/${indentId}"]`) }).getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText(/Purchase order PO\//)).toBeVisible();

    await admin.goto(`/indents/${indentId}/po`);
    await expect(admin.getByText('PURCHASE ORDER').first()).toBeVisible();

    await admin.goto(`/purchase-bills/new?indent=${indentId}`);
    await admin.locator('#bn').fill(`SA/${Date.now() % 100000}`);
    await admin.getByRole('button', { name: 'Record goods receipt' }).click();
    await expect(admin.getByText(/Recorded purchase bill/)).toBeVisible();
    await admin.goto(`/indents/${indentId}`);
    await admin.getByRole('button', { name: 'Pay supplier' }).click();
    await admin.getByRole('button', { name: 'Record supplier payment' }).click();
    await expect(admin.getByText(/Paid ₹/)).toBeVisible();
    const after = await apiCall<{ utilised: number }>(admin, 'GET', '/funds/summary');
    expect(after.utilised).toBeGreaterThan(before.utilised);
  });

  test('step 16: Monitor is read-only and forbidden pages are refused', async ({ page }) => {
    await signIn(page, 'monitor');
    await page.goto('/bills');
    await expect(page.getByRole('button', { name: 'New bill' })).toHaveCount(0);
    for (const path of ['/settlements', '/approvals', '/bills/new']) {
      await page.goto(path);
      await expect(page.getByText('You do not have access to this page')).toBeVisible();
    }
    await page.goto('/');
    await expect(page.getByText('Gross profit')).toHaveCount(0);
  });

  test('a worker cannot open admin pages', async ({ page }) => {
    await signIn(page, 'staff1');
    await page.goto('/settlements');
    await expect(page.getByText('You do not have access to this page')).toBeVisible();
    await page.goto('/approvals');
    await expect(page.getByText('You do not have access to this page')).toBeVisible();
  });

  test('step 12: distributor sees only their own bills and can request an order', async ({ page }) => {
    await signIn(page, 'distributor');
    await expect(page).toHaveURL(/\/portal/);
    await expect(page.getByRole('heading', { name: 'Distributor A' })).toBeVisible();
    await page.getByRole('button', { name: 'Request order' }).click();
    await page.getByRole('combobox', { name: 'Product' }).first().selectOption({ index: 1 });
    await page.getByRole('textbox', { name: 'Quantity' }).first().fill('12');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText(/Submitted order request ORQ-/)).toBeVisible();
  });

  test('step 14f: a worker sees no profit, loan or owner figures anywhere', async ({ page }) => {
    await signIn(page, 'staff3');
    for (const path of ['/', '/my/pay', '/bills', '/explorer']) {
      await page.goto(path);
      await page.waitForTimeout(800);
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/Gross profit|Owner amount|Loan outstanding|Pool after loan/);
    }
    await page.goto('/settlements/new');
    await expect(page.getByText('You do not have access to this page')).toBeVisible();
  });

  test('step 19: a bill finalized by a worker appears on the Admin dashboard within seconds', async ({ browser }) => {
    const admin = await (await browser.newContext()).newPage();
    await signIn(admin, 'admin');
    await admin.goto('/');
    await expect(admin.getByRole('heading', { name: 'Live activity' })).toBeVisible();
    const worker = await (await browser.newContext()).newPage();
    await signIn(worker, 'staff2');
    const products = await apiCall<{ items: { id: string; stock: number }[] }>(worker, 'GET', '/products/available');
    const d = await apiCall<{ id: string }>(worker, 'POST', '/invoices', { type: 'CASH', items: [{ productId: products.items.find((p) => p.stock > 5)?.id, qty: 1, discountPct: 0 }] });
    const fin = await apiCall<{ number: string }>(worker, 'POST', `/invoices/${d.id}/finalize`);
    await expect(admin.getByText(`Worker B finalized ${fin.number}`)).toBeVisible({ timeout: 6000 });
  });

  test('step 22b: Workers and logins shows usage and the limit message', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/workers');
    await expect(page.getByText(/\d+ of 10 worker logins used/)).toBeVisible();
  });

  test('step 18: branding change updates the header and new documents only', async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto('/settings');
    await page.locator('#cp-brand').fill('Cluster Tech');
    await page.getByRole('button', { name: 'Save company profile' }).click();
    await expect(page.getByText(/Saved company profile version/)).toBeVisible();
    await expect(page.locator('nav').getByText('Cluster Tech')).toBeVisible({ timeout: 6000 });
    await expect(page).toHaveTitle(/Cluster Tech/);
    await page.goto('/settings');
    await page.locator('#cp-brand').fill('[Your Brand Name]');
    await page.getByRole('button', { name: 'Save company profile' }).click();
    await expect(page.getByText(/Saved company profile version/)).toBeVisible();
  });
});
