import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Demo@123';

export async function signIn(page: Page, username: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await expect(page).not.toHaveURL(/\/login/);
}

/** Calls the API with the page's session cookie. */
export async function apiCall<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const t = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${t}`);
      return (t ? JSON.parse(t) : null) as unknown;
    },
    { method, path, body },
  ) as Promise<T>;
}

/** Creates and finalizes a credit bill with n lines (quantity 1 each). */
export async function makeBill(page: Page, n: number): Promise<string> {
  const products = await apiCall<{ items: { id: string; stock: number }[] }>(page, 'GET', '/products/available');
  const ids = products.items.filter((p) => p.stock > 25).map((p) => p.id);
  const customers = await apiCall<{ items: { id: string }[] }>(page, 'GET', '/customers?type=RETAIL');
  const items = Array.from({ length: n }, (_, i) => ({ productId: ids[i % ids.length], qty: 1, discountPct: 0 }));
  const draft = await apiCall<{ id: string }>(page, 'POST', '/invoices', { type: 'CREDIT', customerId: customers.items[0]?.id, items });
  await apiCall(page, 'POST', `/invoices/${draft.id}/finalize`);
  return draft.id;
}
