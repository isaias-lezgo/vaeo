# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## The client: Grupo VAEO

This repo is a **single-client fork** of a shared multi-client GHL panel
(`upstream` → `dashboards-GHL`), built to serve **one customer: Grupo VAEO**. Custom
panels are being built for their **two business lines**, which is what the two dashboard
tabs are — not "Marketing" and "Ventas" as in the shared panel.

**VAEO Business Club** (`vaeo.mx`) — flexible-workspace operator in Mexico, founded/led by
Jorge Pizzuto Aznar, ~22 employees, HQ Querétaro. Its pitch is *"Workspitality"* —
hospitality applied to workspace — and *"Tu espacio de trabajo, como te gusta"*. Four
product lines:

| Line | What it is |
|---|---|
| Oficinas virtuales | Fiscal address, package reception, personalized phone answering, IP telephony (3CX), concierge |
| Coworking | Shared flexible desks, community/networking events |
| Oficinas equipadas | Private furnished offices — *"más que oficinas, lugares llenos de experiencias"* |
| Salas de juntas | Meeting rooms, in-person and remote |

Locations: **Monterrey (×2), Querétaro, San Luis Potosí**. Memberships are customizable,
and meeting-room hours transfer between branches — so a lead's *location* matters as much
as their product interest.

**MESH** (`meshcoworking.com`) — the group's **coworking brand**, launched in Monterrey ~5
minutes from San Pedro Garza García, near Hospital San José. Offers private offices,
coworking floor, and meeting rooms. Positioned at entrepreneurs and companies wanting
*"flexibilidad, comodidad y un ambiente inspirador para crecer"*.

**Audience for both panels**: entrepreneurs/freelancers, PYMEs, and corporate clients.
Sales are **membership/lease subscriptions**, not one-off purchases — so retention,
occupancy and lead-to-tour-to-contract flow matter more than the single-purchase funnel
the shared panel was designed around. Keep that in mind when proposing charts.

**Multi-tenancy is no longer a design concern here.** The roster code (`lib/clients.ts`,
password-as-identity, per-location limiter keying) still exists and still works — leave it
alone unless asked — but do **not** weigh new work against cross-client generality, and
don't preserve per-account portability when it complicates a chart. Hardcoding VAEO's
actual pipeline names, stages and custom fields is fine and preferred here.

## Commands

```bash
# Development
pnpm dev        # Start Next.js dev server (localhost:3000)
pnpm build      # Production build (TypeScript errors are ignored — see next.config.mjs)
pnpm start      # Serve production build
pnpm lint       # Run ESLint

# Multi-client
pnpm add-client # Add a client to the DASHBOARD_CLIENTS roster (prompts, validates, prints the blob)
                #   Non-interactive: pnpm add-client --name "X" --location <id> --token pit-…

# Verification (see below — there is no test framework)
pnpm verify:clients      # lib/clients.ts   — roster parsing + password lookup
pnpm verify:auth         # lib/auth.ts      — session token; incl. the cookie-tamper rejection
pnpm verify:limiter      # lib/ghl-limiter.ts — per-location isolation
pnpm verify:attachments  # lib/attachments.ts + lib/attachment-tools.ts — tabular parse/query/join
pnpm verify:paged        # lib/paged-fetch.ts — resiliencia del abanico de páginas
pnpm verify:pivot        # lib/sales-pivot.ts + lib/panel-scope.ts + lib/hubspot-import.ts
pnpm verify:breakdown    # lib/opportunity-breakdown.ts — cubetas de estado + normalización de categorías
pnpm verify:lost-matrix  # lib/lost-reason-matrix.ts — cruce motivo de perdido × categoría
pnpm verify:advisors     # lib/advisor-breakdown.ts — matriz asesor × etapa + cubetas de estatus
pnpm verify:filters      # lib/panel-filters.ts — filtros globales de sucursal y asesor
npx tsc --noEmit         # REQUIRED: next build ignores TS errors, so a green build proves nothing
```

`pnpm lint` is broken and has been for a while — `eslint` is not actually a dependency of
this repo, so the script exits with `command not found`. `npx tsc --noEmit` is the real
gate.

**No test framework, and not adopting one.** Instead, the pure modules where a silent
bug would be a *cross-tenant data leak* (clients / auth / limiter) or a silently wrong
answer (attachments / paged-fetch / sales-pivot / opportunity-breakdown) have assertion scripts under
`scripts/verify-*.ts` (plain `node:assert/strict`, run via `tsx`). Run them after touching
auth, the roster, the limiter, the attachment parsers, the pagination helpers, or the
sales pivot. Everything else is verified by driving the real app.

There is no way to run a single assertion within a script — each `verify:*` script is
the unit. Run the one that covers the module you touched.

Gotcha when writing these scripts: this package is CommonJS (no `"type": "module"`),
so `tsx` compiles to CJS where **top-level `await` fails**. Wrap async work in a
`main()` and call `main().catch(...)` — see the existing scripts.

