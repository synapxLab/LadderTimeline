import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LadderTimeline } from '../src/components/ladder-timeline/LadderTimeline';
import { dateToYear } from '../src/components/ladder-timeline/Scale';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

// ─── Construction ────────────────────────────────────────────────────────────

describe('Construction', () => {
  it('throws without container', () => {
    expect(() => new LadderTimeline({ container: null as unknown as HTMLElement })).toThrow();
  });

  it('builds with minimal options', () => {
    const t = new LadderTimeline({ container });
    expect(t.getScale()).toBe('week');
    expect(t.getDisplayMode()).toBe('expanded');
  });

  it('accepts initial scale', () => {
    const t = new LadderTimeline({ container, scale: 'month' });
    expect(t.getScale()).toBe('month');
  });

  it('accepts initial displayMode', () => {
    const t = new LadderTimeline({ container, displayMode: 'compact' });
    expect(t.getDisplayMode()).toBe('compact');
  });

  it('renders items in the DOM', () => {
    new LadderTimeline({ container });
    const items = container.querySelectorAll('.lt__item');
    expect(items.length).toBeGreaterThan(0);
  });
});

// ─── Public API ──────────────────────────────────────────────────────────────

describe('Public API', () => {
  it('setDate moves cursor and getDate roundtrips', () => {
    const t = new LadderTimeline({ container, scale: 'day' });
    const target = new Date(2024, 5, 15);
    t.setDate(target);
    const got = t.getDate();
    expect(got.getFullYear()).toBe(2024);
    expect(got.getMonth()).toBe(5);
    expect(got.getDate()).toBe(15);
  });

  it('setScale changes scale and getScale reflects it', () => {
    const t = new LadderTimeline({ container });
    t.setScale('decade');
    expect(t.getScale()).toBe('decade');
  });

  it('setDisplayMode toggles', () => {
    const t = new LadderTimeline({ container });
    t.setDisplayMode('compact');
    expect(t.getDisplayMode()).toBe('compact');
    t.setDisplayMode('expanded');
    expect(t.getDisplayMode()).toBe('expanded');
  });
});

// ─── Bounds (year) ───────────────────────────────────────────────────────────

describe('Year bounds', () => {
  it('getBounds returns provided bounds', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      minYear: 1900, maxYear: 2100,
    });
    expect(t.getBounds()).toMatchObject({ minYear: 1900, maxYear: 2100 });
  });

  it('minDate/maxDate are converted to year bounds', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      minDate: new Date(1900, 0, 1),
      maxDate: new Date(2100, 11, 31),
    });
    const bounds = t.getBounds();
    expect(bounds.minYear).toBe(1900);
    expect(bounds.maxYear).toBeGreaterThan(2100); // Dec 31 ≈ 2100.99
  });

  it('setDate is clamped to maxYear', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      maxYear: 2050,
    });
    t.setDate(new Date(2200, 0, 1));
    expect(t.getDate().getFullYear()).toBeLessThanOrEqual(2050);
  });

  it('setDate is clamped to minYear', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      minYear: 1900,
    });
    t.setDate(new Date(1700, 0, 1));
    expect(t.getDate().getFullYear()).toBeGreaterThanOrEqual(1900);
  });

  it('goToNext bloqué à la borne max', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      maxYear: 2025,
    });
    t.setDate(new Date(2025, 0, 1));
    const before = t.getDate().getFullYear();
    t.goToNext();
    expect(t.getDate().getFullYear()).toBe(before);
  });

  it('setDate hors bornes : résultat dans bornes ET sur frontière d\'échelle', () => {
    const t = new LadderTimeline({
      container, scale: 'decade',
      minYear: 2015, maxYear: 2055,
    });
    t.setDate(new Date(2002, 0, 1));  // 2002 << 2015
    const got = t.getDate().getFullYear();
    expect(got).toBeGreaterThanOrEqual(2015);
    expect(got).toBeLessThanOrEqual(2055);
    expect(got % 10).toBe(0);  // doit être une frontière de décennie
  });

  it('goToPrevious bloqué à la borne min', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      minYear: 2000,
    });
    t.setDate(new Date(2000, 0, 1));
    const before = t.getDate().getFullYear();
    t.goToPrevious();
    expect(t.getDate().getFullYear()).toBe(before);
  });
});

// ─── Bounds (scale) ──────────────────────────────────────────────────────────

describe('Scale bounds', () => {
  it('setScale is clamped to finest allowed (minScale)', () => {
    const t = new LadderTimeline({ container, minScale: 'day' });
    t.setScale('ms');
    expect(t.getScale()).toBe('day'); // can't go below day
  });

  it('setScale is clamped to coarsest allowed (maxScale)', () => {
    const t = new LadderTimeline({ container, maxScale: 'century' });
    t.setScale('Ga');
    expect(t.getScale()).toBe('century');
  });

  it('initial scale is clamped if out of range', () => {
    const t = new LadderTimeline({
      container, scale: 'ms',
      minScale: 'day', maxScale: 'year',
    });
    // scale 'ms' is finer than minScale 'day' → clamped up to 'day'
    expect(t.getScale()).toBe('day');
  });
});

