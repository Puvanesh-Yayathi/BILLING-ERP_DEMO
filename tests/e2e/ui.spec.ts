import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiCall, signIn } from './helpers';

const SCREENS = 'docs/screens';

test.describe('login page', () => {
  test('desktop and phone layouts', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('#username')).toBeFocused();
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${SCREENS}/login-desktop.png` });
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.screenshot({ path: `${SCREENS}/login-tablet.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.screenshot({ path: `${SCREENS}/login-phone.png` });
  });

  test('wrong password message does not say which field', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'not-right');
    await page.keyboard.press('Enter');
    await expect(page.getByText('The username or password is not correct.')).toBeVisible();
  });

  test('lockout countdown after repeated failures', async ({ page }) => {
    await page.goto('/login');
    for (let i = 0; i < 6; i++) {
      await page.fill('#username', 'nobody-here');
      await page.fill('#password', 'wrong');
      await page.click('button[type=submit]');
      await page.waitForTimeout(250);
    }
    await expect(page.getByText(/Too many attempts\. Try again in \d+:\d\d/)).toBeVisible();
  });

  test('keyboard only sign in', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.type('staff1');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Demo@123');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Welcome, Worker A/ })).toBeVisible();
  });

  test('reduced motion turns the contour animation off', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/login');
    const anim = await page.locator('.contours path').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
    await ctx.close();
  });
});

test.describe('design acceptance', () => {
  test('no gradients, no colour outside the palette, no emoji on key screens', async ({ page }) => {
    await signIn(page, 'admin');
    for (const path of ['/', '/bills/new', '/approvals', '/payroll/new', '/inventory', '/settlements/new']) {
      await page.goto(path);
      await page.waitForTimeout(1200);
      const issues = await page.evaluate(() => {
        const allowed = new Set(['rgb(255, 255, 255)', 'rgb(243, 245, 248)', 'rgb(220, 226, 234)', 'rgb(15, 42, 71)', 'rgb(31, 95, 153)', 'rgb(138, 90, 43)', 'rgb(91, 104, 120)', 'rgb(30, 123, 79)', 'rgb(166, 106, 18)', 'rgb(179, 38, 30)', 'rgb(0, 0, 0)']);
        const out: string[] = [];
        for (const el of document.querySelectorAll('body *')) {
          const s = getComputedStyle(el);
          if (s.backgroundImage.includes('gradient')) out.push(`gradient on ${el.tagName}`);
          for (const c of [s.color, s.backgroundColor, s.borderTopColor]) {
            const m = c.match(/^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/);
            if (!m) continue;
            if (m[4] !== undefined && Number(m[4]) < 1) continue;
            const key = `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
            if (!allowed.has(key)) out.push(`${key} on ${el.tagName}.${(el as HTMLElement).className}`);
          }
        }
        if (/\p{Extended_Pictographic}/u.test(document.body.innerText)) out.push('emoji in text');
        return [...new Set(out)].slice(0, 10);
      });
      expect(issues, path).toEqual([]);
    }
  });

  test('accessibility: no serious or critical issues on main screens', async ({ page }) => {
    await page.goto('/login');
    let r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await signIn(page, 'admin');
    for (const path of ['/', '/bills/new', '/bills', '/approvals']) {
      await page.goto(path);
      await page.waitForTimeout(1500);
      r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).exclude('.recharts-wrapper').analyze();
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${path}: ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    }
  });

  test('screenshots of key screens at desktop and tablet widths', async ({ page }) => {
    await signIn(page, 'admin');
    const shots: [string, string][] = [
      ['/', 'dashboard'],
      ['/bills/new', 'billing'],
      ['/approvals', 'approvals'],
      ['/payroll/new', 'payslip-overview'],
    ];
    for (const [path, name] of shots) {
      for (const [w, h, tag] of [
        [1440, 900, 'desktop'],
        [834, 1112, 'tablet'],
      ] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(path);
        if (name === 'payslip-overview') {
          await page.selectOption('#ps-w', { index: 1 });
          await page.waitForSelector('text=Day by day');
        }
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${SCREENS}/${name}-${tag}.png` });
      }
    }
    const bills = await apiCall<{ items: { id: string; number: string | null }[] }>(page, 'GET', '/invoices?limit=5');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/bills/${bills.items.find((b) => b.number)?.id}/print`);
    await page.waitForSelector('.a4-page[data-page]');
    await page.waitForTimeout(600);
    await page.locator('.a4-page[data-page="1"]').screenshot({ path: `${SCREENS}/printed-invoice.png` });
  });
});

test.describe('billing by keyboard', () => {
  test('type a product code, set quantity, finalize', async ({ page }) => {
    await signIn(page, 'staff2');
    await page.goto('/bills/new');
    await page.locator('#product-search').focus();
    await page.keyboard.type('PRD-A');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Quantity of Product A' })).toBeFocused();
    await page.keyboard.type('3');
    await expect(page.getByText('₹787.50').first()).toBeVisible();
    await page.getByRole('button', { name: 'Finalize bill' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/bills\/inv_/);
    await expect(page.getByRole('heading', { name: /Bill INV\// })).toBeVisible();
  });

  test('out-of-stock products are shown but cannot be added', async ({ page }) => {
    await signIn(page, 'staff1');
    await page.goto('/bills/new');
    await page.locator('#product-search').fill('PRD-G');
    await expect(page.getByRole('option', { name: /PRD-G/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
