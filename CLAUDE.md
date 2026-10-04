# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

FinUchet ("рассрочка"/installment-plan management SaaS) is a React 19 + Vite web app that ships to three targets from the same codebase:
- **Web/PWA** — built with Vite, served directly.
- **Android** — wrapped with Capacitor (`android/` directory), loads the same web build.
- **Desktop (Windows)** — wrapped with Electron (`electron.cjs`), same web build.

The frontend talks to a separate Express + PostgreSQL backend in `server/` (its own `package.json`, not an npm workspace — install/run it independently).

## Commands

Run from the repo root unless noted.

```bash
npm install                 # install frontend deps
npm run dev                 # Vite dev server on :3000
npm run build                # production web build (alias: build:web)
npm run preview              # preview a production build

npm run build:desktop        # build:web + electron-builder (Windows NSIS installer)
npm run build:mac            # build:web + electron-builder --mac (universal .dmg, ad-hoc signed — Gatekeeper warns until a Developer ID signs/notarizes it)
npm run start-electron       # run the Electron shell against the last build

npm run apk                  # build:web + capacitor sync + gradle assembleDebug
npm run apk:release          # same but assembleRelease
npm run ios                  # build:web + capacitor sync ios + open Xcode
npm run build:all            # build:web + build:desktop + apk
```

Backend (separate install, run from `server/`; `server/package.json`/lock mirror production exactly — add backend deps there, never only on the server or in the root `package.json`, which the frontend deploy prunes):
```bash
cd server
npm install
npm run dev                  # nodemon index.js
npm start                    # node index.js
```

There is no test suite and no linter configured in either package — don't invent `npm test`/`npm run lint` commands. `npx tsc --noEmit -p .` works as a type check but the codebase has ~14 pre-existing errors (as of Oct 2026) — diff against `git stash` rather than expecting zero; Vite's build doesn't type-check.

On this Mac, Node is installed under `~/.local/node` (added to PATH in `~/.zprofile`); non-login shells may need `export PATH="$HOME/.local/node/bin:$PATH"`. `xlsx` is installed from the SheetJS CDN tarball, not the npm registry (the npm `xlsx` package is abandoned).

## Architecture

### Frontend shape
- Entry: `index.tsx` is a thin router — the public calculator (`/calc/…`, `?view=public_calc`) loads only `publicCalcEntry.tsx` → `components/PublicCalculator.tsx` (no App, api.ts or SW, ~100 KB gzip); everything else loads `appEntry.tsx` (the real app root). Installment math shared by the seller's `Calculator.tsx` and the public page lives in `src/calcMath.ts`; calculator settings (categories with per-term rates and a client note, rounding, markup-on-remainder) are in `AppSettings.calculator` and published via `/api/calculator-configs` — one stable config per seller (POST updates it), so the client link never changes or expires.
- No React Router. Navigation is a hand-rolled state machine: `ViewState` (see `types.ts`) is switched in the ~5900-line root `App.tsx`, which owns nearly all top-level state (auth, customers, sales, products, accounts, investors, warehouses, stock movements, settings, etc.) and prop-drills it down through `components/Layout.tsx` (shell: sidebar/bottom nav/header) into the screen/feature components in `components/`.
- `src/*.ts` (outside `src/index.css`/`src/theme/`) holds pure domain helpers extracted from components — e.g. `syncMerge.ts` (offline-queue merge), `profitTotals.ts`, `accountCash.ts`, `supplierLedger.ts`, `contractPdf.ts`, barcode scanning (`barcode*.ts`). Put new non-UI logic there rather than growing `App.tsx`.
- `shared/` (`profit.js`, `excelReport.js`) is plain JS imported by **both** the frontend (`components/DataExport.tsx`) and the backend (`server/index.js`, `server/backup.js`) — keep it CommonJS/ESM-neutral and dependency-free so both sides can load it.
- Profit sharing (investor accounts and the shared POOL: capital × time per payment-plan window, `managerShareSplit` "доля за управление", percent clamped to 0–100, employee bonus) lives **only** in `shared/profit.js`; `src/utils.ts` re-exports it with TS types. Don't reimplement share math elsewhere — the server's `/api/my-bonus` uses the same module.
- Code comments and UI strings are in Russian; match that when editing.
- Modals: build new sheet-style windows on `components/GlassSheet.tsx` (iOS-style sheet: slides up, stops below the notch, swipe-down to dismiss, nav bar with cancel/action, large title that collapses on scroll, `confirmClose` for dirty forms, `SheetSection` for grouped cards); simple bottom sheets/dialogs use `components/Sheet.tsx` (has a grab handle + swipe-down on phones). Full-screen media goes through `components/DocumentViewer.tsx`. Native file save/share on iOS/Android must use `saveContractPdf` (`src/contractPdf.ts`) — `<a download>` does nothing inside the native WebView.
- Glass pill/droplet (bottom nav, `TabPill`, `ModeSwitch`): behaviour lives in `components/useGlassDrop.ts` + `src/index.css` (`.nav-glass-*`, CSS vars `--sx/--sy/--tx/--ty`); the bottom nav in `Layout.tsx` has its own drag/velocity logic but the same CSS.
- `constants.tsx` holds icon map, app name/version, and the `THEMES` accent-color palette (PURPLE/BLUE/GREEN/BLACK — user-selectable brand color, unrelated to light/dark mode).
- `types.ts` is the single source of truth for the domain model (`User` with roles `admin|manager|investor|employee`, `Sale`, `Customer`, `Product`, `Expense`, `Account`, `Investor`, `AppSettings`, etc.) and for `ViewState`.

