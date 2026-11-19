# Sign-In-Free Automatic Google Drive Folder & Sheets Sync

Connect **Task Plan and Status** directly to Google Drive folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG` through a server-proxied **Google Apps Script Web App bridge**, enabling automatic master spreadsheet synchronization and manual snapshots without ever requiring users to sign in with Google.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core architecture and workflow choices have been confirmed from your answers. One brief one-time deployment step in Google Apps Script is required by the folder owner (`ekram.elawyersbd@gmail.com`) so the bridge runs under your Google Drive quota without exposing any credentials to end users.

- **Confirmed Decision 1 — Authentication Bridge**: Use a **Google Apps Script Web App bridge** (`Execute as: Me`, `Who has access: Anyone`) protected by a server-side shared secret so no browser user ever sees a Google Sign-In popup.
- **Confirmed Decision 2 — Sync Behavior**: Support **both** debounced automatic synchronization to a single live Master Google Sheet inside folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG` **and** one-click manual snapshot Google Sheets (for the full visible table or checkbox-selected rows).
- **Confirmed Decision 3 — Role Permissions**: **Admins** configure the sync settings, copy the ready-to-deploy Apps Script code, and run connection diagnostics in **Settings**; **all logged-in users** (Admins and Standard Users) can trigger master syncs and manual table snapshots automatically without Google Sign-In.
- **Security & Secret Hygiene (Default)**: The Apps Script Web App endpoint URL and shared verification secret are stored strictly as server-side environment variables and proxied through internal `/api/drive-bridge/*` routes—never exposed in browser code or end-user form inputs.

---

## 1. Overview & Core Concept

- **What It Does**: Eliminates interactive Google OAuth popups for folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG`. Once the folder owner deploys the generated Apps Script once and sets two server environment variables, the app automatically maintains a formatted live Master Google Sheet inside that folder whenever tasks change, and allows any signed-in teammate to create standalone snapshot Google Sheets from the Task Ledger table in one click.
- **Target Audience / Persona**: Legal and accounting administrators (`ekram.elawyersbd@gmail.com`) and team members logged into `ekram.accounticca.com` who want seamless Google Drive folder backup and Google Sheets reporting without Google account prompts or popup blockers.
- **Key Value**: Zero sign-in friction, works reliably on standard Gmail and Google Workspace accounts using the folder owner's native Drive storage quota, and preserves strict user-level data scoping while keeping the central Master Sheet always up to date.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **One-Time Admin Setup (Settings Page)**:
   - Admin opens **Settings** and navigates to the **Automatic Drive Folder Bridge** section.
   - The section displays the fixed target folder link (`https://drive.google.com/drive/folders/1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG`), a **Copy Apps Script Code** button with the exact pre-configured script (folder ID, formatting logic, and shared-secret guard baked in), concise 3-step deployment instructions, and the required environment variable names.
   - Admin clicks **Test Connection** to verify the server proxy can reach the deployed Apps Script and write to folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG`.
   - Admin configures **Auto-Sync Master Sheet** (Enabled / Paused), the **Master Sheet Title** (default `Task Plan and Status — Master`), and the auto-sync delay (default 3 seconds after edits settle).

2. **Automatic Live Master Sync (All Logged-In Users)**:
   - Whenever any user adds, edits, sorts/bulk-updates, archives, or restores tasks in the Task Ledger, a subtle quiet inline status text in the table export strip updates cleanly (`Syncing to Master Sheet…` → `Synced to Master Sheet · 2:14 PM`) with a direct **Open Master Sheet** link.
   - If the server bridge is not yet configured in environment variables, the strip displays a clear, non-intrusive setup hint for Admins (linking straight to **Settings**) and gracefully preserves existing manual Google Sign-In fallback where needed.

3. **One-Click Manual Snapshot Export (Task Ledger Table)**:
   - Directly above the Task Ledger table, users keep the editable sheet title field and click **Save Snapshot to Drive Folder** (or **Save N Selected to Google Sheet** when row checkboxes are checked).
   - A clean confirmation modal summarizes the snapshot name, row count, and target folder URL—no Google Sign-In prompt is ever triggered.
   - On completion, the new spreadsheet is created directly inside folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG` with styled `#E6F0FA` headers and a frozen top row, and an immediate **Open Snapshot** link appears inline alongside a toast notification.

### Visual Identity & Theme

