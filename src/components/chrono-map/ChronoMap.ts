import type {
  ChronoMapEventDetail,
  ChronoMapOptions,
  TimePoint,
} from './ChronoMap.types';

/**
 * ChronoMap — geospatial timeline.
 *
 * Stub implementation. The real component will mount:
 *   1. A map surface (`.cm__map`) — pluggable adapter (Leaflet / MapLibre / …).
 *   2. A horizontal time axis (`.cm__axis`) — sibling of @synapxlab/timeline.
 *   3. A two-way binding that filters markers by the visible time range and
 *      moves the time cursor when the map is panned over clustered points.
 *
 * For now the constructor only renders the shell and exposes a typed event
 * surface so consumers can wire up against the final API early.
 */
export class ChronoMap {
  readonly container: HTMLElement;
  readonly root:      HTMLElement;
  readonly mapEl:     HTMLElement;
  readonly axisEl:    HTMLElement;

  private points: TimePoint[];
  private range: { start: Date; end: Date };

  constructor(options: ChronoMapOptions) {
    this.container = options.container;
    this.points    = options.points ?? [];
    this.range     = options.initialRange ?? defaultRange(this.points);

    this.root   = el('div',  'cm');
    this.mapEl  = el('div',  'cm__map');
    this.axisEl = el('div',  'cm__axis');

    this.mapEl.textContent  = 'Map surface (adapter pending)';
    this.axisEl.textContent = 'Time axis (adapter pending)';

    this.root.append(this.mapEl, this.axisEl);
    this.container.append(this.root);

    this.applyTheme(options.theme ?? 'light');
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setRange(start: Date, end: Date): void {
    this.range = { start, end };
    this.emit('rangechange');
  }

  getRange(): { start: Date; end: Date } {
    return { start: new Date(this.range.start), end: new Date(this.range.end) };
  }

  setPoints(points: TimePoint[]): void {
    this.points = points.slice();
  }

  destroy(): void {
    this.root.remove();
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private applyTheme(theme: 'light' | 'dark' | 'auto'): void {
    this.root.dataset['theme'] = theme;
  }

  private emit(type: 'rangechange' | 'rangepreview'): void {
    const detail: ChronoMapEventDetail = {
      range: this.getRange(),
      visiblePoints: this.points.filter(p =>
        p.date >= this.range.start && p.date <= this.range.end
      ),
    };
    this.root.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function defaultRange(points: TimePoint[]): { start: Date; end: Date } {
  if (points.length === 0) {
    const end   = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
    return { start, end };
  }
  const times = points.map(p => p.date.getTime()).sort((a, b) => a - b);
  return {
    start: new Date(times[0] ?? Date.now()),
    end:   new Date(times[times.length - 1] ?? Date.now()),
  };
}
