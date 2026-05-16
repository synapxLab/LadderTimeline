/**
 * Scale system — 18 échelles temporelles, du milliard d'années à la nanoseconde.
 *
 * Cursor interne unifié = `decimal year` (float64). Chaque Scale fournit :
 *  - step        : pas entre deux items (en années décimales)
 *  - snap(year)  : arrondit à la frontière d'unité de cette échelle
 *  - build(...)  : produit N items autour du curseur
 *
 * Pour les très grandes échelles (>= ka), on travaille uniquement sur le `year`
 * numérique (Date ne supporte pas au-delà de ±271 821 ans depuis 1970).
 * Pour les échelles fines (< seconde), la précision float64 ne suffit pas pour
 * un timestamp absolu — les labels deviennent décoratifs.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScaleId =
  | 'Ga' | '100Ma' | 'Ma' | '100ka' | '10ka'
  | 'millennium' | 'century' | 'decade'
  | 'year' | 'month' | 'week' | 'day'
  | 'hour' | 'minute' | 'second'
  | 'ms' | 'us' | 'ns';

export interface ScaleItem {
  /** Identité canonique de l'item — décimal year de son début */
  year: number;
  /** Label principal affiché sur l'item */
  label: string;
  /** Label secondaire (S14 · 2025, 14:00…) */
  sublabel: string;
  /** Header optionnel affiché sur l'item sélectionné ou aux transitions */
  header: string;
  /** Label court pour le mode d'affichage `compact` (ex: "·10" pour 1810 à l'échelle décennie) */
  compactLabel: string;
  /** Marqueur "aujourd'hui" (ou présent pour macro) */
  isCurrent: boolean;
  /** Marqueur "sélectionné" */
  isSelected: boolean;
}

export interface Scale {
  id: ScaleId;
  label: string;
  /** Pas (en années décimales) entre deux items adjacents */
  step: number;
  /** Snap d'un year libre à la frontière d'unité de l'échelle */
  snap(year: number): number;
  /** Décale le year de n unités */
  add(year: number, n: number): number;
  /** Construit `count` items autour de `centerYear` */
  build(centerYear: number, count: number, selectedYear: number, locale: string): ScaleItem[];
}

// ─── Helpers Date <-> decimal year ────────────────────────────────────────────

const DATE_MIN_YEAR = -271820;
const DATE_MAX_YEAR =  275759;

function inDateRange(year: number): boolean {
  return year >= DATE_MIN_YEAR && year <= DATE_MAX_YEAR;
}

function yearToDate(year: number): Date {
  const y = Math.floor(year);
  const frac = year - y;
  const startOfY = new Date(y, 0, 1).getTime();
  const startOfNextY = new Date(y + 1, 0, 1).getTime();
  // Math.round évite la dérive sub-ms qui peut basculer sur le jour précédent
  // après un roundtrip dateToYear → yearToDate.
  return new Date(Math.round(startOfY + frac * (startOfNextY - startOfY)));
}

function dateToYear(d: Date): number {
  const y = d.getFullYear();
  const startOfY = new Date(y, 0, 1).getTime();
  const startOfNextY = new Date(y + 1, 0, 1).getTime();
  return y + (d.getTime() - startOfY) / (startOfNextY - startOfY);
}

function todayYear(): number {
  return dateToYear(new Date());
}

// ─── Helpers formatage scientifique grandes années ────────────────────────────

function fmtBigYear(year: number): string {
  const abs = Math.abs(year);
  if (abs >= 1e9)  return `${(year / 1e9).toFixed(2)} Ga`;
  if (abs >= 1e6)  return `${(year / 1e6).toFixed(2)} Ma`;
  if (abs >= 1000) return `${(year / 1000).toFixed(1)} ka`;
  return year < 0 ? `${Math.round(year)}` : `+${Math.round(year)}`;
}

function fmtYearShort(year: number): string {
  const y = Math.round(year);
  if (y < 0)   return `${y} av.`;
  return `${y}`;
}

// ─── Macro scales (Ga, 100Ma, Ma, 100ka, 10ka) ────────────────────────────────