**Package manager: pnpm.** This repo is managed with pnpm (`packageManager: pnpm@11.x`
in `package.json`), and the Vercel deploy runs `pnpm install --frozen-lockfile` against
`pnpm-lock.yaml`. **Install and add dependencies with `pnpm install` / `pnpm add <pkg>`
— never `npm install`.** Running `npm install` writes `package-lock.json` but leaves
`pnpm-lock.yaml` stale, which makes the Vercel build fail with
`ERR_PNPM_OUTDATED_LOCKFILE`. If a lockfile ever drifts, run `pnpm install
--lockfile-only` to resync only the lockfile (no `node_modules` churn), then commit it.
A tracked `package-lock.json` lingers from before the switch; it is **not** the source
of truth — ignore it.

`pnpm-workspace.yaml` exists only for its `allowBuilds` list (`sharp`, `esbuild`). pnpm 11
blocks postinstall scripts by default; without those entries the install dies with
`ERR_PNPM_IGNORED_BUILDS`. If a new dependency needs a postinstall, add it there.

## Environment Variables

Required vars in `.env.local`:
- `DASHBOARD_CLIENTS` — JSON array of clients, one per GHL sub-account:
  `[{"id","name","locationId","ghlToken","password"?}]`. `password` is optional and
  defaults to that client's `locationId`. Use `pnpm add-client` to extend it safely.
- `DASHBOARD_AUTH_SECRET` — random string used to HMAC-sign the session cookie (`openssl rand -hex 32`)
- `ANTHROPIC_API_KEY` — used by `app/api/chat` (assistant), `analyze-report` (PDF analyses)
  and `analyze-contact`
- `GHL_API_TOKEN` / `GHL_LOCATION_ID` — **not read by the app.** Kept only so the dev
  GHL MCP server (`.mcp.json`) can point at one sub-account.

All are server-side only. `DASHBOARD_CLIENTS` is read in `lib/clients.ts`;
`DASHBOARD_AUTH_SECRET` in `lib/auth.ts`, `app/api/auth/login/route.ts`, and
`middleware.ts` — never exposed to the browser.

## Repo docs

- `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md` — the design doc for a feature;
  `docs/superpowers/plans/` — its implementation plan. Both are written **before** the
  code. When picking up non-trivial work on an existing feature, check for its spec first —
  it usually records why an approach was rejected.
- **`README.md` is stale — do not trust it.** It still describes Next 15, SWR caching, a
  `lib/mock-data.ts` fallback, a `filter-bar.tsx` with member/pipeline/tag filters, and a
  `conversations-dashboard.tsx` tab. None of those exist. This file (CLAUDE.md) is the
  accurate description; treat the README as marketing copy.
- `DESIGN.md` — the design system (named color tokens, typography, component rules).
  `PRODUCT.md` — who the three audiences are and what each asks of the same data.
  `snap.md` / `snap2.md` are one-off Playwright accessibility-tree dumps, not docs.

## Architecture

