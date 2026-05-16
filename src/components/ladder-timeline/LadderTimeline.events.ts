import type {
  LadderTimelineSelectEventDetail,
  LadderTimelineNavigateEventDetail,
} from './LadderTimeline.types';

// ─── Typed custom events ──────────────────────────────────────────────────────

/** Fired when the user selects a week (click, keyboard) */
export type WeekChangeEvent = CustomEvent<LadderTimelineSelectEventDetail>;

/** Fired when prev / next / today navigation occurs */
export type WeekNavigateEvent = CustomEvent<LadderTimelineNavigateEventDetail>;

// ─── Event name constants ─────────────────────────────────────────────────────

export const EVENT_WEEK_CHANGE = 'weekchange' as const;
export const EVENT_NAVIGATE = 'navigate' as const;
export const EVENT_SELECT = 'select' as const;

// ─── Factory helpers ──────────────────────────────────────────────────────────

export function createWeekChangeEvent(
  detail: LadderTimelineSelectEventDetail,
): WeekChangeEvent {
  return new CustomEvent<LadderTimelineSelectEventDetail>(EVENT_WEEK_CHANGE, {
    detail,
    bubbles: true,
    composed: true,
  });
}

export function createSelectEvent(
  detail: LadderTimelineSelectEventDetail,
): CustomEvent<LadderTimelineSelectEventDetail> {
  return new CustomEvent<LadderTimelineSelectEventDetail>(EVENT_SELECT, {
    detail,
    bubbles: true,
    composed: true,
  });
}

export function createNavigateEvent(
  detail: LadderTimelineNavigateEventDetail,
): WeekNavigateEvent {
  return new CustomEvent<LadderTimelineNavigateEventDetail>(EVENT_NAVIGATE, {
    detail,
    bubbles: true,
    composed: true,
  });
}

// ─── Typed addEventListener helper ────────────────────────────────────────────

export function onWeekChange(
  target: EventTarget,
  handler: (e: WeekChangeEvent) => void,
): () => void {
  const listener = (e: Event) => handler(e as WeekChangeEvent);
  target.addEventListener(EVENT_WEEK_CHANGE, listener);
  return () => target.removeEventListener(EVENT_WEEK_CHANGE, listener);
}

export function onNavigate(
  target: EventTarget,
  handler: (e: WeekNavigateEvent) => void,
): () => void {
  const listener = (e: Event) => handler(e as WeekNavigateEvent);
  target.addEventListener(EVENT_NAVIGATE, listener);
  return () => target.removeEventListener(EVENT_NAVIGATE, listener);
}
