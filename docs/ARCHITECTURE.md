# ChronoMap — Architecture

> Atlas temporel interactif multi-couches, de **-5 000 000 à aujourd'hui**, éditable, basé sur PostGIS + MapLibre + PHP. Un repo, trois sous-projets (lib, app, server), zéro framework lourd.

---

## Sommaire

1. [Vision en une phrase](#1-vision-en-une-phrase)
2. [Stack & justifications](#2-stack--justifications)
3. [Architecture globale](#3-architecture-globale)
4. [Structure du dépôt](#4-structure-du-dépôt)
5. [Modèle temporel — la pièce-maîtresse](#5-modèle-temporel--la-pièce-maîtresse)
6. [Schéma SQL (PostGIS)](#6-schéma-sql-postgis)
7. [Configuration locale (DB & env)](#7-configuration-locale-db--env)
8. [Classes JS principales](#8-classes-js-principales)
9. [API REST](#9-api-rest)
10. [Stratégie multi-couches](#10-stratégie-multi-couches-le-croisement)
11. [Édition + versioning](#11-édition--versioning)
12. [Performances](#12-performances)
13. [MVP en 6 étapes](#13-mvp-en-6-étapes)
14. [Exemple concret : 4 couches croisées en -1 000](#14-exemple-concret--4-couches-croisées-en--1-000)
15. [Quickstart local](#15-quickstart-local)

---

## 1. Vision en une phrase

> Une carte vectorielle MapLibre pilotée par un **moteur temporel logarithmique** qui interroge une base **PostGIS** via une API REST PHP, où **chaque entité géographique a une période de validité** et un style configurable, le tout éditable depuis l'interface en mode admin.

---

## 2. Stack & justifications

| Couche | Choix | Pourquoi |
|---|---|---|
| Carte | **MapLibre GL JS** | Vector tiles MVT natifs, perf sur gros datasets, animations fluides au zoom — Leaflet sature dès qu'on superpose heatmap + polygones + icônes. Reste open-source (fork pre-fermeture de Mapbox). |
| Géom DB | **PostgreSQL 15+ + PostGIS 3.4** | Indispensable : `ST_AsMVT`, `ST_Simplify` pour LOD, index GIST, support sphère + projection. |
| Backend | **PHP 8.3** (slim, sans framework lourd) | Cohérent avec ton infra Synapx/Adliss existante. Router maison ou Slim 4, PDO direct (pas d'ORM). |
| Lib client | **TS + Vite (lib mode)** | Tu as déjà ce pattern (`@synapxlab/timeline`). Le moteur `ChronoMap` reste publishable sur npm. |
| App | **Vite SPA** (vanilla TS) | Pas de React/Vue — la lib expose tout en API impérative. |
| Temps | Représentation **`year` fractionnaire (NUMERIC)** + `precision` enum | Permet de couvrir -5M → 2026 dans une seule colonne tout en restant trié et indexable (cf. §5). |
| Tuiles | **Endpoint MVT dynamique** `?date_start&date_end` | Pas de pré-rendu : la base répond la tuile filtrée par période. |
| Auth admin | Réutiliser le **JWT keyring** Synapx | Tu l'as déjà pour ws.synapx.fr. Une seule clé partagée. |

---

## 3. Architecture globale

```
┌─────────────────────────────────────────────────────────────┐
│                   FRONTEND (Vite SPA)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  ChronoMap (lib)                                     │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────────┐   │   │
│  │  │TimeEngine│──│ LayerManager │──│  MapAdapter   │   │   │
│  │  │  cursor  │  │  visibility  │  │  (MapLibre)   │   │   │
│  │  │  scale   │  │  z-order     │  │  ↳ sources    │   │   │
│  │  │  range   │  │  palette     │  │  ↳ layers     │   │   │
│  │  └──────────┘  └──────────────┘  └───────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                  │                   │            │
│  ┌──────▼──────┐    ┌──────▼──────┐     ┌──────▼─────────┐  │
│  │ Timeline    │    │ Layer panel │     │ Edit/Inspector │  │
│  │ (bas)       │    │ (gauche)    │     │ (droite)       │  │
│  └─────────────┘    └─────────────┘     └────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │ REST / MVT
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                BACKEND PHP 8.3 (server/)                    │
│  Router → Controllers → Repositories → PDO                  │
│  /layers  /features  /tiles/{z}/{x}/{y}.mvt  /import …      │
└────────────────────────────┬────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│   PostgreSQL 15 + PostGIS 3.4                               │
│   features (geom) ─┬─ layers ─ palettes                     │
│                    ├─ feature_revisions  (audit)            │
│                    └─ datasets / sources / fiability        │
└─────────────────────────────────────────────────────────────┘
```

**Flux type** : l'utilisateur déplace le curseur temporel → `TimeEngine.emit('range')` → `LayerManager` recalcule l'URL des sources MVT (`?t_start=-10100&t_end=-9900`) → MapLibre invalide les tuiles → le serveur exécute un `ST_AsMVT` filtré → la carte se met à jour.

---

## 4. Structure du dépôt

```
ChronoMap/
├── packages/
│   └── core/                          # @synapxlab/chronomap (publié sur npm)
│       ├── src/
│       │   ├── TimeEngine.ts          # moteur temporel pur
│       │   ├── LayerManager.ts        # registre + z-order
│       │   ├── ChronoMap.ts           # orchestrateur (déjà scaffoldé)
│       │   ├── adapters/
│       │   │   ├── MapAdapter.ts      # interface abstraite
│       │   │   └── MapLibreAdapter.ts # impl par défaut
│       │   ├── styling/
│       │   │   ├── Palette.ts         # déconfliction de hues
│       │   │   └── presets.ts         # heatmap/icon/poly/line presets
│       │   ├── types.ts
│       │   └── index.ts
│       ├── package.json
│       └── vite.lib.config.ts
│
├── apps/
│   └── atlas/                         # l'application "Atlas"
│       ├── index.html
│       ├── src/
│       │   ├── main.ts
│       │   ├── ui/
│       │   │   ├── TimelinePanel.ts   # timeline bas (multi-échelle)
│       │   │   ├── LayerPanel.ts      # panneau gauche
│       │   │   ├── Inspector.ts       # panneau droit (lecture)
│       │   │   ├── EditorPanel.ts     # panneau droit (édition)
│       │   │   ├── SearchBar.ts
│       │   │   └── ShortcutBus.ts     # ← → + - espace E L …
│       │   ├── api/Client.ts          # wrapper fetch typé
│       │   └── styles/main.scss
│       └── vite.config.ts
│
├── server/                            # PHP 8.3 REST API
│   ├── public/index.php               # entrypoint (router)
│   ├── src/
│   │   ├── Controller/
│   │   │   ├── LayersController.php
│   │   │   ├── FeaturesController.php
│   │   │   ├── TilesController.php
│   │   │   ├── TimelineController.php
│   │   │   ├── SearchController.php
│   │   │   └── ImportController.php
│   │   ├── Repository/
│   │   │   ├── FeatureRepository.php  # SQL pur via PDO
│   │   │   ├── LayerRepository.php
│   │   │   └── RevisionRepository.php
│   │   ├── Service/
│   │   │   ├── TileBuilder.php        # génère MVT
│   │   │   ├── GeoJsonImporter.php
│   │   │   └── TimeCodec.php          # parsing -10000, "1789-07-14", …
│   │   ├── Db/Connection.php          # PDO singleton
│   │   ├── Http/Router.php
│   │   └── Auth/Jwt.php               # réutilise keyring Synapx
│   ├── .env.example
│   └── composer.json
│
├── db/
│   ├── bootstrap.sql                  # CREATE ROLE + CREATE DATABASE
│   ├── migrations/
│   │   ├── 001_extensions.sql         # CREATE EXTENSION postgis
│   │   ├── 002_layers.sql
│   │   ├── 003_features.sql
│   │   ├── 004_revisions.sql
│   │   ├── 005_views.sql
│   │   └── 006_indexes.sql
│   ├── seed/
│   │   ├── layers.sql
│   │   ├── volcanoes.sql
│   │   ├── climates.sql
│   │   ├── populations.sql
│   │   └── tectonics.sql
│   └── README.md
│
├── docs/
│   ├── ARCHITECTURE.md                # ← ce fichier
│   ├── TIME-MODEL.md
│   └── API.md
│
├── package.json                       # workspaces: packages/*, apps/*
└── README.md
```

> Une trentaine de fichiers source utiles. Pas un mono-repo lerna : juste des workspaces npm natifs.

---

## 5. Modèle temporel — la pièce-maîtresse

### 5.1 Le problème du `-5 000 000`

`PostgreSQL DATE` accepte 4713 BC → 5874897 AD, mais il **n'a pas de notion de précision** : `-10000-01-01` traite janvier 1 au jour près alors qu'on ne sait qu'à 10 ans près. Et l'affichage devient ingérable pour les volcans actifs sur 50 000 ans.

### 5.2 Représentation choisie

Une seule colonne **`NUMERIC(20, 6)` = `year`** (année julienne décimale, signée). Tous les calculs se font sur cette grandeur unique, indexable, triable.

| Donnée réelle | `t_start` | `t_end` | `precision` |
|---|---|---|---|
| Glaciation Würm | `-115000` | `-11700` | `millennium` |
| Empire romain | `-27` | `476` | `decade` |
| Révolution française | `1789.539` (14 juillet) | `1799.832` | `day` |
| Volcan Stromboli (actif) | `-7000` | `null` (= toujours actif) | `century` |
| Bataille de Marignan | `1515.69` | `1515.694` | `day` |

Conversion `date → year` côté backend (`TimeCodec`) :

```php
// "1789-07-14" → 1789.5343...
// "-10000"     → -10000.0
// "-1.2Ma"     → -1200000.0
```

### 5.3 Échelles d'affichage (`Scale`)

```ts
type Scale = 'Ma' | 'ka' | 'millennium' | 'century' | 'decade' | 'year' | 'month' | 'day';

const SCALE_STEP: Record<Scale, number> = {
  Ma:         1_000_000,
  ka:           100_000,
  millennium:     1_000,
  century:          100,
  decade:            10,
  year:               1,
  month:           1/12,
  day:           1/365.25,
};
```

`+` / `-` font passer d'une échelle à la voisine. `←` / `→` déplacent le curseur de `SCALE_STEP[currentScale]`.

La timeline du bas n'est **pas un slider linéaire** (impossible visuellement). C'est un **slider à zoom propre** : à chaque échelle, on voit une fenêtre de ±10 unités autour du curseur. Comme une carte qu'on zoome.

---

## 6. Schéma SQL (PostGIS)

Principe : **un modèle pivot générique** (`layers` + `features` + `feature_revisions`) + des **vues typées** pour confort d'écriture des requêtes spécialisées. Pas de table par sujet — sinon multiplication des jointures à chaque nouvelle couche.

```sql
-- ─── 001_extensions.sql ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- recherche fuzzy

-- ─── 002_layers.sql ─────────────────────────────────────────────────────────
CREATE TYPE geom_kind   AS ENUM ('point','line','polygon','multipolygon','raster');
CREATE TYPE render_type AS ENUM ('points','heatmap','polygons','lines','symbols','choropleth');
CREATE TYPE precision_t AS ENUM ('Ma','ka','millennium','century','decade','year','month','day');

CREATE TABLE layers (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  description  TEXT,
  geom_kind    geom_kind   NOT NULL,
  render_type  render_type NOT NULL,
  style        JSONB NOT NULL DEFAULT '{}',   -- couleur, opacité, paramètres heatmap…
  z_index      INT   NOT NULL DEFAULT 0,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT,
  citation     TEXT,
  license      TEXT
);

-- ─── 003_features.sql ──────────────────────────────────────────────────────
CREATE TABLE features (
  id           BIGSERIAL PRIMARY KEY,
  layer_id     INT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  geom         geometry(GEOMETRY, 4326) NOT NULL,   -- mixte intentionnellement
  t_start      NUMERIC(20, 6) NOT NULL,             -- année décimale signée
  t_end        NUMERIC(20, 6),                      -- NULL = encore valide
  precision    precision_t NOT NULL DEFAULT 'year',
  fiability    SMALLINT NOT NULL DEFAULT 80,        -- 0..100
  source_id    INT REFERENCES sources(id),
  label        TEXT,                                 -- "Stromboli", "Empire romain"
  props        JSONB NOT NULL DEFAULT '{}',          -- payload typé par layer
  style_over   JSONB,                                -- override du style de layer
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT,
  CHECK (t_end IS NULL OR t_end >= t_start)
);

-- ─── 004_revisions.sql ─────────────────────────────────────────────────────
CREATE TABLE feature_revisions (
  id           BIGSERIAL PRIMARY KEY,
  feature_id   BIGINT NOT NULL,                     -- pas de FK pour garder l'historique après DELETE
  op           CHAR(1) NOT NULL,                     -- I/U/D
  before       JSONB,                                -- état avant
  after        JSONB,                                -- état après
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by   TEXT
);

CREATE OR REPLACE FUNCTION trg_features_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO feature_revisions(feature_id, op, before, after, changed_by)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    SUBSTR(TG_OP,1,1),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    COALESCE(NEW.updated_by, OLD.updated_by)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER features_audit
AFTER INSERT OR UPDATE OR DELETE ON features
FOR EACH ROW EXECUTE FUNCTION trg_features_audit();

-- ─── 005_views.sql ─────────────────────────────────────────────────────────
-- Confort d'écriture, ZÉRO duplication de données.
CREATE VIEW v_volcanoes AS
  SELECT f.id, f.geom, f.t_start, f.t_end, f.precision,
         f.label AS name,
         (f.props->>'vei')::INT AS vei,
         (f.props->>'type')     AS type
    FROM features f
    JOIN layers l ON l.id = f.layer_id
   WHERE l.slug = 'volcanoes';

CREATE VIEW v_wars AS
  SELECT f.id, f.geom, f.t_start, f.t_end,
         f.label AS name,
         (f.props->>'belligerents')::JSONB AS belligerents,
         (f.props->>'casualties')::BIGINT  AS casualties
    FROM features f
    JOIN layers l ON l.id = f.layer_id
   WHERE l.slug = 'wars';

-- ─── 006_indexes.sql ───────────────────────────────────────────────────────
CREATE INDEX features_geom_gist        ON features USING GIST  (geom);
CREATE INDEX features_time_btree       ON features (t_start, t_end);
CREATE INDEX features_layer_time_btree ON features (layer_id, t_start, t_end);
CREATE INDEX features_props_gin        ON features USING GIN   (props);
CREATE INDEX features_label_trgm       ON features USING GIN   (label gin_trgm_ops);
```

**Pourquoi pas une table par sujet ?**
- Une table `volcanoes`, une `wars`, une `civilizations`… → 15 tables, donc 15 endpoints, 15 mappers, 15 imports.
- L'éditeur générique devient un cauchemar (formulaires conditionnels).
- Le **pivot `features` + JSONB**, c'est exactement comment OSM et Wikidata gèrent l'hétérogénéité.
- Les **vues** te donnent une API SQL typée gratuite quand tu veux écrire `SELECT * FROM v_volcanoes WHERE vei > 4`.

---

## 7. Configuration locale (DB & env)

> ⚠️ **Ces credentials sont strictement locaux.** Avant tout déploiement public, régénère un mot de passe et passe-le par `.env` non versionné (ou par le keyring Synapx).

### 7.1 Database — credentials locaux

| Paramètre | Valeur |
|---|---|
| Host | `127.0.0.1` |
| Port | `5432` |
| Database | `chronomap` |
| User | `chronomap` |
| Password | `j!1BIq9/aoQYig54` |
| DSN PHP/PDO | `pgsql:host=127.0.0.1;port=5432;dbname=chronomap` |
| URL libpq | `postgresql://chronomap:j!1BIq9%2FaoQYig54@127.0.0.1:5432/chronomap` |

> Le `/` du mot de passe est `%2F` une fois URL-encodé (`j!1BIq9%2FaoQYig54`). Pas besoin d'encoder le `!`.

### 7.2 Script de bootstrap — `db/bootstrap.sql`

À exécuter **une seule fois en tant que superuser** (`postgres`) :

```sql
-- Création du rôle applicatif
CREATE ROLE chronomap WITH LOGIN PASSWORD 'j!1BIq9/aoQYig54';

-- Création de la base, propriétaire = chronomap
CREATE DATABASE chronomap
  WITH OWNER = chronomap
       ENCODING = 'UTF8'
       LC_COLLATE = 'fr_FR.UTF-8'
       LC_CTYPE   = 'fr_FR.UTF-8'
       TEMPLATE = template0;

-- Extensions (nécessitent les droits superuser → on les pose ici)
\c chronomap
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Le rôle applicatif possède tout son schéma public
ALTER SCHEMA public OWNER TO chronomap;
GRANT ALL PRIVILEGES ON DATABASE chronomap TO chronomap;
```

Lancement :

```bash
sudo -u postgres psql -f db/bootstrap.sql
```

Puis on enchaîne les migrations en tant que `chronomap` :

```bash
for f in db/migrations/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done
```

### 7.3 Fichier `server/.env.example`

```ini
# ─── ChronoMap server — local config ──────────────────────────────────────
APP_ENV=local
APP_DEBUG=true

DB_DSN="pgsql:host=127.0.0.1;port=5432;dbname=chronomap"
DB_USER="chronomap"
DB_PASS="j!1BIq9/aoQYig54"

# JWT — réutilise la clé partagée du keyring Synapx en prod ;
# en local on peut générer une clé HS256 dédiée.
JWT_SECRET="change-me-locally"
JWT_ALG="HS256"

# Frontend dev server (CORS allowlist)
CORS_ORIGINS="http://localhost:5173,http://chronomap.fr.lan"
```

> **Le `.env` réel n'est PAS versionné** (le `.gitignore` exclut `.env` déjà). Le `.env.example` sert juste de template à copier : `cp server/.env.example server/.env`.

---

## 8. Classes JS principales

### 8.1 `TimeEngine` (publié dans la lib)

```ts
export class TimeEngine extends EventTarget {
  private _cursor: number;            // année décimale
  private _scale:  Scale;
  private _range:  { start: number; end: number };

  constructor(opts: { cursor?: number; scale?: Scale } = {}) {
    super();
    this._cursor = opts.cursor ?? 0;
    this._scale  = opts.scale  ?? 'year';
    this._range  = this.computeRange();
  }

  setCursor(year: number): void {
    this._cursor = year;
    this._range  = this.computeRange();
    this.emit('change');
  }

  setScale(scale: Scale): void {
    this._scale = scale;
    this._range = this.computeRange();
    this.emit('scale');
    this.emit('change');
  }

  step(direction: 1 | -1): void {
    this.setCursor(this._cursor + direction * SCALE_STEP[this._scale]);
  }

  /** Fenêtre temporelle envoyée aux requêtes (= curseur ± 10 unités). */
  private computeRange() {
    const half = 10 * SCALE_STEP[this._scale];
    return { start: this._cursor - half, end: this._cursor + half };
  }

  get cursor(): number              { return this._cursor; }
  get scale():  Scale               { return this._scale; }
  get range():  { start: number; end: number } { return { ...this._range }; }

  private emit(t: string) { this.dispatchEvent(new CustomEvent(t, { detail: this.snapshot() })); }
  snapshot()              { return { cursor: this._cursor, scale: this._scale, range: this._range }; }
}
```

### 8.2 `LayerManager`

```ts
export class LayerManager extends EventTarget {
  private layers = new Map<string, LayerState>();   // slug → state

  register(def: LayerDefinition): void { /* … */ }
  setVisible(slug: string, v: boolean): void { /* … */ }
  setOpacity(slug: string, o: number): void { /* … */ }
  setRenderType(slug: string, rt: RenderType): void { /* … */ }
  setZ(slug: string, z: number): void { /* … */ }

  /** Renvoie l'ordre de rendu auto + palette déconfliée. */
  resolveDisplay(): LayerDisplay[] { /* … */ }

  active(): LayerState[] {
    return [...this.layers.values()].filter(l => l.visible);
  }
}
```

### 8.3 `MapAdapter` + `MapLibreAdapter`

```ts
export interface MapAdapter {
  mount(container: HTMLElement, opts: MapInitOptions): void;
  setSource(slug: string, source: SourceDef): void;     // GeoJSON | MVT URL
  setLayerStyle(slug: string, style: LayerStyle): void;
  setVisibility(slug: string, v: boolean): void;
  fitTo(bbox: [number, number, number, number]): void;
  on(event: 'click' | 'movestart' | 'moveend' | 'rightclick', cb: (e: MapEvent) => void): void;
  destroy(): void;
}

export class MapLibreAdapter implements MapAdapter { /* impl */ }
```

L'abstraction `MapAdapter` permet de plugger plus tard Leaflet (raster historiques) ou OpenLayers (projections exotiques pour la paléogéographie).

### 8.4 `ChronoMap` (orchestrateur)

```ts
export class ChronoMap {
  readonly time:   TimeEngine;
  readonly layers: LayerManager;
  readonly map:    MapAdapter;

  constructor(opts: ChronoMapOptions) {
    this.time   = new TimeEngine(opts.time);
    this.layers = new LayerManager();
    this.map    = opts.mapAdapter ?? new MapLibreAdapter();
    this.wire();
  }

  private wire(): void {
    this.time.addEventListener('change', () => this.refreshSources());
    this.layers.addEventListener('change', () => this.refreshSources());
  }

  private refreshSources(): void {
    const { start, end } = this.time.range;
    for (const layer of this.layers.active()) {
      const url = `/api/tiles/${layer.slug}/{z}/{x}/{y}.mvt?t_start=${start}&t_end=${end}`;
      this.map.setSource(layer.slug, { type: 'vector', tiles: [url] });
      this.map.setLayerStyle(layer.slug, layer.style);
    }
  }
}
```

### 8.5 `Palette` (déconfliction)

```ts
export class Palette {
  // Distribue les hues sur le cercle pour les couches actives — évite que tout soit rouge.
  static assign(layers: LayerState[]): Map<string, string> {
    const n = layers.length;
    const m = new Map<string, string>();
    layers.forEach((l, i) => {
      if (l.style.color) { m.set(l.slug, l.style.color); return; }
      const hue = Math.round((360 / n) * i);
      m.set(l.slug, `hsl(${hue} 75% 55%)`);
    });
    return m;
  }
}
```

---

## 9. API REST

Tout sous `/api`. Auth JWT (keyring Synapx) pour `POST` / `PUT` / `DELETE`. `GET` public.

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/layers` | Liste les couches avec style + état actif |
| `GET` | `/api/layers/:slug` | Détail d'une couche |
| `POST` | `/api/layers` | Créer une couche |
| `PUT` | `/api/layers/:slug` | Modifier (style, z_index, render_type…) |
| `GET` | `/api/layers/:slug/features?t_start&t_end&bbox` | GeoJSON filtré (petits volumes) |
| `GET` | `/api/tiles/:slug/:z/:x/:y.mvt?t_start&t_end` | **Tuile vectorielle** (gros volumes) |
| `GET` | `/api/features/:id` | Détail (props + revisions count) |
| `POST` | `/api/features` | Créer (geom GeoJSON + props + t_start/t_end) |
| `PUT` | `/api/features/:id` | Modifier |
| `DELETE` | `/api/features/:id` | Supprimer (soft : trigger audit garde la trace) |
| `GET` | `/api/features/:id/revisions` | Historique |
| `POST` | `/api/features/:id/revert/:rev` | Restaurer une révision |
| `GET` | `/api/timeline/range` | `{ min: -5000000, max: 2026 }` (extrêmes de la BD) |
| `GET` | `/api/search?q=rome&date=-100` | Recherche trigram dans `label` + filtre temporel |
| `GET` | `/api/compare?layers=population,climate&date=-500&format=stats` | Stats croisées (sans géom, pour graphiques) |
| `POST` | `/api/import/:slug` | Multipart : `.geojson` ou `.csv` |
| `GET` | `/api/export/:slug?format=geojson&t_start&t_end` | Téléchargement |

### Endpoint clé : la tuile MVT dynamique

```php
// server/src/Controller/TilesController.php
public function getTile(string $slug, int $z, int $x, int $y, Request $r): Response
{
  $tStart = (float) $r->query->get('t_start', '-5000000');
  $tEnd   = (float) $r->query->get('t_end',    '2100');

  $sql = <<<SQL
    WITH bounds AS ( SELECT ST_TileEnvelope(:z, :x, :y) AS env ),
    mvt_geom AS (
      SELECT f.id,
             f.label,
             f.props,
             ST_AsMVTGeom(ST_Transform(f.geom, 3857), b.env, 4096, 64, true) AS geom
        FROM features f
        JOIN layers  l ON l.id = f.layer_id
        JOIN bounds  b ON ST_Intersects(ST_Transform(f.geom, 3857), b.env)
       WHERE l.slug = :slug
         AND f.t_start <= :t_end
         AND (f.t_end IS NULL OR f.t_end >= :t_start)
    )
    SELECT ST_AsMVT(mvt_geom, :slug, 4096, 'geom') FROM mvt_geom;
  SQL;

  $stmt = $this->db->prepare($sql);
  $stmt->execute(compact('z','x','y','slug','tStart','tEnd'));
  $mvt = $stmt->fetchColumn();

  return new Response($mvt, 200, [
    'Content-Type'  => 'application/vnd.mapbox-vector-tile',
    'Cache-Control' => 'public, max-age=300',
  ]);
}
```

C'est **la** ligne qui rend le projet viable à grande échelle : tu envoies de la géom déjà découpée, simplifiée, et filtrée temporellement, en binaire compact.

---

## 10. Stratégie multi-couches (le croisement)

Trois leviers pour rester lisible quand 5 couches sont actives :

### 10.1 Z-order automatique par type

| `render_type` | `z_index` auto |
|---|---|
| `choropleth` (zones climatiques) | 10 |
| `polygons` (frontières, civilisations) | 20 |
| `heatmap` (population) | 30 |
| `lines` (plaques tectoniques, routes) | 40 |
| `points` (villes) | 50 |
| `symbols` (volcans, batailles) | 60 |

→ les couches floues sont **dessous**, les icônes pointues **dessus**. Modifiable manuellement dans le panneau.

### 10.2 Palette déconfliée

`Palette.assign()` répartit les hues sur le cercle quand l'auteur n'a pas fixé de couleur (cf. §8.5). Une heatmap rouge + un climat rouge → on force le climat à virer au bleu/vert.

### 10.3 Mode "comparer"

Bouton qui passe en **swipe** (slider vertical sépare gauche/droite) ou **side-by-side** (deux cartes synchronisées) — pour comparer 1700 vs 2000, ou population vs climat à date fixe.

### 10.4 Auto-réduction d'opacité

Au-delà de 3 couches actives en superposition, `LayerManager` réduit auto l'opacité des heatmaps/choropleths à 0.6, des polygones à 0.5. Réglable individuellement.

---

## 11. Édition + versioning

### 11.1 Workflow

1. Touche `E` → bascule en **mode édition** (`document.body.dataset.mode='edit'`).
2. Clic sur la carte sans feature → ouverture du panneau droit en mode "création" + sélection du type de géom (point / polyline / polygone).
3. Clic sur une feature → panneau droit "modification" : géom modifiable in-situ (drag des vertices via MapLibre Draw plugin), props éditables comme JSON form (auto-formulaire généré depuis le schema JSON de la `layer`).
4. Modification de `t_start` / `t_end` via un mini-slider dédié.
5. Boutons `Enregistrer` (`PUT /api/features/:id`) / `Annuler` / `Supprimer`.

### 11.2 Versioning

- Le trigger `trg_features_audit()` (cf. §6) écrit dans `feature_revisions` à chaque INSERT/UPDATE/DELETE.
- Pas de soft-delete sur la table principale (DELETE = vraie suppression, mais la révision garde le `before`).
- L'UI propose un panneau "historique" avec diff JSON et bouton `Restaurer cette version` → `POST /api/features/:id/revert/:rev`.

### 11.3 Import / export

| Format | Sens | Endpoint |
|---|---|---|
| GeoJSON FeatureCollection | ↑↓ | `/api/import/:slug` / `/api/export/:slug?format=geojson` |
| CSV (lon, lat, t_start, t_end, props_json) | ↑↓ | idem `format=csv` |
| Shapefile (zip) | ↑ | `/api/import/:slug?format=shp` (via `shp2pgsql` côté serveur) |

L'import accepte un **mapping** : colonne `année` → `t_start`, colonne `nom` → `label`, etc. Stocké côté serveur comme template réutilisable.

---

## 12. Performances

| Levier | Gain |
|---|---|
| **MVT dynamique avec `ST_AsMVTGeom`** | Géom déjà clippée et simplifiée par zoom, payload binaire compact (5-10× plus léger que GeoJSON équivalent). |
| **Index GIST sur `geom`** | Recherche bbox en O(log n). |
| **Index BTREE composite `(layer_id, t_start, t_end)`** | Filtrage temporel direct par couche. |
| **`ST_Simplify(geom, tolerance)`** côté tuile, tolerance fonction du `z` | Polygones de plaques tectoniques < 1 ko à `z=2`. |
| **Cache HTTP** `Cache-Control: public, max-age=300` sur MVT | Tuile identique à temps égal réutilisée. |
| **`pg_trgm` sur `label`** | `LIKE '%rome%'` reste sub-seconde sur 100k features. |
| **Pagination implicite par tuile** | Pas besoin de paginer en JSON — la carte ne demande que les tuiles visibles. |
| **Précomputation des hotspots** (vue matérialisée pour `populations` agrégées au siècle) | Évite un `SUM` par tuile sur les couches denses. |
| **Cluster en JS** (supercluster) pour `render_type='points'` à petite échelle | Évite de dessiner 10 000 villes au monde entier. |

---

## 13. MVP en 6 étapes

| Étape | Livrable | Durée idéale |
|---|---|---|
| **1. Schéma + 1 couche** | Postgres+PostGIS up, `layers` + `features` + seed `volcanoes` (~1500 entrées, sourcing Smithsonian GVP). Endpoint `GET /api/layers/:slug/features`. | 1-2 j |
| **2. ChronoMap + MapLibreAdapter** | Lib publiée locale, carte qui affiche les volcans en GeoJSON simple, sans temps. | 2 j |
| **3. TimeEngine + TimelinePanel** | Curseur, échelles, raccourcis ← → + -, refresh des sources avec `?t_start&t_end`. Volcans apparaissent/disparaissent. | 2 j |
| **4. LayerManager + 2 couches** | Ajout `climates` (polygones) et `population` (heatmap). Toggle, opacité, z-order. | 2-3 j |
| **5. MVT pipeline** | Endpoint `/api/tiles/...mvt`, passage des sources en `type: 'vector'`. Test charge sur `population` (densité Maddison Project). | 2 j |
| **6. Édition + audit** | Mode édition, draw, save, `feature_revisions`. Import GeoJSON volcans. | 3 j |

**Total MVP : ~13 jours** — tu as alors un atlas qui fonctionne avec 4 couches et l'édition. Le reste (recherche, compare mode, exports, versioning UI) se rajoute incrémentalement.

---

## 14. Exemple concret : 4 couches croisées en -1 000

### 14.1 Seed minimal

```sql
-- db/seed/layers.sql
INSERT INTO layers (slug, label, geom_kind, render_type, style, z_index) VALUES
  ('volcanoes',  'Volcans actifs',      'point',        'symbols',    '{"icon":"volcano","size":18}', 60),
  ('climates',   'Zones climatiques',   'multipolygon', 'choropleth', '{"palette":"climate"}',         10),
  ('populations','Densité de population','point',       'heatmap',    '{"radius":35,"intensity":0.8}', 30),
  ('tectonics',  'Plaques tectoniques', 'line',         'lines',      '{"color":"#b91c1c","width":2}', 40);

-- db/seed/volcanoes.sql (extrait)
INSERT INTO features (layer_id, geom, t_start, t_end, precision, label, props) VALUES
 ((SELECT id FROM layers WHERE slug='volcanoes'),
  ST_SetSRID(ST_MakePoint(15.213, 38.789), 4326),
  -7000, NULL, 'century', 'Stromboli', '{"vei":3,"type":"stratovolcano"}'),
 ((SELECT id FROM layers WHERE slug='volcanoes'),
  ST_SetSRID(ST_MakePoint(14.426, 40.821), 4326),
  -25000, NULL, 'century', 'Vésuve', '{"vei":5,"type":"stratovolcano"}'),
 ((SELECT id FROM layers WHERE slug='volcanoes'),
  ST_SetSRID(ST_MakePoint(-155.272, 19.421), 4326),
  -300000, NULL, 'millennium', 'Kīlauea', '{"vei":1,"type":"shield"}');

-- db/seed/tectonics.sql (extrait — version simplifiée des limites de plaques)
INSERT INTO features (layer_id, geom, t_start, precision, label, props) VALUES
 ((SELECT id FROM layers WHERE slug='tectonics'),
  ST_GeomFromText('LINESTRING(34 35, 36 33, 38 31, 41 28)', 4326),
  -5000000, 'Ma', 'Faille du Levant', '{"type":"transform","rate_mmyr":4.5}');

-- db/seed/climates.sql (zones climatiques approximatives à -1000)
INSERT INTO features (layer_id, geom, t_start, t_end, precision, label, props) VALUES
 ((SELECT id FROM layers WHERE slug='climates'),
  ST_GeomFromText('MULTIPOLYGON(((-10 30, 40 30, 40 45, -10 45, -10 30)))', 4326),
  -2000, -500, 'century', 'Optimum climatique antique', '{"koppen":"Csa","temp_anomaly":1.2}');

-- db/seed/populations.sql (densités estimées Maddison, agrégées par cellule 5°)
INSERT INTO features (layer_id, geom, t_start, t_end, precision, props) VALUES
 ((SELECT id FROM layers WHERE slug='populations'),
  ST_SetSRID(ST_MakePoint(2.35, 48.85), 4326),
  -1200, -800, 'century', '{"density":12,"region":"Gaule"}'),
 ((SELECT id FROM layers WHERE slug='populations'),
  ST_SetSRID(ST_MakePoint(31.23, 30.05), 4326),
  -1200, -800, 'century', '{"density":85,"region":"Égypte du Nord"}');
```

### 14.2 Requête type — "tout ce qui est visible en -1 000 ± 1 siècle"

```sql
SELECT l.slug, f.id, f.label, f.props, ST_AsGeoJSON(f.geom) AS geom
  FROM features f
  JOIN layers   l ON l.id = f.layer_id
 WHERE l.slug IN ('volcanoes','climates','populations','tectonics')
   AND f.t_start <= -900
   AND (f.t_end IS NULL OR f.t_end >= -1100)
 ORDER BY l.z_index, f.id;
```

Avec l'index composite `(layer_id, t_start, t_end)`, c'est sub-milliseconde sur 100k features.

### 14.3 Wiring frontend

```ts
// apps/atlas/src/main.ts
import { ChronoMap } from '@synapxlab/chronomap';
import { TimelinePanel } from './ui/TimelinePanel';
import { LayerPanel }    from './ui/LayerPanel';
import { ApiClient }     from './api/Client';

const api = new ApiClient('/api');
const cm  = new ChronoMap({
  container: document.getElementById('chronomap')!,
  time: { cursor: -1000, scale: 'century' },
});

// Charger les couches depuis l'API et les enregistrer
const layers = await api.layers.list();
layers.forEach(l => cm.layers.register(l));

// Activer les 4 couches d'exemple
['climates', 'populations', 'tectonics', 'volcanoes']
  .forEach(slug => cm.layers.setVisible(slug, true));

// Brancher les panneaux UI sur le moteur
new TimelinePanel(document.getElementById('timeline')!, cm.time);
new LayerPanel   (document.getElementById('layers')!,   cm.layers);

// Raccourcis clavier
document.addEventListener('keydown', e => {
  switch (e.key) {
    case 'ArrowLeft':  cm.time.step(-1); break;
    case 'ArrowRight': cm.time.step(+1); break;
    case '+':          cm.time.setScale(prevScale(cm.time.scale)); break;
    case '-':          cm.time.setScale(nextScale(cm.time.scale)); break;
    case 'e': case 'E': document.body.dataset.mode = (document.body.dataset.mode === 'edit' ? 'read' : 'edit'); break;
    case 'l': case 'L': document.querySelector('.layer-panel')?.classList.toggle('open'); break;
  }
});
```

Résultat visuel à -1 000 ± 100 ans :
- **Fond** : zones climatiques pastel (choropleth, opacité 0.5)
- **Lignes rouges** : limites de plaques tectoniques
- **Halo coloré** : heatmap de population centrée sur Égypte, Mésopotamie, Vallée de l'Indus, Chine du Nord
- **Icônes de volcans** : Stromboli, Vésuve, Kīlauea actifs

`←` recule de 100 ans → tout se reconfigure : la heatmap se rétracte, certains volcans disparaissent, les frontières changent.

---

## 15. Quickstart local

### 15.1 Prérequis

```bash
# Debian/Ubuntu
sudo apt install postgresql-15 postgresql-15-postgis-3 php8.3 php8.3-pgsql php8.3-curl composer nodejs npm
```

### 15.2 Création de la base

```bash
cd /data/vhosts/@synapxlab/ChronoMap

# 1. Bootstrap (rôle + DB + extensions) — UNE SEULE FOIS, en tant que postgres
sudo -u postgres psql -f db/bootstrap.sql

# 2. Migrations (schéma applicatif)
for f in db/migrations/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done

# 3. Seed (données d'exemple)
for f in db/seed/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done

# 4. Sanity check
PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap \
  -c "SELECT slug, count(*) FROM features f JOIN layers l ON l.id = f.layer_id GROUP BY slug;"
```

### 15.3 Backend PHP

```bash
cp server/.env.example server/.env       # contient déjà les credentials locaux
cd server && composer install
php -S 127.0.0.1:8088 -t public          # → http://127.0.0.1:8088/api/layers
```

### 15.4 Frontend

```bash
# Lib core (mode watch)
cd packages/core && npm install && npm run dev

# App atlas (Vite dev server)
cd apps/atlas && npm install && npm run dev
# → http://localhost:5173
```

### 15.5 Test fumée

| Action | Attendu |
|---|---|
| `curl http://127.0.0.1:8088/api/layers` | JSON avec les 4 couches |
| `curl 'http://127.0.0.1:8088/api/layers/volcanoes/features?t_start=-10000&t_end=0'` | FeatureCollection GeoJSON |
| Ouvrir `http://localhost:5173` | Carte avec les couches actives, curseur sur -1000 |
| Appuyer `←` | Curseur -1100, couches rechargées |
| Appuyer `E` puis cliquer sur la carte | Panneau droit en mode création |

---

## TL;DR — la colonne vertébrale

1. **`features` + JSONB** comme pivot, **vues SQL** pour le confort spécialisé.
2. **`year` décimal** comme unique unité temporelle, des microsecondes humaines au million d'années.
3. **MVT dynamique filtré par date** comme transport — c'est la clé de la perf.
4. **`TimeEngine` + `LayerManager` + `MapAdapter`** — trois classes, c'est tout le cœur.
5. **MVP en ~13 jours** sur 4 couches.
