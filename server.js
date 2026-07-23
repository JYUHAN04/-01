"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "love-state.json");
const AUTH_SECRET = readEnv("AUTH_SECRET", "dev-secret-change-me");
const HEARTBEAT_INTERVAL = 30000;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_WS_PAYLOAD = 100 * 1024 * 1024;
const ROLE_IDS = ["A", "B"];
const PREFERENCE_FIELD_KEYS = ["likes", "avoid", "triggers", "comfort"];
const CORS_BASE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function readEnv(name, fallback) {
  const value = process.env[name];
  if (value && String(value).trim()) return String(value).trim();
  // Railway variables are still preferred, but defaults keep zero-variable deploys usable.
  return fallback;
}

const accounts = [
  {
    id: "A",
    username: readEnv("COUPLE_A_USERNAME", "A"),
    password: readEnv("COUPLE_A_PASSWORD", "a5201314"),
    name: readEnv("COUPLE_A_NAME", "情侣A")
  },
  {
    id: "B",
    username: readEnv("COUPLE_B_USERNAME", "B"),
    password: readEnv("COUPLE_B_PASSWORD", "b5201314"),
    name: readEnv("COUPLE_B_NAME", "情侣B")
  }
];

const clients = new Map();
let state = loadState();

fs.mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      return sendNoContent(res, req.headers.origin);
    }

    if (req.method === "GET" && requestUrl.pathname === "/health") {
      return sendJson(res, 200, {
        ok: true,
        revision: state.revision,
        clients: clients.size,
        updatedAt: state.updatedAt
      });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/login") {
      const body = await readJsonBody(req);
      const account = accounts.find((item) => item.username === String(body.username || "").trim());

      if (!account || account.password !== String(body.password || "")) {
        return sendJson(res, 401, { ok: false, error: "账号或密码不正确" });
      }

      const user = { id: account.id, username: account.username, name: account.name };
      return sendJson(res, 200, {
        ok: true,
        token: signToken(user),
        user,
        snapshot: publicSnapshot(user)
      });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/state") {
      const user = authenticateHttp(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "未登录或登录已过期" });
      return sendJson(res, 200, { ok: true, snapshot: publicSnapshot(user) });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/op") {
      const user = authenticateHttp(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "未登录或登录已过期" });
      const op = await readJsonBody(req);
      const applied = applyOperation(normalizeOperation(op, user));
      broadcastOperation(applied);
      return sendJson(res, 200, { ok: true, op: sanitizeOperationForUser(applied, user), snapshot: publicSnapshot(user) });
    }

    return serveStatic(requestUrl.pathname, res, req.headers.origin);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: "服务器内部错误" });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

server.on("upgrade", (req, socket, head) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (requestUrl.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const user = verifyToken(requestUrl.searchParams.get("token"));
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, user);
  });
});

wss.on("connection", (ws, req, user) => {
  const clientId = crypto.randomUUID();
  clients.set(clientId, {
    id: clientId,
    ws,
    user,
    connectedAt: new Date().toISOString(),
    activity: "在线"
  });
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.send(JSON.stringify({
    type: "welcome",
    clientId,
    user,
    snapshot: publicSnapshot(user),
    presence: presenceList()
  }));

  broadcastPresence();

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString());

      if (message.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
        return;
      }

      if (message.type === "presence.activity") {
        const client = clients.get(clientId);
        if (client) {
          client.activity = String(message.activity || "正在操作").slice(0, 80);
          client.activityAt = new Date().toISOString();
        }
        broadcastPresence();
        return;
      }

      if (message.type === "op") {
        const applied = applyOperation(normalizeOperation(message.op || {}, user));
        broadcastOperation(applied);
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", error: "消息格式不正确" }));
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
    broadcastPresence();
  });
});

const heartbeat = setInterval(() => {
  for (const client of clients.values()) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (!client.ws.isAlive) {
      client.ws.terminate();
      continue;
    }
    client.ws.isAlive = false;
    try {
      client.ws.ping();
    } catch (error) {
      client.ws.terminate();
    }
  }
}, HEARTBEAT_INTERVAL);

server.on("close", () => {
  clearInterval(heartbeat);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Couple realtime site is running at http://localhost:${PORT}`);
});

