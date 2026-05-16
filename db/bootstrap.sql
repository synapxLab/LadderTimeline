-- ChronoMap — bootstrap local
--
-- À exécuter UNE SEULE FOIS en tant que superuser postgres :
--   sudo -u postgres psql -f db/bootstrap.sql
--
-- ⚠️  Credentials strictement locaux. Régénérer le mot de passe
--     avant tout déploiement public.

-- ─── Rôle applicatif ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chronomap') THEN
    CREATE ROLE chronomap WITH LOGIN PASSWORD 'j!1BIq9/aoQYig54';
  END IF;
END
$$;

-- ─── Base ──────────────────────────────────────────────────────────────────
-- (CREATE DATABASE ne peut pas s'exécuter dans un bloc DO, donc on tente
--  directement ; si elle existe déjà, l'erreur est ignorable.)
SELECT 'CREATE DATABASE chronomap
          WITH OWNER = chronomap
               ENCODING = ''UTF8''
               TEMPLATE = template0'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chronomap')\gexec

-- ─── Extensions + ownership (dans la BD chronomap) ─────────────────────────
\c chronomap

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER SCHEMA public OWNER TO chronomap;
GRANT ALL PRIVILEGES ON DATABASE chronomap TO chronomap;
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO chronomap;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO chronomap;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO chronomap;