This is a single-page Next.js 16 (App Router) dashboard that surfaces GoHighLevel CRM data in three tabs: **VAEO**, **MESH**, and **Asistente IA**. The multi-tenant machinery from the shared panel is still in place (a client's password resolves to their own GHL sub-account — see "Multi-client" below), but this deployment serves Grupo VAEO only.

### Panel scope: the pipeline IS the business line

**The two panels are the same charts over two different pipelines.** Every chart in the
VAEO tab counts only contacts whose opportunity lives in the **VAEO** pipeline; every
chart in the MESH tab counts only contacts whose opportunity lives in the **MESH**
pipeline. Nothing else distinguishes the tabs — build a chart once, and it should render
in either panel with only the pipeline scope changing.

Both pipelines live in the **same** GHL sub-account (`uDQiMzx1Iclb6gbJNRDY`, "Grupo VAEO"),
so the main sync fetches them together and the split is client-side:

| Pipeline | id | Stages |
|---|---|---|
| VAEO | `MiATYfkJWklaXqYc7hOr` | Nuevo Lead → Lead en proceso → Lead Perfilado → Propuesta → Negociación → Ganado → Perdido → Cliente Futuro |
| MESH | `DkZiRWdizgMRt7osjuRb` | Nuevo Lead → Lead en proceso → Lead perfilado → Propuesta → Negociación → Ganado → Perdido → Cliente Futuro |

The stage names are identical across the two (modulo the lowercase `perfilado` in MESH),
which is what makes one chart implementation serve both. Match stages **by name**,
case-insensitively — never by stage id — the same rule `isWonOpp()` already follows.

Consequences to keep in mind when building charts:

- **The opportunity is the entry point, not the contact.** A contact has no pipeline of
  their own; they belong to a panel because one of their opportunities does. Scope by
  filtering opportunities on `pipelineId`, then resolve contacts from that set.
- A contact with opportunities in *both* pipelines legitimately appears in *both* panels.
  That is not double-counting to fix — they are a lead for both business lines.
- A contact with **no** opportunity belongs to no pipeline, so it can't be scoped to either
  business line — but it is **never silently dropped**. Those contacts are leads that
  nobody has moved into an embudo yet, which is exactly the leak worth watching. Surface
  them in a **card at the top of the panel** ("Contactos sin oportunidad" — count +
  drill-down to the list), above the pipeline-scoped charts, and keep them **out** of the
  chart aggregates so the funnel numbers stay honest. Show the same card in both panels;
  there is no data to attribute them to one line over the other.
- The pipeline scope is applied **before** the date filter conceptually, but both are just
  filters over the same arrays; order doesn't matter as long as drill-downs still join
  against the unfiltered `all*` sets (see "Drill-downs" below).

`app/page.tsx` passes the **full** opportunity/contact sets to both dashboards; each chart
applies the scope itself through **`lib/panel-scope.ts`** (`scopeOpportunities(opps, panel,
pipelines)`), which is the single definition shared by both panels. `PANEL_SCOPES` also
carries the per-panel **sucursal custom field** (`Sucursal VAEO` vs `Sucursal MESH`), since
that differs between the two lines as well. `resolvePipelineId()` matches the pipeline by
**name** and falls back to the hardcoded id.

### Current state

- Both panels now render charts; `PanelPlaceholder` is no longer used by either. **Shared by both** (identical code, only `panel` differs): `opportunity-status-chart.tsx`, `opportunity-win-rate-chart.tsx`, `lost-reason-matrix.tsx` (tabla "Motivos de perdido": motivo × categoría, con un switch propio entre Canal de Contacto y Origen de Lead — el switch es estado local de la tarjeta, no un filtro global), `advisor-stage-table.tsx` (tabla "Oportunidades por asesor": asesor × etapa, con una barra apilada de estatus por fila; el sombreado se normaliza **por columna** y la fila "Sin asesor" queda fuera de esa normalización y del tinte, porque es un orden de magnitud mayor), and two mounts of `category-breakdown-chart.tsx` (`OrigenDeLeadChart` / `CanalDeContactoChart`, both exported from that file with their tooltip copy), and two mounts of `sales-by-dimension-chart.tsx` (ventas apiladas por mes de cierre, cortadas por sucursal y por servicio — calcan los dos charts de Looker Studio que el cliente ya usa). **VAEO only**: `sales-pivot-table.tsx` ("Resumen general de ventas") — nobody has asked for it in MESH; sus totales y los de las barras salen del mismo agregado y `pnpm verify:pivot` asegura que cuadran. **Their prop surface is intentionally identical and fully wired** — `app/page.tsx` already feeds both the date-filtered slices and the unfiltered `all*` lookup sets, so a new chart drops in with no plumbing. Keep the two prop lists in sync so a chart can move between panels unchanged — the only thing that should differ between the two panels is the pipeline scope (see above). Each panel builds one `shared` object and spreads it into every per-opportunity chart; keep that pattern rather than re-listing props per chart.
- **`ChartContainer` (`components/ui/chart.tsx`) already wraps its child in a Recharts `ResponsiveContainer`.** Do not nest another one inside it — the chart still renders, but Recharts logs "width and height are both fixed numbers" on every resize. Charts recovered from git history predate this and do nest one; drop it when you port them.
- Both panels also take **`dateRange`** (the resolved `ResolvedDateRange | null` from `app/page.tsx`). It exists for charts that measure a date *other than* `createdAt`: the pivot table filters `allOpportunities` by **Fecha de Cierre** itself, because the pre-filtered `opportunities` prop is cut by creation date and would silently drop an opportunity created outside the window but closed inside it.
- Deleted with them (recoverable from git history / `upstream`): `campaign-activity-chart.tsx`, `decision-cycle-table.tsx`, `origen-de-lead-criteria.tsx`. Still present and reusable: `chart-drill-drawer.tsx` (also used by the AI assistant), `detail-drawer.tsx`, `appointment-drill-drawer.tsx`, `export-report-button.tsx`, and all of `dashboard-ui.tsx`.
- The third tab (`DashboardTab` id `"conversations"`, labelled **"Asistente IA"**) renders `conversations-chat.tsx`. It is **permanently mounted and merely hidden** when inactive, so the chat history survives tab switches — do not make it conditional. It always sees the full, unfiltered dataset.
- Both dashboards can **export a branded PDF report** of their own charts (see "PDF report export").

### Data flow

```
browser → middleware.ts (verifies the signed dash_session cookie)
    ↓
app/api/dashboard/route.ts
    ↓  requireClient()  → resolves the cookie's client id to a ClientConfig (lib/session.ts)
    ↓  withClient(...)  → establishes the per-request credential context (lib/ghl-context.ts)
    ↓
lib/ghl-client.ts  (raw GHL types + fetch helpers; reads token+location from the context)
    ↓  lib/ghl-limiter.ts  (concurrency + rate limiting, keyed PER LOCATION)
GHL REST API (services.leadconnectorhq.com)
    ↓  back up: transforms GHL → internal types; contacts/opps/pautas/appointments/tasks fetched concurrently
    ↓  NDJSON stream of {progress|location|step|data|error} frames
hooks/fetch-stream.ts  (parses the NDJSON stream)
    ↓
hooks/use-dashboard-data.ts  (custom streaming fetcher; exposes data, progress text, and structured per-dataset `steps`. No SWR/caching — refresh() re-runs the full sync)
    ↓
app/page.tsx  (tab state, date-filter state, applies the client-side date-range filter, renders dashboard)
    ↓
components/dashboard/{marketing,sales}-dashboard.tsx
```

Beyond that main sync, the app has these routes. Every one that touches GHL runs through
`requireClient()` + `withClient()`; the ones marked **no GHL** work off data the browser
already holds and need only the middleware gate:

| Route | Purpose |
|---|---|
| `dashboard` | the main NDJSON sync above |
| `dashboard-messages` | NDJSON stream of conversation messages, loaded separately from the main sync |
| `conversations` | on-demand full message threads for a batch of contacts |
| `contact-notes` / `contact-tasks` | per-contact detail, fetched live when a drawer opens |
| `analyze-contact` | Anthropic call summarizing one contact (does read GHL for the opportunity) |
| `chat` | one Anthropic turn for the AI assistant — **no GHL** |
| `analyze-report` | Anthropic pass writing the PDF report's analyses — **no GHL** |
| `attachments/process` | parses an uploaded PDF/CSV/Excel for the assistant — **no GHL** |
| `auth/login` / `auth/logout` | session cookie |

Client-side data hooks mirror this: `use-dashboard-data.ts` (main sync),
`use-conversations-data.ts` (messages), `use-agent-loop.ts` (the AI agent loop), all
built on `fetch-stream.ts` for the NDJSON routes.

### Multi-client (multi-tenancy)

One deployment serves every client. **The password IS the client's identity.**

1. `lib/clients.ts` — the roster, parsed from `DASHBOARD_CLIENTS`. This is the
   **seam**: nothing downstream knows the roster comes from an env var, so swapping
   in a database later touches only this file.
2. Login (`app/api/auth/login/route.ts`) looks the submitted password up across the
   roster (`findClientByPassword` — constant-time, no early return) and HMAC-signs
   the matched client's id into the `dash_session` cookie:
   `<clientId>.<expiryMs>.<hmac>`. The id is inside the signed payload, so a client
   cannot edit their cookie to reach another client's data.
3. Every GHL-touching route calls `requireClient()` (`lib/session.ts`), which
   re-verifies the cookie **itself** — it deliberately does not trust a
   middleware-injected header, which would be a spoofing surface. Middleware only
   verifies the signature; resolving the client there would drag the roster into the
   Edge bundle.
4. The route runs its GHL work inside `withClient(client, ...)`
   (`lib/ghl-context.ts`, an `AsyncLocalStorage`). `ghlFetch` reads credentials via
   `currentClient()`, which is why none of its ~113 exported functions needed a
   signature change. `currentClient()` **fails closed** — it throws rather than
   falling back to a default token.
5. `lib/ghl-limiter.ts` keys the concurrency semaphore, token bucket, and 429
   cooldown **by location id**, because GHL's budget is per location. Shared, one
   client's 429 would freeze every other client's sync.

**NEVER** replace the AsyncLocalStorage context with a module-level "current client"
variable: one serverless instance serves overlapping requests, so that would
silently serve client A's dashboard using client B's token.

**Password model — a deliberate, informed tradeoff. Do not "fix" it unprompted.**
A client's password defaults to their GHL `locationId`. That id is *not* a secret
(it appears in GHL URLs, embed codes, webhook payloads, Make scenarios) and it
**cannot be rotated**. The owner accepted this knowingly, for the convenience of
having nothing extra to manage. The escape hatch is already built in: the optional
`password` field on a client entry overrides the default, so any single client can be
given a real, rotatable password by adding one line — no migration, no code change.
Suggest that if a password leaks; don't rewrite the model on your own initiative.

The two streaming routes (`dashboard`, `dashboard-messages`) enter the context
**inside** the `ReadableStream` `start()` callback — the stream outlives the
handler's return, so wrapping the handler would leave the pump running outside the
context.

`app/api/chat` and `app/api/analyze-report` never touch GHL (they work off data the
browser already holds), so they need no client context — only the middleware gate.

Verification scripts (no test framework in this repo): `pnpm verify:clients`,
`pnpm verify:auth`, `pnpm verify:limiter`.

### Loading & progress

The dashboard fetch streams NDJSON progress frames rather than returning a single JSON blob, so the UI can show live progress during the multi-second GHL sync:
- `{ type: "location", name }` — sub-account name (resolved first, for the loading header).
- `{ type: "step", key, status, count }` — structured per-dataset progress. `key` ∈
  `config | contacts | opportunities | pautas | appointments | tasks`; `status` ∈
  `loading | retrying | done | partial | error`. `partial` means the dataset came back
  known-incomplete (some pages never landed) and `error` means it came back with nothing
  — neither is the same as a legitimate zero, which is `done` with `count: 0`. The `data`
  frame carries a matching `warnings[]` that drives the dashboard's amber banner
  (`components/dashboard/sync-warning-banner.tsx`). Because those datasets are fetched
  **concurrently**, the loading screen (`components/dashboard/loading-screen.tsx`) renders
  one live row per dataset with a running count, plus a determinate progress bar driven by
  completed-step count.
- `{ type: "progress", message }` — human-readable fallback text.
- `{ type: "data", ... }` / `{ type: "error", ... }` — terminal frames.

### AI assistant

The assistant is an **agent loop that runs in the browser**, not on the server.

- `app/api/chat/route.ts` handles exactly **one Anthropic turn per request**. When the
  model returns `tool_use` blocks the server just returns them; `hooks/use-agent-loop.ts`
  executes the tools locally and POSTs back with `tool_result` blocks. The server holds
  **no session state** between turns.
- `lib/ai-tools.ts` — the ~25 `TOOL_DEFINITIONS` and their executor. Most tools
  (`search_*`, `aggregate`, `relate`, `get_*`) run **against the dataset the browser
  already holds** — no extra GHL calls. The exceptions reach back through
  `lib/ghl-fetchers.ts` for data not in the initial sync: `get_contact_messages`,
  `search_conversations`, `get_contact_tasks`, `get_contact_notes`.
- UI-side tools: `render_chart` → `chat-chart.tsx`, `ask_user` → `chat-question.tsx`,
  `show_in_panel` → the conversations context panel, `create_pdf` / `export_csv` →
  direct browser downloads.
- `lib/conversations-panel.ts` holds the context panel's logic (extracted from the
  component so it stays testable-by-inspection): the **urgency buckets** are derived from
  the last message only — inbound and unanswered for >72 h = `red`, 24–72 h = `yellow`,
  under 24 h = `grey`; anything the team already replied to is `grey`. Contacts sort by
  bucket, then oldest-activity-first inside a bucket.