function serveStatic(urlPath, res, origin) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const absolutePath = path.normalize(path.join(ROOT, requested));

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403, corsHeaders(origin));
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, data) => {
    if (error) {
      res.writeHead(404, {
        ...corsHeaders(origin),
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      ...corsHeaders(origin),
      "Content-Type": MIME[path.extname(absolutePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    ...CORS_BASE_HEADERS,
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(data));
}

function sendNoContent(res, origin) {
  res.writeHead(204, corsHeaders(origin));
  res.end();
}

function corsHeaders(origin) {
  if (!origin || origin === "null") return CORS_BASE_HEADERS;
  return {
    ...CORS_BASE_HEADERS,
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin"
  };
}

function authenticateHttp(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return verifyToken(token);
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    user,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature || "");
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed.user;
  } catch (error) {
    return null;
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return mergeServerState(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
    }
  } catch (error) {
    console.warn("Cannot read existing state, a new one will be created.", error);
  }
  return mergeServerState({});
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, STATE_FILE);
}

function mergeServerState(input) {
  const realtime = deepMerge(defaultRealtimeState(), input.realtime || {});
  realtime.preferenceBook = normalizePreferenceBook(realtime.preferenceBook);
  const defaults = {
    schema: 2,
    revision: 0,
    updatedAt: "",
    lastActor: null,
    legacy: null,
    realtime: defaultRealtimeState(),
    history: []
  };

  return {
    ...defaults,
    ...input,
    realtime,
    history: Array.isArray(input.history) ? input.history.slice(-200) : []
  };
}

function defaultRealtimeState() {
  return {
    schema: 2,
    theme: "macaron",
    // [新增] A/B 独立主题偏好，同时保留旧 theme 字段兼容旧客户端。
    themePrefs: { A: "macaron", B: "macaron" },
    moods: {},
    tasks: [],
    tree: {
      level: 1,
      water: 0,
      totalWater: 0,
      lastWateredBy: "",
      lastWateredById: "",
      history: []
    },
    doodle: {
      strokes: [],
      savedAt: "",
      savedBy: "",
      savedById: ""
    },
    music: {
      playlist: [],
      currentId: "",
      title: "",
      url: "",
      isPlaying: false,
      currentTime: 0,
      volume: 0.65,
      updatedAt: "",
      updatedBy: "",
      updatedById: ""
    },
    quiz: {
      active: null,
      reports: []
    },
    // [新增] 双人同步小游戏状态。
    truthDare: {
      category: "daily",
      mode: "truth",
      current: null,
      recentIds: [],
      updatedAt: ""
    },
    dateWheel: {
      current: null,
      recentIds: [],
      rotation: 0,
      updatedAt: ""
    },
    fortune: {
      current: null,
      recentIds: [],
      updatedAt: ""
    },
    pulse: {
      round: 1,
      goal: 30,
      total: 0,
      scores: { A: 0, B: 0 },
      lastActor: "",
      lastActorName: "",
      updatedAt: ""
    },
    // [新增] 第二批实时互动模块的持久化状态。
    delayedLetters: [],
    whispers: [],
    capsules: [],
    study: {
      running: false,
      startedAt: "",
      elapsedSeconds: 0,
      goalMinutes: 25,
      quietMode: false,
      noise: "off",
      updatedAt: ""
    },
    emotionCalendar: {},
    preferenceBook: defaultPreferenceBook(),
    reconciliations: [],
    auction: defaultAuctionState(),
    fate: {
      current: {
        id: "fate-1",
        text: "如果只剩一个周末，你们更想怎么过？",
        options: ["窝在家里", "去陌生城市"],
        answers: {},
        createdAt: "",
        createdBy: "系统"
      }
    },
    gravity: {
      points: 0,
      level: 1,
      history: [],
      certificates: []
    },
    meetingMap: { points: [] },
    memoryDraw: { current: null, updatedAt: "" },
    growthGoals: { short: [], mid: [], long: [] },
    questionBlacklist: [],
    blindBox: { date: "", current: null, recentIds: [], updatedAt: "" },
    hypothetical: {
      current: {
        id: "hyp-1",
        text: "如果今晚能瞬移见面 2 小时，你们会先做什么？",
        options: ["吃一顿饭", "散步聊天", "安静抱抱"]
      },
      answers: {},
      updatedAt: ""
    },
    noAngryCards: [],
    monthlyReviews: {},
    lists: {
      travel: [],
      dates: [],
      shopping: []
    },
    calmMemos: [],
    missYouEvents: [],
    anniversaryAcks: {}
  };
}

function deepMerge(target, source) {
  if (Array.isArray(source)) return source.slice();
  if (!source || typeof source !== "object") return target;

  const output = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) {
      output[key] = value.slice();
    } else if (value && typeof value === "object") {
      output[key] = deepMerge(output[key] && typeof output[key] === "object" ? output[key] : {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function defaultPreferenceEntry() {
  return {
    likes: "",
    avoid: "",
    triggers: "",
    comfort: "",
    updatedAt: "",
    updatedBy: "",
    updatedById: ""
  };
}

function defaultPreferenceBook() {
  return {
    byRole: {
      A: defaultPreferenceEntry(),
      B: defaultPreferenceEntry()
    },
    updatedAt: "",
    updatedBy: "",
    updatedById: ""
  };
}

function normalizePreferenceBook(input) {
  const source = input && typeof input === "object" ? input : {};
  const book = deepMerge(defaultPreferenceBook(), source);

  ROLE_IDS.forEach((roleId) => {
    book.byRole[roleId] = deepMerge(defaultPreferenceEntry(), book.byRole && book.byRole[roleId] || {});
    PREFERENCE_FIELD_KEYS.forEach((key) => {
      book.byRole[roleId][key] = String(book.byRole[roleId][key] || "").slice(0, 3000);
    });
  });

  // 兼容旧版公共偏爱记录：迁移到最后更新人的角色栏，避免既有内容丢失。
  const legacyOwner = normalizeRoleId(source.updatedById, "A");
  const legacyTarget = book.byRole[legacyOwner];
  let migratedLegacy = false;
  PREFERENCE_FIELD_KEYS.forEach((key) => {
    const legacyValue = String(source[key] || "").trim();
    if (legacyValue && !String(legacyTarget[key] || "").trim()) {
      legacyTarget[key] = legacyValue.slice(0, 3000);
      migratedLegacy = true;
    }
  });
  if (migratedLegacy) {
    legacyTarget.updatedAt ||= source.updatedAt || "";
    legacyTarget.updatedBy ||= source.updatedBy || "";
    legacyTarget.updatedById ||= legacyOwner;
  }

  book.updatedAt = String(book.updatedAt || "");
  book.updatedBy = String(book.updatedBy || "");
  book.updatedById = ROLE_IDS.includes(book.updatedById) ? book.updatedById : "";
  return book;
}

function normalizeOperation(op, user) {
  return {
    id: String(op.id || crypto.randomUUID()),
    type: String(op.type || ""),
    actor: {
      id: user.id,
      username: user.username,
      name: user.name
    },
    clientId: String(op.clientId || ""),
    clientTime: op.clientTime || "",
    payload: op.payload && typeof op.payload === "object" ? op.payload : {}
  };
}

function applyOperation(op) {
  if (!op.type) throw new Error("Missing operation type");

  const at = new Date().toISOString();
  const realtime = state.realtime;

  switch (op.type) {
    case "legacy.replace":
      state.legacy = op.payload.data || null;
      break;

    case "theme.set":
      realtime.theme = op.payload.theme === "night" ? "night" : "macaron";
      realtime.themePrefs ||= {};
      realtime.themePrefs[op.actor.id] = realtime.theme;
      break;

    case "mood.check": {
      const date = String(op.payload.date || at.slice(0, 10));
      realtime.moods[date] ||= {};
      realtime.moods[date][op.actor.id] = {
        mood: String(op.payload.mood || "开心").slice(0, 20),
        note: String(op.payload.note || "").slice(0, 500),
        actor: op.actor.id,
        actorName: op.actor.name,
        updatedAt: at
      };
      break;
    }

    case "task.add":
      realtime.tasks.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        title: String(op.payload.title || "").slice(0, 120),
        detail: String(op.payload.detail || "").slice(0, 500),
        done: false,
        createdAt: at
      }, op, at));
      break;

    case "task.update":
      updateById(realtime.tasks, op.payload.id, (item) => Object.assign(item, op.payload.patch || {}, actorPatch(op, at)));
      break;

    case "task.delete":
      realtime.tasks = realtime.tasks.filter((item) => item.id !== op.payload.id);
      break;

    case "tree.water": {
      const amount = Math.max(1, Math.min(10, Number(op.payload.amount || 1)));
      realtime.tree.water += amount;
      realtime.tree.totalWater += amount;
      realtime.tree.level = Math.max(1, Math.floor(realtime.tree.totalWater / 8) + 1);
      realtime.tree.lastWateredBy = op.actor.name;
      realtime.tree.lastWateredById = op.actor.id;
      realtime.tree.history = (realtime.tree.history || []).concat(withActor({ amount }, op, at)).slice(-80);
      break;
    }

    case "doodle.stroke":
      realtime.doodle.strokes = (realtime.doodle.strokes || []).concat(withActor({
        id: op.payload.id || crypto.randomUUID(),
        color: op.payload.color || "#ff9fb5",
        size: Number(op.payload.size || 4),
        points: Array.isArray(op.payload.points) ? op.payload.points.slice(0, 600) : []
      }, op, at)).slice(-350);
      break;

    case "doodle.clear":
      realtime.doodle.strokes = [];
      realtime.doodle.clearedAt = at;
      realtime.doodle.clearedBy = op.actor.name;
      break;

    case "doodle.saved":
      realtime.doodle.savedAt = at;
      realtime.doodle.savedBy = op.actor.name;
      realtime.doodle.savedById = op.actor.id;
      break;

    case "music.state":
      realtime.music = {
        ...realtime.music,
        ...op.payload,
        updatedAt: at,
        updatedBy: op.actor.name,
        updatedById: op.actor.id
      };
      break;

    case "music.addTrack":
      realtime.music.playlist = (realtime.music.playlist || []).concat(withActor({
        id: op.payload.id || crypto.randomUUID(),
        title: String(op.payload.title || "未命名音乐").slice(0, 100),
        url: String(op.payload.url || "").slice(0, 3000),
        createdAt: at
      }, op, at)).slice(-80);
      break;

    case "music.deleteTrack":
      realtime.music.playlist = (realtime.music.playlist || []).filter((item) => item.id !== op.payload.id);
      if (realtime.music.currentId === op.payload.id) {
        realtime.music.currentId = "";
        realtime.music.url = "";
        realtime.music.title = "";
        realtime.music.isPlaying = false;
      }
      break;

    case "miss-you":
      realtime.missYouEvents = (realtime.missYouEvents || []).concat(withActor({
        id: op.payload.id || crypto.randomUUID(),
        message: String(op.payload.message || "我想你啦").slice(0, 120)
      }, op, at)).slice(-60);
      break;

    case "list.add":
      ensureList(op.payload.list).unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        text: String(op.payload.text || "").slice(0, 200),
        note: String(op.payload.note || "").slice(0, 500),
        done: false,
        date: String(op.payload.date || ""),
        createdAt: at
      }, op, at));
      break;

    case "list.update":
      updateById(ensureList(op.payload.list), op.payload.id, (item) => Object.assign(item, op.payload.patch || {}, actorPatch(op, at)));
      break;

    case "list.delete": {
      const key = normalizeListKey(op.payload.list);
      realtime.lists[key] = ensureList(key).filter((item) => item.id !== op.payload.id);
      break;
    }

    case "calm.add":
      realtime.calmMemos.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        title: String(op.payload.title || "").slice(0, 120),
        text: String(op.payload.text || "").slice(0, 1000),
        createdAt: at
      }, op, at));
      break;

    case "calm.update":
      updateById(realtime.calmMemos, op.payload.id, (item) => Object.assign(item, op.payload.patch || {}, actorPatch(op, at)));
      break;

    case "calm.delete":
      realtime.calmMemos = realtime.calmMemos.filter((item) => item.id !== op.payload.id);
      break;

    // [新增] 延时信笺、悄悄话、胶囊、自习房、偏爱记录、情绪光谱、和解、地图与目标。
    case "delayedLetter.create":
      realtime.delayedLetters.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        title: String(op.payload.title || "").slice(0, 120),
        text: String(op.payload.text || "").slice(0, 4000),
        deliverAt: safeIso(op.payload.deliverAt, at),
        status: "pending",
        createdAt: at
      }, op, at));
      realtime.delayedLetters = realtime.delayedLetters.slice(0, 80);
      break;

    case "delayedLetter.update":
      updateById(realtime.delayedLetters, op.payload.id, (item) => {
        if (item.actor !== op.actor.id || Date.now() >= Date.parse(item.deliverAt || "")) return;
        Object.assign(item, {
          title: String(op.payload.title || "").slice(0, 120),
          text: String(op.payload.text || "").slice(0, 4000),
          updatedBy: op.actor.name,
          updatedAt: at
        });
      });
      break;

    case "delayedLetter.withdraw":
      updateById(realtime.delayedLetters, op.payload.id, (item) => {
        if (item.actor !== op.actor.id || Date.now() >= Date.parse(item.deliverAt || "")) return;
        Object.assign(item, { status: "withdrawn", text: "", withdrawnAt: at, updatedBy: op.actor.name, updatedAt: at });
      });
      break;

    case "whisper.send":
      realtime.whispers.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        to: normalizeRoleId(op.payload.to, op.actor.id === "A" ? "B" : "A"),
        text: String(op.payload.text || "").slice(0, 1000),
        readAt: "",
        createdAt: at
      }, op, at));
      realtime.whispers = realtime.whispers.filter((item) => !item.readAt || Date.now() - Date.parse(item.readAt) < 86400000).slice(0, 40);
      break;

    case "whisper.read":
      updateById(realtime.whispers, op.payload.id, (item) => {
        if (item.to !== op.actor.id) return;
        Object.assign(item, { readAt: at, text: "", updatedBy: op.actor.name, updatedAt: at });
      });
      break;

    case "capsule.create":
      realtime.capsules.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        title: String(op.payload.title || "").slice(0, 120),
        unlockAt: safeIso(op.payload.unlockAt, at),
        entries: {},
        createdAt: at
      }, op, at));
      realtime.capsules = realtime.capsules.slice(0, 40);
      break;

    case "capsule.entry":
      updateById(realtime.capsules, op.payload.id, (item) => {
        item.entries ||= {};
        item.entries[op.actor.id] = {
          text: String(op.payload.text || "").slice(0, 5000),
          image: String(op.payload.image || "").slice(0, 6 * 1024 * 1024),
          actor: op.actor.id,
          actorName: op.actor.name,
          updatedAt: at
        };
        Object.assign(item, actorPatch(op, at));
      });
      break;

    case "study.timer":
      realtime.study = {
        ...realtime.study,
        running: Boolean(op.payload.running),
        startedAt: String(op.payload.startedAt || ""),
        elapsedSeconds: Math.max(0, Math.min(24 * 3600, Number(op.payload.elapsedSeconds || 0))),
        goalMinutes: Math.max(5, Math.min(240, Number(op.payload.goalMinutes || 25))),
        updatedAt: at,
        updatedBy: op.actor.name,
        updatedById: op.actor.id
      };
      break;

    case "study.quiet":
      realtime.study.quietMode = Boolean(op.payload.quietMode);
      realtime.study.updatedAt = at;
      realtime.study.updatedBy = op.actor.name;
      realtime.study.updatedById = op.actor.id;
      break;

    case "study.noise":
      realtime.study.noise = normalizeNoise(op.payload.noise);
      realtime.study.updatedAt = at;
      realtime.study.updatedBy = op.actor.name;
      realtime.study.updatedById = op.actor.id;
      break;

    case "emotionSpectrum.check": {
      const date = String(op.payload.date || at.slice(0, 10)).slice(0, 10);
      realtime.emotionCalendar[date] ||= {};
      realtime.emotionCalendar[date][op.actor.id] = {
        emotion: normalizeEmotion(op.payload.emotion),
        note: String(op.payload.note || "").slice(0, 500),
        actor: op.actor.id,
        actorName: op.actor.name,
        updatedAt: at
      };
      break;
    }

    case "preference.update": {
      const roleId = op.actor.id;
      const patch = op.payload.patch && typeof op.payload.patch === "object" ? op.payload.patch : {};
      const book = normalizePreferenceBook(realtime.preferenceBook);
      const roleBook = {
        ...defaultPreferenceEntry(),
        ...(book.byRole[roleId] || {})
      };
      PREFERENCE_FIELD_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          roleBook[key] = String(patch[key] || "").slice(0, 3000);
        }
      });
      book.byRole[roleId] = {
        ...roleBook,
        updatedAt: at,
        updatedBy: op.actor.name,
        updatedById: op.actor.id
      };
      realtime.preferenceBook = {
        ...book,
        updatedAt: at,
        updatedBy: op.actor.name,
        updatedById: op.actor.id
      };
      break;
    }

    case "reconciliation.add":
      realtime.reconciliations.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        issue: String(op.payload.issue || "").slice(0, 400),
        agreement: String(op.payload.agreement || "").slice(0, 2000),
        status: "open",
        ack: {},
        createdAt: at
      }, op, at));
      break;

    case "reconciliation.ack":
      updateById(realtime.reconciliations, op.payload.id, (item) => {
        item.ack ||= {};
        item.ack[op.actor.id] = at;
        if (["A", "B"].every((id) => item.ack[id])) item.status = "ready";
        Object.assign(item, actorPatch(op, at));
      });
      break;

    case "reconciliation.resolve":
      updateById(realtime.reconciliations, op.payload.id, (item) => {
        if (item.status === "ready" || ["A", "B"].every((id) => item.ack && item.ack[id])) {
          Object.assign(item, { status: "resolved", resolvedAt: at }, actorPatch(op, at));
        }
      });
      break;

    case "auction.reset":
      realtime.auction = defaultAuctionState(Number(op.payload.round || realtime.auction?.round + 1 || 1), at, op);
      break;

    case "auction.bid": {
      ensureNotGameLocked(realtime, op.type);
      const item = (realtime.auction.items || []).find((entry) => entry.id === op.payload.id);
      const amount = Math.max(1, Math.min(50, Number(op.payload.amount || 10)));
      realtime.auction.coins ||= { A: 100, B: 100 };
      if (!item || Number(realtime.auction.coins[op.actor.id] || 0) < amount) break;
      item.bids ||= {};
      item.bids[op.actor.id] = Number(item.bids[op.actor.id] || 0) + amount;
      realtime.auction.coins[op.actor.id] -= amount;
      item.updatedAt = at;
      break;
    }

    case "fate.reset":
      ensureNotGameLocked(realtime, op.type);
      realtime.fate.current = sanitizeFateQuestion(op.payload.question, at, op.actor.name);
      break;

    case "fate.answer":
      ensureNotGameLocked(realtime, op.type);
      realtime.fate.current ||= sanitizeFateQuestion(null, at, op.actor.name);
      realtime.fate.current.answers ||= {};
      realtime.fate.current.answers[op.actor.id] = String(op.payload.answer || "").slice(0, 80);
      realtime.fate.current.updatedAt = at;
      break;

    case "gravity.certificate":
      realtime.gravity.certificates.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        level: gravityLevel(realtime.gravity.points),
        text: String(op.payload.text || "电子纪念证书已生成。").slice(0, 200),
        createdAt: at
      }, op, at));
      realtime.gravity.certificates = realtime.gravity.certificates.slice(0, 12);
      break;

    case "meeting.add":
      realtime.meetingMap.points.push(withActor({
        id: op.payload.id || crypto.randomUUID(),
        city: String(op.payload.city || "").slice(0, 40),
        place: String(op.payload.place || "").slice(0, 80),
        date: String(op.payload.date || at.slice(0, 10)).slice(0, 10),
        note: String(op.payload.note || "").slice(0, 200)
      }, op, at));
      realtime.meetingMap.points = realtime.meetingMap.points.slice(-80);
      break;

    case "meeting.delete":
      realtime.meetingMap.points = realtime.meetingMap.points.filter((item) => item.id !== op.payload.id);
      break;

    case "memory.draw":
      realtime.memoryDraw = {
        current: withActor({
          kind: String(op.payload.memory?.kind || "回忆").slice(0, 20),
          title: String(op.payload.memory?.title || "").slice(0, 160),
          text: String(op.payload.memory?.text || "").slice(0, 1000),
          image: String(op.payload.memory?.image || "").slice(0, 6 * 1024 * 1024)
        }, op, at),
        updatedAt: at
      };
      break;

    case "growthGoal.add": {
      const term = normalizeGoalTerm(op.payload.term);
      realtime.growthGoals[term].unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        title: String(op.payload.title || "").slice(0, 180),
        note: String(op.payload.note || "").slice(0, 500),
        checks: {},
        createdAt: at
      }, op, at));
      break;
    }

    case "growthGoal.check": {
      const term = normalizeGoalTerm(op.payload.term);
      updateById(realtime.growthGoals[term], op.payload.id, (item) => {
        item.checks ||= {};
        item.checks[op.actor.id] = at;
        Object.assign(item, actorPatch(op, at));
      });
      break;
    }

    case "growthGoal.delete": {
      const term = normalizeGoalTerm(op.payload.term);
      realtime.growthGoals[term] = realtime.growthGoals[term].filter((item) => item.id !== op.payload.id);
      break;
    }

    // [新增功能代码] 五板块整理后的轻量互动工具。
    case "question.blacklist.add": {
      const text = String(op.payload.text || "").trim().slice(0, 300);
      if (text && !(realtime.questionBlacklist || []).some((item) => item.text === text)) {
        realtime.questionBlacklist.unshift(withActor({
          id: op.payload.id || crypto.randomUUID(),
          text,
          createdAt: at
        }, op, at));
      }
      realtime.questionBlacklist = (realtime.questionBlacklist || []).slice(0, 80);
      break;
    }

    case "question.blacklist.delete":
      realtime.questionBlacklist = (realtime.questionBlacklist || []).filter((item) => item.id !== op.payload.id && item.text !== op.payload.text);
      break;

    case "question.blacklist.clear":
      realtime.questionBlacklist = [];
      break;

    case "blindBox.draw":
      realtime.blindBox = {
        date: String(op.payload.date || at.slice(0, 10)).slice(0, 10),
        current: withActor({
          id: op.payload.item?.id || crypto.randomUUID(),
          text: String(op.payload.item?.text || "").slice(0, 160),
          done: false
        }, op, at),
        recentIds: Array.isArray(op.payload.recentIds) ? op.payload.recentIds.slice(-8).map(String) : [],
        updatedAt: at
      };
      break;

    case "hypothetical.reset":
      realtime.hypothetical = {
        current: sanitizeChoiceQuestion(op.payload.question),
        answers: {},
        updatedAt: at,
        updatedBy: op.actor.name,
        updatedById: op.actor.id
      };
      break;

    case "hypothetical.answer":
      realtime.hypothetical ||= { current: sanitizeChoiceQuestion(null), answers: {}, updatedAt: "" };
      realtime.hypothetical.answers ||= {};
      realtime.hypothetical.answers[op.actor.id] = {
        answer: String(op.payload.answer || "").slice(0, 80),
        actorName: op.actor.name,
        updatedAt: at
      };
      break;

    case "noAngryCard.create":
      realtime.noAngryCards.unshift(withActor({
        id: op.payload.id || crypto.randomUUID(),
        text: String(op.payload.text || "").slice(0, 160),
        usedAt: "",
        createdAt: at
      }, op, at));
      realtime.noAngryCards = realtime.noAngryCards.slice(0, 30);
      break;

    case "noAngryCard.use":
      updateById(realtime.noAngryCards, op.payload.id, (item) => {
        Object.assign(item, { usedAt: at, usedById: op.actor.id, usedBy: op.actor.name }, actorPatch(op, at));
      });
      break;

    case "monthlyReview.submit": {
      const month = String(op.payload.month || at.slice(0, 7)).slice(0, 7);
      realtime.monthlyReviews[month] ||= {};
      realtime.monthlyReviews[month][op.actor.id] = {
        score: Math.max(1, Math.min(10, Number(op.payload.score || 10))),
        text: String(op.payload.text || "").slice(0, 1200),
        actor: op.actor.id,
        actorName: op.actor.name,
        updatedAt: at
      };
      break;
    }

    // [新增] 双人同步小游戏操作。
    case "truthDare.draw": {
      ensureNotGameLocked(realtime, op.type);
      const mode = op.payload.mode === "dare" ? "dare" : "truth";
      const category = normalizeTruthDareCategory(op.payload.category);
      realtime.truthDare = {
        ...realtime.truthDare,
        category,
        mode,
        current: withActor({
          id: op.payload.item?.id || crypto.randomUUID(),
          text: String(op.payload.item?.text || "").slice(0, 300),
          category,
          mode
        }, op, at),
        recentIds: Array.isArray(op.payload.recentIds) ? op.payload.recentIds.slice(-12).map(String) : [],
        updatedAt: at
      };
      break;
    }

    case "dateWheel.spin":
      ensureNotGameLocked(realtime, op.type);
      realtime.dateWheel = {
        ...realtime.dateWheel,
        current: withActor({
          id: op.payload.item?.id || crypto.randomUUID(),
          text: String(op.payload.item?.text || "").slice(0, 120),
          rotation: Number(op.payload.rotation || 0)
        }, op, at),
        rotation: Number(op.payload.rotation || 0),
        recentIds: Array.isArray(op.payload.recentIds) ? op.payload.recentIds.slice(-8).map(String) : [],
        updatedAt: at
      };
      break;

    case "fortune.draw":
      ensureNotGameLocked(realtime, op.type);
      realtime.fortune = {
        ...realtime.fortune,
        current: withActor({
          id: op.payload.item?.id || crypto.randomUUID(),
          text: String(op.payload.item?.text || "").slice(0, 240)
        }, op, at),
        recentIds: Array.isArray(op.payload.recentIds) ? op.payload.recentIds.slice(-8).map(String) : [],
        updatedAt: at
      };
      break;

    case "pulse.tap": {
      ensureNotGameLocked(realtime, op.type);
      const amount = Math.max(1, Math.min(5, Number(op.payload.amount || 1)));
      realtime.pulse ||= defaultRealtimeState().pulse;
      realtime.pulse.scores ||= { A: 0, B: 0 };
      realtime.pulse.scores[op.actor.id] = Number(realtime.pulse.scores[op.actor.id] || 0) + amount;
      realtime.pulse.total = Number(realtime.pulse.total || 0) + amount;
      realtime.pulse.goal = Math.max(20, Number(realtime.pulse.goal || 30));
      if (realtime.pulse.total >= realtime.pulse.goal) {
        realtime.pulse.round = Number(realtime.pulse.round || 1) + 1;
        realtime.pulse.goal += 20;
      }
      realtime.pulse.lastActor = op.actor.id;
      realtime.pulse.lastActorName = op.actor.name;
      realtime.pulse.updatedAt = at;
      break;
    }

    case "pulse.reset":
      ensureNotGameLocked(realtime, op.type);
      realtime.pulse = {
        ...defaultRealtimeState().pulse,
        round: Number(realtime.pulse?.round || 1) + 1,
        lastActor: op.actor.id,
        lastActorName: op.actor.name,
        updatedAt: at
      };
      break;

    case "quiz.reset":
      ensureNotGameLocked(realtime, op.type);
      realtime.quiz.active = {
        id: op.payload.id || crypto.randomUUID(),
        createdAt: at,
        createdBy: op.actor.name,
        answers: {}
      };
      break;

    case "quiz.answer": {
      ensureNotGameLocked(realtime, op.type);
      realtime.quiz.active ||= {
        id: crypto.randomUUID(),
        createdAt: at,
        createdBy: op.actor.name,
        answers: {}
      };
      realtime.quiz.active.answers[op.actor.id] ||= {};
      realtime.quiz.active.answers[op.actor.id][op.payload.questionId] = {
        answer: String(op.payload.answer || ""),
        updatedAt: at,
        actorName: op.actor.name
      };
      break;
    }

    default:
      throw new Error(`Unsupported operation: ${op.type}`);
  }

  grantGravityForOperation(realtime, op, at);
  state.realtime = realtime;
  state.revision += 1;
  state.updatedAt = at;
  state.lastActor = op.actor;
  const historyPayload = op.type === "legacy.replace" ? { summary: op.payload.summary || "原站内容更新" } : op.payload;
  state.history = (state.history || []).concat({ ...op, payload: historyPayload, revision: state.revision, serverTime: at }).slice(-200);
  saveState();

  return { ...op, revision: state.revision, serverTime: at };
}

