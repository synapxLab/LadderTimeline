# db/

Schéma SQL et données d'amorçage pour ChronoMap.

```bash
# 1. Bootstrap (rôle + DB + extensions) — UNE SEULE FOIS, en tant que postgres
sudo -u postgres psql -f db/bootstrap.sql

# 2. Migrations
for f in db/migrations/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done

# 3. Seed
for f in db/seed/*.sql; do
  PGPASSWORD='j!1BIq9/aoQYig54' psql -h 127.0.0.1 -U chronomap -d chronomap -f "$f"
done
```

> Credentials locaux par défaut : `chronomap / j!1BIq9/aoQYig54` (cf. `docs/ARCHITECTURE.md` §7).
> **À régénérer avant tout déploiement public.**

Voir [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md#6-schéma-sql-postgis) pour le détail des tables.