- `lib/ai-context.ts` — the Spanish system prompt. It carries hard-won behavioral rules
  (date-window consistency, never concluding from a truncated message sample, `lostReason`
  being a native field, never printing IDs). **Treat those numbered rules as regression
  fixes, not prose** — each one exists because the model got it wrong. Don't trim them
  for brevity.
- `lib/ai-index.ts` — `buildChatIndex()` precomputes the by-contact lookup maps
  (`oppsByContact`, `pautasByContact`, `pautaNameByContact`, …), cached on the contacts
  array reference so it survives within a single agent run.
- `datasetSummary` is built once on the client and pinned for **prompt caching**; keep
  it stable across turns in a session or the cache key breaks.
- **Timezone**: the browser's IANA zone is posted as `userTimezone` on every `chat` and
  `analyze-contact` call; both routes fall back to `America/Mexico_City`. Dates rendered
  into a prompt must go through that zone — the server runs in UTC on Vercel, so
  formatting a timestamp without it shifts "yesterday" by a day for the client.

#### File attachments

Users can drop PDF / CSV / Excel files into the assistant composer.

- `app/api/attachments/process/route.ts` parses uploads server-side (`unpdf` for PDF,
  `xlsx` for tabular) into `ProcessedAttachment` objects. It touches no GHL. Limits:
  32 MB PDF, 25 MB tabular; each Excel sheet becomes its own table.
