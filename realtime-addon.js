(function () {
  const AUTH_KEY = "sweetHomeRealtimeAuthV2";
  const QUEUE_KEY = "sweetHomeRealtimeQueueV2";
  const LEGACY_PENDING_KEY = "sweetHomeRealtimeLegacyPendingV2";

  const app = {
    clientId: getClientId(),
    token: "",
    user: null,
    socket: null,
    connected: false,
    connecting: false,
    shouldReconnect: false,
    reconnectTimer: null,
    reconnectAttempt: 0,
    socketSerial: 0,
    applyingRemote: false,
    legacyTimer: null,
    renderTimer: null,
    activityTimer: null,
    queue: [],
    listTab: "travel",
    selectedMood: "开心",
    lastLegacyHash: "",
    realtime: defaultRealtimeState(),
    presence: [],
    snapshotRevision: 0,
    originalPersistNow: null
  };

  const quizQuestions = [
    { id: "q1", text: "对方压力大时最想要什么？", options: ["安静陪伴", "马上解决", "出去散心"] },
    { id: "q2", text: "最理想的周末约会是？", options: ["宅家做饭", "城市散步", "短途旅行"] },
    { id: "q3", text: "收到哪种小惊喜最开心？", options: ["手写文字", "实用礼物", "突然见面"] },
    { id: "q4", text: "吵架后最需要哪句话？", options: ["我在听你说", "我们慢慢来", "抱抱好不好"] },
    { id: "q5", text: "纪念日更想怎么过？", options: ["仪式感晚餐", "拍照记录", "只要在一起"] },
    { id: "q6", text: "未来最期待一起完成什么？", options: ["布置小家", "看很多风景", "攒一笔基金"] }
  ];

  const moodOptions = ["开心", "想你", "疲惫", "委屈", "期待"];
  const listLabels = {
    travel: "旅行清单",
    dates: "约会计划",
    shopping: "购物清单"
  };

  boot();

  function boot() {
    restoreAuth();
    restoreQueue();
    wrapOriginalFunctions();
    bindEvents();
    ensureStatusChips();
    deferRender();

    if (app.token) {
      app.shouldReconnect = true;
      connectSocket();
      fetchSnapshot();
    } else {
      waitForUnlockThen(showAccountLayer);
    }

    window.addEventListener("online", () => {
      if (app.token) {
        app.shouldReconnect = true;
        connectSocket();
        fetchSnapshot();
      }
    });
    window.addEventListener("offline", updateConnectionStatus);
    window.addEventListener("pageshow", () => {
      if (app.token && !app.connected) {
        app.shouldReconnect = true;
        connectSocket();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && app.token && !app.connected) {
        app.shouldReconnect = true;
        connectSocket();
      }
    });

    setInterval(() => {
      if (app.socket && app.socket.readyState === WebSocket.OPEN) {
        app.socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);
  }

  function wrapOriginalFunctions() {
    try {
      if (typeof persistNow === "function" && !persistNow.__rtWrapped) {
        app.originalPersistNow = persistNow;
        persistNow = function realtimePersistWrapper(options) {
          markLegacyContent();
          const result = app.originalPersistNow.apply(this, arguments);
          if (!app.applyingRemote) scheduleLegacySync(options && options.toast);
          deferRender();
          return result;
        };
        persistNow.__rtWrapped = true;
      }
    } catch (error) {
      console.warn("Realtime wrapper cannot hook persistNow.", error);
    }

    wrapRenderFunction("renderAll");
    wrapRenderFunction("renderHome");
    wrapRenderFunction("renderAlbum");
    wrapRenderFunction("renderTools");
    wrapRenderFunction("renderGames");
    wrapRenderFunction("renderSettings");
  }

  function wrapRenderFunction(name) {
    try {
      const original = window[name];
      if (typeof original !== "function" || original.__rtWrapped) return;
      window[name] = function realtimeRenderWrapper() {
        const result = original.apply(this, arguments);
        deferRender();
        return result;
      };
      window[name].__rtWrapped = true;
    } catch (error) {
      console.warn(`Realtime wrapper cannot hook ${name}.`, error);
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-rt]");
      if (!target) return;

      const action = target.dataset.rt;
      sendActivity(actionName(action));

      if (action === "login") login();
      if (action === "logout") logout();
      if (action === "theme") setTheme(target.dataset.theme);
      if (action === "miss-you") sendMissYou();
      if (action === "mood-select") selectMood(target.dataset.mood);
      if (action === "mood-save") saveMood();
      if (action === "task-add") addSweetTask();
      if (action === "task-toggle") updateSweetTask(target.dataset.id, { done: target.dataset.done !== "true" });
      if (action === "task-delete") deleteSweetTask(target.dataset.id);
      if (action === "tree-water") waterTree();
      if (action === "doodle-clear") sendOperation("doodle.clear", {});
      if (action === "doodle-save") saveDoodleToAlbum();
      if (action === "music-add") addMusicTrack();
      if (action === "music-select") selectMusicTrack(target.dataset.id);
      if (action === "music-delete") deleteMusicTrack(target.dataset.id);
      if (action === "music-play") setMusicPlayback(true);
      if (action === "music-pause") setMusicPlayback(false);
      if (action === "list-tab") {
        app.listTab = target.dataset.list || "travel";
        renderAddon();
      }
      if (action === "list-add") addSharedListItem();
      if (action === "list-toggle") updateSharedListItem(target.dataset.list, target.dataset.id, { done: target.dataset.done !== "true" });
      if (action === "list-delete") deleteSharedListItem(target.dataset.list, target.dataset.id);
      if (action === "calm-add") addCalmMemo();
      if (action === "calm-delete") deleteCalmMemo(target.dataset.id);
      if (action === "quiz-answer") answerQuiz(target.dataset.question, target.dataset.answer);
      if (action === "quiz-reset") resetQuiz();
      if (action === "push-now") scheduleLegacySync("手动同步原有功能");
      if (action === "close-account-layer") hideAccountLayer();
    });

    document.addEventListener("input", (event) => {
      if (event.target.matches("input, textarea, select")) {
        sendActivity("正在编辑");
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target.id === "rtMusicFile" && event.target.files[0]) {
        readFileAsDataUrl(event.target.files[0]).then((url) => {
          const title = event.target.files[0].name.replace(/\.[^.]+$/, "");
          addMusicTrack(title, url);
          event.target.value = "";
        });
      }
    });
  }

  async function login() {
    const username = valueOf("rtLoginUser").trim();
    const password = valueOf("rtLoginPassword");
    if (!username || !password) {
      toast("请先输入情侣账号和密码。");
      return;
    }

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "登录失败");

      app.token = result.token;
      app.user = result.user;
      app.shouldReconnect = true;
      resetReconnectState();
      restoreQueue();
      localStorage.setItem(AUTH_KEY, JSON.stringify({ token: app.token, user: app.user }));
      hideAccountLayer();
      toast(`${app.user.name} 已登录，实时同步开启。`);
      applySnapshot(result.snapshot || {}, false);
      connectSocket();
    } catch (error) {
      toast(error.message || "登录失败，请检查账号密码。");
    }
  }

  function logout() {
    app.shouldReconnect = false;
    resetReconnectState();
    saveQueue();
    app.queue = [];
    app.token = "";
    app.user = null;
    localStorage.removeItem(AUTH_KEY);
    const socket = app.socket;
    app.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch (error) {}
    }
    app.connected = false;
    app.connecting = false;
    updateConnectionStatus();
    showAccountLayer();
  }

  function restoreAuth() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "{}");
      app.token = saved.token || "";
      app.user = saved.user || null;
    } catch (error) {
      app.token = "";
      app.user = null;
    }
  }

  function restoreQueue() {
    if (!app.user || !app.user.id) {
      app.queue = [];
      return;
    }
    try {
      const raw = localStorage.getItem(queueStorageKey());
      app.queue = JSON.parse(raw || "[]");
    } catch (error) {
      app.queue = [];
    }
  }

  function saveQueue() {
    localStorage.setItem(queueStorageKey(), JSON.stringify(app.queue.slice(-200)));
  }

  function queueStorageKey() {
    const userId = app.user && app.user.id ? app.user.id : "guest";
    return `${QUEUE_KEY}:${userId}`;
  }

  function clearReconnectTimer() {
    if (app.reconnectTimer) {
      clearTimeout(app.reconnectTimer);
      app.reconnectTimer = null;
    }
  }

  function resetReconnectState() {
    clearReconnectTimer();
    app.reconnectAttempt = 0;
  }

  function scheduleReconnect(delay) {
    if (!app.token || !app.shouldReconnect || app.connected || app.connecting) return;
    if (app.reconnectTimer) return;

    const wait = Number.isFinite(delay)
      ? Math.max(500, delay)
      : Math.min(30000, Math.round(1200 * Math.pow(1.6, app.reconnectAttempt++)));

    app.reconnectTimer = setTimeout(() => {
      app.reconnectTimer = null;
      connectSocket();
    }, wait);
    updateConnectionStatus();
  }

  async function fetchSnapshot() {
    if (!app.token) return;
    try {
      const response = await fetch("/api/state", {
        headers: { Authorization: `Bearer ${app.token}` }
      });
      if (response.status === 401) {
        logout();
        return;
      }
      const result = await response.json();
      if (result.ok) applySnapshot(result.snapshot || {}, false);
    } catch (error) {
      updateConnectionStatus();
    }
  }

  function connectSocket() {
    if (!app.token) return;
    app.shouldReconnect = true;
    clearReconnectTimer();
    if (app.connecting || app.connected) return;
    if (app.socket && (app.socket.readyState === WebSocket.OPEN || app.socket.readyState === WebSocket.CONNECTING)) return;

    app.connecting = true;
    updateConnectionStatus("连接中");

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(app.token)}`);
    const serial = ++app.socketSerial;
    app.socket = socket;
    socket.__rtSerial = serial;

    const isCurrentSocket = () => app.socket === socket && socket.__rtSerial === serial;

    socket.addEventListener("open", () => {
      if (!isCurrentSocket()) return;
      app.connected = true;
      app.connecting = false;
      resetReconnectState();
      updateConnectionStatus();
      flushQueue();
      sendActivity("在线");
    });

    socket.addEventListener("message", (event) => {
      if (!isCurrentSocket()) return;
      try {
        const message = JSON.parse(event.data);
        handleSocketMessage(message);
      } catch (error) {
        console.warn("Bad realtime message.", error);
      }
    });

    socket.addEventListener("close", () => {
      if (!isCurrentSocket()) return;
      app.socket = null;
      app.connected = false;
      app.connecting = false;
      updateConnectionStatus();
      if (app.shouldReconnect) scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (!isCurrentSocket()) return;
      app.connected = false;
      app.connecting = false;
      updateConnectionStatus();
      if (app.shouldReconnect) scheduleReconnect(1200);
    });
  }

  function handleSocketMessage(message) {
    if (message.type === "welcome") {
      app.presence = message.presence || [];
      applySnapshot(message.snapshot || {}, false);
      updateConnectionStatus();
      return;
    }

    if (message.type === "presence") {
      app.presence = message.presence || [];
      updateConnectionStatus();
      renderAddon();
      return;
    }

    if (message.type === "op") {
      const op = message.op || {};
      if (op.clientId === app.clientId) {
        app.snapshotRevision = op.revision || app.snapshotRevision;
        return;
      }
      applyRemoteOperation(op);
    }
  }

  function applySnapshot(snapshot, forceServerLegacy) {
    app.snapshotRevision = snapshot.revision || app.snapshotRevision;
    app.realtime = normalizeRealtime(snapshot.realtime || app.realtime);
    applyTheme(app.realtime.theme || "macaron");

    if (snapshot.legacy) {
      const localTime = getLegacyTime(getLegacyState());
      const serverTime = getLegacyTime(snapshot.legacy);
      if (!forceServerLegacy && localTime > serverTime + 3000) {
        scheduleLegacySync("同步本机离线内容");
      } else {
        applyLegacyState(snapshot.legacy, false);
      }
    } else if (getLegacyState()) {
      scheduleLegacySync("同步原有功能数据");
    }

    deferRender();
  }

  function applyRemoteOperation(op) {
    if (op.type === "legacy.replace") {
      applyLegacyState(op.payload && op.payload.data, true);
    } else {
      reduceRealtimeOperation(op);
      if (op.type === "miss-you") showHeartBlast(op.actor && op.actor.name, op.payload && op.payload.message);
      if (op.type === "music.state") applyMusicToElement();
    }

    notifyRemote(op);
    deferRender();
  }

  function sendOperation(type, payload, options) {
    if (!app.user) {
      waitForUnlockThen(showAccountLayer);
      toast("请先登录情侣账号，再使用实时互动。");
      return;
    }

    const op = {
      id: uuid(),
      type,
      actor: app.user,
      clientId: app.clientId,
      clientTime: new Date().toISOString(),
      payload: payload || {}
    };

    if (!options || options.local !== false) {
      if (type !== "legacy.replace") reduceRealtimeOperation(op);
      deferRender();
    }

    if (app.socket && app.socket.readyState === WebSocket.OPEN) {
      app.socket.send(JSON.stringify({ type: "op", op }));
    } else if (type === "legacy.replace") {
      localStorage.setItem(LEGACY_PENDING_KEY, "1");
      toast("当前离线，原有功能会在联网后自动同步。");
      if (app.shouldReconnect) scheduleReconnect(800);
    } else {
      app.queue.push(op);
      saveQueue();
      toast("当前离线，操作已缓存，联网后自动同步。");
      if (app.shouldReconnect) scheduleReconnect(800);
    }
  }

  function flushQueue() {
    if (!app.socket || app.socket.readyState !== WebSocket.OPEN) return;

    while (app.queue.length) {
      const op = app.queue.shift();
      app.socket.send(JSON.stringify({ type: "op", op }));
    }
    saveQueue();

    if (localStorage.getItem(LEGACY_PENDING_KEY) === "1") {
      localStorage.removeItem(LEGACY_PENDING_KEY);
      scheduleLegacySync("联网后同步原有功能");
    }
  }

  function scheduleLegacySync(summary) {
    const data = getLegacyState();
    if (data && stableHash(stripLegacyVolatile(data)) === app.lastLegacyHash) return;
    clearTimeout(app.legacyTimer);
    app.legacyTimer = setTimeout(() => sendLegacySnapshot(summary), 650);
  }

  function sendLegacySnapshot(summary) {
    if (!app.user) {
      localStorage.setItem(LEGACY_PENDING_KEY, "1");
      return;
    }

    const data = getLegacyState();
    if (!data) return;
    markLegacyContent(data);
    const hash = stableHash(stripLegacyVolatile(data));
    if (hash === app.lastLegacyHash) return;
    app.lastLegacyHash = hash;

    sendOperation("legacy.replace", {
      data: clone(data),
      summary: summary || "原有功能内容更新"
    }, { local: false });
  }

  function applyLegacyState(nextState, remoteToast) {
    if (!nextState) return;
    try {
      app.applyingRemote = true;
      state = typeof mergeState === "function" ? mergeState(nextState) : clone(nextState);
      if (app.originalPersistNow) {
        app.originalPersistNow.call(window, {});
      } else if (typeof STORAGE_KEY !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      if (typeof renderAll === "function") renderAll();
      if (typeof switchTab === "function" && typeof activeTab !== "undefined") switchTab(activeTab);
      app.lastLegacyHash = stableHash(stripLegacyVolatile(state));
      if (remoteToast) toast("对方更新了原有功能内容，已同步到本机。");
    } catch (error) {
      console.warn("Cannot apply legacy state.", error);
    } finally {
      app.applyingRemote = false;
    }
  }

  function reduceRealtimeOperation(op) {
    const at = op.serverTime || new Date().toISOString();
    const realtime = app.realtime = normalizeRealtime(app.realtime);
    const payload = op.payload || {};
    const actorName = op.actor && op.actor.name || "对方";
    const actorId = op.actor && op.actor.id || "";

    if (op.type === "theme.set") {
      realtime.theme = payload.theme === "night" ? "night" : "macaron";
      applyTheme(realtime.theme);
    }

    if (op.type === "mood.check") {
      const date = payload.date || today();
      realtime.moods[date] ||= {};
      realtime.moods[date][actorId] = {
        mood: payload.mood || "开心",
        note: payload.note || "",
        actor: actorId,
        actorName,
        updatedAt: at
      };
    }

    if (op.type === "task.add") {
      realtime.tasks.unshift(withActor({
        id: payload.id || uuid(),
        title: payload.title || "",
        detail: payload.detail || "",
        done: false,
        createdAt: at
      }, op, at));
    }

    if (op.type === "task.update") {
      updateItem(realtime.tasks, payload.id, payload.patch || {}, op, at);
    }

    if (op.type === "task.delete") {
      realtime.tasks = realtime.tasks.filter((item) => item.id !== payload.id);
    }

    if (op.type === "tree.water") {
      const amount = Math.max(1, Math.min(10, Number(payload.amount || 1)));
      realtime.tree.water += amount;
      realtime.tree.totalWater += amount;
      realtime.tree.level = Math.max(1, Math.floor(realtime.tree.totalWater / 8) + 1);
      realtime.tree.lastWateredBy = actorName;
      realtime.tree.history = (realtime.tree.history || []).concat(withActor({ amount }, op, at)).slice(-80);
    }

    if (op.type === "doodle.stroke") {
      realtime.doodle.strokes = (realtime.doodle.strokes || []).concat(withActor({
        id: payload.id || uuid(),
        color: payload.color || "#ff9fb5",
        size: Number(payload.size || 4),
        points: Array.isArray(payload.points) ? payload.points : []
      }, op, at)).slice(-350);
      drawDoodle();
    }

    if (op.type === "doodle.clear") {
      realtime.doodle.strokes = [];
      drawDoodle();
    }

    if (op.type === "doodle.saved") {
      realtime.doodle.savedAt = at;
      realtime.doodle.savedBy = actorName;
    }

    if (op.type === "music.addTrack") {
      realtime.music.playlist = (realtime.music.playlist || []).concat(withActor({
        id: payload.id || uuid(),
        title: payload.title || "未命名音乐",
        url: payload.url || "",
        createdAt: at
      }, op, at)).slice(-80);
    }

    if (op.type === "music.deleteTrack") {
      realtime.music.playlist = (realtime.music.playlist || []).filter((item) => item.id !== payload.id);
      if (realtime.music.currentId === payload.id) {
        Object.assign(realtime.music, { currentId: "", title: "", url: "", isPlaying: false, currentTime: 0 });
      }
    }

    if (op.type === "music.state") {
      realtime.music = { ...realtime.music, ...payload, updatedAt: at, updatedBy: actorName };
    }

    if (op.type === "miss-you") {
      realtime.missYouEvents = (realtime.missYouEvents || []).concat(withActor({
        id: payload.id || uuid(),
        message: payload.message || "我想你啦"
      }, op, at)).slice(-60);
    }

    if (op.type === "list.add") {
      const list = getSharedList(payload.list);
      list.unshift(withActor({
        id: payload.id || uuid(),
        text: payload.text || "",
        note: payload.note || "",
        date: payload.date || "",
        done: false,
        createdAt: at
      }, op, at));
    }

    if (op.type === "list.update") {
      updateItem(getSharedList(payload.list), payload.id, payload.patch || {}, op, at);
    }

    if (op.type === "list.delete") {
      const key = normalizeList(payload.list);
      realtime.lists[key] = getSharedList(key).filter((item) => item.id !== payload.id);
    }

    if (op.type === "calm.add") {
      realtime.calmMemos.unshift(withActor({
        id: payload.id || uuid(),
        title: payload.title || "",
        text: payload.text || "",
        createdAt: at
      }, op, at));
    }

    if (op.type === "calm.update") {
      updateItem(realtime.calmMemos, payload.id, payload.patch || {}, op, at);
    }

    if (op.type === "calm.delete") {
      realtime.calmMemos = realtime.calmMemos.filter((item) => item.id !== payload.id);
    }

    if (op.type === "quiz.reset") {
      realtime.quiz.active = {
        id: payload.id || uuid(),
        createdAt: at,
        createdBy: actorName,
        answers: {}
      };
    }

    if (op.type === "quiz.answer") {
      realtime.quiz.active ||= {
        id: uuid(),
        createdAt: at,
        createdBy: actorName,
        answers: {}
      };
      realtime.quiz.active.answers[actorId] ||= {};
      realtime.quiz.active.answers[actorId][payload.questionId] = {
        answer: payload.answer || "",
        updatedAt: at,
        actorName
      };
    }
  }

  function renderAddon() {
    ensureStatusChips();
    renderHomeAddon();
    renderAlbumAddon();
    renderToolsAddon();
    renderGamesAddon();
    renderSettingsAddon();
    updateConnectionStatus();
    setupDoodleCanvas();
    applyTheme(app.realtime.theme || "macaron");
    applyMusicToElement();
  }

  function deferRender() {
    clearTimeout(app.renderTimer);
    app.renderTimer = setTimeout(renderAddon, 60);
  }

  function renderHomeAddon() {
    const root = ensureMount("tab-home", "rtHome", "rt-section");
    if (!root) return;

    const moods = app.realtime.moods[today()] || {};
    const myMood = moods[app.user && app.user.id] || null;
    const anniversaryReminders = getAnniversaryReminders();

    root.innerHTML = `
      <section class="section-head">
        <h2>实时双人互动</h2>
        <p>在线、思念、心情、小任务和恋爱小树都会同步到对方屏幕。</p>
      </section>
      <div class="rt-grid two">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>在线状态</h3>
            <span>${app.connected ? "云端已连接" : "离线缓存中"}</span>
          </div>
          <div class="rt-presence-list">${renderPresenceRows()}</div>
          <div class="rt-inline">
            <button class="primary" data-rt="miss-you">${safeIcon("play")}发送思念</button>
            <span class="rt-meta">对方会收到全屏爱心提醒</span>
          </div>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>今日情绪打卡</h3>
            <span>${today()}</span>
          </div>
          <div class="rt-mood-buttons">
            ${moodOptions.map((mood) => `<button class="${(myMood && myMood.mood === mood) || app.selectedMood === mood ? "active" : ""}" data-rt="mood-select" data-mood="${esc(mood)}">${esc(mood)}</button>`).join("")}
          </div>
          <label>
            今天想补一句
            <textarea id="rtMoodNote" placeholder="写给对方看的心情小纸条">${esc(myMood && myMood.note || "")}</textarea>
          </label>
          <button class="primary" data-rt="mood-save">${safeIcon("save")}保存今日心情</button>
          <div class="rt-grid two">${renderMoodCards(moods)}</div>
        </div>
      </div>
      <div class="rt-grid two rt-section">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>甜蜜小任务</h3>
            <span>${completedTasks()} / ${app.realtime.tasks.length} 已完成</span>
          </div>
          <div class="rt-form-row">
            <label>任务<input id="rtTaskTitle" placeholder="例如：今晚睡前互发一句夸夸"></label>
            <label>备注<input id="rtTaskDetail" placeholder="可选"></label>
            <button class="primary" data-rt="task-add">${safeIcon("plus")}发送</button>
          </div>
          <div class="rt-stack">${renderSweetTasks()}</div>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>恋爱小树</h3>
            <span>Lv.${app.realtime.tree.level}</span>
          </div>
          <div class="rt-tree-stage">
            <div class="rt-tree" style="--tree-size:${Math.min(128, 74 + app.realtime.tree.level * 8)}px">
              <div class="rt-tree-crown"></div>
              <div class="rt-tree-trunk"></div>
              <div class="rt-tree-pot"></div>
            </div>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${treeProgress()}%"></div></div>
          <div class="rt-inline">
            <button class="primary" data-rt="tree-water">一起浇水</button>
            <span class="rt-meta">累计 ${app.realtime.tree.totalWater} 滴，上次 ${esc(app.realtime.tree.lastWateredBy || "还没有浇水")}</span>
          </div>
        </div>
      </div>
      <div class="rt-grid two rt-section">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>纪念日提醒</h3>
            <span>7 天内</span>
          </div>
          ${anniversaryReminders.length ? anniversaryReminders.map((item) => `
            <div class="rt-item">
              <strong>${esc(item.title)}</strong>
              <p>${esc(item.date)}，还有 ${item.days} 天</p>
            </div>
          `).join("") : `<div class="empty">最近 7 天没有临近纪念日。</div>`}
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>数据统计</h3>
            <span>自动汇总</span>
          </div>
          ${renderStats()}
        </div>
      </div>
    `;
  }

  function renderAlbumAddon() {
    const root = ensureMount("tab-album", "rtAlbum", "rt-section");
    if (!root) return;
    root.innerHTML = `
      <section class="section-head">
        <h2>双人实时涂鸦</h2>
        <p>两个人画在同一张画布上，保存后会进入原相册。</p>
      </section>
      <div class="panel rt-doodle-shell">
        <div class="rt-doodle-tools">
          <label>颜色<input id="rtDoodleColor" type="color" value="#ff9fb5"></label>
          <label>笔触<input id="rtDoodleSize" type="range" min="2" max="18" value="5"></label>
          <button class="ghost" data-rt="doodle-clear">清空</button>
          <button class="primary" data-rt="doodle-save">${safeIcon("save")}保存到相册</button>
        </div>
        <canvas id="rtDoodleCanvas" width="1200" height="750"></canvas>
        <p class="small-note">已同步 ${app.realtime.doodle.strokes.length} 笔${app.realtime.doodle.savedBy ? `，上次由 ${esc(app.realtime.doodle.savedBy)} 保存` : ""}。</p>
      </div>
    `;
  }

  function renderToolsAddon() {
    const root = ensureMount("tab-tools", "rtTools", "rt-section");
    if (!root) return;
    root.innerHTML = `
      <section class="section-head">
        <h2>共同计划和音乐</h2>
        <p>音乐、旅行、约会、购物和冷静备忘录都支持实时同步。</p>
      </section>
      <div class="rt-grid two">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>同步音乐播放器</h3>
            <span>${esc(app.realtime.music.updatedBy || "等待切歌")}</span>
          </div>
          <div class="rt-music-now">${esc(app.realtime.music.title || "还没有选择音乐")}</div>
          <audio id="rtMusicAudio" class="rt-audio" controls></audio>
          <div class="rt-form-row">
            <label>音乐标题<input id="rtMusicTitle" placeholder="歌名或心情"></label>
            <label>音乐链接<input id="rtMusicUrl" placeholder="https://... 或选择本地音频"></label>
            <button class="primary" data-rt="music-add">${safeIcon("plus")}加入</button>
          </div>
          <label>本地音频
            <input id="rtMusicFile" type="file" accept="audio/*">
          </label>
          <div class="rt-stack">${renderMusicTracks()}</div>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>共享清单</h3>
            <span>${esc(listLabels[app.listTab])}</span>
          </div>
          <div class="rt-list-tabs">
            ${Object.entries(listLabels).map(([key, label]) => `<button class="${app.listTab === key ? "active" : ""}" data-rt="list-tab" data-list="${key}">${label}</button>`).join("")}
          </div>
          <div class="rt-form-row">
            <label>事项<input id="rtListText" placeholder="写一个共同计划"></label>
            <label>日期/备注<input id="rtListNote" placeholder="可选"></label>
            <button class="primary" data-rt="list-add">${safeIcon("plus")}添加</button>
          </div>
          <div class="rt-stack">${renderSharedList(app.listTab)}</div>
        </div>
      </div>
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>矛盾冷静备忘录</h3>
          <span>温柔复盘</span>
        </div>
        <div class="rt-form-row">
          <label>标题<input id="rtCalmTitle" placeholder="例如：关于沟通节奏"></label>
          <label>备忘<textarea id="rtCalmText" placeholder="只记录事实、感受、需要和下次约定"></textarea></label>
          <button class="primary" data-rt="calm-add">${safeIcon("plus")}保存</button>
        </div>
        <div class="rt-stack">${renderCalmMemos()}</div>
      </div>
    `;
  }

  function renderGamesAddon() {
    const root = ensureMount("tab-games", "rtGames", "rt-section");
    if (!root) return;
    const active = app.realtime.quiz.active || { answers: {} };
    root.innerHTML = `
      <section class="section-head">
        <h2>双人默契答题</h2>
        <p>两个人各自作答，完成后自动生成默契分数报告。</p>
      </section>
      <div class="panel rt-stack">
        <div class="rt-card-title">
          <h3>默契测试</h3>
          <button class="ghost" data-rt="quiz-reset">重新开始</button>
        </div>
        ${quizQuestions.map((question, index) => renderQuizQuestion(question, index, active)).join("")}
        ${renderQuizReport(active)}
      </div>
    `;
  }

  function renderSettingsAddon() {
    const root = ensureMount("tab-settings", "rtSettings", "rt-section");
    if (!root) return;
    root.innerHTML = `
      <section class="section-head">
        <h2>实时同步设置</h2>
        <p>账号、主题和原有功能云端同步状态。</p>
      </section>
      <div class="rt-grid two">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>情侣账号</h3>
            <span>${app.user ? esc(app.user.name) : "未登录"}</span>
          </div>
          <p class="small-note">原访问密码仍由原设置页维护；情侣 A/B 账号由服务器 .env 配置。</p>
          <div class="rt-inline">
            <button class="primary" data-rt="push-now">${safeIcon("refresh")}立即同步原功能</button>
            <button class="ghost" data-rt="logout">切换账号</button>
          </div>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>双主题</h3>
            <span>云端同步</span>
          </div>
          <div class="rt-theme-toggle">
            <button class="${app.realtime.theme !== "night" ? "active" : ""}" data-rt="theme" data-theme="macaron">原版马卡龙</button>
            <button class="${app.realtime.theme === "night" ? "active" : ""}" data-rt="theme" data-theme="night">暗夜温柔</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderPresenceRows() {
    const rows = app.presence.length ? app.presence : [
      { id: "A", name: "情侣A", online: app.user && app.user.id === "A", activity: "等待连接" },
      { id: "B", name: "情侣B", online: app.user && app.user.id === "B", activity: "等待连接" }
    ];

    return rows.map((item) => `
      <div class="rt-presence-row">
        <span class="rt-dot ${item.online ? "online" : ""}"></span>
        <strong>${esc(item.name)}${app.user && app.user.id === item.id ? "（我）" : ""}</strong>
        <span class="rt-meta">${item.online ? esc(item.activity || "在线") : "离线"}</span>
      </div>
    `).join("");
  }

  function renderMoodCards(moods) {
    const ids = ["A", "B"];
    return ids.map((id) => {
      const item = moods[id];
      return `
        <div class="rt-item">
          <strong>${id === "A" ? "情侣A" : "情侣B"}：${esc(item && item.mood || "未打卡")}</strong>
          <p>${esc(item && item.note || "今天还没有留下心情。")}</p>
          ${item ? `<span class="rt-badge rt-actor-tag">${esc(item.actorName || id)}</span>` : ""}
        </div>
      `;
    }).join("");
  }

  function renderSweetTasks() {
    if (!app.realtime.tasks.length) return `<div class="empty">还没有小任务，发一个给对方吧。</div>`;
    return app.realtime.tasks.slice(0, 12).map((item) => `
      <div class="rt-item ${item.done ? "done" : ""}">
        <strong>${esc(item.title || "未命名任务")}</strong>
        <p>${esc(item.detail || "没有备注")}</p>
        <div class="rt-inline">
          <button class="ghost" data-rt="task-toggle" data-id="${esc(item.id)}" data-done="${item.done ? "true" : "false"}">${item.done ? "恢复" : "完成"}</button>
          <button class="danger" data-rt="task-delete" data-id="${esc(item.id)}">删除</button>
          <span class="rt-badge">${esc(item.actorName || item.updatedBy || "我们")}</span>
        </div>
      </div>
    `).join("");
  }

  function renderMusicTracks() {
    const playlist = app.realtime.music.playlist || [];
    if (!playlist.length) return `<div class="empty">可添加链接或本地音频，切歌和暂停会同步。</div>`;
    return playlist.slice().reverse().map((item) => `
      <div class="rt-item">
        <strong>${esc(item.title)}</strong>
        <div class="rt-inline">
          <button class="primary" data-rt="music-select" data-id="${esc(item.id)}">${safeIcon("play")}切换</button>
          <button class="danger" data-rt="music-delete" data-id="${esc(item.id)}">删除</button>
          <span class="rt-badge">${esc(item.actorName || "我们")}</span>
        </div>
      </div>
    `).join("");
  }

  function renderSharedList(key) {
    const list = getSharedList(key);
    if (!list.length) return `<div class="empty">${esc(listLabels[key])} 还是空的。</div>`;
    return list.map((item) => `
      <div class="rt-item ${item.done ? "done" : ""}">
        <strong>${esc(item.text)}</strong>
        <p>${esc(item.note || item.date || "没有备注")}</p>
        <div class="rt-inline">
          <button class="ghost" data-rt="list-toggle" data-list="${key}" data-id="${esc(item.id)}" data-done="${item.done ? "true" : "false"}">${item.done ? "恢复" : "完成"}</button>
          <button class="danger" data-rt="list-delete" data-list="${key}" data-id="${esc(item.id)}">删除</button>
          <span class="rt-badge">${esc(item.actorName || "我们")}</span>
        </div>
      </div>
    `).join("");
  }

  function renderCalmMemos() {
    if (!app.realtime.calmMemos.length) return `<div class="empty">还没有冷静备忘录。</div>`;
    return app.realtime.calmMemos.slice(0, 8).map((item) => `
      <div class="rt-item">
        <strong>${esc(item.title || "未命名备忘")}</strong>
        <p>${esc(item.text)}</p>
        <div class="rt-inline">
          <button class="danger" data-rt="calm-delete" data-id="${esc(item.id)}">删除</button>
          <span class="rt-badge">${esc(item.actorName || "我们")}</span>
        </div>
      </div>
    `).join("");
  }

  function renderQuizQuestion(question, index, active) {
    const mine = app.user && active.answers && active.answers[app.user.id] && active.answers[app.user.id][question.id];
    return `
      <div class="rt-item">
        <strong>${index + 1}. ${esc(question.text)}</strong>
        <div class="rt-quiz-options">
          ${question.options.map((option) => `
            <button class="${mine && mine.answer === option ? "active" : ""}" data-rt="quiz-answer" data-question="${question.id}" data-answer="${esc(option)}">${esc(option)}</button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderQuizReport(active) {
    const answers = active.answers || {};
    const a = answers.A || {};
    const b = answers.B || {};
    const both = quizQuestions.filter((q) => a[q.id] && b[q.id]);
    const same = both.filter((q) => a[q.id].answer === b[q.id].answer);
    const score = both.length ? Math.round(same.length / quizQuestions.length * 100) : 0;
    const done = both.length === quizQuestions.length;

    return `
      <div class="tool-result">
        已共同完成 ${both.length} / ${quizQuestions.length} 题。${done ? `默契分数 ${score} 分，${score >= 80 ? "非常同频" : score >= 50 ? "还有很多可爱差异" : "适合认真聊聊彼此的小习惯"}。` : "等两个人都答完后自动出报告。"}
      </div>
    `;
  }

  function renderStats() {
    const legacy = getLegacyState() || {};
    const collections = legacy.collections || {};
    const diary = Array.isArray(collections.diary) ? collections.diary.length : 0;
    const album = Array.isArray(legacy.album) ? legacy.album.length : 0;
    const moods = Object.values(app.realtime.moods || {}).reduce((sum, day) => sum + Object.keys(day || {}).length, 0);
    const tasks = app.realtime.tasks.filter((item) => item.done).length;
    const days = loveDays(legacy.profile && legacy.profile.startDate);

    return `
      <div class="rt-stat-grid">
        <div class="rt-stat"><strong>${days}</strong><span>相恋天数</span></div>
        <div class="rt-stat"><strong>${diary}</strong><span>日记</span></div>
        <div class="rt-stat"><strong>${album}</strong><span>照片</span></div>
        <div class="rt-stat"><strong>${moods}</strong><span>打卡</span></div>
        <div class="rt-stat"><strong>${tasks}</strong><span>任务完成</span></div>
        <div class="rt-stat"><strong>${app.realtime.tree.level}</strong><span>小树等级</span></div>
        <div class="rt-stat"><strong>${getSharedList("travel").length}</strong><span>旅行</span></div>
        <div class="rt-stat"><strong>${getSharedList("shopping").length}</strong><span>购物</span></div>
      </div>
    `;
  }

  function showAccountLayer() {
    if (document.getElementById("rtAccountLayer") || app.user) return;
    const layer = document.createElement("div");
    layer.id = "rtAccountLayer";
    layer.className = "rt-account-layer";
    layer.innerHTML = `
      <div class="modal">
        <div class="brand-mark" style="margin:0 auto">♡</div>
        <h2>登录情侣账号</h2>
        <p class="small-note">先保留原访问密码，再用 A/B 独立账号标记操作人并开启实时同步。</p>
        <label>账号<input id="rtLoginUser" autocomplete="username" placeholder="A 或 B"></label>
        <label>密码<input id="rtLoginPassword" type="password" autocomplete="current-password" placeholder="服务器 .env 中设置的密码"></label>
        <button class="primary" data-rt="login">进入实时小窝</button>
        <button class="ghost" data-rt="close-account-layer">先离线使用</button>
      </div>
    `;
    document.body.appendChild(layer);
    setTimeout(() => document.getElementById("rtLoginUser")?.focus(), 40);
  }

  function hideAccountLayer() {
    document.getElementById("rtAccountLayer")?.remove();
  }

  function waitForUnlockThen(callback) {
    const tick = () => {
      const appNode = document.getElementById("app");
      if (appNode && !appNode.classList.contains("hidden")) {
        callback();
      } else {
        setTimeout(tick, 400);
      }
    };
    tick();
  }

  function ensureStatusChips() {
    const strip = document.querySelector(".status-strip");
    if (!strip) return;
    ensureChip(strip, "rtConnectStatus", "实时同步准备中");
    ensureChip(strip, "rtAccountStatus", "未登录情侣账号");
    ensureChip(strip, "rtOtherStatus", "对方离线");
  }

  function ensureChip(strip, id, text) {
    if (document.getElementById(id)) return;
    const chip = document.createElement("span");
    chip.id = id;
    chip.className = "chip";
    chip.textContent = text;
    strip.appendChild(chip);
  }

  function updateConnectionStatus(text) {
    setText("rtConnectStatus", text || (app.connected ? "实时同步已连接" : navigator.onLine ? "实时同步未连接" : "离线缓存中"));
    setText("rtAccountStatus", app.user ? `当前：${app.user.name}` : "未登录情侣账号");
    const other = app.presence.find((item) => app.user && item.id !== app.user.id);
    setText("rtOtherStatus", other && other.online ? `${other.name} 在线` : "对方离线");
  }

  function setupDoodleCanvas() {
    const canvas = document.getElementById("rtDoodleCanvas");
    if (!canvas || canvas.__rtReady) {
      drawDoodle();
      return;
    }

    canvas.__rtReady = true;
    resizeCanvas(canvas);
    const observer = new ResizeObserver(() => {
      resizeCanvas(canvas);
      drawDoodle();
    });
    observer.observe(canvas);

    let drawing = null;
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      drawing = {
        id: uuid(),
        color: valueOf("rtDoodleColor") || "#ff9fb5",
        size: Number(valueOf("rtDoodleSize") || 5),
        points: [pointFromEvent(canvas, event)]
      };
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing) return;
      drawing.points.push(pointFromEvent(canvas, event));
      drawDoodle(drawing);
    });
    canvas.addEventListener("pointerup", () => finishStroke());
    canvas.addEventListener("pointercancel", () => finishStroke());

    function finishStroke() {
      if (!drawing || drawing.points.length < 2) {
        drawing = null;
        return;
      }
      sendOperation("doodle.stroke", drawing);
      drawing = null;
    }

    drawDoodle();
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(600, Math.round(rect.width * ratio));
    const height = Math.max(360, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function drawDoodle(extraStroke) {
    const canvas = document.getElementById("rtDoodleCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    (app.realtime.doodle.strokes || []).forEach((stroke) => drawStroke(ctx, canvas, stroke));
    if (extraStroke) drawStroke(ctx, canvas, extraStroke);
  }

  function drawStroke(ctx, canvas, stroke) {
    const points = stroke.points || [];
    if (points.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke.color || "#ff9fb5";
    ctx.lineWidth = Number(stroke.size || 4) * (window.devicePixelRatio || 1);
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function pointFromEvent(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  }

  function saveDoodleToAlbum() {
    const canvas = document.getElementById("rtDoodleCanvas");
    if (!canvas) return;
    try {
      const image = canvas.toDataURL("image/png");
      if (typeof state !== "undefined") {
        state.album ||= [];
        state.album.unshift({
          src: image,
          caption: `双人涂鸦 ${new Date().toLocaleString()}`,
          createdAt: new Date().toISOString(),
          actor: app.user && app.user.id || "",
          actorName: app.user && app.user.name || "离线"
        });
        if (typeof persistNow === "function") persistNow({ toast: "涂鸦已保存到相册。" });
        if (typeof renderAlbum === "function") renderAlbum();
      }
      sendOperation("doodle.saved", {});
    } catch (error) {
      toast("保存涂鸦失败，请稍后再试。");
    }
  }

  function addMusicTrack(titleArg, urlArg) {
    const title = titleArg || valueOf("rtMusicTitle").trim();
    const url = urlArg || valueOf("rtMusicUrl").trim();
    if (!title || !url) {
      toast("请填写音乐标题和链接，或选择本地音频。");
      return;
    }
    sendOperation("music.addTrack", { id: uuid(), title, url });
    setValue("rtMusicTitle", "");
    setValue("rtMusicUrl", "");
  }

  function selectMusicTrack(id) {
    const track = (app.realtime.music.playlist || []).find((item) => item.id === id);
    if (!track) return;
    sendOperation("music.state", {
      currentId: track.id,
      title: track.title,
      url: track.url,
      currentTime: 0,
      isPlaying: true,
      volume: app.realtime.music.volume || 0.65
    });
    setTimeout(applyMusicToElement, 80);
  }

  function deleteMusicTrack(id) {
    sendOperation("music.deleteTrack", { id });
  }

  function setMusicPlayback(isPlaying) {
    const audio = document.getElementById("rtMusicAudio");
    sendOperation("music.state", {
      ...app.realtime.music,
      isPlaying,
      currentTime: audio ? audio.currentTime : app.realtime.music.currentTime || 0,
      volume: audio ? audio.volume : app.realtime.music.volume || 0.65
    });
  }

  function applyMusicToElement() {
    const audio = document.getElementById("rtMusicAudio");
    if (!audio) return;
    const music = app.realtime.music || {};
    if (music.url && audio.src !== music.url) audio.src = music.url;
    if (typeof music.volume === "number") audio.volume = music.volume;
    if (Number.isFinite(Number(music.currentTime)) && Math.abs(audio.currentTime - Number(music.currentTime)) > 2) {
      try { audio.currentTime = Number(music.currentTime); } catch (error) {}
    }
    if (music.isPlaying) {
      audio.play().catch(() => {
        setText("rtConnectStatus", "音乐等待点击授权播放");
      });
    } else {
      audio.pause();
    }

    if (!audio.__rtReady) {
      audio.__rtReady = true;
      audio.addEventListener("play", () => {
        if (app.realtime.music.isPlaying) return;
        setMusicPlayback(true);
      });
      audio.addEventListener("pause", () => {
        if (!app.realtime.music.isPlaying) return;
        setMusicPlayback(false);
      });
      audio.addEventListener("seeked", () => setMusicPlayback(!audio.paused));
      audio.addEventListener("volumechange", () => setMusicPlayback(!audio.paused));
    }
  }

  function setTheme(theme) {
    sendOperation("theme.set", { theme });
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle("rt-theme-night", theme === "night");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#17151f" : "#fff3f6");
  }

  function sendMissYou() {
    const messages = ["我想你啦", "想马上见到你", "给你一个远程抱抱", "今天也很喜欢你"];
    const message = messages[Math.floor(Math.random() * messages.length)];
    sendOperation("miss-you", { id: uuid(), message });
    showHeartBlast(app.user && app.user.name, message);
  }

  function showHeartBlast(actorName, message) {
    const blast = document.createElement("div");
    blast.className = "rt-heart-blast";
    blast.innerHTML = `<strong>${esc(actorName || "对方")}：${esc(message || "我想你啦")}</strong>`;
    for (let index = 0; index < 32; index += 1) {
      const heart = document.createElement("span");
      heart.className = "rt-heart";
      heart.textContent = "♡";
      heart.style.setProperty("--x", `${Math.random() * 100}%`);
      heart.style.setProperty("--s", `${18 + Math.random() * 34}px`);
      heart.style.setProperty("--d", `${2.4 + Math.random() * 1.8}s`);
      blast.appendChild(heart);
    }
    document.body.appendChild(blast);
    setTimeout(() => blast.remove(), 3600);
  }

  function selectMood(mood) {
    app.selectedMood = mood || "开心";
    renderAddon();
  }

  function saveMood() {
    sendOperation("mood.check", {
      date: today(),
      mood: app.selectedMood,
      note: valueOf("rtMoodNote").trim()
    });
  }

  function addSweetTask() {
    const title = valueOf("rtTaskTitle").trim();
    const detail = valueOf("rtTaskDetail").trim();
    if (!title) {
      toast("先写一个甜蜜小任务。");
      return;
    }
    sendOperation("task.add", { id: uuid(), title, detail });
    setValue("rtTaskTitle", "");
    setValue("rtTaskDetail", "");
  }

  function updateSweetTask(id, patch) {
    sendOperation("task.update", { id, patch });
  }

  function deleteSweetTask(id) {
    sendOperation("task.delete", { id });
  }

  function waterTree() {
    sendOperation("tree.water", { amount: 1 });
  }

  function addSharedListItem() {
    const text = valueOf("rtListText").trim();
    const note = valueOf("rtListNote").trim();
    if (!text) {
      toast("先写一个清单事项。");
      return;
    }
    sendOperation("list.add", { list: app.listTab, id: uuid(), text, note });
    setValue("rtListText", "");
    setValue("rtListNote", "");
  }

  function updateSharedListItem(list, id, patch) {
    sendOperation("list.update", { list, id, patch });
  }

  function deleteSharedListItem(list, id) {
    sendOperation("list.delete", { list, id });
  }

  function addCalmMemo() {
    const title = valueOf("rtCalmTitle").trim();
    const text = valueOf("rtCalmText").trim();
    if (!title && !text) {
      toast("先写一点需要被温柔记住的内容。");
      return;
    }
    sendOperation("calm.add", { id: uuid(), title, text });
    setValue("rtCalmTitle", "");
    setValue("rtCalmText", "");
  }

  function deleteCalmMemo(id) {
    sendOperation("calm.delete", { id });
  }

  function answerQuiz(questionId, answer) {
    sendOperation("quiz.answer", { questionId, answer });
  }

  function resetQuiz() {
    sendOperation("quiz.reset", { id: uuid() });
  }

  function notifyRemote(op) {
    const actor = op.actor && op.actor.name || "对方";
    const map = {
      "legacy.replace": "更新了原有页面内容",
      "mood.check": "完成了今日情绪打卡",
      "task.add": "发来一个甜蜜小任务",
      "task.update": "更新了甜蜜小任务",
      "tree.water": "给恋爱小树浇了水",
      "doodle.stroke": "在涂鸦画板画了一笔",
      "doodle.saved": "把涂鸦保存到了相册",
      "music.state": "同步了音乐播放器",
      "music.addTrack": "添加了一首音乐",
      "miss-you": "发送了思念提醒",
      "list.add": "更新了共享清单",
      "calm.add": "写下了冷静备忘录",
      "quiz.answer": "回答了一道默契题",
      "theme.set": "切换了主题"
    };
    toast(`${actor}${map[op.type] || "更新了内容"}。`);
  }

  function sendActivity(activity) {
    clearTimeout(app.activityTimer);
    app.activityTimer = setTimeout(() => {
      if (app.socket && app.socket.readyState === WebSocket.OPEN) {
        app.socket.send(JSON.stringify({ type: "presence.activity", activity }));
      }
    }, 180);
  }

  function actionName(action) {
    const map = {
      "miss-you": "发送思念",
      "mood-save": "保存心情",
      "task-add": "发送任务",
      "tree-water": "照顾小树",
      "doodle-save": "保存涂鸦",
      "music-play": "播放音乐",
      "music-pause": "暂停音乐",
      "list-add": "更新清单",
      "quiz-answer": "回答默契题"
    };
    return map[action] || "正在操作";
  }

  function markLegacyContent(target) {
    if (!target && typeof state !== "undefined") target = state;
    if (!target || !app.user) return;

    const actor = app.user.id;
    const actorName = app.user.name;
    const stamp = new Date().toISOString();
    const arrays = [];

    if (Array.isArray(target.album)) arrays.push(target.album);
    if (Array.isArray(target.checklist)) arrays.push(target.checklist);
    if (target.collections) {
      Object.values(target.collections).forEach((value) => {
        if (Array.isArray(value)) arrays.push(value);
      });
    }

    arrays.forEach((list) => {
      list.forEach((item) => {
        if (item && typeof item === "object" && !item.actorName) {
          item.actor = actor;
          item.actorName = actorName;
          item.updatedBy = actorName;
          item.updatedAt = item.updatedAt || stamp;
        }
      });
    });
  }

  function getLegacyState() {
    try {
      if (typeof state !== "undefined") return state;
    } catch (error) {}
    return null;
  }

  function getLegacyTime(data) {
    return Date.parse(data && data.lastSavedAt || "") || 0;
  }

  function getAnniversaryReminders() {
    const legacy = getLegacyState() || {};
    const anniversaries = legacy.collections && Array.isArray(legacy.collections.anniversaries)
      ? legacy.collections.anniversaries
      : [];

    return anniversaries
      .map((item) => {
        const date = nextDate(item.date);
        if (!date) return null;
        const days = Math.ceil((date.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000);
        return { title: item.title || "纪念日", date: item.date, days };
      })
      .filter((item) => item && item.days >= 0 && item.days <= 7)
      .sort((a, b) => a.days - b.days);
  }

  function nextDate(input) {
    if (!input) return null;
    const parsed = new Date(input);
    if (Number.isNaN(parsed.getTime())) return null;
    const now = new Date();
    const next = new Date(now.getFullYear(), parsed.getMonth(), parsed.getDate());
    if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
      next.setFullYear(now.getFullYear() + 1);
    }
    return next;
  }

  function defaultRealtimeState() {
    return {
      schema: 2,
      theme: "macaron",
      moods: {},
      tasks: [],
      tree: { level: 1, water: 0, totalWater: 0, lastWateredBy: "", history: [] },
      doodle: { strokes: [], savedAt: "" },
      music: { playlist: [], currentId: "", title: "", url: "", isPlaying: false, currentTime: 0, volume: 0.65, updatedAt: "" },
      quiz: { active: { id: uuid(), createdAt: new Date().toISOString(), createdBy: "系统", answers: {} }, reports: [] },
      lists: { travel: [], dates: [], shopping: [] },
      calmMemos: [],
      missYouEvents: [],
      anniversaryAcks: {}
    };
  }

  function normalizeRealtime(input) {
    return deepMerge(defaultRealtimeState(), input || {});
  }

  function deepMerge(target, source) {
    if (Array.isArray(source)) return source.slice();
    if (!source || typeof source !== "object") return target;
    const output = { ...target };
    Object.entries(source).forEach(([key, value]) => {
      if (Array.isArray(value)) output[key] = value.slice();
      else if (value && typeof value === "object") output[key] = deepMerge(output[key] && typeof output[key] === "object" ? output[key] : {}, value);
      else output[key] = value;
    });
    return output;
  }

  function withActor(item, op, at) {
    return {
      ...item,
      actor: op.actor && op.actor.id || "",
      actorName: op.actor && op.actor.name || "",
      updatedBy: op.actor && op.actor.name || "",
      updatedAt: at
    };
  }

  function updateItem(list, id, patch, op, at) {
    const item = Array.isArray(list) ? list.find((entry) => entry.id === id) : null;
    if (!item) return;
    Object.assign(item, patch, {
      updatedBy: op.actor && op.actor.name || "",
      updatedAt: at
    });
  }

  function getSharedList(key) {
    key = normalizeList(key);
    app.realtime.lists ||= { travel: [], dates: [], shopping: [] };
    app.realtime.lists[key] ||= [];
    return app.realtime.lists[key];
  }

  function normalizeList(key) {
    return ["travel", "dates", "shopping"].includes(key) ? key : "travel";
  }

  function ensureMount(tabId, id, className) {
    const tab = document.getElementById(tabId);
    if (!tab) return null;
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement("div");
      node.id = id;
      node.className = className || "";
      tab.appendChild(node);
    }
    return node;
  }

  function treeProgress() {
    return Math.round((app.realtime.tree.totalWater % 8) / 8 * 100);
  }

  function completedTasks() {
    return app.realtime.tasks.filter((item) => item.done).length;
  }

  function loveDays(startDate) {
    const start = Date.parse(startDate || "");
    if (!start) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 86400000) + 1);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function uuid() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `rt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getClientId() {
    const key = "sweetHomeRealtimeClientIdV2";
    let id = localStorage.getItem(key);
    if (!id) {
      id = uuid();
      localStorage.setItem(key, id);
    }
    return id;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stableHash(value) {
    const text = JSON.stringify(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function stripLegacyVolatile(value) {
    const data = clone(value);
    delete data.lastSavedAt;
    return data;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (file.size > 8 * 1024 * 1024) {
        reject(new Error("音频文件超过 8MB，建议使用链接。"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch((error) => {
      toast(error.message || "读取文件失败。");
      return "";
    });
  }

  function valueOf(id) {
    return document.getElementById(id)?.value || "";
  }

  function setValue(id, value) {
    const node = document.getElementById(id);
    if (node) node.value = value;
  }

  function setText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function safeIcon(name) {
    try {
      if (typeof icon === "function") return icon(name);
    } catch (error) {}
    return "";
  }

  function toast(message) {
    try {
      if (typeof showToast === "function") {
        showToast(message);
        return;
      }
    } catch (error) {}
    console.log(message);
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
})();
