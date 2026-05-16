/**
 * FullCalendarAdapter
 *
 * Bridges LadderTimeline with a FullCalendar instance without creating
 * a direct import dependency on FullCalendar inside the component.
 *
 * The component only depends on the `CalendarAdapter` interface:
 *   interface CalendarAdapter { gotoDate(date: Date): void; }
 *
 * Usage example (see also main.ts):
 *
 *   import { Calendar } from '@fullcalendar/core';
 *   import { createFullCalendarAdapter, bindTimelineToCalendar } from './adapters/FullCalendarAdapter';
 *
 *   const calendar = new Calendar(calendarEl, { ... });
 *   calendar.render();
 *
 *   const timeline = new LadderTimeline({ container: timelineEl });
 *   timeline.connectAdapter(createFullCalendarAdapter(calendar));
 *
 *   // Or use the convenience helper:
 *   const unbind = bindTimelineToCalendar(timeline, calendar);
 */

import type { CalendarAdapter } from '../components/ladder-timeline/LadderTimeline.types';
import { onWeekChange } from '../components/ladder-timeline/LadderTimeline.events';

// ─── Minimal FullCalendar type surface ────────────────────────────────────────
// We only declare what we use, so no FullCalendar import is needed at compile time.

export interface FullCalendarInstance {
  gotoDate(date: Date | string): void;
  getDate(): Date;
  setOption?(option: string, value: unknown): void;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Wrap a FullCalendar instance in the CalendarAdapter interface.
 * The adapter forwards `gotoDate` calls to FullCalendar.
 */
export function createFullCalendarAdapter(calendar: FullCalendarInstance): CalendarAdapter {
  return {
    gotoDate(date: Date): void {
      calendar.gotoDate(date);
    },
  };
}

// ─── Convenience binder ───────────────────────────────────────────────────────

export interface BindableTimeline {
  connectAdapter(adapter: CalendarAdapter): void;
  getEventTarget(): EventTarget;
}

/**
 * Bind a LadderTimeline (class variant) to a FullCalendar instance bidirectionally.
 *
 * - When the user picks a week in the timeline → calendar.gotoDate() is called.
 * - Returns an `unbind` function to clean up listeners.
 */
export function bindTimelineToCalendar(
  timeline: BindableTimeline,
  calendar: FullCalendarInstance,
): () => void {
  const adapter = createFullCalendarAdapter(calendar);
  timeline.connectAdapter(adapter);

  // Listen for weekchange events on the container and forward to calendar
  const unsubscribe = onWeekChange(timeline.getEventTarget(), (e) => {
    calendar.gotoDate(e.detail.week.start);
  });

  return unsubscribe;
}

// ─── EventTarget variant binder ───────────────────────────────────────────────

import type { LadderTimelineSelectEventDetail } from '../components/ladder-timeline/LadderTimeline.types';
import { EVENT_WEEK_CHANGE } from '../components/ladder-timeline/LadderTimeline.events';

/**
 * Bind a LadderTimelineEventTarget instance to a FullCalendar instance.
 * Use this variant when using the EventTarget-based LadderTimeline.
 */
export function bindEventTargetTimelineToCalendar(
  timeline: EventTarget & { connectAdapter(a: CalendarAdapter): void },
  calendar: FullCalendarInstance,
): () => void {
  const adapter = createFullCalendarAdapter(calendar);
  timeline.connectAdapter(adapter);

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<LadderTimelineSelectEventDetail>).detail;
    calendar.gotoDate(detail.week.start);
  };
  timeline.addEventListener(EVENT_WEEK_CHANGE, handler);
  return () => timeline.removeEventListener(EVENT_WEEK_CHANGE, handler);
}

// ─── Web Component binder ─────────────────────────────────────────────────────

/**
 * Bind a <ladder-timeline> Web Component to a FullCalendar instance.
 *
 * Example:
 *   const el = document.querySelector('ladder-timeline')!;
 *   bindWebComponentToCalendar(el, calendar);
 */
export function bindWebComponentToCalendar(
  el: HTMLElement & { connectAdapter?(a: CalendarAdapter): void },
  calendar: FullCalendarInstance,
): () => void {
  const adapter = createFullCalendarAdapter(calendar);
  el.connectAdapter?.(adapter);

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<LadderTimelineSelectEventDetail>).detail;
    calendar.gotoDate(detail.week.start);
  };
  el.addEventListener(EVENT_WEEK_CHANGE, handler);
  return () => el.removeEventListener(EVENT_WEEK_CHANGE, handler);
}
