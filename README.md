# @synapxlab/ladder-timeline

> Multi-scale temporal carousel — drag and zoom across 18 scales,
> from billion-years to nanoseconds. Zero runtime dependency,
> TypeScript + SCSS.

LadderTimeline is a horizontal time-axis component with a "ladder" of
scales (Ga, Ma, ka, millennium, century, decade, year, month, week, day,
hour, minute, second, ms, μs, ns). Pressing `↑` / `↓` (or programmatic
`setScale(id)`) jumps to a finer or coarser scale; dragging navigates
within the current one.

Designed as a building block for ChronoMap (geospatial timeline) but
usable standalone for any timeline / scrubber UI.

## Install

```bash
npm install @synapxlab/ladder-timeline
```

## Quick start

```ts
import { LadderTimeline } from '@synapxlab/ladder-timeline';
import '@synapxlab/ladder-timeline/style';

const timeline = new LadderTimeline({
  container: document.getElementById('timeline')!,
  scale: 'week',                       // default scale
  onItemChange:  info => console.log('committed', info),
  onItemPreview: info => console.log('preview',   info),
});

// Programmatic scale change
timeline.setScale('decade');
```

## Status

Early scaffold — public API not stable yet.

## License

MIT © synapxLab