- **PDF text-vs-visual fallback**: if extracted text is under `MIN_PDF_TEXT` (40
  non-whitespace chars) the PDF is assumed scanned and re-sent as a native base64
  document block for Claude to read visually, instead of as text.
- **Tabular files are never pasted into the prompt.** Only a summary (schema, row count,
  8 sample rows, per-column stats from `buildTableSummary`) goes to the model; the full
  rows stay in the browser in `uploadedTablesRef` (`hooks/use-agent-loop.ts`) and are
  queried through the `list_uploaded_files` / `query_uploaded_table` /
  `join_uploaded_table` tools, executed locally by `lib/attachment-tools.ts`. Keep it that
  way — a spreadsheet inlined into the prompt blows the context and the cache.
- `lib/attachments.ts` stays framework-free (shared by the route and the verify script);
  the client-only file reading lives in the composer.

### Shared domain rules (single sources of truth)

Four small `lib/` modules exist so Marketing, Ventas, and the AI tools all agree on the
same definitions. **Never re-inline any of this logic in a component** — a local copy
that drifts makes two tabs report different numbers for the same question, which is the
bug class these modules were extracted to kill.

| Module | Owns |
|---|---|
| `lib/pauta.ts` | what counts as "de pauta" + campaign-name resolution (below) |
| `lib/opportunity-status.ts` | `isWonOpp()` — canonical "won" detection |
| `lib/source-platform.ts` | "Origen de lead" platform bucketing + `PLATFORM_COLORS` / `PLATFORM_ORDER` |
| `lib/csv.ts` | CSV cell escaping (`csvCell`, `buildCsv`) |
| `lib/panel-scope.ts` | which pipeline + sucursal custom field each panel means |
| `lib/panel-filters.ts` | los filtros globales de sucursal y asesor de la barra |
| `lib/hubspot-import.ts` | which opportunities arrived already-closed from the HubSpot migration |
| `lib/sales-pivot.ts` | the ventas pivot aggregation (mes de cierre × sucursal › servicio) |
| `lib/sales-series.ts` | la agregación de las barras apiladas (mes de cierre × sucursal / servicio) |
| `lib/opportunity-breakdown.ts` | won/open/lost bucketing per month + "Origen de Lead" / "Canal de Contacto" category rollups |
| `lib/lost-reason-matrix.ts` | el cruce motivo de perdido × categoría (toma sus columnas de `buildCategoryBreakdown`, no re-normaliza) |
| `lib/advisor-breakdown.ts` | la matriz asesor × etapa del embudo + el desglose de estatus por asesor |

