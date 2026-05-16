import { describe, it, expect } from 'vitest';
import {
  SCALES,
  SCALE_COUNT,
  getScale,
  scaleIndex,
  scaleAt,
  dateToYear,
  yearToDate,
  todayYear,
  inDateRange,
  type ScaleId,
} from '../src/components/ladder-timeline/Scale';

// ─── Registry ────────────────────────────────────────────────────────────────

describe('Scale registry', () => {
  it('exposes exactly 18 scales', () => {
    expect(SCALE_COUNT).toBe(18);
    expect(SCALES).toHaveLength(18);
  });

  it('orders scales from coarsest (Ga, idx 0) to finest (ns, idx 17)', () => {
    expect(SCALES[0].id).toBe('Ga');
    expect(SCALES[SCALES.length - 1].id).toBe('ns');
  });

  it('step strictly decreases as index increases', () => {
    for (let i = 1; i < SCALES.length; i++) {
      expect(SCALES[i].step).toBeLessThan(SCALES[i - 1].step);
    }
  });

  it('scaleIndex/scaleAt are inverse functions', () => {
    for (const s of SCALES) {
      expect(scaleAt(scaleIndex(s.id))?.id).toBe(s.id);
    }
  });

  it('getScale throws on unknown id', () => {
    expect(() => getScale('xxx' as ScaleId)).toThrow();
  });
});

// ─── Date / year conversion ──────────────────────────────────────────────────

describe('Date <-> year conversion', () => {
  it('roundtrips a current Date within 1 day', () => {
    const d = new Date(2025, 5, 15);
    const y = dateToYear(d);
    const d2 = yearToDate(y);
    expect(Math.abs(d2.getTime() - d.getTime())).toBeLessThan(86_400_000);
  });

  it('Jan 1st = integer year', () => {
    expect(dateToYear(new Date(2025, 0, 1))).toBe(2025);
    expect(dateToYear(new Date(1900, 0, 1))).toBe(1900);
  });

  it('inDateRange handles edges', () => {
    expect(inDateRange(2025)).toBe(true);
    expect(inDateRange(-100000)).toBe(true);
    expect(inDateRange(-1e6)).toBe(false);   // Ma is out
    expect(inDateRange(1e9)).toBe(false);
  });

  it('todayYear matches current date', () => {
    const expected = new Date().getFullYear();
    const ty = todayYear();
    expect(Math.floor(ty)).toBe(expected);
  });
});

// ─── Per-scale invariants ────────────────────────────────────────────────────

describe('Per-scale invariants', () => {
  const CENTER = 2025.0;
  const COUNT = 11;

  for (const s of SCALES) {
    describe(`scale ${s.id}`, () => {
      const center = s.id === 'Ga' || s.id === '100Ma' || s.id === 'Ma' || s.id === '100ka' || s.id === '10ka'
        ? 0  // macro scales need a year=0 centered window to be meaningful
        : CENTER;

      it('has positive step', () => {
        expect(s.step).toBeGreaterThan(0);
      });

      it('snap is idempotent', () => {
        const snapped = s.snap(center);
        expect(s.snap(snapped)).toBeCloseTo(snapped, 10);
      });

      it('add then add-back ≈ identity (within tolerance)', () => {
        const snapped = s.snap(center);
        const moved = s.add(snapped, 3);
        const back = s.add(moved, -3);
        expect(Math.abs(back - snapped)).toBeLessThan(s.step * 0.5);
      });

      it('build returns exactly count items', () => {
        const items = s.build(center, COUNT, center, 'fr-FR');
        expect(items).toHaveLength(COUNT);
      });

      it('build items have all required fields', () => {
        const items = s.build(center, COUNT, center, 'fr-FR');
        for (const it of items) {
          expect(typeof it.year).toBe('number');
          expect(typeof it.label).toBe('string');
          expect(typeof it.sublabel).toBe('string');
          expect(typeof it.header).toBe('string');
          expect(typeof it.compactLabel).toBe('string');
          expect(typeof it.isCurrent).toBe('boolean');
          expect(typeof it.isSelected).toBe('boolean');
          expect(it.label.length).toBeGreaterThan(0);
        }
      });

      it('exactly one item is selected when selected is in window', () => {
        const items = s.build(center, COUNT, center, 'fr-FR');
        const selected = items.filter(it => it.isSelected);
        expect(selected.length).toBe(1);
      });
    });
  }
});

// ─── Scale-specific behavior ─────────────────────────────────────────────────

