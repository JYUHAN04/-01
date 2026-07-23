# 情侣实时同步网站 Railway 版

## 项目文件
- `server.js`：Node.js 后端入口，启动命令固定为 `node server.js`
- `index.html`：保留原页面和全部原有功能
- `realtime-addon.js`：A/B 登录、动态人称、WebSocket 双向同步、离线队列、新增互动模块
- `realtime-addon.css`：卡通小狗手绘风 UI、暗夜/马卡龙主题、移动端和 iOS/PWA 适配
- `package.json`：Railway 构建依赖与 `start` 脚本
- `.env.example` / `env.example`：本地变量示例，部署时读取平台环境变量

## Railway 启动
Railway 会读取 `package.json`：

```bash
npm start
```

实际执行：

```bash
node server.js
```

服务监听 `0.0.0.0`，端口读取 Railway 动态注入的 `PORT`。

## 必填环境变量
在 Railway 服务的 Variables 中填写：

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

示例：

```text
AUTH_SECRET=please-change-to-a-long-random-secret
COUPLE_A_USERNAME=A
COUPLE_A_PASSWORD=a5201314
COUPLE_A_NAME=角色A
COUPLE_B_USERNAME=B
COUPLE_B_PASSWORD=b5201314
COUPLE_B_NAME=角色B
```

## 本次新增/修改标注
- `[删除冗余模块]`：五大板块收拢、旧相册入口隐藏、老工具/老游戏/老设置折叠保留。
- `[UI改动区域]`：小狗手绘卡片、黑色描边、马卡龙/暗夜主题、手机输入稳定和设置中心教程。
- `[新增功能代码]`：延时信笺、时间胶囊、云自习、偏爱记录、情绪日历、和解契约、拍卖场、命运选择题、一次性悄悄话、引力值、相遇地图、回忆抽签、成长目标等。

## 最简部署步骤
1. 把整个项目文件夹推送到 GitHub。
2. Railway 新建项目，选择该 GitHub 仓库。
3. Variables 按上方清单填写 8 个变量。
4. Start Command 使用 `npm start` 或 `node server.js`。
5. 部署完成后，打开 Railway 生成的公网域名，两台手机访问同一网址登录 A/B 账号即可实时同步。