// ─── Callbacks ───────────────────────────────────────────────────────────────

describe('Callbacks', () => {
  it('fires onItemChange when setScale changes the item', () => {
    let last: { scale: string; year: number } | null = null;
    const t = new LadderTimeline({
      container, scale: 'year',
      onItemChange: info => { last = { scale: info.scale, year: info.year }; },
    });
    t.setScale('decade');
    expect(last).not.toBeNull();
    expect(last!.scale).toBe('decade');
  });

  it('fires onItemChange on setDate', () => {
    let count = 0;
    const t = new LadderTimeline({
      container, scale: 'day',
      onItemChange: () => { count++; },
    });
    t.setDate(new Date(2024, 5, 15));
    expect(count).toBeGreaterThan(0);
  });
});

// ─── DisplayMode rendering ───────────────────────────────────────────────────

describe('DisplayMode rendering', () => {
  it('compact mode tags items with --major or --minor', () => {
    const t = new LadderTimeline({
      container, scale: 'decade', displayMode: 'compact',
    });
    expect(t.getDisplayMode()).toBe('compact');
    const items = container.querySelectorAll('.lt__item');
    const major = container.querySelectorAll('.lt__item--major');
    const minor = container.querySelectorAll('.lt__item--minor');
    expect(items.length).toBeGreaterThan(0);
    // En decade autour de 2025 (avec century en coarser) : 2000 et 2100 sont major
    expect(major.length + minor.length).toBe(items.length);
    expect(major.length).toBeGreaterThan(0);
    expect(minor.length).toBeGreaterThan(0);
  });

  it('expanded mode has no major/minor classes', () => {
    new LadderTimeline({ container, scale: 'decade', displayMode: 'expanded' });
    const major = container.querySelectorAll('.lt__item--major');
    const minor = container.querySelectorAll('.lt__item--minor');
    expect(major.length).toBe(0);
    expect(minor.length).toBe(0);
  });
});

// ─── Markers ─────────────────────────────────────────────────────────────────

describe('Markers', () => {
  it('setMarkers / getMarkers roundtrip', () => {
    const t = new LadderTimeline({ container });
    t.setMarkers([
      { year: 1789, label: 'Révolution' },
      { year: 1815, label: 'Tambora', color: '#dc2626' },
    ]);
    const got = t.getMarkers();
    expect(got).toHaveLength(2);
    expect(got[0].label).toBe('Révolution');
    expect(got[1].color).toBe('#dc2626');
  });

  it('addMarker ajoute, removeMarker(id) supprime', () => {
    const t = new LadderTimeline({ container });
    t.addMarker({ year: 2024, label: 'foo', id: 'a' });
    t.addMarker({ year: 2025, label: 'bar', id: 'b' });
    expect(t.getMarkers()).toHaveLength(2);
    t.removeMarker('a');
    expect(t.getMarkers()).toHaveLength(1);
    expect(t.getMarkers()[0].id).toBe('b');
  });

  it('rend un .lt__marker dans l\'item correspondant', () => {
    const t = new LadderTimeline({
      container, scale: 'year',
      minYear: 2020, maxYear: 2030,
    });
    t.setDate(new Date(2025, 0, 1));
    t.setMarkers([{ year: 2024.5, label: 'mid-2024' }]);
    const dots = container.querySelectorAll('.lt__marker');
    expect(dots.length).toBeGreaterThan(0);
  });

  it('onMarkerClick fires au click', () => {
    let clicked: string | null = null;
    const t = new LadderTimeline({
      container, scale: 'year',
      onMarkerClick: m => { clicked = m.label; },
    });
    t.setDate(new Date(2025, 0, 1));
    t.setMarkers([{ year: 2025.5, label: 'milieu' }]);
    const dot = container.querySelector<HTMLElement>('.lt__marker');
    expect(dot).not.toBeNull();
    dot?.click();
    expect(clicked).toBe('milieu');
  });

  it('markerclick CustomEvent émis sur le container', () => {
    let detail: { year: number; label: string } | null = null;
    const t = new LadderTimeline({ container, scale: 'year' });
    container.addEventListener('markerclick', (e) => {
      detail = (e as CustomEvent).detail;
    });
    t.setDate(new Date(2025, 0, 1));
    t.setMarkers([{ year: 2025.5, label: 'evt' }]);
    container.querySelector<HTMLElement>('.lt__marker')?.click();
    expect(detail).not.toBeNull();
    expect(detail!.label).toBe('evt');
  });
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

describe('destroy()', () => {
  it('clears the container', () => {
    const t = new LadderTimeline({ container });
    expect(container.children.length).toBeGreaterThan(0);
    t.destroy();
    expect(container.children.length).toBe(0);
  });
});
