import type { CompanyProfile, CompanyProfileInput, Settings, SettingsInput } from '@app/contract';
import { audit, emit, newId, type Ctx } from '../ctx.js';
import { validation } from '../errors.js';
import type { AssetMeta, State } from '../state.js';
import { activeWorkerLogins } from './users.js';
import { currentProfile, find, requireRole } from './util.js';

export function updateSettings(s: State, ctx: Ctx, i: SettingsInput): Settings {
  requireRole(ctx, 'ADMIN');
  if (i.maxWorkerLogins < activeWorkerLogins(s))
    throw validation(`There are already ${activeWorkerLogins(s)} active worker logins`, {
      maxWorkerLogins: 'Deactivate workers first or choose a higher limit',
    });
  const before = { ...s.settings };
  s.settings = { ...s.settings, ...i };
  audit(ctx, 'settings', 'settings', 'update', 'Changed settings', before, s.settings);
  return s.settings;
}

export function updateWeeklyOffs(s: State, ctx: Ctx, weeklyOffs: number[]): Settings {
  requireRole(ctx, 'ADMIN');
  const before = [...s.settings.weeklyOffs];
  s.settings.weeklyOffs = [...new Set(weeklyOffs)].sort();
  audit(ctx, 'calendar', 'weekly-offs', 'update', 'Changed weekly off days', before, s.settings.weeklyOffs);
  return s.settings;
}

export function addHoliday(s: State, ctx: Ctx, date: string, name: string) {
  requireRole(ctx, 'ADMIN');
  if (s.holidays.some((h) => h.date === date)) throw validation('A holiday already exists on this date', { date: 'Choose another date' });
  if (s.attendance.some((a) => a.date === date && a.payslipId))
    throw validation('This date is already on a paid payslip', { date: 'Cancel the payslip first' });
  const h = { id: newId(s, 'hol'), date, name };
  s.holidays.push(h);
  s.holidays.sort((a, b) => a.date.localeCompare(b.date));
  audit(ctx, 'calendar', h.id, 'create', `Added holiday ${name} on ${date}`, undefined, h);
  return h;
}

export function removeHoliday(s: State, ctx: Ctx, id: string) {
  requireRole(ctx, 'ADMIN');
  const h = find(s.holidays, id, 'Holiday');
  if (s.attendance.some((a) => a.date === h.date && a.payslipId))
    throw validation('This date is already on a paid payslip. Cancel the payslip first.');
  s.holidays = s.holidays.filter((x) => x.id !== id);
  audit(ctx, 'calendar', h.id, 'delete', `Removed holiday ${h.name} on ${h.date}`, h);
  return h;
}

/** Each edit creates a new version. Documents keep the version they were finalized with. */
export function updateCompanyProfile(s: State, ctx: Ctx, i: CompanyProfileInput): CompanyProfile {
  requireRole(ctx, 'ADMIN');
  const prev = currentProfile(s);
  for (const assetId of [i.logoAssetId, i.faviconAssetId]) if (assetId) find(s.assets, assetId, 'Logo');
  const next: CompanyProfile = {
    ...i,
    id: newId(s, 'cpv'),
    versionNo: prev.versionNo + 1,
    effectiveFrom: ctx.now,
    createdById: ctx.actor.id,
  };
  s.companyProfiles.push(next);
  audit(ctx, 'company-profile', next.id, 'update', `Company profile version ${next.versionNo}`, prev, next);
  emit(ctx, 'branding.update', 'company-profile', next.id, 'Company profile updated', ['*']);
  return next;
}

export function registerAsset(s: State, ctx: Ctx, meta: Omit<AssetMeta, 'id' | 'createdAt'>): AssetMeta {
  requireRole(ctx, 'ADMIN');
  const a: AssetMeta = { ...meta, id: newId(s, 'ast'), createdAt: ctx.now };
  s.assets.push(a);
  audit(ctx, 'asset', a.id, 'create', `Uploaded ${a.kind.toLowerCase()} (${Math.round(a.bytes / 1024)} KB)`);
  return a;
}
