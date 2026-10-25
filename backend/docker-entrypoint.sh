#!/bin/sh
set -e

mkdir -p /data

# Create / update the SQLite schema (idempotent) before starting.
npx prisma db push

# Claim legacy personal data only for the explicitly configured owner, once.
npx tsx src/bootstrap-users.ts

exec npx tsx src/index.ts