function macroScale(id: ScaleId, label: string, step: number): Scale {
  return {
    id, label, step,
    snap(year)  { return Math.round(year / step) * step; },
    add(year, n) { return year + n * step; },
    build(centerYear, count, selectedYear, _locale) {
      const half  = Math.floor(count / 2);
      const start = this.snap(centerYear) - half * step;
      const today = todayYear();
      const items: ScaleItem[] = [];
      for (let i = 0; i < count; i++) {
        const y = start + i * step;
        items.push({
          year: y,
          label:    fmtBigYear(y),
          sublabel: fmtBigYear(y + step) + ' →',
          header:   '',
          compactLabel: fmtBigYear(y),
          isCurrent:  Math.abs(today - y) < step / 2,
          isSelected: Math.abs(this.snap(selectedYear) - y) < step / 2,
        });
      }
      return items;
    },
  };
}

// ─── Mid-large scales (millennium, century, decade) ───────────────────────────

function calendarYearBucketScale(id: ScaleId, label: string, step: number): Scale {
  return {
    id, label, step,
    snap(year)  { return Math.floor(year / step) * step; },
    add(year, n) { return year + n * step; },
    build(centerYear, count, selectedYear, _locale) {
      const half  = Math.floor(count / 2);
      const start = this.snap(centerYear) - half * step;
      const today = todayYear();
      const items: ScaleItem[] = [];
      for (let i = 0; i < count; i++) {
        const y = start + i * step;
        const yi = Math.round(y);
        const next = yi + step;
        const lbl =
          step === 1000 ? `${fmtYearShort(yi)} → ${fmtYearShort(next)}`
        : step ===  100 ? `${fmtYearShort(yi)}s`
        : step ===   10 ? `${fmtYearShort(yi)}s`
        : `${fmtYearShort(yi)}`;
        const sub =
          step === 1000 ? 'millénaire'
        : step ===  100 ? 'siècle'
        : step ===   10 ? 'décennie'
        : '';
        // compactLabel : derniers chiffres dans la "tranche" coarser
        //   decade  (step=10)   → "10", "20", …, "90"
        //   century (step=100)  → "100", "200", …, "900"
        //   millennium (step=1000) → "1000", …, "9000"
        const compact = String(((Math.abs(yi) % (step * 10)) | 0));
        items.push({
          year: y,
          label: lbl,
          sublabel: sub,
          header: '',
          compactLabel: compact,
          isCurrent:  today >= y && today < y + step,
          isSelected: selectedYear >= y && selectedYear < y + step,
        });
      }
      return items;
    },
  };
}

// ─── Year scale ──────────────────────────────────────────────────────────────

const yearScale: Scale = {
  id: 'year',
  label: 'Année',
  step: 1,
  snap(year) { return Math.floor(year); },
  add(year, n) { return year + n; },
  build(centerYear, count, selectedYear, _locale) {
    const half = Math.floor(count / 2);
    const start = Math.floor(centerYear) - half;
    const today = todayYear();
    const items: ScaleItem[] = [];
    for (let i = 0; i < count; i++) {
      const y = start + i;
      const isNewDecade = y % 10 === 0;
      items.push({
        year: y,
        label: fmtYearShort(y),
        sublabel: isNewDecade ? `${y}s` : '',
        header: isNewDecade ? `${y}s` : '',
        compactLabel: String(Math.abs(y) % 100),  // "0".."99"
        isCurrent:  Math.floor(today) === y,
        isSelected: Math.floor(selectedYear) === y,
      });
    }
    return items;
  },
};

// ─── Month scale ─────────────────────────────────────────────────────────────