### Theming (light/dark + accent color)
Two independent theming systems share the same CSS custom-property namespace in `src/index.css`, so be careful not to conflate them:
- **Light/Dark/System mode**: `src/theme/ThemeContext.tsx` (`ThemeProvider`/`useTheme`) owns `mode` (`light|dark|system`), resolves it against `prefers-color-scheme` when `system`, and toggles a `.dark` class on `<html>`. Tailwind v4's `dark:` variant is wired to that class via `@custom-variant dark` in `src/index.css` (not the default `prefers-color-scheme` behavior). Persisted to `localStorage['finuchet_theme_mode']`; an inline script in `index.html` applies the class before first paint to avoid FOUC.
- **Accent color**: `AppSettings.theme` (`PURPLE|BLUE|GREEN|BLACK`) is set in `components/Settings.tsx` and applied by `components/Layout.tsx` via a `useEffect` that writes `--color-primary-*`/`--color-secondary-*` as **inline styles** on `document.documentElement` from `THEMES` in `constants.tsx`. Because inline styles win over class-selector CSS variables, dark-mode surface colors (backgrounds/borders/text) must use plain `slate`/`gray` Tailwind `dark:` utilities rather than the `--color-primary-*` tokens, or they'll fight the accent system.

### Data layer
- `services/api.ts` is the HTTP client. Base URL is resolved at runtime: `http://<host>:5000/api` on localhost/LAN, `/api` in production (same origin as the backend). Auth is a bearer-style `x-auth-token` header backed by `localStorage['token']`. Tokens are 90d with a sliding renewal: the server's `auth` middleware returns `x-renewed-token` for tokens older than 7 days (CORS-exposed for iOS) and `fetchWithAuth` stores it. A 401 on a logged-in request calls `loseSession()` (services/api.ts): token/user are dropped, `finuchet_session_user` remembers who was working, and `App.tsx` shows `Auth` with that e-mail prefilled. `saveItem`/`deleteItem` without a token queue the write (as offline) instead of failing; `api.sync` waits for a token and skips queue items whose `ownerId` belongs to another account; `handleAuthSuccess` flushes the queue.
- Most domain objects go through one generic pair: `api.saveItem(type, item)` → `POST /api/data/:type` and `api.deleteItem(type, id)` → `DELETE /api/data/:type/:id`, where `type` must be one of the server's `VALID_DATA_TYPES` whitelist (`customers, products, sales, expenses, accounts, investors, partnerships, suppliers, settings, tasks, stockMovements, retailSales, warehouses` — check `server/index.js` for the current list). Server-side, every one of these is a row in a single `data_items(id, user_id, type, data JSONB)` table; there are no per-collection tables.
- **Offline-first**: `services/offlineStorage.ts` wraps an IndexedDB (`InstallMateDB`) with a sync queue, a generic cache store, and a file/blob store (for documents attached to customers). `api.saveItem`/`deleteItem` fall back to queuing in IndexedDB when a request fails due to a network error, and `api.sync()` flushes the queue when connectivity returns. `services/storage.ts` additionally mirrors auth/app-settings state into plain `localStorage` for fast local reads.
- Writes of one record are ordered (`serializeWrite` in `services/api.ts`): while an older version of a record is still queued, a new save/delete of it queues behind it instead of going direct (otherwise the flushed old version overwrote the newer one on the server — that is how payments "disappeared"); on flush only the newest queued version is sent, and a delivered version drops older ones. 5xx/408/429 and unreadable success responses are treated like a network failure (queued and retried with the same id), never rolled back on screen. While the queue is non-empty `App.tsx` retries every 20 s (switching networks fires no `online` event).
- Queued offline saves are merged on flush rather than overwriting the server copy (see `mergeInvestor` in `src/syncMerge.ts`); `App.tsx` merges fresh server data into state with `mergeServerData`.
- Adding a new syncable collection means: add it to `VALID_DATA_TYPES` in `server/index.js`, add it to the `Data`/state shape in `types.ts`/`App.tsx`, and handle it in the bulk `GET /api/data` merge in `App.tsx`.

