# ChronoMap — Architecture

> Atlas temporel interactif multi-couches, de **-5 000 000 à aujourd'hui**, éditable, basé sur PostGIS + MapLibre + PHP.
> **La feature qui change tout** : un moteur de corrélations qui rend visibles les liens entre couches (climat ↔ migrations, volcanisme ↔ refroidissement, sécheresse ↔ guerres…).

---

## Sommaire

1. [Vision en une phrase](#1-vision-en-une-phrase)
2. [Stack & justifications](#2-stack--justifications)
3. [Architecture globale](#3-architecture-globale)
4. [Structure du dépôt](#4-structure-du-dépôt)
5. [Taxonomie des données en 10 familles](#5-taxonomie-des-données-en-10-familles)
6. [Modèle temporel — la pièce-maîtresse](#6-modèle-temporel--la-pièce-maîtresse)
7. [Schéma SQL (PostGIS)](#7-schéma-sql-postgis)
8. [Configuration locale (DB & env)](#8-configuration-locale-db--env)
9. [Classes JS principales](#9-classes-js-principales)
10. [API REST](#10-api-rest)
11. [Stratégie multi-couches](#11-stratégie-multi-couches-le-croisement)
12. [Le moteur de corrélations](#12-le-moteur-de-corrélations--la-feature-différenciante)
13. [Édition + versioning](#13-édition--versioning)
14. [Performances](#14-performances)
15. [MVP en 7 étapes](#15-mvp-en-7-étapes)
16. [Exemple concret : 4 couches + 2 corrélations](#16-exemple-concret--4-couches--2-corrélations)
17. [Quickstart local](#17-quickstart-local)

---

## 1. Vision en une phrase

> Une carte vectorielle MapLibre pilotée par un **moteur temporel logarithmique** qui interroge une base **PostGIS** via une API REST PHP, où **chaque entité géographique a une période de validité**, **les couches sont organisées en 10 grandes familles**, et **un moteur de corrélation** révèle les liens causaux et statistiques entre elles, le tout éditable depuis l'interface en mode admin.

---

## 2. Stack & justifications

| Couche | Choix | Pourquoi |
|---|---|---|
| Carte | **MapLibre GL JS** | Vector tiles MVT natifs, perf sur gros datasets, animations fluides au zoom — Leaflet sature dès qu'on superpose heatmap + polygones + icônes. Reste open-source (fork pre-fermeture de Mapbox). |
| Géom DB | **PostgreSQL 15+ + PostGIS 3.4** | Indispensable : `ST_AsMVT`, `ST_Simplify` pour LOD, index GIST, `corr()` natif (Pearson) pour les corrélations, support sphère + projection. |
| Backend | **PHP 8.3** (slim, sans framework lourd) | Cohérent avec ton infra Synapx/Adliss existante. Router maison ou Slim 4, PDO direct (pas d'ORM). |
| Lib client | **TS + Vite (lib mode)** | Tu as déjà ce pattern (`@synapxlab/timeline`). Le moteur `ChronoMap` reste publishable sur npm. |
| App | **Vite SPA** (vanilla TS) | Pas de React/Vue — la lib expose tout en API impérative. |
| Charts | **uPlot** (12 ko, ultra rapide) | Pour les séries temporelles du panneau de corrélation. Pas de Chart.js/D3 plein-pot. |
| Temps | Représentation **`year` fractionnaire (NUMERIC)** + `precision` enum | Permet de couvrir -5M → 2026 dans une seule colonne tout en restant trié et indexable (cf. §6). |
| Tuiles | **Endpoint MVT dynamique** `?date_start&date_end` | Pas de pré-rendu : la base répond la tuile filtrée par période. |
| Auth admin | Réutiliser le **JWT keyring** Synapx | Tu l'as déjà pour ws.synapx.fr. Une seule clé partagée. |

---

## 3. Architecture globale

```
┌─────────────────────────────────────────────────────────────────────┐
│                       FRONTEND (Vite SPA)                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  ChronoMap (lib)                                             │   │
│  │  ┌──────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────┐  │   │
│  │  │TimeEngine│─│ LayerManager │─│CorrelationCore│─│MapAdapter│  │   │
│  │  │ cursor   │ │ visibility   │ │ Pearson(corr)│ │MapLibre │  │   │
│  │  │ scale    │ │ z-order      │ │ neighbours   │ │sources  │  │   │
│  │  │ range    │ │ tree (10 fam)│ │ typed links  │ │layers   │  │   │
│  │  └──────────┘ └──────────────┘ └──────────────┘ └─────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│        │              │                │                 │          │
│  ┌─────▼──────┐ ┌─────▼─────┐ ┌────────▼───────┐ ┌───────▼──────┐   │
│  │ Timeline   │ │LayerPanel │ │ Correlation    │ │ Inspector /  │   │
│  │ (bas)      │ │(10 fam,   │ │ panel  (bas)   │ │ Editor       │   │
│  │            │ │ arbre)    │ │ uPlot + matrix │ │ (droite)     │   │
│  └────────────┘ └───────────┘ └────────────────┘ └──────────────┘   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ REST / MVT / corrélations
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  BACKEND PHP 8.3 (server/)                          │
│  Router → Controllers → Repositories → PDO                          │
│  /layers /features /tiles /correlations /links /import …            │
└────────────────────────────┬────────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│   PostgreSQL 15 + PostGIS 3.4                                       │
│   layer_categories ── layers ── features (geom + t_start/t_end)     │
│                                  ├─ feature_links  (corrélations)   │
│                                  └─ feature_revisions  (audit)      │
└─────────────────────────────────────────────────────────────────────┘
```

**Flux type** : l'utilisateur déplace le curseur temporel → `TimeEngine` émet → `LayerManager` recharge les sources MVT → `CorrelationCore` recalcule les coefficients pour les couches actives → la carte + le panneau de corrélation se mettent à jour ensemble.

---

## 4. Structure du dépôt

```
ChronoMap/
├── packages/
│   └── core/                          # @synapxlab/chronomap (publié sur npm)
│       ├── src/
│       │   ├── TimeEngine.ts          # moteur temporel pur
│       │   ├── LayerManager.ts        # registre + z-order + arbre 10 familles
│       │   ├── CorrelationCore.ts     # client du moteur de corrélation
│       │   ├── ChronoMap.ts           # orchestrateur
│       │   ├── adapters/
│       │   │   ├── MapAdapter.ts      # interface abstraite
│       │   │   └── MapLibreAdapter.ts # impl par défaut
│       │   ├── styling/
│       │   │   ├── Palette.ts         # déconfliction de hues
│       │   │   └── presets.ts         # heatmap/icon/poly/line presets
│       │   ├── types.ts
│       │   └── index.ts
│       └── vite.lib.config.ts
│
├── apps/
│   └── atlas/                         # l'application "Atlas"
│       ├── index.html
│       ├── src/
│       │   ├── main.ts
│       │   ├── ui/
│       │   │   ├── TimelinePanel.ts        # timeline bas (multi-échelle)
│       │   │   ├── LayerPanel.ts           # panneau gauche, arbre 10 familles
│       │   │   ├── CorrelationPanel.ts     # panneau bas (séries + matrice)
│       │   │   ├── Inspector.ts            # panneau droit (lecture)
│       │   │   ├── EditorPanel.ts          # panneau droit (édition)
│       │   │   ├── LinksPanel.ts           # causes & conséquences typées
│       │   │   ├── SearchBar.ts
│       │   │   └── ShortcutBus.ts          # ← → + - espace E L C …
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
│   │   │   ├── CorrelationsController.php   # ← Pearson / matrice / voisinage
│   │   │   ├── LinksController.php          # ← liens typés
│   │   │   ├── TimelineController.php
│   │   │   ├── SearchController.php
│   │   │   └── ImportController.php
│   │   ├── Repository/
│   │   ├── Service/
│   │   │   ├── TileBuilder.php        # génère MVT
│   │   │   ├── CorrelationEngine.php  # ← coeur statistique
│   │   │   ├── GeoJsonImporter.php
│   │   │   └── TimeCodec.php
│   │   ├── Db/Connection.php
│   │   ├── Http/Router.php
│   │   └── Auth/Jwt.php
│   ├── .env.example
│   └── composer.json
│
├── db/
│   ├── bootstrap.sql                  # CREATE ROLE + CREATE DATABASE
│   ├── migrations/
│   │   ├── 001_extensions.sql         # CREATE EXTENSION postgis, pg_trgm
│   │   ├── 002_categories.sql         # 10 familles
│   │   ├── 003_layers.sql
│   │   ├── 004_features.sql
│   │   ├── 005_revisions.sql
│   │   ├── 006_views.sql
│   │   ├── 007_links.sql              # ← liens typés
│   │   ├── 008_buckets.sql            # ← vue matérialisée pour corrélations
│   │   └── 009_indexes.sql
│   ├── seed/
│   │   ├── 01_categories.sql
│   │   ├── 02_layers.sql
│   │   ├── volcanoes.sql
│   │   ├── climates.sql
│   │   ├── populations.sql
│   │   ├── tectonics.sql
│   │   └── known_links.sql            # ← Tambora→1816, sécheresse→Akkad, etc.
│   └── README.md
│
├── docs/
│   ├── ARCHITECTURE.md                # ← ce fichier
│   ├── TIME-MODEL.md
│   ├── CORRELATIONS.md                # ← détail du moteur, p-values, choix méthodo
│   └── API.md
│
├── package.json                       # workspaces: packages/*, apps/*
└── README.md
```

---

## 5. Taxonomie des données en 10 familles

L'atlas se structure en 10 familles. Le **panneau gauche** est un arbre repliable famille → couche → sous-couche. Toutes les couches partagent le même pivot `features` ; la famille est une catégorie d'affichage et de regroupement, pas un type SQL séparé.

Cible à terme : **~80 couches** réparties dans ces 10 familles.

| # | Famille | Slug | Icône | Sous-couches typiques | Render dominants | Échelles utiles |
|---|---|---|---|---|---|---|
| 1 | 🌍 Géologie / Terre profonde | `geo` | 🌍 | plaques tectoniques, frontières & subductions, vitesses, volcans actifs/dormants, éruptions historiques (VEI), nuages volcaniques, séismes (M, profondeur), relief, bathymétrie, niveau des mers, inversions magnétiques | lines, points, polygons, raster | **Ma → year** |
| 2 | 🌦️ Climat / météo | `climate` | 🌦️ | température moyenne, anomalies, biomes (désert/forêt/toundra/jungle), glaciations, courants océaniques (Gulf Stream, El Niño), précipitations, moussons, sécheresses, petits âges glaciaires, mégasécheresses | choropleth, heatmap, lines | ka → year |
| 3 | 👥 Population humaine | `people` | 👥 | densité mondiale, populations régionales, urbanisation, âge/mortalité/espérance, langues, religions, ADN/migrations (sapiens, néandertal), expansions préhistoriques | heatmap, points, polygons | ka → year |
| 4 | ⚔️ Guerres / géopolitique | `geopolitics` | ⚔️ | batailles, fronts, conquêtes, empires (expansion/effondrement), frontières historiques, révolutions, indépendances, coups d'État, alliances, colonisation | polygons, lines, symbols | century → day |
| 5 | 💰 Économie / commerce | `economy` | 💰 | routes commerciales (soie, maritime), ressources (or, pétrole, charbon, lithium), cultures agricoles, rendements, famines, PIB historique, révolutions industrielles | lines, points, choropleth | millennium → year |
| 6 | 🧬 Civilisations / culture | `culture` | 🧬 | civilisations (Égypte, Rome, Maya, Chine…), monuments, sciences/inventions, écritures & alphabets, technologies (bronze, fer, vapeur, nucléaire, internet) | polygons, symbols | millennium → year |
| 7 | 🦖 Vie / biodiversité | `bio` | 🦖 | apparition/extinction d'espèces, répartition des dinosaures, hotspots biodiversité, déforestation, pandémies animales | polygons, points, heatmap | **Ma → year** |
| 8 | ☣️ Pandémies / santé | `health` | ☣️ | épidémies (peste noire, grippe espagnole, COVID), propagation par routes commerciales, vaccination | heatmap, lines, points | century → month |
| 9 | 🚀 Technologie / infra | `tech` | 🚀 | routes, chemins de fer, câbles sous-marins, internet, satellites & orbites, nucléaire, barrages, solaire | lines, points, symbols | decade → year |
| 10 | 🌌 Astronomie / espace | `space` | 🌌 | impacts météoriques, position des étoiles, éclipses, missions spatiales, pollution lumineuse | points, symbols, raster | **Ma → year** |

### Pourquoi cette taxonomie est importante

1. **UX** : 80 couches dans une liste plate = inutilisable. En arbre 10 × 8 = navigable.
2. **Filtre par défaut** : à l'ouverture, on active **uniquement** la couche "phare" de chaque famille (ex: température pour climat, densité pour people) → carte lisible dès le premier rendu.
3. **Corrélations suggérées** : le `CorrelationCore` propose les paires inter-familles les plus intéressantes (climat × people, geo × climate, etc.) avant que l'utilisateur ne cherche.

### Les 7 combos "wow" prioritaires pour le MVP

| # | Combo | Effet visuel |
|---|---|---|
| 1 | **population + climat** | Voir les civilisations naître dans les zones fertiles |
| 2 | **tectonique + volcans + séismes** | "Ring of Fire" qui s'allume |
| 3 | **empires + guerres** | Animation des frontières dans le temps |
| 4 | **niveau des mers** | Continents émergent/disparaissent pendant les glaciations |
| 5 | **routes commerciales** | Le monde "s'allume" à mesure que les routes apparaissent |
| 6 | **pandémies** | Propagation visible par les routes |
| 7 | **biodiversité** | Cartes d'extinctions, vagues de disparition |

---

## 6. Modèle temporel — la pièce-maîtresse

### 6.1 Le problème du `-5 000 000`

`PostgreSQL DATE` accepte 4713 BC → 5874897 AD, mais il **n'a pas de notion de précision** : `-10000-01-01` traite janvier 1 au jour près alors qu'on ne sait qu'à 10 ans près. Et l'affichage devient ingérable pour les volcans actifs sur 50 000 ans.

### 6.2 Représentation choisie

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

### 6.3 Échelles d'affichage (`Scale`)

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

## 7. Schéma SQL (PostGIS)

Principe : **un modèle pivot générique** (`layers` + `features`) + **catégories** (familles) + **liens typés** (`feature_links`) + **audit** (`feature_revisions`) + **vues** typées pour confort.

```sql
-- ─── 001_extensions.sql ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- recherche fuzzy

-- ─── 002_categories.sql ────────────────────────────────────────────────────
CREATE TABLE layer_categories (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,           -- 'geo','climate','people',…
  label        TEXT NOT NULL,
  icon         TEXT,                           -- emoji ou nom de glyphe
  color        TEXT,                           -- couleur dominante de la famille
  position     INT NOT NULL DEFAULT 0,         -- ordre d'affichage
  description  TEXT
);

-- ─── 003_layers.sql ────────────────────────────────────────────────────────
CREATE TYPE geom_kind   AS ENUM ('point','line','polygon','multipolygon','raster');
CREATE TYPE render_type AS ENUM ('points','heatmap','polygons','lines','symbols','choropleth');
CREATE TYPE precision_t AS ENUM ('Ma','ka','millennium','century','decade','year','month','day');

CREATE TABLE layers (
  id              SERIAL PRIMARY KEY,
  category_id     INT NOT NULL REFERENCES layer_categories(id),
  parent_layer_id INT REFERENCES layers(id) ON DELETE SET NULL,   -- sous-couches
  slug            TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,
  description     TEXT,
  geom_kind       geom_kind   NOT NULL,
  render_type     render_type NOT NULL,
  style           JSONB NOT NULL DEFAULT '{}',
  metric_path     TEXT,                                          -- chemin JSONB du métrique
                                                                 -- agrégé pour corrélation
                                                                 -- ex: 'props.vei' ou 'props.density'
  metric_agg      TEXT NOT NULL DEFAULT 'count',                 -- 'count'|'sum'|'avg'|'max'
  z_index         INT NOT NULL DEFAULT 0,
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sources (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT,
  citation     TEXT,
  license      TEXT
);

-- ─── 004_features.sql ──────────────────────────────────────────────────────
CREATE TABLE features (
  id           BIGSERIAL PRIMARY KEY,
  layer_id     INT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  geom         geometry(GEOMETRY, 4326) NOT NULL,
  t_start      NUMERIC(20, 6) NOT NULL,
  t_end        NUMERIC(20, 6),
  precision    precision_t NOT NULL DEFAULT 'year',
  fiability    SMALLINT NOT NULL DEFAULT 80,
  source_id    INT REFERENCES sources(id),
  label        TEXT,
  props        JSONB NOT NULL DEFAULT '{}',
  style_over   JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT,
  CHECK (t_end IS NULL OR t_end >= t_start)
);

-- ─── 005_revisions.sql ─────────────────────────────────────────────────────
CREATE TABLE feature_revisions (
  id           BIGSERIAL PRIMARY KEY,
  feature_id   BIGINT NOT NULL,
  op           CHAR(1) NOT NULL,
  before       JSONB,
  after        JSONB,
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

-- ─── 006_views.sql ─────────────────────────────────────────────────────────
CREATE VIEW v_volcanoes AS
  SELECT f.id, f.geom, f.t_start, f.t_end, f.precision,
         f.label AS name,
         (f.props->>'vei')::INT AS vei,
         (f.props->>'type')     AS type
    FROM features f
    JOIN layers l ON l.id = f.layer_id
   WHERE l.slug = 'volcanoes';
-- (idem v_wars, v_civilizations, v_pandemics… à la demande)

-- ─── 007_links.sql ─────────────────────────────────────────────────────────
CREATE TYPE link_kind AS ENUM (
  'caused_by',        -- A est CAUSÉ PAR B
  'triggered',        -- A a DÉCLENCHÉ B
  'coincides_with',   -- corrélation observée sans causalité prouvée
  'followed_by',      -- enchaînement temporel
  'enabled',          -- a permis (climat → migration, route → expansion)
  'impacted',         -- a impacté (sans détruire)
  'destroyed'         -- a anéanti (séisme → cité)
);

CREATE TABLE feature_links (
  id          BIGSERIAL PRIMARY KEY,
  src_id      BIGINT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  dst_id      BIGINT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  kind        link_kind NOT NULL,
  weight      REAL NOT NULL DEFAULT 1.0    CHECK (weight BETWEEN 0 AND 1),
  evidence    TEXT,                         -- citation libre, abstract, lien DOI
  source_id   INT REFERENCES sources(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT,
  CHECK (src_id <> dst_id)
);

-- ─── 008_buckets.sql ───────────────────────────────────────────────────────
-- Vue matérialisée : agrégation par siècle pour les corrélations rapides.
-- Rafraîchie après chaque import lourd, ou via cron quotidien.
CREATE MATERIALIZED VIEW mv_layer_century_buckets AS
SELECT
  l.id                                        AS layer_id,
  l.slug                                      AS layer_slug,
  floor(f.t_start / 100) * 100                AS century,
  count(*)                                    AS n,
  -- métrique agrégée selon metric_path/metric_agg de la couche
  CASE l.metric_agg
    WHEN 'count' THEN count(*)::FLOAT
    WHEN 'sum'   THEN sum( COALESCE((f.props #>> string_to_array(l.metric_path,'.'))::FLOAT, 0) )
    WHEN 'avg'   THEN avg( COALESCE((f.props #>> string_to_array(l.metric_path,'.'))::FLOAT, 0) )
    WHEN 'max'   THEN max( COALESCE((f.props #>> string_to_array(l.metric_path,'.'))::FLOAT, 0) )
  END                                         AS metric
FROM features f
JOIN layers l ON l.id = f.layer_id
GROUP BY l.id, l.slug, l.metric_agg, l.metric_path, century;

CREATE UNIQUE INDEX mv_lcb_pk
  ON mv_layer_century_buckets (layer_id, century);

-- ─── 009_indexes.sql ───────────────────────────────────────────────────────
CREATE INDEX features_geom_gist        ON features USING GIST  (geom);
CREATE INDEX features_time_btree       ON features (t_start, t_end);
CREATE INDEX features_layer_time_btree ON features (layer_id, t_start, t_end);
CREATE INDEX features_props_gin        ON features USING GIN   (props);
CREATE INDEX features_label_trgm       ON features USING GIN   (label gin_trgm_ops);
CREATE INDEX links_src_kind_btree      ON feature_links (src_id, kind);
CREATE INDEX links_dst_kind_btree      ON feature_links (dst_id, kind);
```

---

## 8. Configuration locale (DB & env)

> ⚠️ **Ces credentials sont strictement locaux.** Avant tout déploiement public, régénère un mot de passe et passe-le par `.env` non versionné (ou par le keyring Synapx).

### 8.1 Database — credentials locaux

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

### 8.2 Script de bootstrap — `db/bootstrap.sql`

À exécuter **une seule fois en tant que superuser** (`postgres`) :

```sql
CREATE ROLE chronomap WITH LOGIN PASSWORD 'j!1BIq9/aoQYig54';

CREATE DATABASE chronomap
  WITH OWNER = chronomap
       ENCODING = 'UTF8'
       LC_COLLATE = 'fr_FR.UTF-8'
       LC_CTYPE   = 'fr_FR.UTF-8'
       TEMPLATE = template0;

\c chronomap
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER SCHEMA public OWNER TO chronomap;
GRANT ALL PRIVILEGES ON DATABASE chronomap TO chronomap;
```

Lancement :

```bash
sudo -u postgres psql -f db/bootstrap.sql
```

Puis migrations + seed (cf. §17 Quickstart).

### 8.3 Fichier `server/.env.example`

```ini
APP_ENV=local
APP_DEBUG=true

DB_DSN="pgsql:host=127.0.0.1;port=5432;dbname=chronomap"
DB_USER="chronomap"
DB_PASS="j!1BIq9/aoQYig54"

JWT_SECRET="change-me-locally"
JWT_ALG="HS256"

CORS_ORIGINS="http://localhost:5173,http://chronomap.fr.lan"
```

> Le `.env` réel n'est **pas versionné** (le `.gitignore` exclut `.env`). Le `.env.example` sert de template.

---

## 9. Classes JS principales

### 9.1 `TimeEngine`

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

  setCursor(year: number): void { this._cursor = year; this._range = this.computeRange(); this.emit('change'); }
  setScale (scale: Scale): void { this._scale = scale; this._range = this.computeRange(); this.emit('change'); }
  step(direction: 1 | -1): void { this.setCursor(this._cursor + direction * SCALE_STEP[this._scale]); }

  private computeRange() {
    const half = 10 * SCALE_STEP[this._scale];
    return { start: this._cursor - half, end: this._cursor + half };
  }

  get cursor() { return this._cursor; }
  get scale()  { return this._scale; }
  get range()  { return { ...this._range }; }

  private emit(t: string) { this.dispatchEvent(new CustomEvent(t, { detail: this.snapshot() })); }
  snapshot()              { return { cursor: this._cursor, scale: this._scale, range: this._range }; }
}
```

### 9.2 `LayerManager` (arbre 10 familles)

```ts
export class LayerManager extends EventTarget {
  private categories = new Map<string, LayerCategory>();
  private layers     = new Map<string, LayerState>();

  loadFromApi(cats: LayerCategory[], layers: LayerDefinition[]): void { /* … */ }

  setVisible(slug: string, v: boolean): void { /* … */ }
  setOpacity(slug: string, o: number): void { /* … */ }
  setRenderType(slug: string, rt: RenderType): void { /* … */ }
  setZ(slug: string, z: number): void { /* … */ }

  /** Arbre famille → couches → sous-couches pour rendre le panneau. */
  tree(): LayerTreeNode[] { /* … */ }

  active(): LayerState[] { return [...this.layers.values()].filter(l => l.visible); }
}
```

### 9.3 `CorrelationCore` (nouveau)

```ts
export class CorrelationCore extends EventTarget {
  constructor(private api: ApiClient) { super(); }

  /** Pearson entre 2 couches actives, sur la fenêtre temporelle courante. */
  async pair(a: string, b: string, range: TimeRange, bucket: BucketSize):
    Promise<{ pearson: number; n: number; series: PairSeries; pValue: number }> {
    return this.api.get('/api/correlations', { params: { layers: `${a},${b}`, range, bucket } });
  }

  /** Matrice n×n pour toutes les couches actives. */
  async matrix(slugs: string[], range: TimeRange, bucket: BucketSize):
    Promise<CorrelationMatrix> {
    return this.api.get('/api/correlations/matrix', { params: { layers: slugs.join(','), range, bucket } });
  }

  /** Liens typés autour d'une feature. */
  async links(featureId: number): Promise<TypedLink[]> {
    return this.api.get(`/api/features/${featureId}/links`);
  }

  /** Voisinage spatio-temporel : tout ce qui se passe dans un rayon et une fenêtre. */
  async neighbours(featureId: number, radiusKm: number, years: number): Promise<Neighbour[]> {
    return this.api.get(`/api/features/${featureId}/neighbours`, { params: { radius_km: radiusKm, years } });
  }
}
```

### 9.4 `MapAdapter` + `MapLibreAdapter`

```ts
export interface MapAdapter {
  mount(container: HTMLElement, opts: MapInitOptions): void;
  setSource(slug: string, source: SourceDef): void;
  setLayerStyle(slug: string, style: LayerStyle): void;
  setVisibility(slug: string, v: boolean): void;
  drawArrow(from: [number, number], to: [number, number], kind: LinkKind): string;
  removeArrow(id: string): void;
  fitTo(bbox: [number, number, number, number]): void;
  on(event: 'click' | 'movestart' | 'moveend' | 'rightclick', cb: (e: MapEvent) => void): void;
  destroy(): void;
}
```

`drawArrow` est nouveau : il dessine une **flèche colorée par `LinkKind`** entre deux features liées (utilisé par le panneau de corrélations niveau 2).

### 9.5 `ChronoMap` (orchestrateur)

```ts
export class ChronoMap {
  readonly time:        TimeEngine;
  readonly layers:      LayerManager;
  readonly correlation: CorrelationCore;
  readonly map:         MapAdapter;

  constructor(opts: ChronoMapOptions) {
    this.time        = new TimeEngine(opts.time);
    this.layers      = new LayerManager();
    this.correlation = new CorrelationCore(opts.api);
    this.map         = opts.mapAdapter ?? new MapLibreAdapter();
    this.wire();
  }

  private wire(): void {
    this.time.addEventListener('change', () => this.refreshAll());
    this.layers.addEventListener('change', () => this.refreshAll());
  }

  private async refreshAll(): Promise<void> {
    const { start, end } = this.time.range;
    for (const layer of this.layers.active()) {
      const url = `/api/tiles/${layer.slug}/{z}/{x}/{y}.mvt?t_start=${start}&t_end=${end}`;
      this.map.setSource(layer.slug, { type: 'vector', tiles: [url] });
      this.map.setLayerStyle(layer.slug, layer.style);
    }
    // Recalcule la matrice de corrélation si ≥2 couches actives
    const slugs = this.layers.active().map(l => l.slug);
    if (slugs.length >= 2) {
      const m = await this.correlation.matrix(slugs, { start, end }, autoBucket(this.time.scale));
      this.dispatchEvent(new CustomEvent('correlation', { detail: m }));
    }
  }
}
```

### 9.6 `Palette` (déconfliction)

```ts
export class Palette {
  static assign(layers: LayerState[]): Map<string, string> {
    const n = layers.length;
    const m = new Map<string, string>();
    layers.forEach((l, i) => {
      if (l.style.color) { m.set(l.slug, l.style.color); return; }
      m.set(l.slug, `hsl(${Math.round((360 / n) * i)} 75% 55%)`);
    });
    return m;
  }
}
```

---

## 10. API REST

Tout sous `/api`. Auth JWT pour `POST` / `PUT` / `DELETE`. `GET` public.

### 10.1 Données

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/categories` | Les 10 familles (avec layers groupés) |
| `GET` | `/api/layers` | Liste plate des couches |
| `GET` | `/api/layers/:slug` | Détail d'une couche |
| `POST` | `/api/layers` | Créer |
| `PUT` | `/api/layers/:slug` | Modifier (style, z_index, render_type, metric_path…) |
| `GET` | `/api/layers/:slug/features?t_start&t_end&bbox` | GeoJSON filtré |
| `GET` | `/api/tiles/:slug/:z/:x/:y.mvt?t_start&t_end` | **Tuile vectorielle** |
| `GET` | `/api/features/:id` | Détail |
| `POST` | `/api/features` | Créer |
| `PUT` | `/api/features/:id` | Modifier |
| `DELETE` | `/api/features/:id` | Supprimer |
| `GET` | `/api/features/:id/revisions` | Historique |
| `POST` | `/api/features/:id/revert/:rev` | Restaurer |
| `GET` | `/api/timeline/range` | Extrêmes de la BD |
| `GET` | `/api/search?q=rome&date=-100` | Recherche trigram + filtre temporel |
| `POST` | `/api/import/:slug` | Multipart : `.geojson` / `.csv` / `.shp.zip` |
| `GET` | `/api/export/:slug?format=geojson&t_start&t_end` | Téléchargement |

### 10.2 Corrélations (nouveau)

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/correlations?layers=a,b&range=start,end&bucket=decade` | **Pearson** entre 2 couches + séries |
| `GET` | `/api/correlations/matrix?layers=a,b,c&range=...&bucket=...` | Matrice n×n pour heatmap de corrélation |
| `GET` | `/api/correlations/suggest?date=-1000&radius_years=200` | Suggestions auto (paires intéressantes pour cette date) |
| `GET` | `/api/features/:id/neighbours?radius_km=500&years=100` | Voisinage spatio-temporel |
| `GET` | `/api/features/:id/links` | Liens typés (causes / conséquences) |
| `POST` | `/api/features/:id/links` | Ajouter un lien curé `{dst_id, kind, weight, evidence}` |
| `DELETE` | `/api/features/:id/links/:linkId` | Retirer |

### 10.3 Endpoint clé : la tuile MVT dynamique

```php
public function getTile(string $slug, int $z, int $x, int $y, Request $r): Response
{
  $tStart = (float) $r->query->get('t_start', '-5000000');
  $tEnd   = (float) $r->query->get('t_end',    '2100');

  $sql = <<<SQL
    WITH bounds AS ( SELECT ST_TileEnvelope(:z, :x, :y) AS env ),
    mvt_geom AS (
      SELECT f.id, f.label, f.props,
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

---

## 11. Stratégie multi-couches (le croisement)

### 11.1 Z-order automatique par type

| `render_type` | `z_index` auto |
|---|---|
| `choropleth` (zones climatiques) | 10 |
| `polygons` (frontières, civilisations) | 20 |
| `heatmap` (population) | 30 |
| `lines` (plaques tectoniques, routes) | 40 |
| `points` (villes) | 50 |
| `symbols` (volcans, batailles) | 60 |

→ les couches floues sont **dessous**, les icônes pointues **dessus**.

### 11.2 Palette déconfliée

`Palette.assign()` répartit les hues sur le cercle (cf. §9.6).

### 11.3 Mode "comparer"

Bouton qui passe en **swipe** ou **side-by-side** — pour comparer 1700 vs 2000, ou population vs climat à date fixe.

### 11.4 Auto-réduction d'opacité

Au-delà de 3 couches actives, `LayerManager` réduit auto l'opacité des heatmaps/choropleths à 0.6, des polygones à 0.5.

### 11.5 Arbre par famille dans le panneau gauche

```
🌍 Géologie
  ├─ ☑ Plaques tectoniques     [lines, opac 80%]
  ├─ ☑ Volcans actifs          [symbols]
  ├─ ☐ Séismes                  [points]
  └─ ☐ Niveau des mers          [polygons]
🌦️ Climat
  ├─ ☑ Température              [choropleth]
  └─ ☐ Glaciations              [polygons]
👥 Population
  └─ ☑ Densité                  [heatmap]
…
```

Chaque famille a un toggle global (active toutes les sous-couches) et un toggle indépendant par couche.

---

## 12. Le moteur de corrélations — la feature différenciante

> **Voir une donnée, c'est Wikipédia avec une carte. Voir une corrélation, c'est un outil de recherche.**
>
> Le moteur de corrélation opère à **trois niveaux complémentaires** : proximité spatio-temporelle (implicite, automatique), liens typés (curés, qualitatifs), corrélation statistique (Pearson sur séries temporelles).

### 12.1 Niveau 1 — Voisinage spatio-temporel (implicite)

**Question type** : *"Que s'est-il passé dans un rayon de 500 km et ± 100 ans autour de l'éruption du Vésuve en 79 ?"*

```sql
SELECT f2.id, f2.label, l.slug AS layer,
       ST_Distance(f1.geom::geography, f2.geom::geography) / 1000 AS dist_km,
       (f2.t_start - f1.t_start)                                  AS delta_years
  FROM features f1
  JOIN features f2 ON f1.id <> f2.id
   AND ST_DWithin(f1.geom::geography, f2.geom::geography, :radius_m)
   AND abs(f2.t_start - f1.t_start) <= :years
  JOIN layers l ON l.id = f2.layer_id
 WHERE f1.id = :feature_id
 ORDER BY dist_km, abs(delta_years);
```

**UI** : clic droit sur une feature → "**Voisinage**" → liste triable par couche / distance / écart temporel. Chaque ligne est cliquable et zoom la carte sur la feature voisine.

**Coût** : sub-seconde avec l'index `features_geom_gist` + `features_layer_time_btree`.

### 12.2 Niveau 2 — Liens typés curés (`feature_links`)

Quand un historien sait qu'un événement en a causé un autre, on l'inscrit **explicitement** dans la base. Pas de devinette, pas de faux positifs.

```sql
INSERT INTO feature_links (src_id, dst_id, kind, weight, evidence, source_id) VALUES
  -- L'éruption du Tambora (1815) a causé l'"année sans été" (1816)
  ((SELECT id FROM features WHERE label='Éruption du Tambora 1815'),
   (SELECT id FROM features WHERE label='Année sans été 1816'),
   'caused_by', 0.95, 'Stommel & Stommel, 1983, "Volcano Weather"', NULL),

  -- La sécheresse mésopotamienne 4.2 ka a permis l'effondrement de l'empire d'Akkad
  ((SELECT id FROM features WHERE label='Mégasécheresse 4.2 ka'),
   (SELECT id FROM features WHERE label='Effondrement empire d''Akkad'),
   'enabled', 0.7, 'Weiss et al., 2015, PNAS', NULL),

  -- Peste noire et petit âge glaciaire — coïncidence sans causalité prouvée
  ((SELECT id FROM features WHERE label='Peste noire 1347-1352'),
   (SELECT id FROM features WHERE label='Petit âge glaciaire'),
   'coincides_with', 0.6, NULL, NULL);
```

**API**:
```
GET  /api/features/:id/links           → liens entrants + sortants
POST /api/features/:id/links           → ajouter (mode édition)
DELETE /api/features/:id/links/:linkId → retirer
```

**UI** : panneau droit "**Causes & conséquences**" affiche les liens typés avec couleur par `link_kind` :

| `link_kind` | Couleur | Sémantique |
|---|---|---|
| `caused_by` / `triggered` | rouge | causalité forte |
| `enabled` | orange | a permis sans causer |
| `impacted` / `destroyed` | violet | conséquence physique |
| `followed_by` | gris | enchaînement temporel sans causalité |
| `coincides_with` | bleu | corrélation sans causalité prouvée |

**Sur la carte** : `MapAdapter.drawArrow(from, to, kind)` trace une flèche colorée entre la feature source et la feature destination (peut traverser le globe).

### 12.3 Niveau 3 — Corrélation statistique sur séries temporelles

C'est la fonction **wow**. L'utilisateur active deux couches, le serveur agrège chacune par bucket temporel et calcule `corr()` (Pearson natif PostgreSQL).

```sql
-- Corrélation entre volcanisme (somme VEI) et anomalie de température, par décennie sur 1500-2020
WITH bucketed AS (
  SELECT l.slug,
         width_bucket(f.t_start, 1500, 2020, 52) AS bucket,
         CASE l.metric_agg
           WHEN 'count' THEN count(*)::FLOAT
           WHEN 'sum'   THEN sum((f.props #>> string_to_array(l.metric_path,'.'))::FLOAT)
           WHEN 'avg'   THEN avg((f.props #>> string_to_array(l.metric_path,'.'))::FLOAT)
         END AS metric
    FROM features f
    JOIN layers l ON l.id = f.layer_id
   WHERE l.slug IN ('volcanoes','climate_temperature')
     AND f.t_start BETWEEN 1500 AND 2020
   GROUP BY l.slug, l.metric_agg, l.metric_path, bucket
),
joined AS (
  SELECT a.bucket, a.metric AS x, b.metric AS y
    FROM bucketed a
    JOIN bucketed b ON a.bucket = b.bucket
   WHERE a.slug = 'volcanoes'
     AND b.slug = 'climate_temperature'
)
SELECT corr(x, y) AS pearson, count(*) AS n FROM joined;
```

**Endpoint** :
```
GET /api/correlations?layers=volcanoes,climate_temperature
                     &range=1500,2020&bucket=decade
```

**Réponse** :
```json
{
  "pearson": -0.34,
  "n_buckets": 52,
  "p_value": 0.014,
  "series": [
    { "bucket": 1500, "volcanoes": 12,  "climate_temperature": -0.20 },
    { "bucket": 1510, "volcanoes":  3,  "climate_temperature":  0.10 },
    { "bucket": 1520, "volcanoes": 27,  "climate_temperature": -0.85 },
    …
  ]
}
```

**P-value** : calculée serveur via la transformation de Fisher (ou table de Student). `< 0.05` → coefficient considéré significatif (badge ✅ dans l'UI).

### 12.4 Matrice de corrélation (n×n)

Quand ≥ 3 couches sont actives, le panneau de corrélation affiche une **heatmap** de toutes les paires :

```
                 volcanoes  climates  population  wars
   volcanoes        1.00     -0.34      0.05      0.12
   climates        -0.34      1.00      0.61      0.28
   population       0.05      0.61      1.00      0.42
   wars             0.12      0.28      0.42      1.00
```

Endpoint `GET /api/correlations/matrix?layers=...&range=...&bucket=...`.

UI : cellule cliquable → ouvre le graphique paire correspondant.

### 12.5 Suggestions automatiques

À l'ouverture, ou quand l'utilisateur arrive sur une date intéressante, le serveur propose les **3 paires les plus corrélées (en valeur absolue)** pour la fenêtre temporelle courante, **sur l'ensemble des couches actives**.

```
GET /api/correlations/suggest?date=-1000&radius_years=500
→ [
    { pair: ['climate','population'], pearson:  0.78, hint: 'Populations suivent les optima climatiques' },
    { pair: ['volcanoes','climate'],  pearson: -0.41, hint: 'Volcanisme refroidit le climat' },
    { pair: ['wars','climate'],       pearson: -0.32, hint: 'Sécheresses précèdent les guerres' }
  ]
```

C'est ce qui transforme l'outil de **carte temporelle** en **moteur de découverte**.

### 12.6 Visualisations UI du panneau de corrélation

Trois modes, en bas de l'écran à côté de la timeline :

| Mode | Quand | Rendu |
|---|---|---|
| **Pair view** | 2 couches actives | uPlot double-axe : série A (gauche, couleur de A) + série B (droite, couleur de B) + bandeau "Pearson = -0.34 ✅" |
| **Matrix view** | ≥ 3 couches | Heatmap n×n cliquable (cellule → pair view) |
| **Links view** | feature sélectionnée | Liste typée des liens entrants/sortants, flèches sur la carte |

### 12.7 Performance des corrélations

| Levier | Gain |
|---|---|
| **Vue matérialisée `mv_layer_century_buckets`** rafraîchie quotidiennement | Pearson sur 50 buckets = < 1 ms |
| **Bucket auto-choisi** depuis `TimeEngine.scale` (`Ma` → bucket=Ma, `year` → bucket=year) | Toujours ~30-100 buckets, idéal pour la stat |
| **Limite n_buckets** : refus de corréler si `n < 8` | Évite les coefficients trompeurs sur 3 points |
| **Cache HTTP** sur `/api/correlations` (`max-age=60`) | Recalcul que si fenêtre change |

### 12.8 Limites & honnêteté intellectuelle

Le moteur de corrélation est un **outil d'exploration**, pas une preuve causale.

- **Pearson ne capte que les relations linéaires**. Un fit log/exp passerait inaperçu. Une option future : Spearman (rangs) déjà accessible via `corr()` PostgreSQL si on transforme via `rank()`.
- **Petits échantillons** : un Pearson de 0.9 sur 4 points est du bruit. D'où le seuil `n ≥ 8`.
- **Corrélation ≠ causalité**. C'est pourquoi on **distingue clairement** dans l'UI :
  - les liens **typés** (curés par un humain qui a lu la littérature)
  - les corrélations **statistiques** (badge "exploratoire")
- **Documentation dédiée** : `docs/CORRELATIONS.md` détaille les choix méthodo (Pearson, p-value, fenêtres, dégénérescences).

---

## 13. Édition + versioning

### 13.1 Workflow

1. Touche `E` → mode édition.
2. Clic sur la carte sans feature → panneau droit en mode **création**.
3. Clic sur une feature → panneau **modification** : géom drag-éditable, props en JSON form (généré depuis le `schema` de la `layer`).
4. Onglet **"Causes & conséquences"** : ajouter un lien typé (`POST /api/features/:id/links`).
5. Slider dédié pour `t_start` / `t_end`.
6. `Enregistrer` (`PUT`) / `Annuler` / `Supprimer`.

### 13.2 Versioning

- Trigger `trg_features_audit()` (cf. §7) écrit dans `feature_revisions` à chaque `INSERT/UPDATE/DELETE`.
- DELETE = vraie suppression, mais la révision garde le `before`.
- UI propose un panneau "Historique" avec diff JSON + bouton `Restaurer cette version` (`POST /api/features/:id/revert/:rev`).

### 13.3 Import / export

| Format | Sens | Endpoint |
|---|---|---|
| GeoJSON FeatureCollection | ↑↓ | `/api/import/:slug` / `/api/export/:slug?format=geojson` |
| CSV (lon, lat, t_start, t_end, props_json) | ↑↓ | idem `format=csv` |
| Shapefile (zip) | ↑ | `/api/import/:slug?format=shp` (via `shp2pgsql`) |

L'import accepte un **mapping** de colonnes, stocké côté serveur comme template réutilisable.

---

## 14. Performances

| Levier | Gain |
|---|---|
| **MVT dynamique avec `ST_AsMVTGeom`** | Géom déjà clippée et simplifiée par zoom, payload binaire compact (5-10× plus léger que GeoJSON). |
| **Index GIST sur `geom`** | Recherche bbox en O(log n). |
| **Index BTREE composite `(layer_id, t_start, t_end)`** | Filtrage temporel direct par couche. |
| **`ST_Simplify`** par niveau de zoom | Polygones de plaques tectoniques < 1 ko à `z=2`. |
| **Vue matérialisée `mv_layer_century_buckets`** | Corrélations en < 1 ms. |
| **Cache HTTP** sur MVT (5 min) et corrélations (1 min) | Réutilisation par toute la session. |
| **`pg_trgm` sur `label`** | Recherche fuzzy sub-seconde sur 100k features. |
| **Pagination implicite par tuile** | Pas besoin de paginer en JSON. |
| **Cluster en JS (supercluster)** pour `render_type='points'` à petite échelle | Évite de dessiner 10 000 villes au monde entier. |

---

## 15. MVP en 7 étapes

| Étape | Livrable | Durée idéale |
|---|---|---|
| **1. Schéma + catégories + 1 couche** | Postgres+PostGIS up, 10 `layer_categories`, `layers` + `features` + seed `volcanoes` (~1500 entrées GVP). Endpoint `GET /api/layers/:slug/features`. | 1-2 j |
| **2. ChronoMap + MapLibreAdapter + LayerPanel arbre** | Carte affiche les volcans, panneau gauche montre les 10 familles repliables avec toggle. | 2-3 j |
| **3. TimeEngine + TimelinePanel** | Curseur, échelles, raccourcis ← → + -, refresh des sources avec `?t_start&t_end`. | 2 j |
| **4. LayerManager + 3 couches phares** | Ajout `climates` (choropleth) et `populations` (heatmap) et `tectonics` (lines). Z-order auto, palette. | 2-3 j |
| **5. MVT pipeline** | Endpoint `/api/tiles/...mvt`, sources MapLibre en `type: 'vector'`. Test charge sur `populations`. | 2 j |
| **6. Édition + audit** | Mode édition, draw, save, `feature_revisions`. Import GeoJSON. | 3 j |
| **7. Moteur de corrélations** | `/api/correlations` Pearson + matrice, `feature_links` + `/api/features/:id/links`, `/api/features/:id/neighbours`, `CorrelationPanel` (pair view + matrix), seed `known_links.sql`. | **4-5 j** |

**Total MVP : ~17-20 jours** — tu as alors un atlas qui fonctionne avec 4 couches, l'édition, **et le moteur de corrélation à 3 niveaux**.

---

## 16. Exemple concret : 4 couches + 2 corrélations

### 16.1 Seed

```sql
-- db/seed/01_categories.sql
INSERT INTO layer_categories (slug, label, icon, color, position) VALUES
  ('geo',         'Géologie',              '🌍', '#92400e', 1),
  ('climate',     'Climat / météo',        '🌦️', '#1e40af', 2),
  ('people',      'Population humaine',    '👥', '#7c3aed', 3),
  ('geopolitics', 'Guerres / géopolitique','⚔️', '#991b1b', 4),
  ('economy',     'Économie / commerce',   '💰', '#a16207', 5),
  ('culture',     'Civilisations',         '🧬', '#15803d', 6),
  ('bio',         'Biodiversité',          '🦖', '#166534', 7),
  ('health',      'Pandémies / santé',     '☣️', '#9d174d', 8),
  ('tech',        'Technologie / infra',   '🚀', '#0e7490', 9),
  ('space',       'Astronomie',            '🌌', '#3b0764', 10);

-- db/seed/02_layers.sql
INSERT INTO layers (category_id, slug, label, geom_kind, render_type, style, z_index,
                    metric_path, metric_agg) VALUES
  ((SELECT id FROM layer_categories WHERE slug='geo'),
   'volcanoes', 'Volcans actifs', 'point', 'symbols',
   '{"icon":"volcano","size":18}', 60, 'vei', 'sum'),
  ((SELECT id FROM layer_categories WHERE slug='climate'),
   'climates', 'Zones climatiques', 'multipolygon', 'choropleth',
   '{"palette":"climate"}', 10, 'temp_anomaly', 'avg'),
  ((SELECT id FROM layer_categories WHERE slug='people'),
   'populations', 'Densité de population', 'point', 'heatmap',
   '{"radius":35,"intensity":0.8}', 30, 'density', 'sum'),
  ((SELECT id FROM layer_categories WHERE slug='geo'),
   'tectonics', 'Plaques tectoniques', 'line', 'lines',
   '{"color":"#b91c1c","width":2}', 40, NULL, 'count');

-- db/seed/volcanoes.sql (extrait)
INSERT INTO features (layer_id, geom, t_start, t_end, precision, label, props) VALUES
  ((SELECT id FROM layers WHERE slug='volcanoes'),
   ST_SetSRID(ST_MakePoint(15.213, 38.789), 4326),
   -7000, NULL, 'century', 'Stromboli', '{"vei":3,"type":"stratovolcano"}'),
  ((SELECT id FROM layers WHERE slug='volcanoes'),
   ST_SetSRID(ST_MakePoint(117.85, -8.25), 4326),
   1815.246, 1815.247, 'day', 'Éruption du Tambora 1815', '{"vei":7,"deaths":71000}');

-- db/seed/climates.sql (anomalie -1°C en 1816, "année sans été")
INSERT INTO features (layer_id, geom, t_start, t_end, precision, label, props) VALUES
  ((SELECT id FROM layers WHERE slug='climates'),
   ST_GeomFromText('MULTIPOLYGON(((-180 0, 180 0, 180 90, -180 90, -180 0)))', 4326),
   1816, 1817, 'year', 'Année sans été 1816', '{"temp_anomaly":-1.0}');

-- db/seed/known_links.sql — corrélations curées (niveau 2)
INSERT INTO feature_links (src_id, dst_id, kind, weight, evidence) VALUES
  ((SELECT id FROM features WHERE label='Éruption du Tambora 1815'),
   (SELECT id FROM features WHERE label='Année sans été 1816'),
   'caused_by', 0.95,
   'Stommel & Stommel 1983, "Volcano Weather: The Story of 1816, the Year without a Summer"');
```

### 16.2 Démo de corrélation **niveau 2** — Tambora 1815 → 1816

L'utilisateur :
1. Active les couches `volcanoes` + `climates`.
2. Place le curseur en `1815`, scale = `year`.
3. Clique sur l'icône Tambora → panneau droit ouvre **"Causes & conséquences"**.
4. Voit : `Éruption du Tambora 1815 ──caused_by──► Année sans été 1816` (flèche rouge).
5. La carte trace une flèche rouge entre l'Indonésie (point Tambora) et le polygone monde (zone climatique de 1816).
6. Clic sur la flèche → zoom sur l'année 1816, affichage des deux features.

### 16.3 Démo de corrélation **niveau 3** — Volcanisme vs température, 1500-2020

L'utilisateur :
1. Active `volcanoes` + `climate_temperature`.
2. Place le curseur en `1800`, scale = `century`.
3. Le `CorrelationPanel` en bas affiche automatiquement :
   - Graphique double-axe avec deux séries superposées (somme VEI par décennie, anomalie de température)
   - Badge : **Pearson = -0.34   |   n = 52   |   p = 0.014   ✅**
   - Tooltip explicatif : "Volcanisme et température sont négativement corrélés sur cette période (modeste mais significatif). Cohérent avec le forcing radiatif des aérosols sulfatés stratosphériques."
4. Active une 3ᵉ couche (`populations`) → le panneau bascule en **matrix view** : heatmap 3×3 cliquable.

### 16.4 Requête type — visualisation à -1 000 ± 100 ans

```sql
SELECT l.slug, f.id, f.label, f.props, ST_AsGeoJSON(f.geom) AS geom
  FROM features f
  JOIN layers   l ON l.id = f.layer_id
 WHERE l.slug IN ('volcanoes','climates','populations','tectonics')
   AND f.t_start <= -900
   AND (f.t_end IS NULL OR f.t_end >= -1100)
 ORDER BY l.z_index, f.id;
```

### 16.5 Wiring frontend complet

```ts
// apps/atlas/src/main.ts
import { ChronoMap } from '@synapxlab/chronomap';
import { TimelinePanel }    from './ui/TimelinePanel';
import { LayerPanel }       from './ui/LayerPanel';
import { CorrelationPanel } from './ui/CorrelationPanel';
import { LinksPanel }       from './ui/LinksPanel';
import { ApiClient }        from './api/Client';

const api = new ApiClient('/api');
const cm  = new ChronoMap({
  container:  document.getElementById('chronomap')!,
  api,
  time:       { cursor: -1000, scale: 'century' },
});

// Charger l'arbre des couches (10 familles)
const cats   = await api.get('/categories');     // 10 familles + layers groupés
cm.layers.loadFromApi(cats.categories, cats.layers);

// Activer les 4 couches phares d'exemple
['climates', 'populations', 'tectonics', 'volcanoes']
  .forEach(slug => cm.layers.setVisible(slug, true));

// Panneaux UI
new TimelinePanel(document.getElementById('timeline')!, cm.time);
new LayerPanel(document.getElementById('layers')!, cm.layers);
new CorrelationPanel(document.getElementById('correlation')!, cm);   // ← écoute 'correlation'
new LinksPanel(document.getElementById('links')!, cm);

// Raccourcis clavier
document.addEventListener('keydown', e => {
  switch (e.key) {
    case 'ArrowLeft':  cm.time.step(-1); break;
    case 'ArrowRight': cm.time.step(+1); break;
    case '+':          cm.time.setScale(prevScale(cm.time.scale)); break;
    case '-':          cm.time.setScale(nextScale(cm.time.scale)); break;
    case 'e': case 'E': document.body.dataset.mode = (document.body.dataset.mode === 'edit' ? 'read' : 'edit'); break;
    case 'l': case 'L': document.querySelector('.layer-panel')?.classList.toggle('open'); break;
    case 'c': case 'C': document.querySelector('.correlation-panel')?.classList.toggle('open'); break;
  }
});
```

Résultat à -1 000 ± 100 ans :
- **Carte** : zones climatiques pastel, lignes rouges des plaques, halo coloré de la heatmap population, icônes de volcans.
- **Panneau gauche** : 4 couches actives, leurs familles repliées.
- **Panneau bas** : matrice 4×4 de corrélations avec, par exemple, `climates × populations = +0.61` (les humains habitent les zones où il fait bon).
- **Clic** sur cette cellule → uPlot s'ouvre, deux courbes superposées : densité de population (gauche) et anomalie de température (droite) sur la fenêtre temporelle visible.

---

## 17. Quickstart local

### 17.1 Prérequis

```bash
sudo apt install postgresql-15 postgresql-15-postgis-3 php8.3 php8.3-pgsql php8.3-curl composer nodejs npm
```

### 17.2 Création de la base

```bash
cd /data/vhosts/@synapxlab/ChronoMap

# 1. Bootstrap (rôle + DB + extensions) — UNE SEULE FOIS
sudo -u postgres psql -f db/bootstrap.sql

# 2. Migrations (schéma + corrélations)
for f in db/migrations/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done

# 3. Seed (10 familles, 4 couches phares, données + liens curés)
for f in db/seed/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done

# 4. Sanity check
PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -c "
  SELECT lc.label, l.slug, count(f.*) AS features
    FROM layer_categories lc
    JOIN layers   l ON l.category_id = lc.id
    LEFT JOIN features f ON f.layer_id = l.id
   GROUP BY lc.label, l.slug
   ORDER BY lc.position, l.slug;
"
```

### 17.3 Backend PHP

```bash
cp server/.env.example server/.env
cd server && composer install
php -S 127.0.0.1:8088 -t public          # → http://127.0.0.1:8088/api/categories
```

### 17.4 Frontend

```bash
cd packages/core && npm install && npm run dev     # lib en watch
cd apps/atlas    && npm install && npm run dev     # → http://localhost:5173
```

### 17.5 Test fumée

| Action | Attendu |
|---|---|
| `curl http://127.0.0.1:8088/api/categories` | 10 familles + leurs couches |
| `curl 'http://127.0.0.1:8088/api/correlations?layers=volcanoes,climates&range=1500,2020&bucket=decade'` | `{ "pearson": -0.xx, "n_buckets": 52, "series": [...] }` |
| `curl 'http://127.0.0.1:8088/api/features/<tambora>/links'` | Lien `caused_by → Année sans été 1816` |
| Ouvrir `http://localhost:5173` | Carte + 10 familles repliables à gauche + matrice corrélation en bas |
| Touche `←` | Curseur recule, carte + corrélations rechargent |
| Touche `C` | Toggle panneau corrélation |

---

## TL;DR — la colonne vertébrale

1. **10 familles** → arbre dans le panneau gauche, ~80 couches à terme, toutes sur le même pivot `features`.
2. **`features` + JSONB** comme pivot, **vues SQL** pour le confort spécialisé.
3. **`year` décimal** comme unique unité temporelle, des microsecondes humaines au million d'années.
4. **MVT dynamique filtré par date** comme transport — clé de la perf.
5. **Trois niveaux de corrélation** : voisinage spatio-temporel (auto), liens typés (curés), Pearson statistique sur séries temporelles. C'est le différenciateur du projet.
6. **`TimeEngine` + `LayerManager` + `CorrelationCore` + `MapAdapter`** — quatre classes, c'est tout le cœur.
7. **MVP en ~17-20 jours** sur 4 couches + édition + moteur de corrélation.
