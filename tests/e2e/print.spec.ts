import { expect, test } from '@playwright/test';
import { makeBill, signIn } from './helpers';

const MM = 96 / 25.4;

/** Section 9A: A4 pagination rules for invoices of 1, 10, 12, 25 and 60 items. */
test.describe('A4 invoice pagination', () => {
  test.beforeEach(async ({ page }) => signIn(page, 'admin'));

  for (const n of [1, 10, 12, 25, 60]) {
    test(`${n} items`, async ({ page }) => {
      const id = await makeBill(page, n);
      await page.goto(`/bills/${id}/print`);
      await page.waitForSelector('.a4-page[data-page]');
      await page.evaluate(() => document.fonts.ready);
      const pages = await page.$$eval('.a4-page[data-page]', (els) =>
        els.map((p) => {
          const body = p.querySelector('.a4-body') as HTMLElement;
          const box = p.getBoundingClientRect();
          const inner = [...p.querySelectorAll('.a4-body *')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
          return {
            text: p.textContent ?? '',
            rows: p.querySelectorAll('.a4-body tbody tr[data-row]').length,
            thead: !!p.querySelector('.a4-body thead'),
            tail: !!p.querySelector('[data-tail]'),
            clipped: body.scrollHeight > body.clientHeight + 1,
            left: Math.min(...inner.map((r) => r.left)) - box.left,
            right: box.right - Math.max(...inner.map((r) => r.right)),
            width: box.width,
          };
        }),
      );
      const total = pages.reduce((a, p) => a + p.rows, 0);
      expect(total).toBe(n);
      if (n === 12) expect(pages.map((p) => p.rows)).toEqual([10, 2]);
      pages.forEach((p, i) => {
        expect(p.text).toContain('TAX INVOICE');
        expect(p.text).toContain('[Your Brand Name]');
        expect(p.text).toContain(`Page ${i + 1} of ${pages.length}`);
        expect(p.thead).toBe(true);
        expect(p.tail).toBe(i === pages.length - 1);
        expect(p.clipped).toBe(false);
        expect(p.left).toBeGreaterThanOrEqual(10 * MM - 1);
        expect(p.right).toBeGreaterThanOrEqual(10 * MM - 1);
        expect(Math.round(p.width / MM)).toBe(210);
      });
      const last = pages[pages.length - 1];
      expect(last?.rows).toBeGreaterThanOrEqual(Math.min(2, n));
      expect(last?.text).toContain('Grand total');
      for (const p of pages.slice(0, -1)) {
        expect(p.text).toContain('Continued on next page');
        expect(p.text).not.toContain('Grand total');
      }
    });
  }

  test('reference image of a seeded invoice', async ({ page }) => {
    await page.goto('/bills');
    const first = await page.evaluate(async () => {
      const r = await fetch('/api/v1/invoices?limit=500');
      const j = (await r.json()) as { items: { id: string; number: string | null }[] };
      return j.items.filter((i) => i.number).sort((a, b) => String(a.number).localeCompare(String(b.number)))[0]?.id;
    });
    await page.goto(`/bills/${first}/print`);
    await page.waitForSelector('.a4-page[data-page]');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await expect(page.locator('.a4-page[data-page="1"]')).toHaveScreenshot('seeded-invoice-page1.png');
  });
});