function ensureList(list) {
  const key = normalizeListKey(list);
  state.realtime.lists[key] ||= [];
  return state.realtime.lists[key];
}

function normalizeListKey(list) {
  return ["travel", "dates", "shopping"].includes(list) ? list : "travel";
}

function normalizeTruthDareCategory(category) {
  return ["daily", "sweet", "fun"].includes(category) ? category : "daily";
}

function defaultAuctionState(round = 1, at = new Date().toISOString(), op = { actor: { name: "系统" } }) {
  const catalog = ["一次认真视频约会", "下次见面路线选择权", "睡前故事十分钟", "周末共同电影", "一次无条件夸夸", "一起完成一顿饭"];
  return {
    round: Number(round || 1),
    coins: { A: 100, B: 100 },
    items: catalog.map((title, index) => ({ id: `auction-${round}-${index}`, title, bids: {} })),
    createdAt: at,
    createdBy: op.actor?.name || "系统"
  };
}

function safeIso(input, fallback) {
  const time = Date.parse(input || "");
  return Number.isNaN(time) ? fallback : new Date(time).toISOString();
}

function normalizeRoleId(value, fallback) {
  return ["A", "B"].includes(value) ? value : fallback;
}

function normalizeNoise(noise) {
  return ["off", "rain", "waves", "cafe", "white"].includes(noise) ? noise : "off";
}

