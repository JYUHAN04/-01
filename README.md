# Railway Deployment

## Files
- `server.js`: Node.js entry file
- `index.html`: frontend page
- `realtime-addon.css`: realtime feature styles
- `realtime-addon.js`: frontend realtime logic and mobile reconnect logic
- `package.json`: npm dependencies and start script
- `.env.example`: local environment variable example

## Start Command

```bash
node server.js
```

Railway can also use the npm start script:

```bash
npm start
```

## Required Railway Variables

Set exactly these variables in Railway:

```text
PORT
AUTH_SECRET
COUPLE_A_USERNAME
COUPLE_A_PASSWORD
COUPLE_A_NAME
COUPLE_B_USERNAME
COUPLE_B_PASSWORD
COUPLE_B_NAME
```

## Deploy
1. Push this folder to GitHub.
2. Railway -> `New Project` -> `Deploy from GitHub repo`.
3. Select the repository.
4. Add the required variables above.
5. Deploy and open the public Railway URL on mobile.

## Added / Modified Areas
- `realtime-addon.js`
  - Added dynamic identity rendering: account A sees A as `我` and B as `宝宝`; account B sees B as `我` and A as `宝宝`.
  - Expanded the quiz and truth-or-dare banks into `日常温柔`, `甜蜜暧昧`, and `趣味整活`.
  - Added synced truth-or-dare, date wheel, fortune draw, and long-distance pulse relay.
  - Wrapped existing dice/wheel games with lightweight feedback while preserving original behavior.
- `server.js`
  - Added Railway-safe persisted state fields for the new synced games.
  - Added WebSocket operation handlers for the new synced game actions.
- `realtime-addon.css`
  - Added responsive mobile styles and animation feedback for the new game widgets.

## Added / Modified Areas In v2.3.0
- `realtime-addon.js`
  - [新增] 延时信笺、限时悄悄话、共享时间胶囊、云陪伴自习房间、偏爱记录本、情绪光谱日历、和解契约、引力值、相遇轨迹地图、回忆抽签机、共同成长目标。
  - [新增] 默契拍卖场、命运选择题，并接入和解契约锁定逻辑。
  - [新增] 相册分类增强视图，保留原相册与 JSON 导入导出。
  - [修改] 双主题改为 A/B 账号独立云端保存。
- `server.js`
  - [新增] 第二批模块的持久化字段与 WebSocket 操作处理。
  - [新增] 延时信笺、时间胶囊、限时悄悄话的服务端可见性过滤。
  - [新增] 引力值奖励与和解契约游戏锁定校验。
- `realtime-addon.css`
  - [新增] 新模块移动端布局、暗夜主题适配、引力值特效、轨迹地图动画。