- **`isWonOpp()`**: some sub-accounts never flip `status` to `"won"` — they record a sale
  by moving the opportunity into a late stage ("09. Negocio Ganado") while `status`
  stays `"open"`. Detection matches the **stage name** (`/ganad[oa]|\bwon\b/i`), never
  hardcoded stage IDs, so it stays portable across locations. An explicitly
  `lost`/`abandoned` opp is never a win regardless of stage.
- **`source-platform.ts`**: buckets into Instagram / Facebook / TikTok / Google / Otro by
  loose substring match, because field *names* differ per sub-account ("Origen de Lead"
  vs "Origen del Lead", "Tipo de pauta" vs "Tipo de anuncio"). **WhatsApp is deliberately
  absent** — it's a contact channel, not a lead origin, so a bare "whatsapp" stays in
  "Otro". `components/dashboard/origen-de-lead-criteria.tsx` is the UI that explains these
  rules to the user; keep the two in sync.
- **`csv.ts`**: shared by the assistant's `export_csv` tool and the drill drawer's
  "Exportar" button (`lib/drill-export.ts`), so both files escape identically.
  `lib/download.ts` triggers the actual browser download for both.

#### Pauta (paid-advertising) classification

`lib/pauta.ts` is the **single source of truth** for what counts as "de pauta", shared by
the marketing charts and the AI tools. Do not re-inline this logic anywhere.

- `isDePauta(opp, pautaContacts)` — a deliberate **union**: the contact is linked to a
  Pauta custom-object record **OR** the opportunity itself carries a paid-traffic
  source/medium (`isPaidTraffic`). Neither signal alone is complete — Pauta records come
  from a Make scenario and don't always exist, and not every paid lead keeps its UTM — so
  each covers the other's gaps.
- `resolveCampaignName()` — an ordered fallback chain, since sub-accounts name the field
  differently ("Nombre pauta", "Nombre de la pauta", …) and some accounts have no
  attribution URL at all.
- Totals legitimately differ between grouping modes; that's by design, not a bug.

### PDF report export

Both dashboards export a branded PDF via `components/dashboard/export-report-button.tsx`.

- `lib/report.ts` composes a `ReportInput` (KPIs + `ReportSection[]`) from the dashboard's
  **already-computed aggregates** — deterministic code, not the model.
- `app/api/analyze-report/route.ts` then makes one Haiku pass that writes an executive
  summary plus one analysis per section. Sections are analyzed **by default**; `ai: false`
  opts out. Token budget is sized to the section count (~13 marketing / ~8 ventas) — if you
  add sections, check it still fits.
- `lib/pdf/*` renders the spec with pdfmake: `build-pdf.ts` (doc definition — **LETTER
  landscape**, 712pt usable width), `charts.ts` (hand-drawn canvas charts), `blocks.ts`
  (tables/KPIs), `branding.ts` (palette, `sanitizeBrand`).
- The same `create_pdf` spec/renderer backs the AI assistant's PDF tool, so both outputs
  share one format. Changing `lib/pdf/*` affects both.
- **Brand rule**: `sanitizeBrand()` strips "GoHighLevel"/"GHL" from all rendered text —
  the platform is presented as "Lezgo Suite CRM". The AI prompts carry the same rule.
- pdfmake **cannot render in a bare Node harness** — verify PDF changes by building and
  driving the real app.

### Key design decisions

