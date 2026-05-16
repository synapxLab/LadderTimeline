import type { WeekItem, WeekRange } from './LadderTimeline.types';

// ─── Basic date operations ────────────────────────────────────────────────────

/** Return a new Date stripped to midnight UTC-local */
export function normalizeDate(d: Date): Date {
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return n;
}

/** Clone a Date instance */
export function cloneDate(d: Date): Date {
  return new Date(d.getTime());
}

/** Add (or subtract) N days */
export function addDays(d: Date, days: number): Date {
  const result = cloneDate(d);
  result.setDate(result.getDate() + days);
  return result;
}

/** Add (or subtract) N weeks */
export function addWeeks(d: Date, weeks: number): Date {
  return addDays(d, weeks * 7);
}

// ─── Week boundary calculation ────────────────────────────────────────────────

/**
 * Return Monday (firstDayOfWeek=1) or Sunday (firstDayOfWeek=0)
 * of the week containing `d`.
 */
export function getWeekStart(d: Date, firstDayOfWeek: 0 | 1 = 1): Date {
  const normalized = normalizeDate(d);
  const day = normalized.getDay(); // 0=Sun … 6=Sat
  const diff = (day - firstDayOfWeek + 7) % 7;
  return addDays(normalized, -diff);
}

/** Return the last day of the week (6 days after start) */
export function getWeekEnd(weekStart: Date): Date {
  return addDays(weekStart, 6);
}

/** ISO-8601 week number */
export function getISOWeekNumber(d: Date): number {
  const date = normalizeDate(d);
  // Thursday of current week → always in the same ISO year
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

// ─── Comparison helpers ───────────────────────────────────────────────────────

/** True if two dates fall on the same calendar day */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True if two dates fall in the same ISO week */
export function isSameWeek(a: Date, b: Date, firstDayOfWeek: 0 | 1 = 1): boolean {
  const startA = getWeekStart(a, firstDayOfWeek);
  const startB = getWeekStart(b, firstDayOfWeek);
  return isSameDay(startA, startB);
}

/** Numeric comparison: –1, 0, 1 */
export function compareDate(a: Date, b: Date): -1 | 0 | 1 {
  const na = normalizeDate(a).getTime();
  const nb = normalizeDate(b).getTime();
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a week date range using Intl.DateTimeFormat.formatRange when available.
 * Same month  → "18 – 24 août"  /  "Aug 18 – 24"   (month shown once)
 * Cross-month → "28 mars – 3 avr." / "Mar 28 – Apr 3"
 */
export function formatWeekLabel(range: WeekRange, locale: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const fmt = new Intl.DateTimeFormat(locale, opts);

  // formatRange est supporté par tous les navigateurs evergreen (Chrome 76+, FF 91+, Safari 14.1+)
  // Les types TS de lib DOM n'incluent pas encore formatRange → cast explicite
  const fmtAny = fmt as unknown as { formatRange?: (s: Date, e: Date) => string };
  if (typeof fmtAny.formatRange === 'function') {
    return fmtAny.formatRange(range.start, range.end);
  }

  // Fallback : afficher les deux dates complètes
  return `${fmt.format(range.start)} – ${fmt.format(range.end)}`;
}

/** "W14 · 2025" */
export function formatWeekSublabel(weekNumber: number, year: number): string {
  return `S${weekNumber} · ${year}`;
}

// ─── Week list builder ────────────────────────────────────────────────────────

/**
 * Generate an array of WeekItems centred on `referenceDate`.
 *
 * @param referenceDate   Centre of the window
 * @param selectedDate    Currently selected date
 * @param weeksVisible    Total weeks to generate (should be odd for centring)
 * @param firstDayOfWeek  0 = Sun, 1 = Mon
 * @param locale          BCP-47 locale
 */
export function buildWeekList(
  referenceDate: Date,
  selectedDate: Date,
  weeksVisible: number,
  firstDayOfWeek: 0 | 1,
  locale: string,
): WeekItem[] {
  const today = normalizeDate(new Date());
  const refStart = getWeekStart(referenceDate, firstDayOfWeek);
  const half = Math.floor(weeksVisible / 2);

  const items: WeekItem[] = [];

  for (let offset = -half; offset <= half; offset++) {
    const start = addWeeks(refStart, offset);
    const end = getWeekEnd(start);
    const range: WeekRange = { start, end };
    const weekNumber = getISOWeekNumber(start);
    const year = start.getFullYear();

    items.push({
      weekNumber,
      year,
      range,
      label: formatWeekLabel(range, locale),
      sublabel: formatWeekSublabel(weekNumber, year),
      isCurrent: isSameWeek(today, start, firstDayOfWeek),
      isSelected: isSameWeek(selectedDate, start, firstDayOfWeek),
    });
  }

  return items;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !isNaN(d.getTime());
}
