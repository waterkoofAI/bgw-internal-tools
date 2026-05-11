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

function writeRow(ss, sheetName, data) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['date', 'json', 'submitted_at']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }

  const allVals = sheet.getDataRange().getValues();
  let rowIdx = -1;
  for (let i = 1; i < allVals.length; i++) {
    if (allVals[i][0] === data.date) {
      rowIdx = i + 1;
      break;
    }
  }

  const now = new Date().toLocaleString('en-GB');
  if (rowIdx > 0) {
    // 覆盖同日记录（支持重试和回填）
    sheet.getRange(rowIdx, 1, 1, 3).setValues([[data.date, JSON.stringify(data), now]]);
  } else {
    sheet.appendRow([data.date, JSON.stringify(data), now]);
  }

  return { ok: true, date: data.date };
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
