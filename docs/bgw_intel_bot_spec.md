# BGW Intel Bot — Requirements

**Project:** Telegram intelligence/monitoring bot using Telethon user-mode
**Repo:** `waterkoofAI/bgw-intel-bot` (to be created, private)
**Deployment:** Railway, project `optimistic-illumination`, new service `bgw-intel-bot`
**Date:** 2026-05-12

---

## 1. Purpose

Use a Telegram **user account** (not a Telegram Bot) to passively monitor public TG groups and channels, then generate daily AI-summarized intelligence reports delivered via DM to the operator.

This bot is **read-only OSINT** — it never sends messages to monitored groups, never DMs anyone except the operator, never identifies itself.

---

## 2. Account Setup

| Item | Value |
|------|-------|
| Monitoring account | `@waterkoofaibot` (user account, NOT a Telegram bot — login via phone + SMS, NOT via BotFather token) |
| DM recipient | `@downcenchen` (operator's main Telegram account) |
| Telegram API credentials | api_id + api_hash from https://my.telegram.org (operator provides via Railway env vars) |
| Session storage | `.session` file persisted on `/data` volume so re-login isn't needed on restart |

**Critical:** Telegram bans accounts that send too many requests too fast. Set conservative read rate limits and don't backfill history aggressively. The user account should look like a normal lurker, not a scraper.

---

## 3. Phase 0: One-Time Historical Backfill (highest priority)

**Target:** `@runesgangalpha` (Telegram channel, last updated around 2026-05-07)

**Goal:** Generate a single comprehensive Markdown document analyzing all historical posts from this channel for reference strategies BGW can learn from.

**Tasks:**

1. Connect via Telethon, join `@runesgangalpha` if not already joined
2. Fetch **all** historical messages from the channel
3. For each message, capture:
   - timestamp
   - text content (full, not truncated)
   - reactions count
   - forwarded_from (if any)
   - links extracted from message
4. Send the entire corpus to Gemini 3.1 Pro with a prompt to:
   - Identify the channel's overall posting strategy
   - Categorize content types (alpha calls, community recap, project highlights, etc.)
   - Surface the top 20 highest-engagement posts
   - Identify key projects/tokens/themes mentioned
   - Summarize "what made this channel useful for its audience"
   - Note any patterns in posting cadence, message length, format
5. Output to: `bgw-intel-bot/output/runesgangalpha_strategy_analysis.md` (also DM the summary to `@downcenchen`)

**Trigger:** Manual one-time, via env var `RUN_NOW=backfill_runesgangalpha`.

**Token budget:** If the corpus is too large for one Gemini call, chunk it (chunk by date, e.g. 1 month per chunk, then meta-summarize the chunks). Gemini 3.1 Pro context window is large but not infinite.

**Output document structure (suggested):**

```markdown
# @runesgangalpha — Historical Strategy Analysis

**Period:** YYYY-MM-DD → 2026-05-07
**Total posts:** N
**Final post date:** 2026-05-07

## Overall posting strategy
[Gemini analysis prose]

## Content type breakdown
| Type | Count | % |
|---|---|---|
| Alpha call | ... | ... |
| Community recap | ... | ... |
| ... | ... | ... |

## Top 20 highest-engagement posts
[Sorted by reactions, with date / content excerpt / reactions count]

## Key themes
[Themes extracted by Gemini]

## Posting cadence
[Daily? Weekly? When in the day? Avg message length?]

## What worked for the audience
[Gemini's takeaway]

## Strategic notes for BGW
[Gemini suggests what we can learn / apply]
```

---

## 4. Phase 1: Daily Monitoring of @runesgang

**Target:** `@runesgang` (Telegram group)

**Schedule:** Every day at **09:00 Asia/Shanghai**, generate a summary of the past 24 hours (00:00 → 23:59 of yesterday in Asia/Shanghai).

**Tasks:**

1. **Continuous listener:** Telethon event handler stores every message from `@runesgang` into local SQLite as it arrives
   - Don't try to fetch entire history at startup (looks like scraping)
   - Just listen forward from when bot starts
   - SQLite schema includes: msg_id, timestamp, sender_id, sender_username (if available), text, reactions_count, reply_to_msg_id, forwarded_from, has_media (bool), media_caption
2. **Daily summarizer (09:00 Asia/Shanghai):**
   - Query yesterday's messages from SQLite
   - Send corpus to Gemini 3.1 Pro
   - Generate structured Markdown summary (template in section 5)
3. **Push to operator:** Send the summary as a Markdown-formatted DM to `@downcenchen`
   - If summary is >4096 chars (Telegram limit), split into multiple messages
   - Send the original Markdown file as a document attachment too (so operator can save it)

---

## 5. Daily Summary Template

```markdown
📡 **@runesgang · 2026-05-12 (yesterday)**

📊 **Stats**
- Messages: 234
- Active users: 48
- Highly-reacted messages (≥10 reactions): 3

🔥 **Main Topics** (by volume + engagement)

### 1. [Topic title] (54 related messages)
- Key claim / news / discussion point
- Notable participants: @abc, @def
- Sentiment: bullish / bearish / neutral
- Linked resources: [link1], [link2]

### 2. [Topic 2] (32 related messages)
- ...

### 3. [Topic 3] (18 related messages)
- ...

📌 **Worth Watching**
- [Insight 1: anything unusual / alpha-worthy]
- [Insight 2]

🔗 **Important Links Shared**
- [URL] — context
- [URL] — context

💬 **Notable Quotes** (3-5 highest-signal)
- "..." — @user1 14:32
- "..." — @user2 16:21

📈 **Sentiment Snapshot**
- Overall: bullish / bearish / mixed
- Around [topic]: ...
```

**Gemini prompt guidelines:**
- Output language: 中文（operator preference）
- Tone: 客观、信息密度高、不掺水
- Don't summarize "user A said X" — instead extract themes and synthesize
- Quote raw Chinese/English text verbatim when worth quoting
- Don't speculate beyond what's in the messages

---

## 6. Architecture

```
bgw-intel-bot/
├── main.py                  # Entry: env validation, Telethon client, mode dispatch
├── listener.py              # Telethon event handlers (NewMessage handler for @runesgang)
├── database.py              # SQLite schema for messages + summaries
├── summarizer.py            # Gemini wrapper: build_daily_prompt, build_backfill_prompt
├── dm_pusher.py             # Push Markdown DM to @downcenchen (with 4096-char splitting)
├── jobs.py                  # APScheduler: daily 09:00 summary job
├── backfill.py              # One-shot Phase 0 historical channel scrape + analysis
├── requirements.txt         # telethon, google-generativeai, apscheduler, tzdata
├── Dockerfile               # python:3.12-slim
├── .env.example
├── .gitignore               # includes *.session (critical — auth file)
├── README.md
├── CLAUDE.md
├── DEPLOY.md
├── tests/                   # mock tests (Telethon client mocked)
│   ├── conftest.py
│   ├── test_summarizer.py
│   ├── test_database.py
│   └── test_dm_pusher.py
└── output/                  # generated reports go here (mounted to /data/output)
    └── .gitkeep
```

---

## 7. Environment Variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `TELEGRAM_API_ID` | yes | `12345678` | From my.telegram.org |
| `TELEGRAM_API_HASH` | yes | `abc123...` | From my.telegram.org |
| `TELEGRAM_PHONE` | yes | `+1234567890` | The phone for @waterkoofaibot |
| `OPERATOR_USERNAME` | yes | `downcenchen` | Without @, recipient of DM summaries |
| `MONITOR_GROUP` | yes | `runesgang` | Without @, the group to monitor |
| `BACKFILL_CHANNEL` | yes | `runesgangalpha` | Without @, channel for Phase 0 |
| `GEMINI_API_KEY` | yes | `AIza...` | Same key as Lark Reporter, reused |
| `GEMINI_MODEL` | no | `gemini-3.1-pro` | Pro for detailed transcripts; flash-lite too lossy |
| `TIMEZONE` | no | `Asia/Shanghai` | All scheduling in this TZ |
| `DAILY_SUMMARY_TIME` | no | `09:00` | When to push daily summary |
| `DB_PATH` | no | `/data/intel.db` | Railway volume mount |
| `SESSION_PATH` | no | `/data/intel.session` | Telethon session file |
| `OUTPUT_DIR` | no | `/data/output` | Where one-shot reports are written |
| `LOG_LEVEL` | no | `INFO` | DEBUG for verbose |
| `RUN_NOW` | no | `backfill_runesgangalpha` / `daily_summary` / (unset) | One-shot mode for testing |
| `DRY_RUN` | no | `0` | If `1`, log summaries but don't send DM |
| `MONTHLY_GEMINI_BUDGET_USD` | no | `30` | Soft cap; log warning when approached, don't auto-stop |

---

## 8. First-Time Login Flow

Telethon requires interactive auth on first run (SMS code). This is awkward on Railway.

**Recommended approach:**

1. Operator runs `python main.py` **once locally** with all env vars set
2. On first run, Telethon prompts for SMS code in stdout — operator enters it
3. Telethon writes `intel.session` file containing the persistent session
4. Operator uploads `intel.session` to the Railway volume manually (via railway CLI or a one-shot setup script)
5. From then on, Railway service uses the existing session, no SMS prompts

Alternative if local Python is blocked: Use Telethon's `StringSession` and dump the session string to an env var. Bot reads `STRING_SESSION` env var if set.

DEPLOY.md must cover both options.

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Account ban from aggressive scraping | Conservative reads, listen-forward only (don't backfill @runesgang history). Phase 0 backfill of @runesgangalpha is one-time, paginate slowly (1 page per 2 sec). |
| Telethon API changes | Pin `telethon==1.36.0` (latest stable as of 2026-05) |
| SMS auth required mid-run | Session file persisted; only re-auth on hard logout. Alert operator via DM if re-auth needed. |
| 2FA password set on account | Support env var `TELEGRAM_2FA_PASSWORD` for accounts with 2FA. |
| Group becomes private | Log error and notify operator via DM; don't crash. |
| Gemini API failure | Retry once, then fall back to "raw message list" DM if summary generation fails. Don't lose the data. |
| Excessive logging | LOG_LEVEL=INFO by default, don't log message contents (privacy hygiene + log size). |
| Subpoena / legal | Document that this is OSINT on public groups; messages are stored max 30 days, then auto-deleted. |

---

## 10. Data Retention

- **Raw messages in SQLite:** keep 30 days, daily cleanup job at 03:00 deletes older
- **Daily summary Markdowns in `/data/output`:** keep indefinitely (small, useful)
- **Phase 0 output:** keep indefinitely
- **Telethon session:** keep until invalid

---

## 11. Privacy & Compliance Notes

- This bot monitors public groups. Operator confirms acceptance of legal/ethical responsibility.
- Bot **does not**:
  - DM anyone in the group
  - Send messages to the monitored group
  - Share collected data outside the operator's own DM channel
  - Store personally identifying info beyond usernames (no real names, no phone numbers, no wallet addresses)
- All raw message data auto-purges after 30 days.

---

## 12. Stage Roadmap

- **Stage A** — Scaffold + Telethon connect + session persistence + `/ping` operator command (DM-only)
- **Stage B** — Listener: subscribe to @runesgang, write incoming messages to SQLite
- **Stage C** — Phase 0 backfill: scrape @runesgangalpha + Gemini analysis + DM
- **Stage D** — Phase 1 daily summary: APScheduler job at 09:00 + Gemini + DM
- **Stage E** — Tests + DEPLOY.md + CI

Each Stage stops for operator review before next Stage starts.

---

## 13. Acceptance

- ✅ Phase 0: A polished `.md` file analyzing @runesgangalpha history, delivered to operator DM as both text and document attachment
- ✅ Phase 1: First daily summary arrives in operator DM at 09:00 day-after-deployment, matches template
- ✅ No alerts about session expiry, rate limits, or API errors during first 7 days
- ✅ Operator can run `/ping` in DM and get a response within 5 seconds confirming bot is alive