- **Aesthetic Direction**: Crisp, utilitarian legal/corporate ledger matching the existing Task Plan and Status design language—flat, single-elevation surfaces with clean hairline dividers and zero decorative clutter.
- **Color Palette & Mood**:
  - **60% Canvas**: Cool neutral light gray (`#F4F7F6`) and crisp white (`#FFFFFF`) primary sheets.
  - **30% Structural Surfaces**: Soft ice-blue headers and subtle action strips (`#E6F0FA`, `#F7FAFE`), slate borders (`#8FA6C1`, `#E2E8F0`), and muted slate body typography (`#1E293B`, `#475569`).
  - **10% Accents & Semantic States**: Deep navy primary actions (`#1A365D`), emerald green for verified bridge/sheet saves (`#16A34A` / `#047857`), amber for pending sync or unconfigured warnings (`#D97706`), and crimson for actionable errors (`#DC2626`)—always paired with explicit text labels and icons, never color alone.
- **Typography & Hierarchy**:
  - Preserves the existing **2+1 font system**: `Plus Jakarta Sans` for section headings and navigation, `Public Sans` for compact 12px–14px controls and descriptions, and `JetBrains Mono` (`tabular-nums`) for timestamps, row counts, folder IDs, and the copyable Apps Script code block.
- **Component Styling & Layout**:
  - Single-elevation sections separated by hairline borders and generous whitespace—no nested card sandwiches, no thick left accent stripes, and no static pill badges (metadata like last-synced time and row count renders as quiet unboxed text with `·` separators).
  - All toolbar controls and buttons remain strictly single-line (`whitespace-nowrap shrink-0`) with visible focus rings and $\le 200\text{ms}$ feedback transitions.

### Interactive Feedback & Motion

- **States Handled**: Unconfigured bridge state (with Admin shortcut to Settings), checking/testing state, active syncing state, synced success state with timestamp and direct Google Sheet link, and recoverable error state with a one-click **Retry Sync** button.
- **Non-Blocking Auto-Sync**: Debounced background sync runs asynchronously without locking inline spreadsheet editing or disrupting typing focus.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Google Apps Script Web App Bridge over Google Cloud Service Account**
  - *Chosen Approach*: Route requests from the Express server to a lightweight Apps Script Web App deployed under the folder owner's account (`Execute as: Me`).
  - *Why*: Service Accounts on personal Gmail folders encounter Google's 0 GB storage quota restriction when creating new Google Sheets, whereas an Apps Script Web App runs directly under the folder owner's Drive quota, works on both personal Gmail and Google Workspace, and requires zero end-user Google Sign-In.
  - *Alternatives Considered*: Google Cloud Service Account (limited to paid Workspace Shared Drives or editing pre-created files only) and browser OAuth popups (require repeated user sign-in and trigger popup blockers).

- **Decision 2 — Full-Stack Server Proxy with Environment Variables**
  - *Chosen Approach*: Upgrade the runtime entry point to an Express server mounting Vite middleware in development and exposing `/api/drive-bridge/*` endpoints that attach the shared secret server-side.
  - *Why*: Calling Google Apps Script directly from the browser exposes the shared secret in client code and triggers CORS preflight redirects on `script.google.com`. Proxying through the Express backend handles Apps Script's `302` redirect cleanly, keeps secrets strictly server-side, and enforces request validation.
  - *Alternatives Considered*: Direct browser `fetch` to `script.google.com` (blocked by CORS on JSON POST responses and leaks the shared token).

- **Decision 3 — Debounced Auto-Sync Master Sheet + On-Demand Snapshots**
  - *Chosen Approach*: Automatically sync the full active task dataset to one designated Master Google Sheet inside folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG` (debounced by 3 seconds so rapid typing produces a single write), while allowing any logged-in user to create separate timestamped snapshot sheets from either the full visible table or checked rows.
  - *Why*: Prevents rate-limiting during inline spreadsheet edits while ensuring the Drive folder always holds an up-to-date master ledger plus point-in-time exports for client/invoice batches.

- **Decision 4 — Role-Scoped Permissions & Safe Partial Edits**
  - *Chosen Approach*: Admins manage bridge configuration, auto-sync toggles, and setup instructions in Settings. When Standard Users edit their assigned rows, the client sends the full current ledger state (or merges updates cleanly) so the Master Sheet never loses rows belonging to other users, while manual snapshots export only the rows visible or selected by that user.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                         Browser Client (React SPA)                        │
│                                                                           │
│  ┌──────────────────────────────┐     ┌────────────────────────────────┐  │
│  │       Task Ledger Table      │     │    Admin Settings Console      │  │
│  │  • Live auto-sync status     │     │  • Apps Script code generator  │  │
│  │  • Open Master Sheet link    │     │  • 3-step deployment guide     │  │
│  │  • Save Snapshot button      │     │  • Test Connection button      │  │
│  │    (visible or checked rows) │     │  • Auto-sync & title settings  │  │
│  └──────────────┬───────────────┘     └───────────────┬────────────────┘  │
│                 │                                     │                   │
│                 └──────────────┬──────────────────────┘                   │
│                                ▼                                          │
│                 ┌──────────────────────────────┐                          │
│                 │   Bridge Client Service      │                          │
│                 │   • Debounced master sync    │                          │
│                 │   • Snapshot export request  │                          │
│                 │   • Status & retry handling  │                          │
│                 └──────────────┬───────────────┘                          │
└────────────────────────────────┼──────────────────────────────────────────┘
                                 │  Same-origin JSON requests (/api/drive-bridge/*)
                                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   Express Server Proxy (Port 3000)                        │
│                                                                           │
│  • GET  /api/drive-bridge/status      → Checks env config & pings bridge  │
│  • POST /api/drive-bridge/sync-master → Upserts live Master Sheet         │
│  • POST /api/drive-bridge/snapshot    → Creates new Snapshot Sheet        │
│  • Attaches server-only secret & follows Apps Script 302 redirects        │
└────────────────────────────────┬──────────────────────────────────────────┘
                                 │  HTTPS POST + shared secret token
                                 ▼
┌───────────────────────────────────────────────────────────────────────────┐
│            Google Apps Script Web App (Runs as Folder Owner)              │
│                                                                           │
│  • Verifies shared secret token                                           │
│  • Targets folder: 1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG                      │
│  • syncMaster: Finds/creates Master Sheet in folder, rewrites 13 columns, │
│    styles header row (#E6F0FA), freezes row 1, returns URL & timestamp    │
│  • createSnapshot: Creates new formatted Sheet directly in target folder  │
└───────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Server Configuration (Environment Variables — documented in `.env.example`)**:
  - `GOOGLE_APPS_SCRIPT_URL`: Deployed Web App URL from Google Apps Script (`https://script.google.com/macros/s/.../exec`).
  - `GOOGLE_APPS_SCRIPT_SECRET`: Shared verification token checked by the Apps Script `doPost` handler.
  - `GOOGLE_DRIVE_TARGET_FOLDER_ID`: Defaults to `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG`.
