# Phase 0 — Foundations

**Goal:** a repo and pipeline where every later phase ships safely and repeatably.
**Duration:** ~1 week · **Team:** 1 engineer · **Prereqs:** accounts for GitHub, a host, a managed Postgres, an error tracker.

## Outcomes
* Project skeleton with lint/type/test/build in CI
* Migrations (not `push`) and a seed script
* Three environments with isolated secrets
* Baseline observability, health checks, and design system

## Prototype status
Skeleton ✅ (Next.js + Drizzle + Tailwind), `/api/health` ✅. Missing: CI, migrations, tests, logging, envs → this phase.

---

## Step-by-step

### 0.1 Repository & tooling
1. Create the GitHub repo `invitz`; protect `main` (PR required, 1 review, CI green, linear history).
2. Add `.editorconfig`, `.nvmrc` (Node 22 LTS), and `engines` in `package.json`.
3. Enable `strict` TypeScript (already on); add `noUncheckedIndexedAccess` once the code base is stable.
4. Configure ESLint (`eslint-config-next`) + Prettier + `lint-staged` + `husky` pre-commit (`eslint --fix`, `prettier --write`).
5. Adopt **Conventional Commits**; add `commitlint` (optional) and release-please for changelogs.
6. Write `CONTRIBUTING.md`: branch naming, PR template, definition of done.

### 0.2 Configuration & secrets
1. Create `src/lib/env.ts` that parses `process.env` with **zod** and throws at boot with a readable list of missing variables. Export a typed `env` object; forbid direct `process.env` access elsewhere (ESLint `no-restricted-properties`).
2. Keep `.env.example` as the contract (exists). Never commit `.env`.
3. Store secrets in the host's secret manager (Vercel/Fly secrets, Doppler, or AWS SSM). Rotate `AUTH_SECRET` and API keys on a calendar reminder.
4. Split variables by environment: `local`, `preview`, `staging`, `production`. **Production keys never exist in other environments.**

### 0.3 Database workflow
1. Replace `drizzle-kit push` with migrations:
   ```bash
   npx drizzle-kit generate     # creates SQL in ./drizzle
   npx drizzle-kit migrate      # applies in CI/CD
   ```
2. Update `drizzle.config.json` with `"out": "./drizzle"`.
3. Move `src/lib/bootstrap.ts` seed logic into `scripts/seed.ts` (idempotent upserts for `topics`, `groups`, `qc_guidelines`). Demo data goes into `scripts/seed-demo.ts`, **never run in production**.
4. Add a CI job that spins up a Postgres service container, runs migrations from scratch, and runs the seed.
5. Rule: every PR that changes `schema.ts` includes the generated migration; reviewers read the SQL.
6. Enable `pg_trgm` and `pgcrypto` extensions in the first migration (needed for P5/P6).

### 0.4 CI/CD
1. GitHub Actions workflow `ci.yml`:
   * `npm ci` → `npm run lint` → `npm run typecheck` → `npm run test` → `npm run build`
   * Postgres service container for integration tests
   * Playwright smoke job against the built app (P7 expands it)
2. `deploy.yml`: on merge to `main` → deploy to **staging** → run smoke tests → manual approval → **production**. Run `drizzle-kit migrate` before the new version starts (expand/contract migrations only: never drop a column in the same release that stops using it).
3. Preview deployments per PR with a seeded ephemeral database (Neon branching makes this trivial).
4. Dependabot/Renovate weekly; `npm audit --omit=dev` in CI (fail on high).

### 0.5 Observability baseline
1. Add **pino** JSON logging with a `requestId`; include `userId`, `inviteId` where relevant. Never log secrets, e-mails, phone numbers, webhook URLs.
2. Add **Sentry** (server + client) with release tagging and source maps.
3. Extend `/api/health` → liveness; add `/api/ready` → DB reachable, migrations current, queue reachable (P3), AI key present (warn only).
4. Uptime monitor (Better Stack/UptimeRobot) on `/api/health`.

### 0.6 Design system & UI foundations
1. Define tokens in `globals.css` (`@theme`): brand violet/fuchsia, neutrals, semantic colours for **verified (green) / caution (amber) / blocked (red)** — these three colours carry the product's meaning, so keep them consistent and accessible (≥ 4.5:1 contrast).
2. Extract primitives: `Button`, `Input`, `Textarea`, `Card`, `Badge`, `Tabs`, `Dialog`, `Toast`. (shadcn/ui is a good starting point.)
3. Page shell: nav, footer, responsive layout, dark mode (optional), empty/loading/error states (`loading.tsx`, `error.tsx`, `not-found.tsx` per route group).
4. Write a one-page **voice & tone** guide for caution/blocked copy (calm, specific, never accusatory).

### 0.7 Testing scaffolding
1. Add **Vitest** (unit/integration) and **Playwright** (e2e).
2. Create `tests/factories.ts` to build users/groups/invites quickly.
3. First tests (they protect the core): `canonicalizeUrl`, `inspectUrl`, `inspectText`, `isPrivateAddress`, `decide`.

### 0.8 Documentation & decision log
1. Put these docs under `/docs`; add `docs/adr/0001-modular-monolith.md` etc. (use the ADR table in 01-architecture).
2. Write `docs/runbooks/` skeletons: *deploy*, *rollback*, *restore DB*, *rotate secrets*.

---

## Acceptance criteria (definition of done)
- [ ] A fresh clone runs with `npm i && cp .env.example .env && npm run db:migrate && npm run dev`
- [ ] CI is green on a PR and blocks merges when red
- [ ] A merge to `main` deploys staging automatically; production needs approval
- [ ] Errors from a deliberately thrown exception appear in Sentry within a minute
- [ ] Missing required env var stops boot with a clear message
- [ ] Migrations apply cleanly to an empty database in CI

## Risks
| Risk | Mitigation |
|---|---|
| Over-engineering tooling | Cap this phase at one week; skip optional items (commitlint, dark mode) |
| `drizzle-kit push` habits leak to prod | CI fails if `push` appears in deploy scripts |