function normalizeEmotion(emotion) {
  return ["晴", "甜", "稳", "累", "低", "想"].includes(emotion) ? emotion : "晴";
}

function normalizeGoalTerm(term) {
  return ["short", "mid", "long"].includes(term) ? term : "short";
}

function sanitizeFateQuestion(question, at, actorName) {
  const fallback = {
    id: "fate-1",
    text: "如果只剩一个周末，你们更想怎么过？",
    options: ["窝在家里", "去陌生城市"]
  };
  const source = question && typeof question === "object" ? question : fallback;
  const options = Array.isArray(source.options) && source.options.length >= 2 ? source.options.slice(0, 2) : fallback.options;
  return {
    id: String(source.id || crypto.randomUUID()).slice(0, 80),
    text: String(source.text || fallback.text).slice(0, 200),
    options: options.map((item) => String(item).slice(0, 80)),
    answers: {},
    createdAt: at,
    createdBy: actorName || "系统"
  };
}

function sanitizeChoiceQuestion(question) {
  const fallback = {
    id: "hyp-1",
    text: "如果今晚能瞬移见面 2 小时，你们会先做什么？",
    options: ["吃一顿饭", "散步聊天", "安静抱抱"]
  };
  const source = question && typeof question === "object" ? question : fallback;
  const options = Array.isArray(source.options) && source.options.length >= 2 ? source.options.slice(0, 4) : fallback.options;
  return {
    id: String(source.id || crypto.randomUUID()).slice(0, 80),
    text: String(source.text || fallback.text).slice(0, 220),
    options: options.map((item) => String(item).slice(0, 80))
  };
}

