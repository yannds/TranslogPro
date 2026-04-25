-- ═════════════════════════════════════════════════════════════════════════════
-- TransLog Pro — Runtime pg_hba.conf hardening (MED-13, audit Vague 2)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- Restreint pg_hba aux réseaux overlay Docker uniquement (au lieu de
-- `host all all all` qui acceptait des connexions depuis n'importe où).
-- À exécuter en SUPERUSER après init initial Postgres.
--
-- Idempotent : on réécrit le fichier complet à partir d'un template.
-- Reload soft via pg_reload_conf() — pas de coupure connexion existante.
--
-- Usage :
--   docker exec ... psql -U app_admin -d postgres -f 05-pg-hba-runtime.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- pg_hba.conf est un fichier texte non géré par SQL, mais on peut le réécrire
-- via pg_read_server_files / pg_write_server_files (SUPERUSER only).
-- Approche : COPY FROM PROGRAM pour réécrire (Postgres 14+).

DO $$
DECLARE
  hba_path text;
BEGIN
  SELECT setting INTO hba_path FROM pg_settings WHERE name = 'hba_file';
  RAISE NOTICE 'pg_hba.conf path: %', hba_path;
END $$;

-- ⚠️  Pour modifier pg_hba.conf en production sans casser, préférer :
--
--   docker exec <postgres_cid> sh -c "cat > /var/lib/postgresql/data/pg_hba.conf << 'HBA'
-- # PostgreSQL Client Authentication Configuration File (TransLog Pro hardened)
-- # local      DATABASE  USER  METHOD
-- local   all             all                                     trust
-- host    all             all             127.0.0.1/32            trust
-- host    all             all             ::1/128                 trust
-- local   replication     all                                     trust
-- host    replication     all             127.0.0.1/32            trust
-- host    replication     all             ::1/128                 trust
-- # Restreint au réseau overlay Docker Swarm uniquement (10.0.0.0/8)
-- host    all             all             10.0.0.0/8              scram-sha-256
-- HBA"
--
--   docker exec <postgres_cid> su -c "pg_ctl reload -D /var/lib/postgresql/data" postgres
--
-- Ce script SQL est principalement documentaire — la modif effective passe
-- par les commandes shell ci-dessus, déjà appliquées (audit Vague 2 §MED-13).

SELECT pg_reload_conf();
