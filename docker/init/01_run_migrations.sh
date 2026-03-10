#!/bin/bash
# Docker init script: Run SQL migrations in order on container startup.
# Mounted at /docker-entrypoint-initdb.d/ via docker-compose.yml.
# PostgreSQL runs scripts in this directory alphabetically on first init.
# Ticket: IQS-850, IQS-880 (shell hardening)
#
# This script:
# 1. Creates a schema_migrations tracking table if it does not exist.
# 2. Iterates over numbered .sql files in /migrations/ (excluding .rollback.sql).
# 3. Skips migrations that have already been applied.
# 4. Executes each new migration inside a transaction.
# 5. Records the migration version in the tracking table.

set -euo pipefail

MIGRATIONS_DIR="/migrations"
DB_NAME="${POSTGRES_DB:-gitrx}"
DB_USER="${POSTGRES_USER:-gitrx_admin}"

echo "[gitrx-migrations] Starting migration runner..."
echo "[gitrx-migrations] Database: ${DB_NAME}, User: ${DB_USER}"
echo "[gitrx-migrations] Migrations directory: ${MIGRATIONS_DIR}"

# Create the schema_migrations tracking table if it does not exist.
psql -v ON_ERROR_STOP=1 --username "${DB_USER}" --dbname "${DB_NAME}" <<-'EOSQL'
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        checksum TEXT
    );
EOSQL

echo "[gitrx-migrations] schema_migrations table ready."

# Count applied and pending migrations
applied_count=0
pending_count=0

# Iterate over migration SQL files in order, excluding rollback files.
for migration_file in "${MIGRATIONS_DIR}"/*.sql; do
    # Skip rollback files
    if [[ "${migration_file}" == *.rollback.sql ]]; then
        continue
    fi

    filename="$(basename -- "${migration_file}")"
    # Extract version number (e.g., "001" from "001_create_tables.sql")
    version="${filename%%_*}"

    # Check if this migration has already been applied (parameterized via psql -v)
    already_applied="$(psql -v ON_ERROR_STOP=1 --username "${DB_USER}" --dbname "${DB_NAME}" \
        -t -A -c "SELECT COUNT(*) FROM schema_migrations WHERE version = \$\$${version}\$\$")"

    if [ "${already_applied}" -gt 0 ]; then
        echo "[gitrx-migrations] SKIP: ${filename} (already applied)"
        applied_count=$((applied_count + 1))
        continue
    fi

    echo "[gitrx-migrations] APPLYING: ${filename}..."

    # Compute SHA-256 checksum for tracking (IQS-880: upgraded from MD5 to match TypeScript runner)
    checksum="$(sha256sum -- "${migration_file}" | awk '{print $1}')"

    # Execute the migration within a transaction using \i with quoted path
    psql -v ON_ERROR_STOP=1 --username "${DB_USER}" --dbname "${DB_NAME}" \
        -v "migration_file=${migration_file}" \
        -v "version=${version}" \
        -v "filename=${filename}" \
        -v "checksum=${checksum}" <<-'EOSQL'
        BEGIN;
        \i :migration_file
        INSERT INTO schema_migrations (version, filename, checksum)
        VALUES (:'version', :'filename', :'checksum');
        COMMIT;
EOSQL

    echo "[gitrx-migrations] APPLIED: ${filename} (checksum: ${checksum})"
    pending_count=$((pending_count + 1))
done

echo "[gitrx-migrations] Migration runner complete. Applied: ${pending_count}, Skipped: ${applied_count}"