describe('yearScale specifics', () => {
  const scale = getScale('year');

  it('snap floors to integer year', () => {
    expect(scale.snap(2025.5)).toBe(2025);
    expect(scale.snap(2025.99)).toBe(2025);
    expect(scale.snap(2026)).toBe(2026);
  });

  it('step is 1', () => {
    expect(scale.step).toBe(1);
  });

  it('compactLabel is last 2 digits', () => {
    const items = scale.build(2025, 5, 2025, 'fr-FR');
    const it2024 = items.find(i => i.year === 2024);
    expect(it2024?.compactLabel).toBe('24');
  });
});

describe('decadeScale specifics', () => {
  const scale = getScale('decade');

  it('snap floors to multiple of 10', () => {
    expect(scale.snap(2025)).toBe(2020);
    expect(scale.snap(2029.99)).toBe(2020);
    expect(scale.snap(2030)).toBe(2030);
  });

  it('label has "s" suffix (e.g. 2020s)', () => {
    const items = scale.build(2025, 3, 2025, 'fr-FR');
    expect(items.some(i => i.label.endsWith('s'))).toBe(true);
  });
});

describe('centuryScale specifics', () => {
  const scale = getScale('century');

  it('snap floors to multiple of 100', () => {
    expect(scale.snap(2025)).toBe(2000);
    expect(scale.snap(1899)).toBe(1800);
  });
});

describe('millenniumScale specifics', () => {
  const scale = getScale('millennium');

  it('snap floors to multiple of 1000', () => {
    expect(scale.snap(2025)).toBe(2000);
    expect(scale.snap(1500)).toBe(1000);
  });
});

describe('monthScale specifics', () => {
  const scale = getScale('month');

  it('snap to 1st of month', () => {
    const date = new Date(2025, 5, 15); // Jun 15
    const snapped = scale.snap(dateToYear(date));
    const snappedDate = yearToDate(snapped);
    expect(snappedDate.getDate()).toBe(1);
    expect(snappedDate.getMonth()).toBe(5); // still June
  });

  it('add jumps by months', () => {
    const may = dateToYear(new Date(2025, 4, 1));
    const sep = scale.add(may, 4);
    expect(yearToDate(sep).getMonth()).toBe(8); // Sep = month 8
  });
});

describe('weekScale specifics', () => {
  const scale = getScale('week');

  it('snap to Monday (or start of week)', () => {
    const wed = new Date(2025, 5, 18); // Wed Jun 18 2025
    const snapped = scale.snap(dateToYear(wed));
    const snappedDate = yearToDate(snapped);
    expect(snappedDate.getDay()).toBe(1); // Monday
  });

  it('add jumps by 7 days', () => {
    const monday = new Date(2025, 5, 16); // Mon
    const week3 = scale.add(dateToYear(monday), 3);
    const w3Date = yearToDate(week3);
    expect((w3Date.getTime() - monday.getTime()) / 86_400_000).toBeCloseTo(21, 0);
  });
});

describe('dayScale specifics', () => {
  const scale = getScale('day');

  it('add jumps by 1 day', () => {
    const day = dateToYear(new Date(2025, 5, 15));
    const next = scale.add(day, 1);
    const nextDate = yearToDate(next);
    expect(nextDate.getDate()).toBe(16);
  });
});

describe('macro scales (Ga/Ma)', () => {
  it('Ga step is 1e9', () => {
    expect(getScale('Ga').step).toBe(1e9);
  });

  it('Ma step is 1e6', () => {
    expect(getScale('Ma').step).toBe(1e6);
  });

  it('snap rounds to nearest 1Ga', () => {
    expect(getScale('Ga').snap(-1.4e9)).toBe(-1e9);
    expect(getScale('Ga').snap(-1.6e9)).toBe(-2e9);
  });
});

describe('sub-second scales (ms/μs/ns) — decorative', () => {
  for (const id of ['ms', 'us', 'ns'] as ScaleId[]) {
    it(`${id} step > 0 but tiny`, () => {
      const s = getScale(id);
      expect(s.step).toBeGreaterThan(0);
      expect(s.step).toBeLessThan(1e-3); // sub-millennium
    });

    it(`${id} labels use relative ±N notation`, () => {
      const items = getScale(id).build(2025, 11, 2025, 'fr-FR');
      // Center item should be "+0 <unit>"
      expect(items.some(i => i.isSelected && /^[+-]?0\s/.test(i.label))).toBe(true);
    });
  }
});
