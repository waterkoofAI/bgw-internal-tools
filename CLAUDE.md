# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A single-file, static GitHub Pages site: **`bgw_report_v2.html`**. No build system, no server, no dependencies beyond CDN-hosted Chart.js + html2canvas. Open the HTML in a browser and it works; deploy by pushing to GitHub and serving via Pages.

This repo is one of three "BGW community" repos under `/Volumes/Cathy/bgw-projects/`. It is the **reader/dashboard** side of the Shared Data Pipeline. The frontend doesn't run on Railway, but the repo also hosts the canonical source of the GAS Apps Script backend under `gas/` — see the "GAS Apps Script source" section below.

## What `bgw_report_v2.html` does

A tabbed dashboard with two roles ("modes") across five "communities":

### Communities (tabs)
- `en` — EN Community (manual mod report)
- `cn` — 中文社区 (manual mod report)
- `pred` — Prediction Group (manual mod report)
- `bot_prediction` — Prediction Bot (auto-pushed snapshot from bgw-v4)
- `bot_airdrop` — Airdrop Bot (auto-pushed snapshot from moew-airdrop-bot)

### Modes
- **Mod (Fill)** — moderators submit daily community reports. Only available on the three community tabs. Bot tabs force CM view.
- **CM (View)** — read-only dashboard with summary cards, charts, history table. Always-on for bot tabs.

The mode/community state lives in JS globals (`mode`, `com`) and is restored from `localStorage` on load.

## Data flow

This page is the **reader** side of the Shared Data Pipeline that's documented in `bgw-v4/CLAUDE.md`. The sheet IDs and tab names are hardcoded in the HTML:

- Google Sheet ID: `1Q03YZxG1EGs1aDmLOXoz3tGOiBot8_bNt_FfQDS2j60` (constant `SHEET_ID` near line 820)
- Tabs: `bgw_en`, `bgw_cn`, `bgw_pred`, `bgw_bot_prediction`, `bgw_bot_airdrop` (object `SHEET_TABS`)

### Reads (no auth, no CORS issue)
`fetchCom(c)` hits the Google Sheets gviz CSV endpoint directly:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&sheet={tab}&t={cacheBuster}
```
Each row's second column is a JSON-encoded report payload; `parseSheetCSV()` extracts and parses them. The Google Sheet must be set to "Anyone with the link can view" for this to work.

### Writes (JSONP to GAS Web App, only from Mod mode)
The site does NOT post to the Google Sheet directly. It POSTs (JSONP-style, via `<script>` injection to bypass CORS) to a Google Apps Script Web App URL that the moderator pastes into the in-page Config bar and saves to `localStorage` as `bgw_gas_url`. Format:
```
{gasUrl}?action=save&community={com}&d={encoded JSON}&callback={cbName}
```
The GAS Web App is the same one bgw-v4 writes bot snapshots to — see `bgw-v4/CLAUDE.md` "Shared Data Pipeline" for the deployment ID. Mods can also use the in-page "Sync now" button to pull the latest from Sheets.

### Local cache
Each community's data is mirrored into `localStorage['bgw_data_{c}']` after every fetch/save, so the dashboard works offline (read-only) once the user has synced at least once. `mergeInto(c, remoteArr)` dedupes by `date` and keeps the remote version.

## GAS Apps Script source

The Google Apps Script Web App that backs writes from `bgw_report_v2.html` (JSONP GET `?action=save`) and from bgw-v4 / moew-airdrop-bot (JSON POST) lives in `gas/`. Apps Script does NOT auto-sync with git — this directory is the **canonical source**, but the running Web App is whatever was last pasted into the Apps Script editor.

- `gas/Code.gs` — backend logic: `doGet` (JSONP for HTML tool), `doPost` (Bot teams), `writeRow`, `readAll`, `setupSheets`, `testBotPost`.
- `gas/appsscript.json` — manifest. `timeZone: Asia/Shanghai`, V8 runtime, Web App `executeAs: USER_DEPLOYING` + `access: ANYONE_ANONYMOUS`.

### Required Script Property (one-time setup)

`ADMIN_TOKEN` is NOT in the source — it's fetched via `getAdminToken()` from Script Properties. To deploy:

1. Apps Script editor → ⚙️ Project Settings → Script Properties → Add property
2. Name: `ADMIN_TOKEN`, Value: the prod token (see `bgw-v4/CLAUDE.md` "Production State")

Without this, `doPost` returns `{ok:false, error:"Unauthorized"}` for every Bot push.

### Workflow for editing

Apps Script can't pull from git, so the loop is manual:
1. Edit `gas/Code.gs` here, commit, push.
2. Open the Apps Script editor for the deployed Web App project.
3. Copy the new `Code.gs` content, paste over the existing file in the editor.
4. (Optional) Run `testBotPost()` in the editor to verify.
5. **Deploy → Manage Deployments → Edit current deployment → New version** (otherwise the public Web App URL still serves the old code).

Steps 2–5 are required for changes to take effect.

## Sister Services

- **bgw-v4** (sibling repo, private) — owns the Shared Data Pipeline. Writes daily `bgw_bot_prediction` snapshots via `job_daily_snapshot` (UTC 00:30). The GAS Web App / Sheet topology and all sheet tabs are documented in `bgw-v4/CLAUDE.md` under "Shared Data Pipeline".
- **moew-airdrop-bot** (sibling repo, private) — exposes the data that bgw-v4 forwards into the `bgw_bot_airdrop` tab.
- **lark-reporter** (sibling repo, private) — the other reader of the same Google Sheet; turns the daily rows into Lark PNG cards at 9am Beijing.

## Gotchas

- **The GAS Web App URL is NOT hardcoded here.** Mods paste it into the Config bar; it's stored in `localStorage` per-browser. If you wipe localStorage you also wipe the moderator's GAS URL — they'll need to re-paste it. The default URL is in `bgw-v4/CLAUDE.md` "Shared Data Pipeline" if they lose it.
- **Asymmetric auth on GAS.** The `doPost` path (Bot teams) requires `body.token === ADMIN_TOKEN`. The `doGet ?action=save` path (HTML tool JSONP) does NOT — anyone who knows the GAS URL can write via that path. Don't ship anything sensitive into the Sheet, and treat the GAS URL itself as a moderate secret.
- **`SHEET_ID` and `SHEET_TABS` are duplicated** between this repo and `bgw-v4`/`lark-reporter`. If the sheet is ever renamed or replaced, all three need to change.
- **CSV parsing is fragile**: `parseSheetCSV` assumes exactly 3 columns with the JSON payload in column 2, doubled-`""` quote escaping. Adding columns to the Sheet (or changing column order) silently breaks reads.
- **GitHub Pages caches aggressively.** A pushed change to the HTML can take a few minutes to propagate; the cache-buster in the gviz URL (`&t={Date.now()}`) only busts the Sheets fetch, not Pages itself.
- **Two CDN deps (Chart.js 4.4.1, html2canvas 1.4.1) are hotlinked from cdnjs.** If you mirror this somewhere without internet, those need to be bundled.
