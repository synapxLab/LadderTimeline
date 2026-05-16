// ─── Core date range ──────────────────────────────────────────────────────────

export interface WeekRange {
  start: Date;
  end: Date;
}

// ─── Week item for rendering ──────────────────────────────────────────────────

export interface WeekItem {
  weekNumber: number;
  year: number;
  range: WeekRange;
  /** Short label: e.g. "31 Mar – 6 Apr" */
  label: string;
  /** Secondary label: e.g. "W14" */
  sublabel: string;
  isCurrent: boolean;
  isSelected: boolean;
}

// ─── Component options ────────────────────────────────────────────────────────

import type { ScaleId } from './Scale';

export interface LadderTimelineOptions {
  /** Required mount point */
  container: HTMLElement;
  /** Initially selected date (defaults to today) */
  selectedDate?: Date;
  /** Centre of the rendered window (defaults to today) */
  referenceDate?: Date;
  /** How many items to render at once (default: 51) */
  weeksVisible?: number;
  /** 0 = Sunday, 1 = Monday (default: 1) */
  firstDayOfWeek?: 0 | 1;
  /** BCP-47 locale for formatting (default: 'fr-FR') */
  locale?: string;
  /** Compact mode – less padding, smaller text (default: false) */
  compact?: boolean;
  /** Échelle temporelle initiale (default: 'week') */
  scale?: ScaleId;
  /**
   * Mode d'affichage des items :
   * - `'expanded'` (default) : label + sublabel sur tous les items.
   * - `'compact'`            : seuls les items aux frontières de l'échelle
   *   supérieure gardent l'affichage complet ; les autres sont minimisés
   *   (juste un compactLabel).
   */
  displayMode?: 'expanded' | 'compact';
  /**
   * Échelle la plus fine autorisée (unité la plus courte). Default: `'ns'`.
   * Ex: `minScale: 'day'` interdit hour/minute/second/ms/μs/ns.
   */
  minScale?: ScaleId;
  /**
   * Échelle la plus grossière autorisée (unité la plus longue). Default: `'Ga'`.
   * Ex: `maxScale: 'century'` interdit millennium/10ka/100ka/Ma/100Ma/Ga.
   */
  maxScale?: ScaleId;
  /** Année minimale navigable (decimal year, ex: -10000 pour 10 000 av. J.-C.). */
  minYear?: number;
  /** Année maximale navigable (decimal year). */
  maxYear?: number;
  /** Date minimale navigable. Convertie en minYear. Ignoré si minYear est fourni. */
  minDate?: Date;
  /** Date maximale navigable. Convertie en maxYear. Ignoré si maxYear est fourni. */
  maxDate?: Date;
  /** Optional callback shortcut (alternative to listening to 'weekchange') */
  onWeekChange?: (detail: LadderTimelineSelectEventDetail) => void;
  /** Fired live during drag as the center item changes (before snap) */
  onWeekPreview?: (detail: LadderTimelineSelectEventDetail) => void;
  /** Fired when the centered item is committed (after snap) — toutes échelles */
  onItemChange?: (info: TimelineItemInfo) => void;
  /** Fired live during drag/scroll for the centered item — toutes échelles */
  onItemPreview?: (info: TimelineItemInfo) => void;
  /** Liste initiale de markers (dates clés) à poser sur la timeline */
  markers?: TimelineMarker[];
  /** Click sur un marker */
  onMarkerClick?: (marker: TimelineMarker) => void;
  /**
   * Thème visuel.
   * - 'light' (défaut) : toujours clair
   * - 'dark'           : toujours sombre
   * - 'auto'           : suit prefers-color-scheme du système
   */
  theme?: 'light' | 'dark' | 'auto';
  /**
   * Clé localStorage pour persister la semaine sélectionnée entre les rechargements.
   * Si définie et qu'une valeur valide est stockée, elle prend priorité sur selectedDate.
   */
  storageKey?: string;
}

// ─── Event payloads ───────────────────────────────────────────────────────────

export interface LadderTimelineSelectEventDetail {
  date: Date;
  week: WeekRange;
}

export interface LadderTimelineNavigateEventDetail {
  direction: 'prev' | 'next' | 'today';
  date: Date;
  week: WeekRange;
}

// ─── External calendar adapter ────────────────────────────────────────────────

export interface CalendarAdapter {
  gotoDate(date: Date): void;
}

// ─── Item info (scale-agnostic) ───────────────────────────────────────────────

export interface TimelineItemInfo {
  scale: ScaleId;
  year: number;
  label: string;
  sublabel: string;
  header: string;
  /** Date équivalent si le year est dans la plage Date, sinon null */
  date: Date | null;
}

// ─── Markers / events ─────────────────────────────────────────────────────────

export interface TimelineMarker {
  /** Position en décimal year (ex: 1789.539 pour 14 juillet 1789) */
  year: number;
  /** Texte affiché en tooltip (et dans les payloads d'événement) */
  label: string;
  /** Couleur du marker. Défaut : couleur d'accent du thème. */
  color?: string;
  /** Identifiant optionnel — pour removeMarker() */
  id?: string;
}