### Backend (`server/index.js` ~6500 lines, plus `server/api/`)
Local Postgres: `docker-compose up -d` starts Postgres 16 on host port **5434** (user/pass `postgres`, db `finuchet`); point the server at it with `DATABASE_URL` in `server/.env`. Tables are created idempotently at startup (`CREATE TABLE IF NOT EXISTS` in `index.js`, plus `ensureApiTables`/`ensureOAuthTables`) — there is no migration tool.
Express + `pg` (PostgreSQL) + JWT auth (`jsonwebtoken`), bcrypt password hashing, `multer` for document uploads (`server/uploads`), `nodemailer` for verification emails. Route groups:
- `/api/auth/*` — register/login/reset (email verification codes), `/api/auth/me`.
- `/api/data` (GET, bulk) and `/api/data/:type` (POST)/`/api/data/:type/:id` (DELETE) — the generic sync endpoint described above.
- `/api/users/manage`, `/api/admin/*` — sub-user (employee/investor) management and admin panel (cross-tenant user list, subscription overrides, support tools).
- `/api/integrations/whatsapp/*` — WhatsApp instance creation and reminder sending (green-api style), tied into `services/whatsapp.ts` on the frontend.
- `/api/support/*` / `/api/admin/support/*` — in-app support ticket + broadcast system.
- `/api/payment/*` — subscription payment creation/webhook.
- `/api/v1/*` — a separate public API (customers/accounts/expenses/contracts/payments/income) authenticated by a per-user generated API key (`adminGenerateUserApiKey`/`generateApiKey`), distinct from the JWT session auth used by the app itself. Implemented in `server/api/` (`v1.js` router, `auth.js` key auth + rate limiters, `middleware.js` idempotency/request log, `openapi.js` spec, `validate.js`). The same directory hosts an OAuth server (`oauth*.js`) and an MCP JSON-RPC endpoint (`mcp*.js`) whose tools deliberately call the `/api/v1` routes internally instead of duplicating logic — add new capabilities to `v1.js` first, then expose them via MCP.
- `/api/calculator-configs/*` — public, unauthenticated installment-calculator link configs (`?view=public_calc` / `/calc` routes in `App.tsx` render a standalone calculator using these).
- Role/tenant model: `role` is one of `admin|manager|investor|employee`. Managers own the data; `employee`/`investor` accounts scope reads/writes back to their `managerId` via `getTargetUserId`; `filterDataForEmployee` further restricts an employee's view to their `allowedInvestorIds`. `PLAN_LIMITS` enforces per-`SubscriptionPlan` (`TRIAL|START|STANDARD|BUSINESS`) contract/investor/employee/WhatsApp/AI caps server-side.

### AI integration
`services/geminiService.ts` uses `@google/genai` (Gemini) for generating WhatsApp collection messages and other AI features gated by `PLAN_LIMITS.ai`/`AppSettings`. Requires `GEMINI_API_KEY` in `.env.local`; Vite exposes it as both `process.env.API_KEY` and `process.env.GEMINI_API_KEY` via the `define` block in `vite.config.ts`.

### Styling
Tailwind CSS v4 via `@tailwindcss/vite` (CSS-first config, no `tailwind.config.js` `theme` block beyond color aliasing — see `src/index.css` for the actual token definitions and the `@theme`/`:root`/`.dark` blocks). `tailwind.config.js` only maps `indigo`/`purple`/`green`/`dark` Tailwind color families onto the CSS variables defined in `src/index.css`.

