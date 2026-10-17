/** Minutes east of UTC for a time zone at a given instant. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** Converts a wall-clock date ("2026-08-05") and minute-of-day in tz to a UTC Date. */
export function zonedToDate(day: string, minuteOfDay: number, tz: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60));
  const off1 = tzOffsetMinutes(tz, guess);
  const t1 = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(tz, t1);
  return off2 === off1 ? t1 : new Date(guess.getTime() - off2 * 60000);
}

export function fmtClock(minuteOfDay: number): string {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function parseClock(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Minute of day of a Date in a time zone. */
export function minuteInZone(d: Date, tz: string): number {
  const off = tzOffsetMinutes(tz, d);
  const local = new Date(d.getTime() + off * 60000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}