- **Client Sync Preferences (Persisted locally, Admin-configurable)**:
  - `autoSyncEnabled` (boolean, default `true` once bridge is active)
  - `masterSheetTitle` (string, default `Task Plan and Status — Master`)
  - `masterSheetId` & `masterSheetUrl` (string | null, returned by the bridge after first sync so subsequent updates reuse the exact same file)
  - `debounceSeconds` (number, default `3`)
- **Transient Sync Status State**:
  - `bridgeConfigured` (boolean), `syncState` (`'idle' | 'syncing' | 'synced' | 'error'`), `lastSyncedAt` (ISO timestamp), `lastError` (string | null), `lastSnapshot` (`{ title, url } | null`).

### Interactive Component & State Mapping

- **Admin Settings Bridge Panel**:
  - *Copy Apps Script*: Copies the complete, ready-to-paste `.gs` script pre-filled with folder ID `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG` and instructions for setting the script property secret and deploying as a Web App.
  - *Test Connection*: Calls `GET /api/drive-bridge/status`, verifies server env vars and live Apps Script reachability, and renders either a verified folder name/timestamp or a specific actionable troubleshooting message.
  - *Auto-Sync Toggle & Master Sheet Title*: Mutates persisted bridge preferences; enabling auto-sync triggers an immediate initial sync if un-synced changes exist.
- **Task Ledger Export Strip**:
  - *Automatic Master Sync*: Watches task changes via a debounced effect whenever `bridgeConfigured && autoSyncEnabled` is true, deduplicating unchanged payloads via content hashing so idle renders never trigger redundant writes.
  - *Manual Sync Now*: Lets any logged-in user force an immediate Master Sheet update without waiting for the debounce timer.
  - *Save Snapshot Button*: Opens the confirmation modal summarizing sheet title, row count (selected rows if checked, otherwise populated visible rows in sorted order), and target folder URL, then calls `POST /api/drive-bridge/snapshot` with zero Google Sign-In required.

### Key Request Sequence (Master Sync & Snapshot)

1. User edits a task cell (or clicks **Save Snapshot to Drive Folder** and confirms in the modal).
2. Client sends the 13-column task rows + metadata to the Express proxy (`/api/drive-bridge/sync-master` or `/api/drive-bridge/snapshot`).
3. Express validates payload structure, reads `GOOGLE_APPS_SCRIPT_URL` and `GOOGLE_APPS_SCRIPT_SECRET` from server environment variables, forwards the HTTPS POST request with redirect-following enabled, and parses the JSON result.
4. Apps Script validates the secret, locates or creates the spreadsheet inside folder `1OjfZm2kE5F9yGnmdFIv8WZpuAPpu9VpG`, writes headers and rows, applies `#E6F0FA` header fill and frozen row 1, and returns `{ ok: true, spreadsheetId, title, spreadsheetUrl, syncedAt }`.
5. Express returns the sanitized metadata to the browser; the UI updates the quiet sync timestamp and renders the clickable **Open Master Sheet** / **Open Snapshot** link.