function ensureNotGameLocked(realtime, type) {
  const locked = (realtime.reconciliations || []).some((item) => item.status !== "resolved");
  if (locked) throw new Error(`Games locked by reconciliation: ${type}`);
}

function grantGravityForOperation(realtime, op, at) {
  const rewards = {
    "mood.check": 2,
    "emotionSpectrum.check": 2,
    "task.update": 1,
    "tree.water": 1,
    "doodle.saved": 2,
    "truthDare.draw": 1,
    "dateWheel.spin": 1,
    "fortune.draw": 1,
    "pulse.tap": 1,
    "quiz.answer": 1,
    "auction.bid": 1,
    "fate.answer": 1,
    "growthGoal.check": 3,
    "memory.draw": 1,
    "meeting.add": 2,
    "capsule.entry": 2,
    "delayedLetter.create": 2,
    "whisper.send": 1,
    "blindBox.draw": 1,
    "hypothetical.answer": 1,
    "noAngryCard.create": 1,
    "monthlyReview.submit": 2
  };
  const amount = rewards[op.type] || 0;
  if (!amount) return;
  realtime.gravity ||= { points: 0, level: 1, history: [], certificates: [] };
  realtime.gravity.points = Number(realtime.gravity.points || 0) + amount;
  realtime.gravity.level = gravityLevel(realtime.gravity.points);
  realtime.gravity.history = (realtime.gravity.history || []).concat({
    type: op.type,
    amount,
    actor: op.actor.id,
    actorName: op.actor.name,
    createdAt: at
  }).slice(-120);
}