- **No mock-data fallback**: when the GHL API is unavailable or errors, the UI renders against empty arrays (`data?.contacts ?? []` patterns in `app/page.tsx`). The former `lib/mock-data.ts` and its stand-ins have been removed.
- **All GHL API calls are server-only**: `lib/ghl-client.ts` is never imported from client components — only from API routes. This keeps the token out of the browser bundle. Client code reaches GHL data through `lib/ghl-fetchers.ts`, which calls those routes.
- **`/opportunities/search` uses `location_id` (snake_case)** while most other endpoints use `locationId` (camelCase). The `useSnakeCaseLocationId` flag in `ghlFetch` handles this quirk.
- **"Importación HubSpot" is a second global filter, and it is OFF by default.** Grupo VAEO
  migrated from HubSpot on 2026-03-20; deals HubSpot had already closed came over with a
  close date inside that month, so 485 of the VAEO pipeline's 648 won opportunities pile
  onto mar 2026. `lib/hubspot-import.ts` requires **both** a HubSpot id custom field **and**
  a close date within the migration month — the 10 deals that arrived open and were later
  won in the CRM ($267,163) are real sales and keep counting. Calibrated against the
  client's Looker Studio report ("No es de Importación"), which the panel now matches **to
  the cent** in every settled month. Applied in `app/page.tsx` to the opportunity set
  *before* the date filter, so the date-filtered slices and the `all*` lookup sets agree —
  a drill-down must never surface a record the charts excluded. The AI assistant is
  deliberately exempt, same as the date filter.
- **Filtering is entirely client-side**: `lib/date-range.ts` (`DateFilter`, `resolveDateRange`, `filterByDateRange`) filters the already-fetched dataset by date; `components/dashboard/date-range-filter.tsx` is the UI *and* the bar that hosts every other panel-wide filter. The filtered slices are computed in `app/page.tsx` and passed to each dashboard as props. The filter bar is hidden on the AI assistant tab, which always sees the full dataset.
- **There are three panel-wide filters, and they compose in a fixed order** — all of them
  live in `app/page.tsx` and all of them are applied to the opportunity set **before** the
  date cut, so the date-filtered slices and the unfiltered `all*` lookup sets agree. A
  drill-down must never surface a record the charts excluded:
  `data.opportunities` → `applyHubspotFilter` → `applyPanelFilters` → `scopedOpportunities`
  → `filterByDateRange` → `opportunities`.
  **`lib/panel-filters.ts`** owns the last two: the **Sucursal** and **Asesor** multi-select
  menus (`multi-select-filter.tsx`, one generic component mounted twice). Notes worth
  keeping:
  - **Empty selection = no filter.** Do not "fix" this into an all-selected neutral state:
    with that convention a branch newly added in the CRM would silently sit outside a
    filter the user believes is off.
  - `sucursalOf()` reads **either** `Sucursal VAEO` **or** `Sucursal MESH` — an opportunity
    only populates its own pipeline's field — which is what lets **one global menu** serve a
    bar that lives above the tabs. Options are derived from the loaded dataset, plus a
    `Sin sucursal` bucket so those records stay reachable.
  - `ADVISORS` is **hardcoded to the three sales advisors the client named** (Zulema Silva,
    Dariana Turrubiates, Diana Arbelaez); the sub-account's other six users are owner,
    marketing and support. Matching is by **first name**, accent- and case-insensitive
    against `opp.assignedTo`, so a corrected surname in GHL doesn't break the filter.
  - They filter **opportunities only** — contacts carry no sucursal of their own.
  - The AI assistant is exempt, same as the date filter and the HubSpot toggle.
- **`calls` is always empty** in live data — GHL doesn't expose a public calls endpoint in the standard API. **`tasks` is populated** via the location-wide `/locations/:id/tasks/search` endpoint (`searchLocationTasks`), fetched concurrently with the other datasets.
- **Drill-downs resolve joins against the *unfiltered* set.** Dashboards take both
  `opportunities` (date-filtered, for display) and `allOpportunities` (everything, as a
  lookup table) — likewise `allContacts` / `allPautas` / `allAppointments`. An opportunity
  can be created outside the window that puts its contact on screen, so joining against the
  filtered slice silently drops real rows. Keep that pairing when adding a drawer.

### Internal type system

`lib/types.ts` defines the canonical internal types (`Contact`, `Opportunity`, `Pauta`, `Appointment`, `Call`, `Task`, `Message`, `Pipeline`). The API route transforms raw GHL shapes into these before returning JSON. Always work against the internal types in components — never import from `lib/ghl-client.ts` on the client side.

## GHL API Gotchas

> Full schema reference: `/Users/isaiasrios/Downloads/GHL-API-Schemas.md`

- **Version header required** on all requests: `Version: 2021-07-28` (legacy) or `2023-02-21` (current).
- **customFields shape differs between read and write**:
  - Write (create/update): `{ id, key, field_value }`
  - Read (contacts): `{ id, value }`
  - Read (opportunities): `{ id, fieldValue }`
