# Database Schema

GemBots uses PostgreSQL (Supabase-compatible).

## Setup

1. Create a PostgreSQL database
2. Apply `schema.sql` for the base schema
3. Apply migrations in order (`v2` → `v10`)

## Schema Files

- `schema.sql` — Base tables (bots, rooms, battles, users, etc.)
- `v2-schema.sql` → `v10-commissions-analytics.sql` — Incremental migrations

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
```
