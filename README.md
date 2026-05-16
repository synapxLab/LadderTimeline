# @synapxlab/chronomap

> Geospatial timeline — synchronise a map and a temporal axis to visualise
> spatio-temporal data. Zero runtime dependency, TypeScript + SCSS.

ChronoMap couples an interactive map (Leaflet, MapLibre, Mapbox, OpenLayers…)
with a horizontal time axis. Dragging the timeline filters the markers shown on
the map; moving the map updates the visible time window. Adapters keep the
core framework-agnostic.

## Install

```bash
npm install @synapxlab/chronomap
```

## Quick start

```ts
import { ChronoMap } from '@synapxlab/chronomap';
import '@synapxlab/chronomap/style';

const chronomap = new ChronoMap({
  container: document.getElementById('chronomap')!,
  // …options
});
```

## Status

Early scaffold — public API not stable yet.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — proposition d'architecture complète (stack, modèle temporel, schéma SQL, classes JS, API REST, MVP). Lecture obligatoire avant de coder.
- **[db/README.md](db/README.md)** — bootstrap local de la base PostgreSQL + PostGIS.

## License

MIT © synapxLab
