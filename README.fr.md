# @synapxlab/ladder-timeline

> Carrousel temporel multi-échelles — glisser et zoomer sur 16 échelles,
> du milliard d'années à la milliseconde. Zéro dépendance runtime,
> TypeScript + SCSS.

🇬🇧 [Read in English](./README.md)

LadderTimeline est un composant d'axe temporel horizontal organisé en
**échelle de 16 niveaux** (Ga, 100Ma, Ma, 100ka, 10ka, millénaire,
siècle, décennie, année, mois, semaine, jour, heure, minute, seconde,
ms). `↑`/`↓` (ou `setScale(id)`) bascule vers une échelle plus
fine / plus grossière ; glisser navigue dans l'échelle courante.

Conçu comme une brique de **ChronoMap** (timeline géospatiale) mais
utilisable de façon autonome pour toute UI de scrubber temporel.

## Installation

```bash
npm install @synapxlab/ladder-timeline
```

## Démarrage rapide

```ts
import { LadderTimeline } from '@synapxlab/ladder-timeline';
import '@synapxlab/ladder-timeline/style';

const timeline = new LadderTimeline({
  container:   document.getElementById('timeline')!,
  scale:       'week',
  displayMode: 'expanded',         // ou 'compact'
  minScale:    'ms',               // unité la plus fine autorisée
  maxScale:    'millennium',       // unité la plus grossière autorisée
  minDate:     new Date(1900, 0, 1),
  maxDate:     new Date(2100, 11, 31),
  onItemChange:  info => console.log('commit',  info),
  onItemPreview: info => console.log('preview', info),
});
```

## Fonctionnalités

### 16 échelles (« l'échelle »)

| Macro     | Calendaire        | Sub-jour       | Sub-seconde  |
|-----------|-------------------|----------------|--------------|
| Ga        | millénaire        | heure          | ms           |
| 100Ma     | siècle            | minute         |              |
| Ma        | décennie          | seconde        |              |
| 100ka     | année             |                |              |
| 10ka      | mois              |                |              |
|           | semaine           |                |              |
|           | jour              |                |              |

Le curseur est stocké en interne comme une **année décimale** (`number`),
ce qui permet une navigation fluide à toutes les échelles. L'échelle `ms`
est décorative (float64 ne supporte pas de timestamp absolu plus fin
que ~1 ms — les labels sont relatifs `±N ms` autour du curseur).

### Deux modes d'affichage

- **`expanded`** (défaut) — chaque item affiche label + sublabel complets.
- **`compact`** — les items aux frontières de l'**échelle supérieure**
  gardent l'affichage complet ; les items intermédiaires sont minimisés
  à un seul chiffre. Exemple à l'échelle décennie :
  `1800` · 10 · 20 · 30 · 40 · 50 · 60 · 70 · 80 · 90 · `1900`

Bascule à l'exécution :

```ts
timeline.setDisplayMode('compact');
```

### Bornes

```ts
new LadderTimeline({
  minYear, maxYear,   // année décimale (couvre toute la plage Ga→ms)
  minDate, maxDate,   // confort Date (converti en minYear/maxYear)
  minScale, maxScale, // clamp ScaleId sur setScale()
});

timeline.getBounds(); // { minYear, maxYear, minScale, maxScale }
```

Le curseur reste dans `[minYear, maxYear]` (drag, clavier, `setDate`).
L'échelle reste dans `[maxScale, minScale]` (du plus grossier au plus fin).

### Clavier

| Touche               | Action                              |
|----------------------|-------------------------------------|
| `←` / `→`            | Item précédent / suivant            |
| `Home`               | Aujourd'hui                         |
| `↑` / `+`            | Zoom in (échelle plus fine)         |
| `↓` / `-`            | Zoom out (échelle plus grossière)   |

Molette : scroll = précédent/suivant (debounced).

### Callbacks

```ts
new LadderTimeline({
  onItemChange:  info => {…},   // commit (après snap)
  onItemPreview: info => {…},   // live (pendant drag/scroll)
});

// info: { scale, year, label, sublabel, header, date }
```

`date` est `null` quand l'année de l'échelle est hors plage `Date` JS
(Ma, Ga, …).

## API

```ts
class LadderTimeline {
  constructor(options: LadderTimelineOptions);

  // Curseur
  getDate(): Date;
  setDate(date: Date): void;
  goToToday(): void;
  goToPrevious(): void;
  goToNext(): void;

  // Échelle
  getScale(): ScaleId;
  setScale(id: ScaleId): void;

  // Affichage
  getDisplayMode(): 'expanded' | 'compact';
  setDisplayMode(mode: 'expanded' | 'compact'): void;

  // Bornes
  getBounds(): { minYear, maxYear, minScale, maxScale };

  // Cycle de vie
  render(): void;
  destroy(): void;
  on(event, handler): () => void;
  getEventTarget(): EventTarget;
  connectAdapter(adapter: CalendarAdapter): void;
}
```

## Statut

Squelette initial — l'API publique n'est pas encore stable.

## Licence

MIT © synapxLab