const monthScale: Scale = {
  id: 'month',
  label: 'Mois',
  step: 1 / 12,
  snap(year) {
    if (!inDateRange(year)) return Math.floor(year * 12) / 12;
    const d = yearToDate(year);
    return dateToYear(new Date(d.getFullYear(), d.getMonth(), 1));
  },
  add(year, n) {
    if (!inDateRange(year)) return year + n / 12;
    const d = yearToDate(year);
    return dateToYear(new Date(d.getFullYear(), d.getMonth() + n, 1));
  },
  build(centerYear, count, selectedYear, locale) {
    const half = Math.floor(count / 2);
    const center = inDateRange(centerYear) ? yearToDate(this.snap(centerYear)) : null;
    const todayD = new Date();
    const todayM = new Date(todayD.getFullYear(), todayD.getMonth(), 1).getTime();
    const selM   = inDateRange(selectedYear) ? new Date(yearToDate(this.snap(selectedYear)).getFullYear(), yearToDate(this.snap(selectedYear)).getMonth(), 1).getTime() : null;
    const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'long' });
    const fmtShort = new Intl.DateTimeFormat(locale, { month: 'short' });
    const items: ScaleItem[] = [];

    for (let i = -half; i < count - half; i++) {
      if (!center) {
        const y = this.snap(centerYear) + i / 12;
        items.push({ year: y, label: '—', sublabel: '', header: '', compactLabel: '—', isCurrent: false, isSelected: false });
        continue;
      }
      const d = new Date(center.getFullYear(), center.getMonth() + i, 1);
      const long  = fmtMonth.format(d);
      const short = fmtShort.format(d);
      const labelFull = long.charAt(0).toUpperCase() + long.slice(1);
      const labelAbbr = short.charAt(0).toUpperCase() + short.slice(1);
      const isJan = d.getMonth() === 0;
      items.push({
        year:     dateToYear(d),
        label:    isJan ? `${labelAbbr} ${d.getFullYear()}` : labelAbbr,
        sublabel: String(d.getFullYear()),
        header:   labelFull,
        compactLabel: String(d.getMonth() + 1),  // 1..12
        isCurrent:  d.getTime() === todayM,
        isSelected: selM !== null && d.getTime() === selM,
      });
    }
    return items;
  },
};

// ─── Week scale ──────────────────────────────────────────────────────────────

const ONE_WEEK_YEARS = 7 / 365.25;

function startOfWeek(d: Date, firstDayOfWeek: 0 | 1 = 1): Date {
  const day = d.getDay();
  const diff = (day - firstDayOfWeek + 7) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
}

function isoWeekNumber(d: Date): number {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const weekScale: Scale = {
  id: 'week',
  label: 'Semaine',
  step: ONE_WEEK_YEARS,
  snap(year) {
    if (!inDateRange(year)) return year;
    return dateToYear(startOfWeek(yearToDate(year)));
  },
  add(year, n) {
    if (!inDateRange(year)) return year + n * ONE_WEEK_YEARS;
    const d = yearToDate(year);
    return dateToYear(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7));
  },
  build(centerYear, count, selectedYear, locale) {
    const half = Math.floor(count / 2);
    const todayWeekStart = startOfWeek(new Date()).getTime();
    const selStart = inDateRange(selectedYear) ? startOfWeek(yearToDate(selectedYear)).getTime() : null;
    const fmtRange = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const fmtMonthLong = new Intl.DateTimeFormat(locale, { month: 'long' });
    const items: ScaleItem[] = [];

    if (!inDateRange(centerYear)) {
      // Hors plage Date — fallback approximatif
      for (let i = -half; i < count - half; i++) {
        const y = this.snap(centerYear) + i * ONE_WEEK_YEARS;
        items.push({ year: y, label: '—', sublabel: '', header: '', compactLabel: '—', isCurrent: false, isSelected: false });
      }
      return items;
    }

    const center = startOfWeek(yearToDate(centerYear));
    for (let i = -half; i < count - half; i++) {
      const start = new Date(center.getFullYear(), center.getMonth(), center.getDate() + i * 7);
      const end   = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const range = (fmtRange as unknown as { formatRange?: (a: Date, b: Date) => string }).formatRange?.(start, end)
        ?? `${fmtRange.format(start)} – ${fmtRange.format(end)}`;
      const monthName = fmtMonthLong.format(start);
      items.push({
        year:     dateToYear(start),
        label:    range,
        sublabel: `S${isoWeekNumber(start)} · ${start.getFullYear()}`,
        header:   monthName.charAt(0).toUpperCase() + monthName.slice(1),
        compactLabel: String(start.getDate()),  // jour du début de semaine
        isCurrent:  start.getTime() === todayWeekStart,
        isSelected: selStart !== null && start.getTime() === selStart,
      });
    }
    return items;
  },
};

