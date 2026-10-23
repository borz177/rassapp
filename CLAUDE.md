# CLAUDE.md

Guidance for Claude Code in this repo. Code comments and UI strings are in Russian — match that when editing.

## Project

FinUchet ("рассрочка"/installment-plan SaaS): React 19 + Vite app shipped to four targets from one codebase — Web/PWA, Android (Capacitor, `android/`), iOS (Capacitor 8, `ios/`), Desktop (Electron, `electron.cjs`: Windows NSIS + macOS dmg). Backend is a separate Express + PostgreSQL app in `server/` (own `package.json`, not a workspace; add backend deps there, never only on the server or in the root `package.json`, which the frontend deploy prunes).

## Commands

```bash
npm install && npm run dev      # Vite on :3000
npm run build                   # web build (build:web)
npm run build:desktop           # web + electron-builder --win (works from this Mac)
npm run build:mac               # universal .dmg, ad-hoc signed (Gatekeeper warns)
npm run apk | apk:release | ios # Android / iOS (ios opens Xcode)
cd server && npm install && npm run dev   # nodemon; `npm start` = node
```

- No test suite/linter — don't invent `npm test`/`lint`. Exceptions: `cd server && npm run ai:eval` (~20 scenarios against the real model, `server/ai/evals/run.js`; needs a local server + OpenRouter key + demo account; run after changing the assistant's prompt/tools/model); `node -r ./server/node_modules/dotenv/config --test server/ai/*.test.js server/contractTemplates/*.test.js dotenv_config_path=server/.env` (PG-tests use a throwaway schema in the local DB); `cd server && node ai/evals/skills-isolated.js` (real model, synthetic data: forecast, collections, payoff, restructure, stock); `npx tsc --noEmit -p .` (≈13 pre-existing errors — compare against `git stash`; Vite doesn't type-check).
- Node lives in `~/.local/node` (`export PATH="$HOME/.local/node/bin:$PATH"` in non-login shells). `xlsx` comes from the SheetJS CDN tarball, not npm.
- Local Postgres: `docker-compose up -d` (Postgres 16, host port **5434**, user/pass `postgres`, db `finuchet`); set `DATABASE_URL` in `server/.env`. Tables are created idempotently at startup — no migration tool.

## Frontend architecture

- `index.tsx` is a thin router: public calculator (`/calc/…`, `/c/<id>`, `?view=public_calc`) loads only `publicCalcEntry.tsx`; `/help` loads `helpEntry.tsx` (articles in `src/helpArticles.ts`, screenshots via `scripts/help-shots`); everything else loads `appEntry.tsx`. A failed chunk import triggers one reload. Calculator math is shared in `src/calcMath.ts`; calculator config is `AppSettings.calculator`, published via `/api/calculator-configs` (one stable config per seller).
- No React Router: `ViewState` (`types.ts`) is switched in the huge root `App.tsx`, which owns nearly all state and prop-drills through `components/Layout.tsx` (shell). Put new non-UI logic in `src/*.ts` (pure helpers: `syncMerge`, `profitTotals`, `accountCash`, `contractPdf`, `customerPhones`, …), not in `App.tsx`.
- `shared/` (`profit.js`, `excelReport.js`, `contractTemplate.js`) is plain JS imported by both frontend and backend — keep it dependency-free. Profit sharing (investors, POOL, `managerShareSplit`, employee bonus) lives **only** in `shared/profit.js` (`src/utils.ts` re-exports it); never reimplement share math.
- `types.ts` is the domain model + `ViewState`; `constants.tsx` has icons, app version, `THEMES`.
- Modals: sheet-style windows → `components/GlassSheet.tsx` (swipe-down, `confirmClose` for dirty forms, `SheetSection`); simple bottom sheets → `components/Sheet.tsx`; full-screen media → `DocumentViewer.tsx`. Native file save/share must use `saveContractPdf` (`src/contractPdf.ts`) — `<a download>` does nothing in the native WebView. Confirm dialogs over other modals need a higher z-index (e.g. Tasks uses 10000).
- Glass pill/droplet (bottom nav, `TabPill`, `ModeSwitch`): `components/useGlassDrop.ts` + `.nav-glass-*` in `src/index.css`.
- Long lists render progressively (`src/hooks/useProgressiveList.ts`).
- Contract printing: built-in templates in `src/contractTemplates.ts`; personal block-based templates (AI recognizer + manual constructor) are documented in `docs/custom-contract-templates.md` — read it before touching them.

### Theming
Two independent systems share the CSS-variable namespace in `src/index.css`:
- **Light/Dark/System**: `src/theme/ThemeContext.tsx` toggles `.dark` on `<html>` (Tailwind v4 `dark:` is wired via `@custom-variant dark`); persisted in `localStorage['finuchet_theme_mode']`, applied by an inline script in `index.html` before first paint.
- **Accent color** (`AppSettings.theme` PURPLE|BLUE|GREEN|BLACK): `Layout.tsx` writes `--color-primary-*`/`--color-secondary-*` as inline styles from `THEMES`. Inline styles win over class CSS vars, so dark-mode surfaces (bg/border/text) must use plain `slate`/`gray` `dark:` utilities, never the primary tokens.
- Styling is Tailwind v4 (CSS-first, `@tailwindcss/vite`); `tailwind.config.js` only aliases color families onto the CSS vars.

## Data layer

- `services/api.ts`: base URL `http://<host>:5000/api` on localhost/LAN, `/api` in prod. Auth header `x-auth-token` from `localStorage['token']` (90 d, sliding renewal via `x-renewed-token`). A 401 calls `loseSession()` → `Auth` with e-mail prefilled. Writes without a token are queued as offline; `api.sync` skips queue items of another `ownerId`.
- Most objects use `api.saveItem(type, item)` → `POST /api/data/:type` and `api.deleteItem` → `DELETE /api/data/:type/:id`; `type` must be in the server's `VALID_DATA_TYPES` (check `server/index.js`). Server side everything is a row in `data_items(id, user_id, type, data JSONB)`. Adding a syncable collection = add to `VALID_DATA_TYPES`, to `types.ts`/`App.tsx` state, and to the bulk `GET /api/data` merge in `App.tsx`.
- **Offline-first**: `services/offlineStorage.ts` (IndexedDB `InstallMateDB`: sync queue, cache, file store). Writes of one record are ordered (`serializeWrite`): while an older version is queued a newer save queues behind it, only the newest queued version is sent, 5xx/408/429/unreadable responses count as network failures (queued, same id, never rolled back on screen). While the queue is non-empty `App.tsx` retries every 20 s. Queued saves are merged on flush (`src/syncMerge.ts`, `mergeInvestor`); fresh server data goes through `mergeServerData`.

## Backend (`server/index.js` + `server/api/`, `server/ai/`, `server/contractTemplates/`)

Express + `pg`, JWT, bcrypt, multer (`server/uploads`), nodemailer. Roles `admin|manager|investor|employee`: managers own data, employees/investors scope to their `managerId` via `getTargetUserId`; `filterDataForEmployee` limits by `allowedInvestorIds`. `PLAN_LIMITS` (`TRIAL|START|STANDARD|BUSINESS`) enforces contract/investor/employee/WhatsApp/AI/contractTemplates caps server-side (`checkFeatureAccess`).
Route groups: `/api/auth/*`, `/api/data*`, `/api/users/manage` + `/api/admin/*`, `/api/integrations/whatsapp/*` (+ `services/whatsapp.ts`), `/api/support/*`, `/api/payment/*`, `/api/calculator-configs/*` (public), `/api/contract-templates/recognize`, `/api/push/*`.
`/api/v1/*` is the public API (per-user API key; `server/api/`: `v1.js`, `auth.js`, `middleware.js`, `openapi.js`, `validate.js`) plus an OAuth server (`oauth*.js`) and MCP endpoint (`mcp*.js`) whose tools call `/api/v1` internally — add capabilities to `v1.js` first, then expose via MCP.

### AI
- FinUchetGPT (`server/ai/assistant.js`) calls models via OpenRouter (`OPENROUTER_API_KEY`, proxy `OPENROUTER_BASE_URL` default `https://wa.rassrochka.pro/openrouter/v1`, `FALLBACK_MODEL` retry). Siblings: `collections.js` (forecast, collection queue, promises, payoff/restructure math; promises in table `ai_payment_promises` via `promises.js`), `stock.js` (receive / write-off / retail sale exactly like `App.tsx` + undo), `digest.js` (morning summary incl. promises, no model call), `quality.js` (self-improvement signals; `cant_do` = requests it couldn't fulfil), `discipline.js`, `fuzzyName.js`, `vocabulary.js`, `ruNumbers.js`, `evals/`. Action cards (`kind`s like `contract_form`, `send_doc`, `reschedule`, `template_draft`) are rendered in `components/AIActionCard.tsx` and handled in `AIAssistant.tsx`; a new kind must be added to `ACTION_KINDS` in `assistant.js`. Gated by `AI_AGENT_PUBLIC=1` in `/var/www/env/rassapp.env` (open to all since 20.10.2026; `aiAgentAllowed` in `server/index.js`).
- Personal contract-template recognition: `server/contractTemplates/` (model `AI_TEMPLATE_MODEL`, daily limit 5 shared via `usage.js`).
- `services/geminiService.ts` (`@google/genai`, `GEMINI_API_KEY` in `.env.local`, exposed via the `define` block in `vite.config.ts`) generates WhatsApp collection texts.

## Native shells

- **Android** (`capacitor.config.ts`): loads the remote `server.url` (`https://rassrochka.pro`, `cleartext: true`) — a hosted-webview wrapper, not offline, despite `webDir: 'dist'`. `server.errorPath: 'offline.html'`. APK self-update check in `App.tsx` is Android-only.
- **iOS**: web build is **bundled** (`server.url` dropped when `process.argv` contains `ios` — a bare `npx cap sync` would give iOS the remote URL). Page runs at `capacitor://localhost`, so same-origin assumptions go through `src/platform.ts` (`isBundledApp()`, `SERVER_ORIGIN`, `publicOrigin()`, `serverFileUrl()`); `API_URL` switches itself; the server allows `IOS_APP_ORIGIN` in CORS. UI changes reach iPhones only via an App Store build → keep the API backward-compatible. Uses the UIScene life cycle (`SceneDelegate.swift` + `Info.plist`) — don't revert to an AppDelegate window. iPhone-only. App Store rules: `isIOSApp()` hides prices/payment/"оформите подписку" everywhere — gate any new purchase entry point. Push on iOS is native APNs (`src/nativePush.ts` → `/api/push/native/subscribe` → `native_push_tokens` → `server/apns.js`), enabled only when `APNS_KEY_PATH/KEY_ID/TEAM_ID` are set; the Push capability must still be added in Xcode with a paid team. Subscription-expiry emails: `server/subscription-reminders.js`.
- **Electron** (`electron.cjs`/`preload.js`): UI is **bundled** — the window opens `https://rassrochka.pro/app` but `protocol.handle('https')` serves GETs for that host from packaged `dist/` (SPA fallback) and passes `/api`, `/uploads`, `/downloads`, other hosts to the network (same origin → no CORS changes, logins/IndexedDB survive). Works offline; UI changes reach desktop users only with a new `.dmg`/`.exe` (keep API backward-compatible). `FINUCHET_URL=http://localhost:3000/` disables bundling for testing. No service worker or Web Push in the shell (`isDesktopShell()`). `preload.js` exposes `window.finuchetShell`; `floating: true` (mac and win32) makes `index.html` add `html.shell-floating` (+ `shell-win` on Windows): sidebar and content become separate rounded cards over vibrancy (mac) / acrylic (Win 11 22H2+, else solid `#1e293b`) — `.shell-*` in `src/index.css`; the content card scrolls itself (`src/rootScroll.ts`). Mac: Russian app menu, keeps running after window close. `npmRebuild: false` + `!node_modules` in `build.files` (the shell needs no npm deps; rebuilding `sharp` for Electron fails). To test UI via CDP use a separate `--user-data-dir` (other Electron instances lock IndexedDB).
