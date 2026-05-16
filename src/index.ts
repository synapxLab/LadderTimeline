// ─── Composant principal ──────────────────────────────────────────────────────
export { LadderTimeline } from './components/ladder-timeline/LadderTimeline';

// ─── Types publics ────────────────────────────────────────────────────────────
export type {
  LadderTimelineOptions,
  LadderTimelineSelectEventDetail,
  LadderTimelineNavigateEventDetail,
  WeekRange,
  WeekItem,
  CalendarAdapter,
} from './components/ladder-timeline/LadderTimeline.types';

// ─── Adapter FullCalendar ─────────────────────────────────────────────────────
export {
  createFullCalendarAdapter,
  bindTimelineToCalendar,
} from './adapters/FullCalendarAdapter';
export type {
  FullCalendarInstance,
  BindableTimeline,
} from './adapters/FullCalendarAdapter';

// ─── Styles ───────────────────────────────────────────────────────────────────
import './components/ladder-timeline/LadderTimeline.scss';
