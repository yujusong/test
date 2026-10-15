#!/bin/sh
# Runs inside a disposable postgres:15 container: stub → schema (test hash) → assertions.
set -e
until pg_isready -U postgres -q; do sleep 1; done
HASH=$(printf '%s' 'test-bootstrap-secret' | sha256sum | cut -d' ' -f1)
sed "s/__BOOTSTRAP_HASH__/$HASH/" /schema/schema.sql > /tmp/schema.sql
psql -v ON_ERROR_STOP=1 -q -U postgres -f /sql/00_stub.sql
psql -v ON_ERROR_STOP=1 -q -U postgres -f /tmp/schema.sql
# Re-running the schema must be safe (idempotent).
psql -v ON_ERROR_STOP=1 -q -U postgres -f /tmp/schema.sql
psql -v ON_ERROR_STOP=1 -q -U postgres -f /sql/20_test.sql