// ─── Day scale ───────────────────────────────────────────────────────────────

const ONE_DAY_YEARS = 1 / 365.25;

const dayScale: Scale = {
  id: 'day',
  label: 'Jour',
  step: ONE_DAY_YEARS,
  snap(year) {
    if (!inDateRange(year)) return year;
    const d = yearToDate(year);
    return dateToYear(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  },
  add(year, n) {
    if (!inDateRange(year)) return year + n * ONE_DAY_YEARS;
    const d = yearToDate(year);
    return dateToYear(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  },
  build(centerYear, count, selectedYear, locale) {
    const half = Math.floor(count / 2);
    const todayD = new Date();
    const todayKey = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate()).getTime();
    const selKey = inDateRange(selectedYear)
      ? new Date(yearToDate(selectedYear).getFullYear(), yearToDate(selectedYear).getMonth(), yearToDate(selectedYear).getDate()).getTime()
      : null;
    const fmtWD = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const fmtMonthLong = new Intl.DateTimeFormat(locale, { month: 'long' });
    const items: ScaleItem[] = [];

    if (!inDateRange(centerYear)) {
      for (let i = -half; i < count - half; i++) {
        items.push({ year: this.snap(centerYear) + i * ONE_DAY_YEARS, label: '—', sublabel: '', header: '', compactLabel: '—', isCurrent: false, isSelected: false });
      }
      return items;
    }
    const center = yearToDate(this.snap(centerYear));
    for (let i = -half; i < count - half; i++) {
      const d = new Date(center.getFullYear(), center.getMonth(), center.getDate() + i);
      const wd = fmtWD.format(d);
      const monthName = fmtMonthLong.format(d);
      items.push({
        year:     dateToYear(d),
        label:    `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d.getDate()}`,
        sublabel: `${monthName.slice(0, 3)} ${d.getFullYear()}`,
        header:   monthName.charAt(0).toUpperCase() + monthName.slice(1),
        compactLabel: String(d.getDate()),  // jour du mois
        isCurrent:  d.getTime() === todayKey,
        isSelected: selKey !== null && d.getTime() === selKey,
      });
    }
    return items;
  },
};

// ─── Sub-day scales (hour / minute / second) ─────────────────────────────────

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

function subDayScale(
  id: ScaleId, label: string, msPerStep: number,
  fmtFn: (d: Date) => string,
  compactFn: (d: Date) => string,
): Scale {
  const stepYears = msPerStep / MS_PER_YEAR;
  return {
    id, label, step: stepYears,
    snap(year) {
      if (!inDateRange(year)) return year;
      const ms = yearToDate(year).getTime();
      return dateToYear(new Date(Math.floor(ms / msPerStep) * msPerStep));
    },
    add(year, n) {
      if (!inDateRange(year)) return year + n * stepYears;
      const ms = yearToDate(year).getTime();
      return dateToYear(new Date(ms + n * msPerStep));
    },
    build(centerYear, count, selectedYear, locale) {
      const half = Math.floor(count / 2);
      const todayMs = Date.now();
      const todayBucket = Math.floor(todayMs / msPerStep) * msPerStep;
      const selBucket  = inDateRange(selectedYear)
        ? Math.floor(yearToDate(selectedYear).getTime() / msPerStep) * msPerStep
        : null;
      const fmtDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
      const items: ScaleItem[] = [];

      if (!inDateRange(centerYear)) {
        for (let i = -half; i < count - half; i++) {
          items.push({ year: this.snap(centerYear) + i * stepYears, label: '—', sublabel: '', header: '', compactLabel: '—', isCurrent: false, isSelected: false });
        }
        return items;
      }
      const centerMs = Math.floor(yearToDate(this.snap(centerYear)).getTime() / msPerStep) * msPerStep;
      for (let i = -half; i < count - half; i++) {
        const ms = centerMs + i * msPerStep;
        const d = new Date(ms);
        items.push({
          year:     dateToYear(d),
          label:    fmtFn(d),
          sublabel: fmtDay.format(d),
          header:   fmtFn(d),
          compactLabel: compactFn(d),
          isCurrent:  ms === todayBucket,
          isSelected: selBucket !== null && ms === selBucket,
        });
      }
      return items;
    },
  };
}

const hourScale   = subDayScale('hour',   'Heure',   3600 * 1000,
  d => `${String(d.getHours()).padStart(2,'0')}:00`,
  d => String(d.getHours()));
const minuteScale = subDayScale('minute', 'Minute',  60 * 1000,
  d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
  d => `:${String(d.getMinutes()).padStart(2,'0')}`);
const secondScale = subDayScale('second', 'Seconde', 1000,
  d => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`,
  d => `:${String(d.getSeconds()).padStart(2,'0')}`);

// ─── Sub-second scales (ms / μs / ns) — décoratif ─────────────────────────────

function subSecondScale(id: ScaleId, label: string, unit: 'ms' | 'µs' | 'ns', divisor: number): Scale {
  // step en années : 1 unit = (1 / divisor) seconde / secondes-par-an
  const stepYears = (1 / divisor) / (365.25 * 24 * 3600);
  return {
    id, label, step: stepYears,
    snap(year) { return year; },
    add(year, n) { return year + n * stepYears; },
    build(centerYear, count, selectedYear, _locale) {
      const half = Math.floor(count / 2);
      const sel = Math.round((selectedYear - centerYear) / stepYears);
      const items: ScaleItem[] = [];
      for (let i = -half; i < count - half; i++) {
        items.push({
          year:    centerYear + i * stepYears,
          label:   `${i >= 0 ? '+' : ''}${i} ${unit}`,
          sublabel: '',
          header:  `Δ${unit}`,
          compactLabel: `${i >= 0 ? '+' : ''}${i}`,
          isCurrent:  i === 0,
          isSelected: i === sel,
        });
      }
      return items;
    },
  };
}

const msScale = subSecondScale('ms', 'Milliseconde', 'ms', 1000);
const usScale = subSecondScale('us', 'Microseconde', 'µs', 1_000_000);
const nsScale = subSecondScale('ns', 'Nanoseconde',  'ns', 1_000_000_000);

// ─── Registry ────────────────────────────────────────────────────────────────

export const SCALES: Scale[] = [
  macroScale('Ga',    "Milliard d'années",          1e9),
  macroScale('100Ma', 'Centaine de millions d\'années', 1e8),
  macroScale('Ma',    "Million d'années",           1e6),
  macroScale('100ka', 'Centaine de milliers d\'années', 1e5),
  macroScale('10ka',  '10 000 ans',                 1e4),
  calendarYearBucketScale('millennium', 'Millénaire', 1000),
  calendarYearBucketScale('century',    'Siècle',     100),
  calendarYearBucketScale('decade',     'Décennie',   10),
  yearScale,
  monthScale,
  weekScale,
  dayScale,
  hourScale,
  minuteScale,
  secondScale,
  msScale,
  usScale,
  nsScale,
];

const SCALE_BY_ID: Record<ScaleId, Scale> = SCALES.reduce((acc, s) => {
  acc[s.id] = s;
  return acc;
}, {} as Record<ScaleId, Scale>);

export function getScale(id: ScaleId): Scale {
  const s = SCALE_BY_ID[id];
  if (!s) throw new Error(`[Scale] unknown id: ${id}`);
  return s;
}

/** Ordre canonique : index 0 = Ga (le plus grossier) → 17 = ns (le plus fin). */
const SCALE_ORDER_BY_ID: Record<ScaleId, number> = (() => {
  const m: Partial<Record<ScaleId, number>> = {};
  SCALES.forEach((s, i) => { m[s.id] = i; });
  return m as Record<ScaleId, number>;
})();

export function scaleIndex(id: ScaleId): number {
  return SCALE_ORDER_BY_ID[id];
}

export function scaleAt(index: number): Scale | undefined {
  return SCALES[index];
}

export const SCALE_COUNT = SCALES.length;

export { dateToYear, yearToDate, todayYear, inDateRange };