### Native shells
- `capacitor.config.ts`: the Android build points at a **remote** `server.url` (`https://rassrochka.pro`) with `cleartext: true` rather than bundling `dist/` for offline-first native use — the Android app is effectively a hosted-webview wrapper, not a fully offline bundle, despite `webDir: 'dist'` being configured.
- **iOS** (`ios/`, Capacitor 8, Swift Package Manager — no CocoaPods): unlike Android, the web build is **bundled** into the app — `capacitor.config.ts` drops `server.url` when `process.argv` contains `ios` (i.e. `npx cap sync/copy/run ios`; a bare `npx cap sync` would give iOS the remote URL). The page runs at `capacitor://localhost`, so anything that assumes same-origin with the backend must go through `src/platform.ts`: `isBundledApp()`, `SERVER_ORIGIN`, `publicOrigin()` for links users copy/share, `serverFileUrl()` for `/uploads/...` paths (used by `ProductImage`); `API_URL` in `services/api.ts` already switches. The server allows that origin in CORS (`IOS_APP_ORIGIN`) and sends `Cross-Origin-Resource-Policy: cross-origin` for product photos. UI changes reach iPhones only via a new App Store build, so keep the API backward-compatible. `server.errorPath: 'offline.html'` (`public/offline.html`) is for Android's remote mode. The app uses the UIScene life cycle (`ios/App/App/SceneDelegate.swift` + `UIApplicationSceneManifest` in `Info.plist`) — the Xcode 27 SDK refuses to launch apps without it, so don't revert to an AppDelegate-owned window. App Store rules forbid selling the subscription outside Apple's IAP, so `isIOSApp()` (`src/platform.ts`) hides prices/payment buttons/"оформите подписку" prompts on iOS (`Tariffs.tsx`, `SubscriptionExpiryBanner.tsx`, `showUpgradeAlert` in `App.tsx`) — any new purchase entry point must be gated the same way. The APK self-update check in `App.tsx` is Android-only. iPhone-only build (`TARGETED_DEVICE_FAMILY = 1`). Push on iOS is native APNs, not Web Push: `src/nativePush.ts` (plugin `@capacitor/push-notifications`, iOS only — on Android `register()` without Firebase crashes) → `POST /api/push/native/subscribe` → `native_push_tokens` table → `server/apns.js` (HTTP/2 + ES256 JWT, no deps), called from `sendPushToUser`. Enabled only when `APNS_KEY_PATH`/`APNS_KEY_ID`/`APNS_TEAM_ID` are set in `/var/www/env/rassapp.env`; until then `/api/push/native-config` says `ios: false` and Settings hides the push block on iPhone. The Push Notifications capability (entitlement) still has to be added in Xcode once a paid team is selected — a free personal team can't sign with it. Subscription-expiry emails with a pay link: `server/subscription-reminders.js`.
- `electron.cjs`/`preload.js`: Electron shell. Like iOS, the UI is **bundled**: the window opens `https://rassrochka.pro/app`, but `protocol.handle('https')` serves every GET for that host from the packaged `dist/` (SPA fallback to `index.html`) and passes `/api`, `/uploads`, `/downloads` and other hosts to the network — same origin as the old remote mode, so no CORS changes and existing logins/IndexedDB survive. It works offline, and UI changes reach desktop users only with a new `.dmg`/`.exe` (keep the API backward-compatible). `FINUCHET_URL=http://localhost:3000/` disables bundling for testing against `npm run dev`. The service worker is not registered in the shell (`isDesktopShell()` in `src/platform.ts`) and Web Push is hidden there (Electron has no push service). `preload.js` exposes `window.finuchetShell`; on macOS `floating: true` makes `index.html` add `html.shell-floating` — sidebar and content become separate rounded cards over a vibrancy window (`.shell-*` in `src/index.css`), and the content card scrolls itself (`src/rootScroll.ts`); external links open in the system browser; on macOS it installs a Russian app menu (needed for Cmd+C/V/Q) and keeps running after the window closes. `npmRebuild: false` + `!node_modules` in `build.files` — the shell needs no npm deps (and rebuilding `sharp` for Electron fails). macOS icon: `build/icon.png` (rounded, padded; generated from the iOS AppIcon).
