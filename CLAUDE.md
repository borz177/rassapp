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
npm run start-electron       # run the Electron shell against the last build

npm run apk                  # build:web + capacitor sync + gradle assembleDebug
npm run apk:release          # same but assembleRelease
npm run build:all            # build:web + build:desktop + apk
```

Backend (separate install, run from `server/`):
```bash
cd server
npm install
npm run dev                  # nodemon index.js
npm start                    # node index.js
```

There is no test suite and no linter configured in either package — don't invent `npm test`/`npm run lint` commands.

**Known environment gap:** `@capacitor/status-bar`, `bcryptjs`, and `libphonenumber-js` are imported by frontend code (`App.tsx`, `services/storage.ts`, `components/CustomerDetails.tsx`) but are not listed in the root `package.json` and are typically missing from `node_modules`. `npm run dev`/`npm run build` will fail on module resolution until these are installed. This predates any feature work — verify against a clean `git stash` before assuming a change caused it.

## Architecture

### Frontend shape
- No React Router. Navigation is a hand-rolled state machine: `ViewState` (see `types.ts`) is switched in the ~3000-line root `App.tsx`, which owns nearly all top-level state (auth, customers, sales, products, accounts, investors, settings, etc.) and prop-drills it down through `components/Layout.tsx` (shell: sidebar/bottom nav/header) into the ~35 screen/feature components in `components/`.
- `constants.tsx` holds icon map, app name/version, and the `THEMES` accent-color palette (PURPLE/BLUE/GREEN/BLACK — user-selectable brand color, unrelated to light/dark mode).
- `types.ts` is the single source of truth for the domain model (`User` with roles `admin|manager|investor|employee`, `Sale`, `Customer`, `Product`, `Expense`, `Account`, `Investor`, `AppSettings`, etc.) and for `ViewState`.

### Theming (light/dark + accent color)
Two independent theming systems share the same CSS custom-property namespace in `src/index.css`, so be careful not to conflate them:
- **Light/Dark/System mode**: `src/theme/ThemeContext.tsx` (`ThemeProvider`/`useTheme`) owns `mode` (`light|dark|system`), resolves it against `prefers-color-scheme` when `system`, and toggles a `.dark` class on `<html>`. Tailwind v4's `dark:` variant is wired to that class via `@custom-variant dark` in `src/index.css` (not the default `prefers-color-scheme` behavior). Persisted to `localStorage['finuchet_theme_mode']`; an inline script in `index.html` applies the class before first paint to avoid FOUC.
- **Accent color**: `AppSettings.theme` (`PURPLE|BLUE|GREEN|BLACK`) is set in `components/Settings.tsx` and applied by `components/Layout.tsx` via a `useEffect` that writes `--color-primary-*`/`--color-secondary-*` as **inline styles** on `document.documentElement` from `THEMES` in `constants.tsx`. Because inline styles win over class-selector CSS variables, dark-mode surface colors (backgrounds/borders/text) must use plain `slate`/`gray` Tailwind `dark:` utilities rather than the `--color-primary-*` tokens, or they'll fight the accent system.

### Data layer
- `services/api.ts` is the HTTP client. Base URL is resolved at runtime: `http://<host>:5000/api` on localhost/LAN, `/api` in production (same origin as the backend). Auth is a bearer-style `x-auth-token` header backed by `localStorage['token']`. A 401 triggers a global session-expired flow (`window.__onSessionExpired`) rather than a hard redirect where possible.
- Most domain objects go through one generic pair: `api.saveItem(type, item)` → `POST /api/data/:type` and `api.deleteItem(type, id)` → `DELETE /api/data/:type/:id`, where `type` must be one of the server's `VALID_DATA_TYPES` whitelist (`customers, products, sales, expenses, accounts, investors, partnerships, settings`).
- **Offline-first**: `services/offlineStorage.ts` wraps an IndexedDB (`InstallMateDB`) with a sync queue, a generic cache store, and a file/blob store (for documents attached to customers). `api.saveItem`/`deleteItem` fall back to queuing in IndexedDB when a request fails due to a network error, and `api.sync()` flushes the queue when connectivity returns. `services/storage.ts` additionally mirrors auth/app-settings state into plain `localStorage` for fast local reads.
- `getBaseUrl()` in `api.ts` and the whitelist in `server/index.js` (`VALID_DATA_TYPES`) must stay in sync when adding a new syncable collection.

### Backend (`server/index.js`, single file, ~3400 lines)
Express + `pg` (PostgreSQL) + JWT auth (`jsonwebtoken`), bcrypt password hashing, `multer` for document uploads (`server/uploads`), `nodemailer` for verification emails. Route groups:
- `/api/auth/*` — register/login/reset (email verification codes), `/api/auth/me`.
- `/api/data` (GET, bulk) and `/api/data/:type` (POST)/`/api/data/:type/:id` (DELETE) — the generic sync endpoint described above.
- `/api/users/manage`, `/api/admin/*` — sub-user (employee/investor) management and admin panel (cross-tenant user list, subscription overrides, support tools).
- `/api/integrations/whatsapp/*` — WhatsApp instance creation and reminder sending (green-api style), tied into `services/whatsapp.ts` on the frontend.
- `/api/support/*` / `/api/admin/support/*` — in-app support ticket + broadcast system.
- `/api/payment/*` — subscription payment creation/webhook.
- `/api/v1/*` — a separate public API (customers/accounts/expenses/contracts/payments/income) authenticated by a per-user generated API key (`adminGenerateUserApiKey`/`generateApiKey`), distinct from the JWT session auth used by the app itself.
- `/api/calculator-configs/*` — public, unauthenticated installment-calculator link configs (`?view=public_calc` / `/calc` routes in `App.tsx` render a standalone calculator using these).
- Role/tenant model: `role` is one of `admin|manager|investor|employee`. Managers own the data; `employee`/`investor` accounts scope reads/writes back to their `managerId` via `getTargetUserId`; `filterDataForEmployee` further restricts an employee's view to their `allowedInvestorIds`. `PLAN_LIMITS` enforces per-`SubscriptionPlan` (`TRIAL|START|STANDARD|BUSINESS`) contract/investor/employee/WhatsApp/AI caps server-side.

### AI integration
`services/geminiService.ts` uses `@google/genai` (Gemini) for generating WhatsApp collection messages and other AI features gated by `PLAN_LIMITS.ai`/`AppSettings`. Requires `GEMINI_API_KEY` in `.env.local`; Vite exposes it as both `process.env.API_KEY` and `process.env.GEMINI_API_KEY` via the `define` block in `vite.config.ts`.

### Styling
Tailwind CSS v4 via `@tailwindcss/vite` (CSS-first config, no `tailwind.config.js` `theme` block beyond color aliasing — see `src/index.css` for the actual token definitions and the `@theme`/`:root`/`.dark` blocks). `tailwind.config.js` only maps `indigo`/`purple`/`green`/`dark` Tailwind color families onto the CSS variables defined in `src/index.css`.

### Native shells
- `capacitor.config.ts`: Android build points at a **remote** `server.url` (`https://rassrochka.pro`) with `cleartext: true` rather than bundling `dist/` for offline-first native use — the Android app is effectively a hosted-webview wrapper, not a fully offline bundle, despite `webDir: 'dist'` being configured.
- `electron.cjs`/`preload.js`: minimal Electron main process, no IPC surface of note beyond loading the built web app.
