#!/bin/bash
# Postgres init script — exporte les env vars custom vers les .sql suivants
# Run en ordre alphabétique, donc 10- exécute APRÈS 01/02/10 (OK l'ordre)
set -e

# Les scripts .sql peuvent lire ces vars via `:'APP_RUNTIME_PASSWORD'` (psql var)
export PGHOST="localhost"
export PGPORT="5432"
export PGUSER="app_admin"
export PGDATABASE="translog"

# Aucune action ici — juste pour que les vars soient dispo pour le .sql suivant.
# (Postgres entrypoint exporte déjà POSTGRES_PASSWORD, les autres sont passées)