- **DATE custom fields use `fieldValueDate`** — an epoch in **milliseconds at UTC
  midnight**, not `fieldValue`/`fieldValueString`/`value`. `resolveCustomFields()` in
  `app/api/dashboard/route.ts` normalizes it to ISO so `customFieldsResolved` stays
  string-valued. Bucket such dates with **UTC** getters: read in `America/Mexico_City`, a
  close on the 1st at 00:00Z lands in the previous month.
- **Tags on contacts**: sending `tags` in update/upsert **overwrites all existing tags**. Use `/contacts/:id/tags` (POST/DELETE) for incremental changes.
- **Opportunity status** valid values: `open`, `won`, `lost`, `abandoned`, `all` (`all` is search-filter only).
- **`lostReasonId`** is only relevant when status is `"lost"`.
- **`/opportunities/search`** uses snake_case params (`location_id`, `pipeline_id`, etc.) — already handled by `useSnakeCaseLocationId` flag in `ghlFetch`.
- **Conversation `type`** is numeric in some endpoints: `1=Phone`, `2=Email`, `3=FB Messenger`, `4=Review`, `5=Group SMS`.
- **Required scopes**: `contacts.readonly/write`, `opportunities.readonly/write`, `conversations.readonly/write`.

## GHL MCP Server

An HTTP MCP server (`ghl-mcp`, configured in `.mcp.json`) connects directly to GoHighLevel's hosted MCP endpoint (`https://services.leadconnectorhq.com/mcp/`). It authenticates with the same `GHL_API_TOKEN` and `GHL_LOCATION_ID` env vars used by `lib/ghl-client.ts`.

- **Purpose**: lets Claude Code query/mutate live GHL data directly during development (inspecting real contacts, opportunities, pipelines, custom fields, conversations) without writing throwaway scripts. It is **not** part of the app's runtime data flow — the app always goes through `app/api/dashboard/route.ts` → `lib/ghl-client.ts`. Never wire MCP calls into application code.
- **Use it to**: verify real data shapes, discover pipeline/custom-field IDs, confirm API behavior, and validate transforms against production data before coding them in `route.ts`.
- **Tools** (prefixed `mcp__ghl-mcp__`), grouped:
  - `contacts_*` — get-contact, get-contacts, create/update/upsert-contact, add-tags, remove-tags, get-all-tasks
  - `opportunities_*` — get-opportunity, search-opportunity, get-pipelines, update-opportunity
  - `conversations_*` — search-conversation, get-messages, send-a-new-message
  - `locations_*` — get-location, get-custom-fields
  - `calendars_*` — get-calendar-events, get-appointment-notes
  - `payments_*` — list-transactions, get-order-by-id
  - `blogs_*`, `emails_*`, `social-media-posting_*` — content/marketing operations
- **Caution**: write tools (create/update/upsert/send/post) mutate live production data. Default to read-only tools; only use write tools when explicitly asked.

### UI components

- `components/ui/` — shadcn/ui components (generated, do not hand-edit)
- `components/dashboard/` — domain components; each dashboard component receives already-filtered data as props
- `components/dashboard/date-range-filter.tsx` is the only global filter UI; the `DateFilter` type lives in `lib/date-range.ts`
- Charts use Recharts via the shadcn chart wrapper (`components/ui/chart.tsx`)
- `components.json` controls shadcn/ui config (alias `@/components/ui`, Tailwind CSS v3)
- Shared chart chrome lives in `dashboard-ui.tsx`: `ChartCardHeader`, `ScopePill` (scope
  label + tooltip explaining a chart's rule), and `CardTone` (won/lost card tints — the
  light/dark pairs are tuned by eye, not numerically matched; don't "normalize" them)

**Chart conventions** — apply to every new chart:
- Use `NonZeroTooltipContent` so empty series don't render noise, and wire a drill-down
  drawer (`chart-drill-drawer.tsx`) — every chart should be clickable through to its records
- Series apiladas: usa `SERIES_PALETTE` / `SERIES_NEUTRALS` (`dashboard-ui.tsx`), no
  `CHART_PALETTE` — esta última no pasa la validación de contraste/CVD en un stack. Cinco
  tonos es el límite; una dimensión con más valores pliega su cola en "Otros"
  (`lib/sales-series.ts`). El color se asigna sobre el set SIN filtrar, para que mover el
  filtro de fechas no repinte las series.
- Una leyenda propia (fuera del `ChartContainer`) **no ve** las variables `--color-<slot>`
  que emite `ChartStyle`: van bajo el selector `[data-chart=chart-<id>]`. Pásale un `id`
  al `ChartContainer` y marca el bloque de chips con el mismo `data-chart` —
  `sales-by-dimension-chart.tsx` es el ejemplo. (La vieja regla "ningún encoding que
  requiera leyenda" se eliminó: una barra apilada la requiere por definición, y estos
  charts calcan un reporte que el cliente ya usa.)
- Never nest a scroll container inside a card. For narrow scrollable panels use a plain
  `overflow-y-auto` div — Radix `ScrollArea` breaks `truncate`
