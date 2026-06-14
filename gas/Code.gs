/**
 * BGW Report Backend — v2.0
 *
 * 支持两种数据源：
 * 1. HTML 工具（bgw_report_v2.html）通过 JSONP GET 读写社区日报
 * 2. Bot 团队通过 POST JSON 推 Bot 每日快照
 *
 * 数据存储：Google Sheet 各 tab，每行一天，第二列是 JSON
 * - bgw_en / bgw_cn / bgw_pred — 社区日报（HTML 工具填）
 * - bgw_bot_prediction / bgw_bot_airdrop — Bot 自动推送的日快照
 */

const SHEET_ID = '1Q03YZxG1EGs1aDmLOXoz3tGOiBot8_bNt_FfQDS2j60';

// ADMIN_TOKEN 来源于 Script Properties，不硬编码在源码里。
// 一次性设置：Apps Script 编辑器 → ⚙️ Project Settings → Script Properties → Add property
//             Property: ADMIN_TOKEN, Value: <prod 值，见 bgw-v4/CLAUDE.md>
function getAdminToken() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
}

const COMMUNITY_WHITELIST = ['en', 'cn', 'pred', 'bot_prediction', 'bot_airdrop'];
const TAB_PREFIX = {
  en: 'bgw_en',
  cn: 'bgw_cn',
  pred: 'bgw_pred',
  bot_prediction: 'bgw_bot_prediction',
  bot_airdrop: 'bgw_bot_airdrop'
};

// ════════════════════════════════════════════════════════════════
// doGet：HTML 工具用，JSONP 读/写
// ════════════════════════════════════════════════════════════════
function doGet(e) {
  const callback = e.parameter.callback || '';
  try {
    const action = e.parameter.action || 'get';
    const community = e.parameter.community || 'en';

    if (!COMMUNITY_WHITELIST.includes(community)) {
      return respond({ ok: false, error: 'Invalid community: ' + community }, callback);
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetName = TAB_PREFIX[community];

    if (action === 'save') {
      // HTML 工具 JSONP 写入
      const data = JSON.parse(decodeURIComponent(e.parameter.d));
      const result = writeRow(ss, sheetName, data);
      return respond(result, callback);
    } else {
      // HTML 工具 JSONP 读取
      const reports = readAll(ss, sheetName);
      return respond(reports, callback);
    }
  } catch(err) {
    return respond({ ok: false, error: err.toString() }, callback);
  }
}

// ════════════════════════════════════════════════════════════════
// doPost：Bot 团队用，JSON POST 推日快照
// ════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    // 解析 body
    let body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch(err) {
      return respondJson({ ok: false, error: 'Invalid JSON body' });
    }

    // 鉴权
    if (body.token !== getAdminToken()) {
      return respondJson({ ok: false, error: 'Unauthorized' });
    }

    // 白名单
    const community = body.community;
    if (!COMMUNITY_WHITELIST.includes(community)) {
      return respondJson({ ok: false, error: 'Invalid community: ' + community });
    }

    // 数据必须有 date 字段
    const data = body.data;
    if (!data || !data.date) {
      return respondJson({ ok: false, error: 'Missing data.date' });
    }

    // 写入
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheetName = TAB_PREFIX[community];
    const result = writeRow(ss, sheetName, data);
    return respondJson(result);

  } catch(err) {
    return respondJson({ ok: false, error: err.toString() });
  }
}

// ════════════════════════════════════════════════════════════════
// 共享工具函数
// ════════════════════════════════════════════════════════════════

// ── date-merge 坑修复 helpers (2026-06-15) ──────────────────────────────
// Sheets silently coerces a "YYYY-MM-DD" string into a Date cell. The old lookup
// `allVals[i][0] === data.date` compared a Date object to a string → always false →
// every writer APPENDED a duplicate row instead of merging. Real-world damage: cn
// 2026-06-13 ended up with two rows (bot objective + mod subjective), and the daily
// report read only the first → showed 待补 even though the mods HAD filled their scores.
function normDate_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz || 'UTC', 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

