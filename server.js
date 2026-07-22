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
        snapshot: publicSnapshot()
      });
    }

    if (req.method === "GET" && requestUrl.pathname === "/api/state") {
      const user = authenticateHttp(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "未登录或登录已过期" });
      return sendJson(res, 200, { ok: true, snapshot: publicSnapshot() });
    }

    if (req.method === "POST" && requestUrl.pathname === "/api/op") {
      const user = authenticateHttp(req);
      if (!user) return sendJson(res, 401, { ok: false, error: "未登录或登录已过期" });
      const op = await readJsonBody(req);
      const applied = applyOperation(normalizeOperation(op, user));
      broadcast({ type: "op", op: applied });
      return sendJson(res, 200, { ok: true, op: applied, snapshot: publicSnapshot() });
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
    snapshot: publicSnapshot(),
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
        broadcast({ type: "op", op: applied });
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
    realtime: deepMerge(defaultRealtimeState(), input.realtime || {}),
    history: Array.isArray(input.history) ? input.history.slice(-200) : []
  };
}

function defaultRealtimeState() {
  return {
    schema: 2,
    theme: "macaron",
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

    // [新增] 双人同步小游戏操作。
    case "truthDare.draw": {
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
      realtime.pulse = {
        ...defaultRealtimeState().pulse,
        round: Number(realtime.pulse?.round || 1) + 1,
        lastActor: op.actor.id,
        lastActorName: op.actor.name,
        updatedAt: at
      };
      break;

    case "quiz.reset":
      realtime.quiz.active = {
        id: op.payload.id || crypto.randomUUID(),
        createdAt: at,
        createdBy: op.actor.name,
        answers: {}
      };
      break;

    case "quiz.answer": {
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

function publicSnapshot() {
  return {
    schema: state.schema,
    revision: state.revision,
    updatedAt: state.updatedAt,
    lastActor: state.lastActor,
    legacy: state.legacy,
    realtime: state.realtime,
    history: state.history
  };
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