function gravityLevel(points) {
  return Math.max(1, Math.floor(Math.sqrt(Number(points || 0) / 12)) + 1);
}

function updateById(list, id, update) {
  const item = Array.isArray(list) ? list.find((entry) => entry.id === id) : null;
  if (item) update(item);
}

function withActor(item, op, at) {
  return {
    ...item,
    actor: op.actor.id,
    actorName: op.actor.name,
    updatedBy: op.actor.name,
    updatedAt: at
  };
}

function actorPatch(op, at) {
  return {
    updatedBy: op.actor.name,
    updatedAt: at
  };
}

function publicSnapshot(user) {
  return {
    schema: state.schema,
    revision: state.revision,
    updatedAt: state.updatedAt,
    lastActor: state.lastActor,
    legacy: state.legacy,
    realtime: sanitizeRealtimeForUser(state.realtime, user),
    history: sanitizeHistoryForUser(state.history, user)
  };
}

function sanitizeRealtimeForUser(realtime, user) {
  const now = Date.now();
  const copy = JSON.parse(JSON.stringify(realtime || {}));
  const userId = user && user.id;

  copy.delayedLetters = (copy.delayedLetters || []).map((item) => {
    const mine = item.actor === userId;
    const unlocked = Date.parse(item.deliverAt || "") <= now;
    if (mine || unlocked || item.status === "withdrawn") return item;
    return { ...item, title: "信笺正在倒计时", text: "", hidden: true };
  });

  copy.capsules = (copy.capsules || []).map((item) => {
    const unlocked = Date.parse(item.unlockAt || "") <= now;
    if (unlocked) return item;
    const entries = {};
    for (const role of ["A", "B"]) {
      if (item.entries && item.entries[role]) {
        entries[role] = {
          sealed: true,
          actor: role,
          actorName: item.entries[role].actorName,
          updatedAt: item.entries[role].updatedAt
        };
      }
    }
    return { ...item, entries };
  });

  copy.whispers = (copy.whispers || []).map((item) => {
    if (item.to === userId && !item.readAt) return item;
    return { ...item, text: "" };
  });

  return copy;
}

