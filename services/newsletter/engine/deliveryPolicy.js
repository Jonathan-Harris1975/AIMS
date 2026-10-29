import { WEEKEND_TIMES, CUTOFF_TIMES, londonDate, londonInstant } from './weekendSchedule.js';
import { checkWeekendMaintenance } from './weekendMaintenance.js';

export async function checkIssueDeliveryPolicy(metadata = {}, now = new Date(), { maintenance = checkWeekendMaintenance } = {}) {
  if (!['saturday', 'sunday'].includes(metadata.edition)) {
    if (metadata.scheduledAt && (!Number.isFinite(Date.parse(metadata.scheduledAt)) || Date.parse(metadata.scheduledAt) > now.getTime())) {
      return { ok: false, status: 'issue_not_due' };
    }
    return { ok: true };
  }
  const edition = metadata.edition;
  const day = londonDate(now), weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday !== (edition === 'saturday' ? 6 : 0)) return { ok: false, status: 'wrong_delivery_day' };
  const scheduledAt = londonInstant(day, WEEKEND_TIMES[edition]);
  const cutoffAt = londonInstant(day, CUTOFF_TIMES[edition]);
  if (metadata.qa?.passed !== true || metadata.scheduledAt !== scheduledAt) return { ok: false, status: 'prepared_issue_invalid' };
  if (now.getTime() < Date.parse(scheduledAt) || now.getTime() >= Date.parse(cutoffAt)) {
    return { ok: false, status: 'outside_delivery_window' };
  }
  const clearance = await maintenance({ now });
  if (!clearance.ok || clearance.busy) return { ok: false, status: 'maintenance_not_clear', maintenance: clearance };
  return { ok: true, cutoffAt };
}
