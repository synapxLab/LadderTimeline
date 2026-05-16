// ─── Public types ─────────────────────────────────────────────────────────────

/** A single timestamped geographic point. */
export interface TimePoint {
  id: string | number;
  date: Date;
  /** [lat, lon] in WGS-84. */
  coords: [number, number];
  /** Optional payload — anything you want to surface in popups / handlers. */
  data?: Record<string, unknown>;
}

/** Detail fired by ChronoMap custom events. */
export interface ChronoMapEventDetail {
  range: { start: Date; end: Date };
  visiblePoints: TimePoint[];
}

/** Options accepted by the ChronoMap constructor. */
export interface ChronoMapOptions {
  /** Required mount point. */
  container: HTMLElement;
  /** Optional initial dataset. */
  points?: TimePoint[];
  /** Initial time window (defaults to bounds of `points`, or last 7 days). */
  initialRange?: { start: Date; end: Date };
  /** BCP-47 locale for label formatting (default: navigator.language). */
  locale?: string;
  /** Theme — 'auto' follows prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'auto';
  /** Live callback while the time cursor moves (before snap). */
  onRangePreview?: (detail: ChronoMapEventDetail) => void;
  /** Callback after the range snaps / is validated. */
  onRangeChange?: (detail: ChronoMapEventDetail) => void;
}
