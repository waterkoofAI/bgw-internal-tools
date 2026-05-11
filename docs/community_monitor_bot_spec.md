# Community Monitor Bot — Requirements

**To:** Bot 团队
**From:** Dashboard 团队
**Date:** 2026-05-11
**Target launch:** 2026-05-25 (W6)

---

## 1. 目的

让 Mod 每天少填 60% 的数据。现在 Mod 每天要填 9 个字段（成员、消息、活跃、满意度、Mod 评分、客诉、备注等），其中 6 个是**纯量化数据**，完全可以 Bot 自动采集。

加上 Bot 后：
- **Bot 自动填**：总成员、新增、消息数、活跃用户、满意度均分、满意度投票数
- **Mod 手动填**：Mod 评分、客诉记录、备注（这3项需要人判断）

---

## 2. 部署形式

**两个独立 Bot 实例**（建议，便于权限隔离）：
- `@BGW_EN_Monitor` — 加入 EN 社区群
- `@BGW_CN_Monitor` — 加入中文社区群

或者**单一 Bot 两个群**（也行），只要每天能区分推送到不同的 Sheet tab 即可。

---

## 3. 字段映射

数据源 → Google Sheet 字段（每天 UTC 0:00 推送，覆盖当天记录）：

| Sheet 字段 | 数据源 | 采集方式 |
|------------|--------|---------|
| `members_total` | Telegram API `getChatMembersCount` | 每天 23:50 调一次 |
| `members_new` | 今日 `members_total` - 昨日 `members_total` | 计算 |
| `messages` | 消息监听器累加 | 每条消息 +1，每天 23:59 归零 |
| `active` | 唯一发送者去重 | Set\<user_id\>.size |
| `sat_avg` | 满意度投票均值 | Bot 发投票 → 收集结果 |
| `sat_votes` | 满意度投票总票数 | Bot 收集 |

**留空字段**（Mod 填）：`mod`, `mods`, `mod_scores`, `mod_score`, `complaints`, `notes`

---

## 4. 满意度投票交互设计

**每天定时发起投票（建议时间：当地时间 20:00）**

格式：Telegram Poll（原生投票，参与门槛低）

EN 版本：
```
🌟 Daily Community Pulse — How was your experience today?

⭐⭐⭐⭐⭐ Excellent
⭐⭐⭐⭐ Good
⭐⭐⭐ Average
⭐⭐ Poor
⭐ Bad

(Anonymous · Closes in 24h)
```

CN 版本：
```
🌟 今日社区体验如何？

⭐⭐⭐⭐⭐ 非常满意
⭐⭐⭐⭐ 满意
⭐⭐⭐ 一般
⭐⭐ 不太满意
⭐ 不满意

(匿名 · 24小时后关闭)
```

**收集逻辑：**
- 投票关闭时拉取结果
- `sat_avg` = sum(stars × votes) / total_votes，保留1位小数
- `sat_votes` = total_votes
- 如果当天投票数 < 3，标记 `sat_avg: null`（数据不足，不显示）

---

## 5. GAS POST 接口

已存在的 GAS 接口（你们之前用过的同一个）。

> ⚠️ **实际的 GAS URL 和 token 不在此文档里**——Bot 团队找 Dashboard 团队（DM 我）拿，或者从你们已有的 prediction-bot / airdrop-bot 部署环境变量里复用同一对值。**不要把 token 硬编码到 commit 进公开 repo 的代码或文档里。**

```
POST <GAS_URL>

{
  "token": "<ADMIN_TOKEN>",
  "community": "en",
  "data": {
    "date": "2026-05-11",
    "members_total": 130413,
    "members_new": 145,
    "messages": 185,
    "active": 234,
    "sat_avg": 4.2,
    "sat_votes": 18
  }
}
```

**关键约定：**
- `community` 必须是 `en` 或 `cn`
- `data.date` 必填（YYYY-MM-DD）
- 同一天重复 POST 会**覆盖**已有记录，但 GAS 现在会**保留 Mod 已填字段**（complaints / mod_scores / notes / mod 等），只覆盖你们推的6个字段

**Mod 填表流程不变**：他们继续用 HTML 工具填，但 quantitative 字段会自动被 Bot 数据覆盖（Bot 优先 vs Mod 优先的逻辑下面 6 节说）。

---

## 6. 数据合并逻辑（重要）

每天可能出现 3 种情况：
1. **Mod 先填，Bot 后推**（常见）：Bot 覆盖 6 个量化字段，保留 Mod 的质化字段
2. **Bot 先推，Mod 后填**：Mod 填表时不要覆盖 Bot 已推的量化字段
3. **只有 Bot 推没有 Mod 填**：那天就只有量化数据，质化字段为空

**简化方案（你们这边）：**
- Bot POST 时只推 6 个字段，**不要**推 `complaints` / `mod_scores` / `notes` 等
- GAS 那边我会改逻辑：保留旧记录里的 Mod 填写字段（merge 而不是 overwrite）

GAS 那边的合并逻辑由我（Dashboard 团队）负责调整，你们不用管。你们只管推自己负责的 6 个字段。

---

## 7. 违规检测（可选，Phase 2）

不在首次交付范围内，留作未来扩展：
- 关键词黑名单（scam / 跑路 / 钓鱼链接）触发 → DM CM
- 消息洪水检测 → DM CM

---

## 8. 时间表

| 周 | 任务 |
|----|------|
| W3 (5/4–5/10) | 已收尾 Prediction Bot 和 Airdrop Bot |
| W4 (5/11–5/17) | 你们休息 / 收尾 |
| W5 (5/18–5/24) | **Community Monitor Bot 开发** |
| W6 (5/25–5/31) | **5/25 上线** + Bug fix |

---

## 9. 验收标准

**5/25 当天：**
1. Bot 加入 EN/CN 两个群，能正常监听消息
2. 当天 23:50 自动调 `getChatMembersCount` 拿到成员数
3. 当天 20:00 发起满意度投票，能收集到至少 3 票
4. UTC 0:00 推数据到 GAS，Dashboard 能看到当日的 6 个字段已填
5. Mod 当天用 HTML 工具填表时，提交后 6 个量化字段保持 Bot 推的值不被覆盖

---

## 10. 我会做的配套工作

- 改 GAS 脚本，让 POST 时做字段级合并而不是整条覆盖
- 改 Dashboard 工具，让 Mod 看到 "已由 Bot 自动填充" 的提示，减少他们重复填的动机
- 改 Mod 填表表单，把 Bot 字段标灰、显示为只读（防止误填）

时间表上我会在 W5 完成，跟你们同步上线。

---

## 11. 任何疑问

字段语义不清、API 限制、Telegram Bot 框架选型，DM 我直接问。