// Like mergeRow but skips empty incoming values (null/''/[]), so collapsing a bot row
// with a mod row keeps each side's real values instead of a blank clobbering a real one.
function mergeNonEmpty_(a, b) {
  const m = Object.assign({}, a || {});
  for (const k in b) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
    const v = b[k];
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'notes' && v && typeof v === 'object' && !Array.isArray(v)) {
      m.notes = Object.assign({}, (a && a.notes) || {}, v);
      continue;
    }
    m[k] = v;
  }
  return m;
}

// ONE-TIME cleanup: collapse pre-fix duplicate-date rows into one merged row per date.
// Run manually from the Apps Script editor ONCE after deploying (Run → dedupeAllTabs).
function dedupeAllTabs() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tz = ss.getSpreadsheetTimeZone();
  Object.keys(TAB_PREFIX).forEach(function (community) {
    const sheet = ss.getSheetByName(TAB_PREFIX[community]);
    if (!sheet || sheet.getLastRow() < 2) return;
    const vals = sheet.getDataRange().getValues();
    const byDate = {};
    for (let i = 1; i < vals.length; i++) {
      const d = normDate_(vals[i][0], tz);
      if (!d) continue;
      let obj = {};
      try { obj = vals[i][1] ? JSON.parse(vals[i][1]) : {}; } catch (e) { obj = {}; }
      byDate[d] = byDate[d] ? mergeNonEmpty_(byDate[d], obj) : obj;
    }
    const dates = Object.keys(byDate).sort();
    const out = dates.map(function (d) {
      const j = Object.assign({}, byDate[d]); j.date = d;
      return [d, JSON.stringify(j), new Date().toISOString()];
    });
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
    if (out.length) {
      sheet.getRange(2, 1, out.length, 1).setNumberFormat('@');
      sheet.getRange(2, 1, out.length, 3).setValues(out);
    }
    Logger.log(TAB_PREFIX[community] + ': ' + (vals.length - 1) + ' rows -> ' + out.length + ' dates');
  });
}

function writeRow(ss, sheetName, data) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['date', 'json', 'submitted_at']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  // date-merge 坑修复: normalize both sides for the lookup; pin the date cell to text
  // on write so it can never be re-coerced to a Date again.
  const tz = ss.getSpreadsheetTimeZone();
  const allVals = sheet.getDataRange().getValues();
  let rowIdx = -1;
  let existing = null;
  for (let i = 1; i < allVals.length; i++) {
    if (normDate_(allVals[i][0], tz) === data.date) {
      rowIdx = i + 1;
      try {
        existing = allVals[i][1] ? JSON.parse(allVals[i][1]) : null;
      } catch (e) {
        existing = null;
      }
      break;
    }
  }

  const merged = mergeRow(existing, data);
  const now = new Date().toLocaleString('en-GB');
  const targetRow = rowIdx > 0 ? rowIdx : sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1).setNumberFormat('@');   // date column = plain text
  sheet.getRange(targetRow, 1, 1, 3).setValues([[data.date, JSON.stringify(merged), now]]);

  return { ok: true, date: data.date };
}

/**
 * Field-level merge of incoming into existing.
 *
 * Rules:
 *  - Fields NOT present in `incoming` keep their value from `existing`.
 *  - Fields present in `incoming` overwrite — including explicit `null`, `0`,
 *    empty string, or empty array, which are all treated as meaningful values.
 *    (e.g. sat_avg=null means "fewer than 3 votes, low confidence" per spec;
 *    complaints=[] means "no complaints today, replace yesterday's list".)
 *  - `date` is the row key, never overwritten. `submitted_at` is always set
 *    to "now" on every merge so consumers can tell when the row last changed.
 *  - `notes` is shallow-merged: keys present in incoming.notes overwrite,
 *    keys only in existing.notes are kept. Pass `notes: null` (not an object)
 *    if you want to actually clear notes.
 *  - Arrays (complaints, mod_scores) are NOT merged — they're replaced wholesale
 *    when present, because element identity in those lists isn't well-defined.
 */