function sanitizeOperationForUser(op, user) {
  const userId = user && user.id;
  const payload = { ...(op.payload || {}) };
  if (op.type === "delayedLetter.create" || op.type === "delayedLetter.update") {
    const mine = op.actor && op.actor.id === userId;
    const unlocked = Date.parse(payload.deliverAt || "") <= Date.now();
    if (!mine && !unlocked) {
      payload.title = "信笺正在倒计时";
      payload.text = "";
      payload.hidden = true;
    }
  }

  if (op.type === "capsule.entry") {
    payload.text = "";
    payload.image = "";
    payload.sealed = true;
  }

  if (op.type === "whisper.send" && payload.to !== userId) {
    payload.text = "";
  }

  return { ...op, payload };
}

function sanitizeHistoryForUser(history, user) {
  return Array.isArray(history)
    ? history.map((entry) => sanitizeOperationForUser(entry, user)).slice(-200)
    : [];
}

function presenceList() {
  return accounts.map((account) => {
    const active = [...clients.values()].filter((client) => client.user.id === account.id);
    const newest = active.at(-1);
    return {
      id: account.id,
      username: account.username,
      name: account.name,
      online: active.length > 0,
      devices: active.length,
      activity: newest?.activity || "离线",
      activityAt: newest?.activityAt || newest?.connectedAt || ""
    };
  });
}

function broadcastPresence() {
  broadcast({ type: "presence", presence: presenceList() });
}

function broadcast(message) {
  const raw = JSON.stringify(message);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

function broadcastOperation(op) {
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({ type: "op", op: sanitizeOperationForUser(op, client.user) }));
    }
  }
}
