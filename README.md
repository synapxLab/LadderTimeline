# @synapxlab/ladder-timeline

> Multi-scale temporal carousel — drag and zoom across 16 scales,
> from billion-years to milliseconds. Zero runtime dependency,
> TypeScript + SCSS.

🇫🇷 [Lire en français](./README.fr.md)

LadderTimeline is a horizontal time-axis component with a **ladder of
16 scales** (Ga, 100Ma, Ma, 100ka, 10ka, millennium, century, decade,
year, month, week, day, hour, minute, second, ms). Press `↑`/`↓`
(or call `setScale(id)`) to jump to a finer/coarser scale; drag to
navigate within the current one.

Designed as a building block for **ChronoMap** (geospatial timeline)
but usable standalone for any timeline/scrubber UI.

## Install

```bash
npm install @synapxlab/ladder-timeline
```

## Quick start

```ts
import { LadderTimeline } from '@synapxlab/ladder-timeline';
import '@synapxlab/ladder-timeline/style';

const timeline = new LadderTimeline({
  container:   document.getElementById('timeline')!,
  scale:       'week',
  displayMode: 'expanded',         // or 'compact'
  minScale:    'ms',               // finest unit allowed
  maxScale:    'millennium',       // coarsest unit allowed
  minDate:     new Date(1900, 0, 1),
  maxDate:     new Date(2100, 11, 31),
  onItemChange:  info => console.log('committed', info),
  onItemPreview: info => console.log('preview',   info),
});
```

## Features

### 16 scales (the "ladder")

| Macro     | Calendar         | Sub-day        | Sub-second   |
|-----------|------------------|----------------|--------------|
| Ga        | millennium       | hour           | ms           |
| 100Ma     | century          | minute         |              |
| Ma        | decade           | second         |              |
| 100ka     | year             |                |              |
| 10ka      | month            |                |              |
|           | week             |                |              |
|           | day              |                |              |

The cursor is stored as a **decimal year** (`number`) internally,
so navigation works seamlessly across all scales. The `ms` scale is
decorative (float64 doesn't support absolute timestamps finer than
~1 ms, so labels are relative `±N ms` around the cursor).

### Two display modes

- **`expanded`** (default) — every item shows full label + sublabel.
- **`compact`** — items at the *next-coarser scale* boundaries keep
  the full display; intermediate items are minimised to a single
  digit. Example at decade scale:
  `1800` · 10 · 20 · 30 · 40 · 50 · 60 · 70 · 80 · 90 · `1900`

Switch at runtime:

```ts
timeline.setDisplayMode('compact');
```

### Bounds

```ts
new LadderTimeline({
  minYear, maxYear,   // decimal year (covers full Ga→ms range)
  minDate, maxDate,   // Date convenience (converted to minYear/maxYear)
  minScale, maxScale, // ScaleId clamp on setScale()
});

timeline.getBounds(); // { minYear, maxYear, minScale, maxScale }
```

Cursor stays inside `[minYear, maxYear]` (drag, keyboard, `setDate`).
Scale stays inside `[maxScale, minScale]` (coarsest → finest).

### Keyboard

| Key                  | Action                       |
|----------------------|------------------------------|
| `←` / `→`            | Previous / next item         |
| `Home`               | Today                        |
| `↑` / `+`            | Zoom in (finer scale)        |
| `↓` / `-`            | Zoom out (coarser scale)     |

Wheel : scroll = next/previous (debounced).

### Callbacks

```ts
new LadderTimeline({
  onItemChange:  info => {…},   // committed (after snap)
  onItemPreview: info => {…},   // live (during drag/scroll)
});

// info: { scale, year, label, sublabel, header, date }
```

`date` is `null` when the scale's year is outside the JS `Date`
range (Ma, Ga, …).

## API

```ts
class LadderTimeline {
  constructor(options: LadderTimelineOptions);

  // Cursor
  getDate(): Date;
  setDate(date: Date): void;
  goToToday(): void;
  goToPrevious(): void;
  goToNext(): void;

  // Scale
  getScale(): ScaleId;
  setScale(id: ScaleId): void;

  // Display
  getDisplayMode(): 'expanded' | 'compact';
  setDisplayMode(mode: 'expanded' | 'compact'): void;

  // Bounds
  getBounds(): { minYear, maxYear, minScale, maxScale };

  // Lifecycle
  render(): void;
  destroy(): void;
  on(event, handler): () => void;
  getEventTarget(): EventTarget;
  connectAdapter(adapter: CalendarAdapter): void;
}
```

## Status

Early scaffold — public API not stable yet.

## License

MIT © synapxLab