function mergeRow(existing, incoming) {
  if (!existing) {
    // No prior row — store incoming as-is, but normalize submitted_at.
    const fresh = Object.assign({}, incoming);
    fresh.submitted_at = new Date().toISOString();
    return fresh;
  }

  const merged = Object.assign({}, existing);

  for (const key in incoming) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    if (key === 'date') continue;       // immutable row key
    if (key === 'submitted_at') continue; // we set this ourselves below
    const val = incoming[key];
    if (val === undefined) continue;    // not present in the payload

    // Shallow-merge notes when it's a plain object on both sides
    if (key === 'notes' && val && typeof val === 'object' && !Array.isArray(val)) {
      const existingNotes = (existing.notes && typeof existing.notes === 'object' && !Array.isArray(existing.notes))
        ? existing.notes : {};
      merged.notes = Object.assign({}, existingNotes, val);
      continue;
    }

    // Everything else: take the incoming value verbatim (null / 0 / [] / "" all pass through).
    merged[key] = val;
  }

  merged.date = existing.date;
  merged.submitted_at = new Date().toISOString();
  return merged;
}

function readAll(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const vals = sheet.getDataRange().getValues();
  const reports = [];
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][1]) {
      try {
        reports.push(JSON.parse(vals[i][1]));
      } catch(err) {}
    }
  }
  reports.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return reports;
}

function respond(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function respondJson(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// ════════════════════════════════════════════════════════════════
// 一次性初始化：跑这个建好所有 tab
// ════════════════════════════════════════════════════════════════
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabs = ['bgw_en', 'bgw_cn', 'bgw_pred', 'bgw_bot_prediction', 'bgw_bot_airdrop'];
  tabs.forEach(name => {
    if (!ss.getSheetByName(name)) {
      const sheet = ss.insertSheet(name);
      sheet.appendRow(['date', 'json', 'submitted_at']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
      Logger.log('Created tab: ' + name);
    } else {
      Logger.log('Tab already exists: ' + name);
    }
  });
}

// ════════════════════════════════════════════════════════════════
// mergeRow unit tests — run any test_merge_case_* from the Apps Script editor.
// Each prints PASS / FAIL via Logger; check the execution log to verify.
// ════════════════════════════════════════════════════════════════
function _assertEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    Logger.log('  PASS ' + label);
    return true;
  }
  Logger.log('  FAIL ' + label + '\n    expected: ' + e + '\n    actual:   ' + a);
  return false;
}

// Case 1: Bot pushes first, Mod submits later without the 6 bot fields.
// Bot's quantitative fields must survive; Mod's qualitative fields are added.
function test_merge_case_1() {
  Logger.log('test_merge_case_1: Bot first, Mod later');
  const existing = {
    date: '2026-05-12',
    members_total: 130413, members_new: 145,
    messages: 185, active: 23,
    sat_avg: 4.2, sat_votes: 18,
    submitted_at: '2026-05-12T00:00:00Z'
  };
  const incoming = {
    date: '2026-05-12', community: 'en',
    mod: 'Alice, Bob', mods: ['Alice', 'Bob'],
    mod_scores: [{name: 'Alice', score: 9}, {name: 'Bob', score: 8}],
    mod_score: 9,
    complaints: [{type: 'spam', count: 3, speed: '<5 min'}],
    notes: {topic: 'NFT drop', highlights: 'Quiet day'}
  };
  const r = mergeRow(existing, incoming);
  _assertEq('bot.members_total preserved', r.members_total, 130413);
  _assertEq('bot.members_new preserved',   r.members_new,   145);
  _assertEq('bot.messages preserved',      r.messages,      185);
  _assertEq('bot.active preserved',        r.active,        23);
  _assertEq('bot.sat_avg preserved',       r.sat_avg,       4.2);
  _assertEq('bot.sat_votes preserved',     r.sat_votes,     18);
  _assertEq('mod.mod_score added',         r.mod_score,     9);
  _assertEq('mod.complaints added',        r.complaints,    [{type: 'spam', count: 3, speed: '<5 min'}]);
  _assertEq('mod.notes added',             r.notes,         {topic: 'NFT drop', highlights: 'Quiet day'});
}

