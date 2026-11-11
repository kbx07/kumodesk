// Local time in the time zones of the time groups (no external libraries).

const fmtCache = new Map();
function fmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }));
  }
  return fmtCache.get(tz);
}

const WD = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

/** Local date and time in the zone tz. */
export function localParts(tz, now = new Date()) {
  const p = {};
  for (const part of fmt(tz).formatToParts(now)) p[part.type] = part.value;
  const hour = Number(p.hour), minute = Number(p.minute);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    minutes: hour * 60 + minute,
    weekday: WD[p.weekday],
  };
}

export function hhmmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 ? v : null;
}

/** Whether the daily candle dated barDate is already closed for the given group. */
export function isBarClosed(barDate, group, now = new Date()) {
  const lp = localParts(group.timezone, now);
  if (barDate < lp.date) return true;
  if (barDate > lp.date) return false;
  const close = hhmmToMinutes(group.close_time) ?? 1439;
  // End of trading 00:00 means the midnight that ends the day (round-the-clock markets such as crypto):
  // the candle of the current date is still open; only yesterday's is closed.
  if (close === 0) return false;
  return lp.minutes >= close;
}

/** Whether the group should run now (after close + delay, once a day). */
export function groupDue(group, now = new Date()) {
  if (!group.enabled) return false;
  const lp = localParts(group.timezone, now);
  const days = String(group.days || '1,2,3,4,5').split(',').map(Number);
  if (!days.includes(lp.weekday)) return false;
  const runAt = (hhmmToMinutes(group.close_time) ?? 0) + (group.delay_min || 0);
  if (runAt >= 1440) return false; // nonsensical configuration – skip
  if (lp.minutes < runAt) return false;
  return group.last_run_date !== lp.date;
}

/** The group's next run as a Date (minute precision, for display). */
export function nextRun(group, now = new Date()) {
  if (!group.enabled) return null;
  const runAt = (hhmmToMinutes(group.close_time) ?? 0) + (group.delay_min || 0);
  const days = String(group.days || '1,2,3,4,5').split(',').map(Number);
  const start = Math.floor(now.getTime() / 60000) * 60000;
  // search up to 8 days ahead around the expected time
  const lp0 = localParts(group.timezone, now);
  let delta = runAt - lp0.minutes;
  for (let d = 0; d < 8; d++) {
    const cand = new Date(start + (delta + d * 1440) * 60000);
    // DST correction: shift to the actual local time
    const lp = localParts(group.timezone, cand);
    const fix = runAt - lp.minutes;
    const c2 = Math.abs(fix) <= 120 ? new Date(cand.getTime() + fix * 60000) : cand;
    const l2 = localParts(group.timezone, c2);
    if (c2 <= now) continue;
    if (!days.includes(l2.weekday)) continue;
    if (group.last_run_date === l2.date) continue;
    return c2;
  }
  return null;
}
