# Invitz

Share any event link with the right community (generalist, topic-specific, or private custom groups). Every share is quality-checked by deterministic rules + an AI reviewer before anyone is notified, and unverifiable links are clearly labelled *"proceed with caution"*.

See [`docs/README.md`](./docs/README.md) for the full architecture, data model, risk register, and phase roadmap.

## Quick start

```bash
npm install
cp .env.example .env            # configure DATABASE_URL, AUTH_SECRET, auth providers, and an AI key
npm run db:migrate              # applies ./drizzle SQL migrations
npm run db:seed                 # seeds topics and QC rulebook (pass --demo for sample users/events)
npm run dev                     # http://localhost:3000
```

## Scripts

- `npm run dev` — start Next.js dev server
- `npm run build` / `npm start` — production build and server
- `npm run lint` — ESLint (`eslint-config-next`)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — run Vitest test suite
- `npm run db:generate` — generate Drizzle SQL migrations in `./drizzle`
- `npm run db:migrate` — apply SQL migrations
- `npm run db:seed` — run idempotent DB seed (`scripts/seed.ts`)

## Authentication & Production Notes

- Uses **Auth.js v5** (`next-auth`) with PostgreSQL database sessions (`30` days), Resend 10-minute single-use e-mail magic links (`RESEND_API_KEY`), and optional Google / GitHub / LinkedIn OAuth (verified e-mail required for account linking).
- Set `DATABASE_URL` (pooled Postgres URL recommended; pool size defaults to `3` on Vercel via `DB_POOL_MAX`), `AUTH_SECRET`, and an AI key (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`); without an AI key, clean links receive **Unverified · proceed with caution**.
- Run `npm run db:migrate && npm run db:seed` during deployment setup before serving traffic.