// Case 2: Mod fills first, Bot pushes later with only its 6 fields.
// Mod's qualitative fields must survive; Bot's fields overwrite (no prior bot data).
function test_merge_case_2() {
  Logger.log('test_merge_case_2: Mod first, Bot later');
  const existing = {
    date: '2026-05-12', community: 'en',
    mod: 'Alice', mods: ['Alice'], mod_scores: [{name: 'Alice', score: 8}], mod_score: 8,
    complaints: [{type: 'wallet', count: 2, speed: '5–15 min'}],
    notes: {topic: 'Wallet questions', highlights: 'None'},
    submitted_at: '2026-05-12T10:00:00Z'
  };
  const incoming = {
    date: '2026-05-12',
    members_total: 130413, members_new: 145,
    messages: 185, active: 23,
    sat_avg: 4.2, sat_votes: 18
  };
  const r = mergeRow(existing, incoming);
  _assertEq('mod.mod_score preserved',  r.mod_score,  8);
  _assertEq('mod.complaints preserved', r.complaints, [{type: 'wallet', count: 2, speed: '5–15 min'}]);
  _assertEq('mod.notes preserved',      r.notes,      {topic: 'Wallet questions', highlights: 'None'});
  _assertEq('bot.members_total added',  r.members_total, 130413);
  _assertEq('bot.sat_avg added',        r.sat_avg,    4.2);
}

// Case 3: Bot pushes sat_avg=null, sat_votes=2 (low confidence, fewer than 3 votes).
// null must be preserved as null, NOT dropped or converted.
function test_merge_case_3() {
  Logger.log('test_merge_case_3: explicit null preserves as null');
  const existing = {
    date: '2026-05-12',
    sat_avg: 4.5, sat_votes: 10,
    submitted_at: '2026-05-12T08:00:00Z'
  };
  const incoming = { date: '2026-05-12', sat_avg: null, sat_votes: 2 };
  const r = mergeRow(existing, incoming);
  _assertEq('null overwrites 4.5', r.sat_avg, null);
  _assertEq('sat_votes overwrites', r.sat_votes, 2);
}

// Case 4: Mod sets complaints to empty array — must be stored as [], not dropped.
function test_merge_case_4() {
  Logger.log('test_merge_case_4: empty array overwrites');
  const existing = {
    date: '2026-05-12',
    complaints: [{type: 'spam', count: 5, speed: '<5 min'}],
    submitted_at: '2026-05-12T08:00:00Z'
  };
  const incoming = { date: '2026-05-12', complaints: [] };
  const r = mergeRow(existing, incoming);
  _assertEq('complaints replaced with []', r.complaints, []);
}

// Case 5: notes shallow-merge — keys only in existing.notes are kept,
// keys present in incoming.notes overwrite.
function test_merge_case_5() {
  Logger.log('test_merge_case_5: notes shallow merge');
  const existing = {
    date: '2026-05-12',
    notes: {topic: 'A', highlights: 'B'},
    submitted_at: '2026-05-12T08:00:00Z'
  };
  const incoming = { date: '2026-05-12', notes: {topic: 'C'} };
  const r = mergeRow(existing, incoming);
  _assertEq('notes.topic overwritten', r.notes.topic, 'C');
  _assertEq('notes.highlights kept',   r.notes.highlights, 'B');
}

// Runs all 5 cases in one go for convenience.
function test_merge_all() {
  test_merge_case_1();
  test_merge_case_2();
  test_merge_case_3();
  test_merge_case_4();
  test_merge_case_5();
  Logger.log('--- All merge tests done. Scroll up to check for any FAIL lines. ---');
}

// ════════════════════════════════════════════════════════════════
// 测试函数：在 GAS 编辑器里手动跑，验证 POST 能正常工作
// ════════════════════════════════════════════════════════════════
function testBotPost() {
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        token: getAdminToken(),
        community: 'bot_prediction',
        data: {
          date: '2026-05-11',
          users_total: 3362,
          users_new: 642,
          wallets_connected_total: 1395,
          wallets_connected_new: 280,
          paper_traders_total: 41,
          paper_traders_new: 8,
          real_traders_total: 1,
          real_traders_new: 0,
          paper_trades_today: 132,
          real_trades_today: 0,
          points_issued_today: 12450,
          points_spent_today: 0,
          pool_remaining_pts: 974000,
          pool_remaining_usd: 4870,
          submitted_at: '2026-05-12T00:00:00Z'
        }
      })
    }
  };
  const result = doPost(mockEvent);
  Logger.log(result.getContent());
}
