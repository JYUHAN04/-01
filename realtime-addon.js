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
    truthDareCategory: "daily",
    truthDareMode: "truth",
    // [新增] 本轮新增模块的本地 UI 状态；真实数据仍全部进入 realtime 云端状态。
    albumCategoryFilter: "all",
    growthGoalTab: "short",
    selectedEmotion: "晴",
    quietDraftBlockedAt: 0,
    noiseSource: null,
    noiseContext: null,
    selectedMood: "开心",
    lastLegacyHash: "",
    realtime: defaultRealtimeState(),
    presence: [],
    snapshotRevision: 0,
    originalPersistNow: null,
    identityTextOriginals: new WeakMap(),
    gameFlash: "",
    gameFlashTimer: null
  };

  // [新增] 动态身份称谓与题库配置：A/B 只作为数据角色，页面始终按当前账号渲染“我/宝宝”。
  const ROLE_IDS = ["A", "B"];
  const ROLE_FALLBACK = { A: "角色A", B: "角色B" };

  const quizQuestions = [
    { id: "q1", category: "日常温柔", text: "压力大时最想被怎样陪着？", options: ["安静陪伴", "一起拆解问题", "出门散散心"] },
    { id: "q2", category: "日常温柔", text: "最理想的周末节奏是？", options: ["宅家做饭", "城市散步", "短途旅行"] },
    { id: "q3", category: "日常温柔", text: "收到哪种小惊喜最开心？", options: ["手写文字", "实用礼物", "突然见面"] },
    { id: "q4", category: "日常温柔", text: "吵架后最需要哪句话？", options: ["我在听你说", "我们慢慢来", "抱抱好不好"] },
    { id: "q5", category: "甜蜜暧昧", text: "纪念日更想怎么过？", options: ["仪式感晚餐", "拍照记录", "只要在一起"] },
    { id: "q6", category: "甜蜜暧昧", text: "最喜欢哪种亲密小动作？", options: ["牵手", "拥抱", "摸摸头"] },
    { id: "q7", category: "甜蜜暧昧", text: "最容易被哪句话哄好？", options: ["我想你了", "你对我很重要", "我们一起慢慢来"] },
    { id: "q8", category: "甜蜜暧昧", text: "下一次见面最想先做什么？", options: ["抱很久", "吃一顿饭", "拍合照"] },
    { id: "q9", category: "趣味整活", text: "如果一起开店，最像开什么店？", options: ["甜品店", "小酒馆", "花店"] },
    { id: "q10", category: "趣味整活", text: "谁更可能半夜突然想吃夜宵？", options: ["我", "宝宝", "都可能"] },
    { id: "q11", category: "趣味整活", text: "旅行中更像谁负责导航？", options: ["我", "宝宝", "一起迷路也快乐"] },
    { id: "q12", category: "未来想象", text: "未来最期待一起完成什么？", options: ["布置小家", "看很多风景", "攒一笔基金"] }
  ];

  const truthDareDecks = {
    daily: {
      label: "日常温柔",
      truth: [
        "最近哪一刻觉得被认真爱着？",
        "今天最想收到宝宝哪种回应？",
        "哪件小事会让你一整天心情变好？",
        "最近有没有一句话想让我多听几遍？",
        "什么时候会特别需要安静陪伴？",
        "你觉得我们最默契的生活习惯是什么？",
        "最近一次偷偷心软是因为什么？",
        "如果今天只剩十分钟聊天，你最想聊什么？",
        "你希望我下次见面提前准备什么？",
        "最喜欢我们相处里的哪个细节？"
      ],
      dare: [
        "给宝宝发一句今天限定夸夸。",
        "用三个词形容现在的心情。",
        "说一个下次见面想完成的小约定。",
        "发一张此刻身边的小物件照片。",
        "给宝宝安排一个明天的小提醒。",
        "写一句睡前安心留言。",
        "用一句话描述今天最想分享的画面。",
        "立刻保存一个共同清单事项。",
        "给恋爱小树浇一次水。",
        "发送一次思念提醒。"
      ]
    },
    sweet: {
      label: "甜蜜暧昧",
      truth: [
        "第一次明显心动是在什么时候？",
        "最想被宝宝怎么叫你？",
        "哪种靠近会让你最没有抵抗力？",
        "如果今晚能梦到宝宝，希望梦见什么？",
        "最喜欢宝宝身上的哪个反差？",
        "哪一句情话你听了会装淡定但很开心？",
        "下次拥抱想抱多久？",
        "最想和宝宝拍哪一种合照？",
        "哪次聊天让你后来还反复想起？",
        "如果写一张小纸条藏起来，会写什么？"
      ],
      dare: [
        "发一句不许撤回的直球情话。",
        "给宝宝起一个今晚限定昵称。",
        "用语音说一句“我想你了”。",
        "描述一个理想的下次见面开场。",
        "给宝宝发送一个全屏思念提醒。",
        "写下一个只属于你们的暗号。",
        "说出一个想一起解锁的约会动作。",
        "把下一次约会计划加入清单。",
        "给宝宝一个 20 秒远程抱抱倒计时。",
        "用五个字以内夸宝宝。"
      ]
    },
    fun: {
      label: "趣味整活",
      truth: [
        "谁更像家里的气氛组？",
        "如果宝宝变成表情包，会是哪一个？",
        "你们谁更容易嘴硬心软？",
        "如果一起上综艺，会是什么人设？",
        "谁更可能在超市买一堆计划外零食？",
        "给宝宝的可爱程度打几分，为什么超过满分？",
        "如果恋爱小树会说话，它会吐槽什么？",
        "谁更适合掌管旅行路线？",
        "如果今天互换身份，第一件事会做什么？",
        "哪件小事最像你们专属笑点？"
      ],
      dare: [
        "发一个最不像自己的可爱语气包。",
        "给宝宝布置一个一分钟内能完成的小任务。",
        "用夸张主持人口吻宣布今天的喜欢值。",
        "抽一个共同购物清单里的奇怪愿望。",
        "给下一次约会取一个综艺名。",
        "用三个 emoji 讲今天的心情。",
        "说一句土味情话，但要真诚。",
        "给宝宝颁一个今日限定奖项。",
        "把当前默契分数截图发给宝宝。",
        "立刻点亮一次心动接力。"
      ]
    }
  };

  const dateWheelOptions = [
    "奶茶散步", "一起看电影", "视频做饭", "云逛超市", "互写小纸条",
    "计划下一次旅行", "睡前语音十分钟", "一起整理相册", "周末早午餐", "随机城市漫步"
  ];

  const fortuneNotes = [
    "今天适合多说一句喜欢。",
    "下次见面先抱一下再说话。",
    "把一个小愿望放进清单，它会慢慢实现。",
    "今晚的好运来自一次主动分享。",
    "适合给宝宝一个认真夸夸。",
    "今天的关系关键词是：耐心。",
    "适合安排一个只属于你们的小仪式。",
    "想念不用攒着，发出去会更甜。",
    "今天可以把争执换成拥抱后的复盘。",
    "默契会在一次次回应里长出来。"
  ];

  const moodOptions = ["开心", "想你", "疲惫", "委屈", "期待"];
  const listLabels = {
    travel: "旅行清单",
    dates: "约会计划",
    shopping: "购物清单"
  };

  // [新增] 延时信笺、情绪光谱、自习房、地图、目标和新游戏的配置项。
  const emotionOptions = [
    { key: "晴", label: "晴", color: "#ffbf69" },
    { key: "甜", label: "甜", color: "#ff8fab" },
    { key: "稳", label: "稳", color: "#7bdcb5" },
    { key: "累", label: "累", color: "#9bb1ff" },
    { key: "低", label: "低", color: "#8f8aa8" },
    { key: "想", label: "想", color: "#8dc8f4" }
  ];

  const albumCategories = ["日常", "旅行", "节日", "涂鸦", "礼物", "其他"];
  const goalLabels = { short: "短期", mid: "中期", long: "长期" };
  const preferenceFields = [
    ["likes", "喜欢"],
    ["avoid", "忌口/避雷"],
    ["triggers", "情绪雷区"],
    ["comfort", "安抚方式"]
  ];
  const whiteNoiseOptions = [
    ["off", "关闭"],
    ["rain", "细雨"],
    ["waves", "海浪"],
    ["cafe", "咖啡馆"],
    ["white", "白噪音"]
  ];

  const auctionCatalog = [
    "一次认真视频约会", "下次见面路线选择权", "睡前故事十分钟", "周末共同电影",
    "一次无条件夸夸", "一起完成一顿饭", "散步时牵手优先权", "今日撒娇豁免券"
  ];

  const fateQuestions = [
    { id: "fate-1", text: "如果只剩一个周末，你们更想怎么过？", options: ["窝在家里", "去陌生城市"] },
    { id: "fate-2", text: "纪念日惊喜更偏向哪一种？", options: ["精心准备", "随性见面"] },
    { id: "fate-3", text: "异地想念爆发时更希望？", options: ["马上通话", "收到长消息"] },
    { id: "fate-4", text: "下一次旅行更想选？", options: ["海边慢住", "山城散步"] },
    { id: "fate-5", text: "遇到小矛盾时更适合？", options: ["先抱抱冷静", "先把话说清"] },
    { id: "fate-6", text: "共同生活里更想优先拥有？", options: ["稳定仪式感", "新鲜小冒险"] }
  ];

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

    // [新增] 定时刷新倒计时类模块，并从云端拉取到期信笺/胶囊的可见内容。
    setInterval(() => {
      if (app.token) fetchSnapshot();
      renderAddon();
    }, 30000);
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
    wrapOriginalGameFeedback();
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

  // [修改] 原有小游戏增强：只包裹旧函数增加反馈，不改动原页面逻辑。
  function wrapOriginalGameFeedback() {
    [
      ["rollDice", "飞行棋已前进，状态会自动同步。"],
      ["spinWheel", "约会转盘已转动，结果会自动同步。"]
    ].forEach(([name, message]) => {
      try {
        const original = window[name];
        if (typeof original !== "function" || original.__rtGameWrapped) return;
        window[name] = function realtimeGameFeedbackWrapper() {
          const result = original.apply(this, arguments);
          triggerGameFlash(name === "rollDice" ? "飞行棋" : "转盘");
          toast(message);
          scheduleLegacySync(message);
          return result;
        };
        window[name].__rtGameWrapped = true;
      } catch (error) {
        console.warn(`Realtime wrapper cannot hook ${name}.`, error);
      }
    });
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
      if (action === "td-category") {
        app.truthDareCategory = target.dataset.category || "daily";
        renderAddon();
      }
      if (action === "td-mode") {
        app.truthDareMode = target.dataset.mode || "truth";
        renderAddon();
      }
      if (action === "td-draw") drawTruthDare();
      if (action === "date-wheel-spin") spinDateWheel();
      if (action === "fortune-draw") drawFortune();
      if (action === "pulse-tap") tapPulse();
      if (action === "pulse-reset") resetPulse();
      if (action === "quiz-answer") answerQuiz(target.dataset.question, target.dataset.answer);
      if (action === "quiz-reset") resetQuiz();
      if (handleExtendedAction(action, target)) return;
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

  // [新增] 新模块事件分发，避免改动原有功能按钮逻辑。
  function handleExtendedAction(action, target) {
    const map = {
      "letter-send": sendDelayedLetter,
      "letter-update": () => updateDelayedLetter(target.dataset.id),
      "letter-withdraw": () => withdrawDelayedLetter(target.dataset.id),
      "whisper-send": sendSecretWhisper,
      "whisper-open": () => openSecretWhisper(target.dataset.id),
      "capsule-create": createCapsule,
      "capsule-entry": () => saveCapsuleEntry(target.dataset.id),
      "study-start": startStudyTimer,
      "study-pause": pauseStudyTimer,
      "study-reset": resetStudyTimer,
      "study-quiet": toggleQuietMode,
      "study-noise": () => setStudyNoise(target.dataset.noise || "off"),
      "emotion-select": () => selectEmotion(target.dataset.emotion),
      "emotion-save": saveEmotionSpectrum,
      "preference-save": savePreferenceBook,
      "reconcile-add": addReconciliation,
      "reconcile-ack": () => acknowledgeReconciliation(target.dataset.id),
      "reconcile-resolve": () => resolveReconciliation(target.dataset.id),
      "auction-reset": resetAuction,
      "auction-bid": () => bidAuctionItem(target.dataset.id),
      "fate-reset": resetFateQuestion,
      "fate-answer": () => answerFateQuestion(target.dataset.answer),
      "gravity-certificate": createGravityCertificate,
      "map-add": addMeetingPoint,
      "map-delete": () => deleteMeetingPoint(target.dataset.id),
      "memory-draw": drawMemory,
      "goal-tab": () => { app.growthGoalTab = target.dataset.term || "short"; renderAddon(); },
      "goal-add": addGrowthGoal,
      "goal-check": () => checkGrowthGoal(target.dataset.term, target.dataset.id),
      "goal-delete": () => deleteGrowthGoal(target.dataset.term, target.dataset.id),
      "album-filter": () => { app.albumCategoryFilter = target.dataset.category || "all"; renderAddon(); },
      "album-set-category": () => setAlbumCategory(Number(target.dataset.index), target.dataset.category || "其他")
    };
    if (!map[action]) return false;
    map[action]();
    return true;
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
      toast(`${roleLabel(app.user.id)}已登录，实时同步开启。`);
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
    applyTheme(currentTheme());

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
      if (op.type === "miss-you") showHeartBlast(op.actor, op.payload && op.payload.message);
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
      const theme = payload.theme === "night" ? "night" : "macaron";
      realtime.theme = theme;
      realtime.themePrefs ||= {};
      realtime.themePrefs[actorId || app.user && app.user.id || "A"] = theme;
      applyTheme(currentTheme());
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
      realtime.tree.lastWateredById = actorId;
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
      realtime.doodle.savedById = actorId;
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
      realtime.music = { ...realtime.music, ...payload, updatedAt: at, updatedBy: actorName, updatedById: actorId };
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

    // [新增] 信笺、胶囊、自习房、偏爱记录、情绪光谱、和解契约、地图、目标等同步状态。
    if (op.type === "delayedLetter.create") {
      realtime.delayedLetters.unshift(withActor({
        id: payload.id || uuid(),
        title: payload.title || "",
        text: payload.text || "",
        deliverAt: payload.deliverAt || at,
        status: "pending",
        hidden: Boolean(payload.hidden),
        createdAt: at
      }, op, at));
    }

    if (op.type === "delayedLetter.update") {
      updateItem(realtime.delayedLetters, payload.id, {
        title: payload.title || "",
        text: payload.text || "",
        updatedAt: at
      }, op, at);
    }

    if (op.type === "delayedLetter.withdraw") {
      updateItem(realtime.delayedLetters, payload.id, { status: "withdrawn", text: "", withdrawnAt: at }, op, at);
    }

    if (op.type === "whisper.send") {
      realtime.whispers.unshift(withActor({
        id: payload.id || uuid(),
        to: payload.to || otherRoleId(actorId),
        text: payload.text || "",
        readAt: "",
        createdAt: at
      }, op, at));
      realtime.whispers = realtime.whispers.slice(0, 40);
    }

    if (op.type === "whisper.read") {
      updateItem(realtime.whispers, payload.id, { readAt: at, text: "" }, op, at);
    }

    if (op.type === "capsule.create") {
      realtime.capsules.unshift(withActor({
        id: payload.id || uuid(),
        title: payload.title || "",
        unlockAt: payload.unlockAt || at,
        entries: {},
        createdAt: at
      }, op, at));
    }

    if (op.type === "capsule.entry") {
      const capsule = realtime.capsules.find((item) => item.id === payload.id);
      if (capsule) {
        capsule.entries ||= {};
        capsule.entries[actorId] = {
          text: payload.text || "",
          image: payload.image || "",
          sealed: Boolean(payload.sealed),
          actor: actorId,
          actorName,
          updatedAt: at
        };
        Object.assign(capsule, actorPatch(op, at));
      }
    }

    if (op.type === "study.timer") {
      realtime.study = { ...realtime.study, ...payload, updatedAt: at, updatedById: actorId, updatedBy: actorName };
    }

    if (op.type === "study.quiet") {
      realtime.study.quietMode = Boolean(payload.quietMode);
      realtime.study.updatedAt = at;
      realtime.study.updatedById = actorId;
      realtime.study.updatedBy = actorName;
    }

    if (op.type === "study.noise") {
      realtime.study.noise = normalizeNoise(payload.noise);
      realtime.study.updatedAt = at;
      realtime.study.updatedById = actorId;
      realtime.study.updatedBy = actorName;
      syncNoisePlayback(realtime.study.noise);
    }

    if (op.type === "emotionSpectrum.check") {
      const date = payload.date || today();
      realtime.emotionCalendar[date] ||= {};
      realtime.emotionCalendar[date][actorId] = {
        emotion: normalizeEmotion(payload.emotion),
        note: payload.note || "",
        actor: actorId,
        actorName,
        updatedAt: at
      };
    }

    if (op.type === "preference.update") {
      realtime.preferenceBook = {
        ...realtime.preferenceBook,
        ...payload.patch,
        updatedAt: at,
        updatedBy: actorName,
        updatedById: actorId
      };
    }

    if (op.type === "reconciliation.add") {
      realtime.reconciliations.unshift(withActor({
        id: payload.id || uuid(),
        issue: payload.issue || "",
        agreement: payload.agreement || "",
        status: "open",
        ack: {},
        createdAt: at
      }, op, at));
    }

    if (op.type === "reconciliation.ack") {
      const item = realtime.reconciliations.find((entry) => entry.id === payload.id);
      if (item) {
        item.ack ||= {};
        item.ack[actorId] = at;
        if (ROLE_IDS.every((id) => item.ack[id])) item.status = "ready";
        Object.assign(item, actorPatch(op, at));
      }
    }

    if (op.type === "reconciliation.resolve") {
      updateItem(realtime.reconciliations, payload.id, { status: "resolved", resolvedAt: at }, op, at);
    }

    if (op.type === "auction.reset") {
      realtime.auction = createAuctionRound(payload.round || Number(realtime.auction?.round || 0) + 1, at, op);
    }

    if (op.type === "auction.bid") {
      const item = realtime.auction.items.find((entry) => entry.id === payload.id);
      const amount = Math.max(1, Number(payload.amount || 10));
      if (item && Number(realtime.auction.coins?.[actorId] || 0) >= amount) {
        item.bids ||= {};
        item.bids[actorId] = Number(item.bids[actorId] || 0) + amount;
        realtime.auction.coins[actorId] -= amount;
        item.updatedAt = at;
      }
    }

    if (op.type === "fate.reset") {
      realtime.fate.current = {
        ...(payload.question || randomFateQuestion()),
        answers: {},
        createdAt: at,
        createdBy: actorName
      };
    }

    if (op.type === "fate.answer") {
      realtime.fate.current ||= { ...randomFateQuestion(), answers: {} };
      realtime.fate.current.answers ||= {};
      realtime.fate.current.answers[actorId] = payload.answer || "";
      realtime.fate.current.updatedAt = at;
    }

    if (op.type === "gravity.certificate") {
      realtime.gravity.certificates.unshift(withActor({
        id: payload.id || uuid(),
        level: gravityLevel(realtime.gravity.points),
        text: payload.text || "电子纪念证书已生成。",
        createdAt: at
      }, op, at));
      realtime.gravity.certificates = realtime.gravity.certificates.slice(0, 12);
    }

    if (op.type === "meeting.add") {
      realtime.meetingMap.points.push(withActor({
        id: payload.id || uuid(),
        city: payload.city || "",
        place: payload.place || "",
        date: payload.date || today(),
        note: payload.note || ""
      }, op, at));
    }

    if (op.type === "meeting.delete") {
      realtime.meetingMap.points = realtime.meetingMap.points.filter((item) => item.id !== payload.id);
    }

    if (op.type === "memory.draw") {
      realtime.memoryDraw = {
        current: withActor(payload.memory || {}, op, at),
        updatedAt: at
      };
    }

    if (op.type === "growthGoal.add") {
      const term = normalizeGoalTerm(payload.term);
      realtime.growthGoals[term].unshift(withActor({
        id: payload.id || uuid(),
        title: payload.title || "",
        note: payload.note || "",
        checks: {},
        createdAt: at
      }, op, at));
    }

    if (op.type === "growthGoal.check") {
      const term = normalizeGoalTerm(payload.term);
      const item = realtime.growthGoals[term].find((entry) => entry.id === payload.id);
      if (item) {
        item.checks ||= {};
        item.checks[actorId] = at;
        Object.assign(item, actorPatch(op, at));
      }
    }

    if (op.type === "growthGoal.delete") {
      const term = normalizeGoalTerm(payload.term);
      realtime.growthGoals[term] = realtime.growthGoals[term].filter((item) => item.id !== payload.id);
    }

    // [新增] 趣味互动操作：真心话大冒险、同步约会转盘、甜蜜抽签、心动接力。
    if (op.type === "truthDare.draw") {
      realtime.truthDare = {
        ...realtime.truthDare,
        category: normalizeTruthDareCategory(payload.category),
        mode: payload.mode === "dare" ? "dare" : "truth",
        current: withActor({
          id: payload.item && payload.item.id || uuid(),
          text: payload.item && payload.item.text || "",
          category: normalizeTruthDareCategory(payload.category),
          mode: payload.mode === "dare" ? "dare" : "truth"
        }, op, at),
        recentIds: Array.isArray(payload.recentIds) ? payload.recentIds.slice(-12) : [],
        updatedAt: at
      };
    }

    if (op.type === "dateWheel.spin") {
      realtime.dateWheel = {
        ...realtime.dateWheel,
        current: withActor({
          id: payload.item && payload.item.id || uuid(),
          text: payload.item && payload.item.text || "",
          rotation: Number(payload.rotation || 0)
        }, op, at),
        rotation: Number(payload.rotation || 0),
        recentIds: Array.isArray(payload.recentIds) ? payload.recentIds.slice(-8) : [],
        updatedAt: at
      };
    }

    if (op.type === "fortune.draw") {
      realtime.fortune = {
        ...realtime.fortune,
        current: withActor({
          id: payload.item && payload.item.id || uuid(),
          text: payload.item && payload.item.text || ""
        }, op, at),
        recentIds: Array.isArray(payload.recentIds) ? payload.recentIds.slice(-8) : [],
        updatedAt: at
      };
    }

    if (op.type === "pulse.tap") {
      realtime.pulse ||= defaultPulseState();
      const amount = Math.max(1, Math.min(5, Number(payload.amount || 1)));
      realtime.pulse.scores ||= { A: 0, B: 0 };
      realtime.pulse.scores[actorId] = Number(realtime.pulse.scores[actorId] || 0) + amount;
      realtime.pulse.total = Number(realtime.pulse.total || 0) + amount;
      realtime.pulse.goal = Math.max(20, Number(realtime.pulse.goal || 30));
      if (realtime.pulse.total >= realtime.pulse.goal) {
        realtime.pulse.round = Number(realtime.pulse.round || 1) + 1;
        realtime.pulse.goal += 20;
      }
      realtime.pulse.lastActor = actorId;
      realtime.pulse.lastActorName = actorName;
      realtime.pulse.updatedAt = at;
      triggerGameFlash(`${roleLabel(actorId)} +${amount}`);
    }

    if (op.type === "pulse.reset") {
      realtime.pulse = { ...defaultPulseState(), round: Number(realtime.pulse && realtime.pulse.round || 1) + 1, updatedAt: at, lastActor: actorId, lastActorName: actorName };
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

    grantGravityForOperation(realtime, op, at);
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
    applyTheme(currentTheme());
    applyGravityEffects(app.realtime.gravity);
    applyMusicToElement();
    applyDynamicIdentityLabels();
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
        <p>在线、思念、心情、小任务和恋爱小树都会同步到${esc(roleLabel(otherRoleId()))}屏幕。</p>
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
            <span class="rt-meta">${esc(roleLabel(otherRoleId()))}会收到全屏爱心提醒</span>
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
            <textarea id="rtMoodNote" placeholder="写给${esc(roleLabel(otherRoleId()))}看的心情小纸条">${esc(myMood && myMood.note || "")}</textarea>
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
            <span class="rt-meta">累计 ${app.realtime.tree.totalWater} 滴，上次 ${esc(app.realtime.tree.lastWateredById ? displayActor(app.realtime.tree.lastWateredById, app.realtime.tree.lastWateredBy) : "还没有浇水")}</span>
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
      ${renderDelayedLetters()}
      ${renderStudyRoom()}
      ${renderEmotionSpectrum()}
      ${renderGravityPanel()}
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
        <p class="small-note">已同步 ${app.realtime.doodle.strokes.length} 笔${app.realtime.doodle.savedBy ? `，上次由 ${esc(displayActor(app.realtime.doodle.savedById, app.realtime.doodle.savedBy))} 保存` : ""}。</p>
      </div>
      ${renderAlbumCategories()}
      ${renderTimeCapsules()}
      ${renderMemoryMachine()}
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
            <span>${esc(app.realtime.music.updatedById ? displayActor(app.realtime.music.updatedById, app.realtime.music.updatedBy) : "等待切歌")}</span>
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
      ${renderPreferenceBook()}
      ${renderReconciliationPanel()}
      ${renderMeetingMap()}
      ${renderGrowthGoals()}
    `;
  }

  function renderGamesAddon() {
    const root = ensureMount("tab-games", "rtGames", "rt-section");
    if (!root) return;
    const active = app.realtime.quiz.active || { answers: {} };
    const locked = hasOpenReconciliation();
    root.innerHTML = `
      <section class="section-head">
        <h2>双人互动游戏</h2>
        <p>真心话大冒险、约会转盘、甜蜜抽签、心动接力和默契测试都会实时同步。</p>
      </section>
      ${locked ? `<div class="rt-lock-banner">和解契约未完成，大部分娱乐小游戏已温柔暂停。先去工具页完成和解登记吧。</div>` : ""}
      <div class="rt-grid two">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>真心话大冒险</h3>
            <span>${esc(truthDareDecks[app.truthDareCategory]?.label || "日常温柔")}</span>
          </div>
          <div class="rt-list-tabs">
            ${Object.entries(truthDareDecks).map(([key, deck]) => `<button class="${app.truthDareCategory === key ? "active" : ""}" data-rt="td-category" data-category="${key}">${esc(deck.label)}</button>`).join("")}
          </div>
          <div class="rt-theme-toggle">
            <button class="${app.truthDareMode !== "dare" ? "active" : ""}" data-rt="td-mode" data-mode="truth">真心话</button>
            <button class="${app.truthDareMode === "dare" ? "active" : ""}" data-rt="td-mode" data-mode="dare">大冒险</button>
          </div>
          ${renderTruthDareCard()}
          <button class="primary" data-rt="td-draw">${safeIcon("refresh")}抽一题</button>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>同步约会转盘</h3>
            <span>${dateWheelOptions.length} 个灵感</span>
          </div>
          ${renderDateWheel()}
          <button class="primary" data-rt="date-wheel-spin">${safeIcon("refresh")}转一下</button>
        </div>
      </div>
      <div class="rt-grid two rt-section">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>甜蜜抽签</h3>
            <span>今日小签文</span>
          </div>
          ${renderFortuneCard()}
          <button class="primary" data-rt="fortune-draw">${safeIcon("play")}抽一签</button>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>异地心动接力</h3>
            <span>第 ${Number(app.realtime.pulse?.round || 1)} 轮</span>
          </div>
          ${renderPulseGame()}
          <div class="rt-inline">
            <button class="primary" data-rt="pulse-tap">${safeIcon("plus")}点亮一下</button>
            <button class="ghost" data-rt="pulse-reset">开启新一轮</button>
          </div>
        </div>
      </div>
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>默契测试</h3>
          <button class="ghost" data-rt="quiz-reset">重新开始</button>
        </div>
        ${quizQuestions.map((question, index) => renderQuizQuestion(question, index, active)).join("")}
        ${renderQuizReport(active)}
      </div>
      ${renderAuctionGame()}
      ${renderFateGame()}
    `;
    applyEntertainmentLock();
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
            <span>${app.user ? `当前：${esc(roleLabel(app.user.id))}` : "未登录"}</span>
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
            <span>账号独立保存</span>
          </div>
          <div class="rt-theme-toggle">
            <button class="${currentTheme() !== "night" ? "active" : ""}" data-rt="theme" data-theme="macaron">原版马卡龙</button>
            <button class="${currentTheme() === "night" ? "active" : ""}" data-rt="theme" data-theme="night">暗夜温柔</button>
          </div>
        </div>
      </div>
    `;
  }

  // [新增] 延时信笺和限时悄悄话：都走 WebSocket，同步后按权限/时间展示。
  function renderDelayedLetters() {
    const letters = (app.realtime.delayedLetters || []).slice().sort((a, b) => Date.parse(a.deliverAt || 0) - Date.parse(b.deliverAt || 0));
    return `
      <div class="rt-grid two rt-section">
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>延时信笺</h3>
            <span>倒计时投递</span>
          </div>
          <div class="rt-form-row">
            <label>标题<input id="rtLetterTitle" placeholder="写给${esc(roleLabel(otherRoleId()))}的一封信"></label>
            <label>投递时间<input id="rtLetterAt" type="datetime-local" value="${esc(dateTimeLocal(Date.now() + 3600000))}"></label>
            <label>内容<textarea id="rtLetterText" placeholder="倒计时结束前，你还可以修改或撤回。"></textarea></label>
            <button class="primary" data-rt="letter-send">${safeIcon("plus")}放入信箱</button>
          </div>
          <div class="rt-stack">${letters.length ? letters.slice(0, 10).map(renderLetterCard).join("") : `<div class="empty">还没有延时信笺。</div>`}</div>
        </div>
        <div class="panel rt-stack">
          <div class="rt-card-title">
            <h3>限时悄悄话</h3>
            <span>只读一次</span>
          </div>
          <label>悄悄话<textarea id="rtWhisperText" placeholder="读完即销毁，不会作为永久内容展示。"></textarea></label>
          <button class="primary" data-rt="whisper-send">${safeIcon("play")}发送一次性悄悄话</button>
          <div class="rt-stack">${renderWhispers()}</div>
        </div>
      </div>
    `;
  }

  function renderLetterCard(item) {
    const mine = item.actor === (app.user && app.user.id);
    const due = Date.parse(item.deliverAt || "");
    const unlocked = due && Date.now() >= due;
    const withdrawn = item.status === "withdrawn";
    const title = item.hidden ? "信笺正在倒计时" : item.title || "未命名信笺";
    const body = withdrawn
      ? "这封信笺已撤回。"
      : unlocked || mine ? item.text || "还没有内容" : "倒计时结束后才可以查看内容。";
    return `
      <div class="rt-item ${withdrawn ? "done" : ""}">
        <div class="rt-card-title">
          <strong>${esc(title)}</strong>
          <span>${withdrawn ? "已撤回" : unlocked ? "已投递" : remainingText(due)}</span>
        </div>
        <p>${esc(body)}</p>
        <small>${esc(displayActor(item.actor, item.actorName))} 创建 · ${esc(formatTime(item.createdAt))}</small>
        ${mine && !unlocked && !withdrawn ? `
          <div class="rt-form-row compact">
            <label>标题<input id="rtLetterTitle-${esc(item.id)}" value="${esc(item.title || "")}"></label>
            <label>内容<textarea id="rtLetterText-${esc(item.id)}">${esc(item.text || "")}</textarea></label>
            <button class="ghost" data-rt="letter-update" data-id="${esc(item.id)}">保存修改</button>
            <button class="danger" data-rt="letter-withdraw" data-id="${esc(item.id)}">撤回</button>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderWhispers() {
    const whispers = (app.realtime.whispers || []).filter((item) => item.to === (app.user && app.user.id) || item.actor === (app.user && app.user.id));
    if (!whispers.length) return `<div class="empty">这里会显示未读悄悄话和发送状态。</div>`;
    return whispers.slice(0, 8).map((item) => {
      const mine = item.actor === (app.user && app.user.id);
      const unreadForMe = item.to === (app.user && app.user.id) && !item.readAt && item.text;
      return `
        <div class="rt-item ${item.readAt ? "done" : ""}">
          <strong>${mine ? `发给${esc(roleLabel(item.to))}` : `${esc(displayActor(item.actor, item.actorName))}发来的悄悄话`}</strong>
          <p>${item.readAt ? "已阅读并销毁。" : unreadForMe ? "有一条只可阅读一次的消息。" : "等待对方阅读。"}</p>
          ${unreadForMe ? `<button class="primary" data-rt="whisper-open" data-id="${esc(item.id)}">阅读并销毁</button>` : ""}
        </div>
      `;
    }).join("");
  }

  // [新增] 云陪伴自习房间：同步计时/安静模式，白噪音在本机播放。
  function renderStudyRoom() {
    const study = app.realtime.study || defaultStudyState();
    const elapsed = studyElapsed(study);
    const progress = Math.min(100, Math.round(elapsed / Math.max(60, Number(study.goalMinutes || 25) * 60) * 100));
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>云陪伴自习房间</h3>
          <span>${study.quietMode ? "安静模式中" : "可以轻声互动"}</span>
        </div>
        <div class="rt-grid two">
          <div class="rt-focus-clock">
            <strong>${formatDuration(elapsed)}</strong>
            <span>${study.running ? "计时中" : "已暂停"} · 目标 ${Number(study.goalMinutes || 25)} 分钟</span>
            <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
            <div class="rt-inline">
              <button class="primary" data-rt="study-start">${safeIcon("play")}开始</button>
              <button class="ghost" data-rt="study-pause">暂停</button>
              <button class="ghost" data-rt="study-reset">重置</button>
              <button class="${study.quietMode ? "danger" : "ghost"}" data-rt="study-quiet">${study.quietMode ? "关闭安静" : "安静模式"}</button>
            </div>
          </div>
          <div class="rt-stack">
            <div class="rt-presence-list">${renderPresenceRows()}</div>
            <div class="rt-list-tabs">
              ${whiteNoiseOptions.map(([key, label]) => `<button class="${study.noise === key ? "active" : ""}" data-rt="study-noise" data-noise="${key}">${label}</button>`).join("")}
            </div>
            <p class="small-note">白噪音受浏览器自动播放限制，只会在当前设备点击后播放；房间状态会同步给${esc(roleLabel(otherRoleId()))}。</p>
          </div>
        </div>
      </div>
    `;
  }

  // [新增] 情绪光谱日历：按日期记录，并实时生成月报条形图。
  function renderEmotionSpectrum() {
    const monthKey = today().slice(0, 7);
    const todayRecord = app.realtime.emotionCalendar?.[today()]?.[app.user && app.user.id] || null;
    const selected = todayRecord?.emotion || app.selectedEmotion;
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>情绪光谱日历</h3>
          <span>${monthKey} 月报</span>
        </div>
        <div class="rt-mood-buttons spectrum">
          ${emotionOptions.map((item) => `<button style="--mood:${item.color}" class="${selected === item.key ? "active" : ""}" data-rt="emotion-select" data-emotion="${esc(item.key)}">${esc(item.label)}</button>`).join("")}
        </div>
        <label>今天的备注<textarea id="rtEmotionNote" placeholder="记录触发点、安抚方式或值得收藏的小事。">${esc(todayRecord?.note || "")}</textarea></label>
        <button class="primary" data-rt="emotion-save">${safeIcon("save")}保存情绪光谱</button>
        ${renderEmotionReport(monthKey)}
      </div>
    `;
  }

  function renderEmotionReport(monthKey) {
    const records = app.realtime.emotionCalendar || {};
    const days = Object.entries(records).filter(([date]) => date.startsWith(monthKey));
    const rows = ROLE_IDS.map((role) => {
      const counts = {};
      let total = 0;
      days.forEach(([, value]) => {
        const item = value && value[role];
        if (!item) return;
        counts[item.emotion] = (counts[item.emotion] || 0) + 1;
        total += 1;
      });
      return `
        <div class="rt-spectrum-row">
          <strong>${esc(roleLabel(role))}</strong>
          <div>
            ${emotionOptions.map((item) => `<i title="${esc(item.label)}" style="--mood:${item.color};width:${Math.max(6, Math.round((counts[item.key] || 0) / Math.max(1, total) * 100))}%"></i>`).join("")}
          </div>
          <span>${total} 天</span>
        </div>
      `;
    }).join("");
    return `<div class="rt-spectrum-report">${rows}</div>`;
  }

  // [新增] 引力值成长体系：互动越多，等级和特效越高。
  function renderGravityPanel() {
    const gravity = app.realtime.gravity || defaultGravityState();
    const level = gravityLevel(gravity.points);
    const next = gravityNext(level);
    const progress = Math.min(100, Math.round((gravity.points - gravityBase(level)) / Math.max(1, next - gravityBase(level)) * 100));
    return `
      <div class="panel rt-stack rt-section rt-gravity-panel">
        <div class="rt-card-title">
          <h3>引力值成长体系</h3>
          <span>Lv.${level}</span>
        </div>
        <div class="rt-gravity-orbit">
          <strong>${Number(gravity.points || 0)}</strong>
          <span>引力值</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
        <p class="small-note">打卡、浇水、完成目标、游玩同步小游戏都会增加引力值。Lv.2 解锁柔光特效，Lv.4 解锁专属背景。</p>
        <div class="rt-inline">
          <button class="primary" data-rt="gravity-certificate">${safeIcon("save")}生成电子纪念证书</button>
          <span class="rt-meta">已生成 ${gravity.certificates?.length || 0} 张</span>
        </div>
        <div class="rt-stack">${(gravity.certificates || []).slice(0, 3).map(renderCertificate).join("")}</div>
      </div>
    `;
  }

  function renderCertificate(item) {
    return `
      <div class="rt-certificate">
        <strong>电子纪念证书 · Lv.${Number(item.level || 1)}</strong>
        <p>${esc(item.text || "谢谢你们认真经营这一段关系。")}</p>
        <small>${esc(formatTime(item.createdAt))}</small>
      </div>
    `;
  }

  // [新增] 相册分类增强：不替换原相册，只追加一个可筛选/改分类视图。
  function renderAlbumCategories() {
    const album = getLegacyAlbum();
    const filtered = app.albumCategoryFilter === "all"
      ? album
      : album.filter((entry) => (entry.item.category || "其他") === app.albumCategoryFilter);
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>相册分类</h3>
          <span>${album.length} 张照片</span>
        </div>
        <div class="rt-list-tabs">
          <button class="${app.albumCategoryFilter === "all" ? "active" : ""}" data-rt="album-filter" data-category="all">全部</button>
          ${albumCategories.map((category) => `<button class="${app.albumCategoryFilter === category ? "active" : ""}" data-rt="album-filter" data-category="${esc(category)}">${esc(category)}</button>`).join("")}
        </div>
        <div class="rt-album-category-grid">
          ${filtered.length ? filtered.slice(0, 12).map(renderAlbumCategoryCard).join("") : `<div class="empty">这个分类还没有照片。</div>`}
        </div>
      </div>
    `;
  }

  function renderAlbumCategoryCard(entry) {
    const item = entry.item;
    return `
      <div class="rt-album-category-card">
        ${item.src ? `<img src="${esc(item.src)}" alt="">` : `<div class="rt-image-placeholder">照片</div>`}
        <strong>${esc(item.caption || item.title || "未命名照片")}</strong>
        <span class="rt-badge">${esc(item.category || "其他")}</span>
        <div class="rt-option-cloud">
          ${albumCategories.map((category) => `<button data-rt="album-set-category" data-index="${entry.index}" data-category="${esc(category)}">${esc(category)}</button>`).join("")}
        </div>
      </div>
    `;
  }

  // [新增] 双人共享时间胶囊：未到期只展示封存状态，到期后展示双方内容。
  function renderTimeCapsules() {
    const capsules = app.realtime.capsules || [];
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>双人共享时间胶囊</h3>
          <span>到期同步解锁</span>
        </div>
        <div class="rt-form-row">
          <label>胶囊名<input id="rtCapsuleTitle" placeholder="例如：写给三个月后的我们"></label>
          <label>解封日期<input id="rtCapsuleAt" type="datetime-local" value="${esc(dateTimeLocal(Date.now() + 7 * 86400000))}"></label>
          <button class="primary" data-rt="capsule-create">${safeIcon("plus")}创建胶囊</button>
        </div>
        <div class="rt-stack">${capsules.length ? capsules.slice(0, 8).map(renderCapsuleCard).join("") : `<div class="empty">还没有时间胶囊。</div>`}</div>
      </div>
    `;
  }

  function renderCapsuleCard(item) {
    const unlockAt = Date.parse(item.unlockAt || "");
    const unlocked = unlockAt && Date.now() >= unlockAt;
    const mine = item.entries && app.user ? item.entries[app.user.id] : null;
    return `
      <div class="rt-item">
        <div class="rt-card-title">
          <strong>${esc(item.title || "未命名胶囊")}</strong>
          <span>${unlocked ? "已解封" : remainingText(unlockAt)}</span>
        </div>
        ${unlocked ? renderCapsuleEntries(item.entries || {}) : `<p>内容已封存，解封前双方都无法在页面查看。</p>`}
        <div class="rt-form-row compact">
          <label>我的写入<textarea id="rtCapsuleText-${esc(item.id)}" placeholder="${mine ? "可再次写入覆盖原内容" : "写入后会立即封存"}"></textarea></label>
          <label>图片<input id="rtCapsuleImage-${esc(item.id)}" type="file" accept="image/*"></label>
          <button class="primary" data-rt="capsule-entry" data-id="${esc(item.id)}">${safeIcon("save")}${mine ? "更新我的封存" : "写入胶囊"}</button>
        </div>
      </div>
    `;
  }

  function renderCapsuleEntries(entries) {
    return `<div class="rt-grid two">${ROLE_IDS.map((role) => {
      const entry = entries[role];
      return `
        <div class="rt-item">
          <strong>${esc(roleLabel(role))}</strong>
          <p>${esc(entry && entry.text || "没有写入文字。")}</p>
          ${entry && entry.image ? `<img class="rt-capsule-image" src="${esc(entry.image)}" alt="">` : ""}
        </div>
      `;
    }).join("")}</div>`;
  }

  // [新增] 回忆抽签机：从已同步的原日记/留言/照片中抽一条。
  function renderMemoryMachine() {
    const current = app.realtime.memoryDraw?.current;
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>回忆抽签机</h3>
          <span>${memoryPool().length} 条回忆</span>
        </div>
        <button class="primary" data-rt="memory-draw">${safeIcon("refresh")}随机翻一段回忆</button>
        ${current ? `
          <div class="rt-game-result">
            <span class="rt-badge">${esc(current.kind || "回忆")}</span>
            <strong>${esc(current.title || "一段回忆")}</strong>
            <p>${esc(current.text || "")}</p>
            ${current.image ? `<img class="rt-memory-image" src="${esc(current.image)}" alt="">` : ""}
            <small>${esc(displayActor(current.actor, current.actorName))} 抽到</small>
          </div>
        ` : `<div class="empty">点击按钮，从历史日记、留言或照片里抽一段。</div>`}
      </div>
    `;
  }

  // [新增] 偏爱记录本：共享文档式编辑，保存后双端同步。
  function renderPreferenceBook() {
    const book = app.realtime.preferenceBook || {};
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>偏爱记录本</h3>
          <span>共享文档</span>
        </div>
        <div class="rt-grid two">
          ${preferenceFields.map(([key, label]) => `
            <label>${label}<textarea id="rtPref-${key}" placeholder="记录${esc(roleLabel(otherRoleId()))}需要被记住的小细节">${esc(book[key] || "")}</textarea></label>
          `).join("")}
        </div>
        <button class="primary" data-rt="preference-save">${safeIcon("save")}保存偏爱记录</button>
        <p class="small-note">${book.updatedById ? `上次由 ${esc(displayActor(book.updatedById, book.updatedBy))} 更新` : "还没有保存过偏爱记录。"}</p>
      </div>
    `;
  }

  // [新增] 和解契约：未完成时锁定娱乐游戏，推动先修复关系。
  function renderReconciliationPanel() {
    const items = app.realtime.reconciliations || [];
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>和解契约</h3>
          <span>${hasOpenReconciliation() ? "游戏暂停中" : "关系已恢复"}</span>
        </div>
        <div class="rt-form-row">
          <label>矛盾点<input id="rtReconcileIssue" placeholder="只描述事实，不贴标签"></label>
          <label>后续约定<textarea id="rtReconcileAgreement" placeholder="我们下次可以怎么更温柔地相处"></textarea></label>
          <button class="primary" data-rt="reconcile-add">${safeIcon("plus")}登记契约</button>
        </div>
        <div class="rt-stack">${items.length ? items.slice(0, 8).map(renderReconciliationItem).join("") : `<div class="empty">没有未处理的矛盾契约。</div>`}</div>
      </div>
    `;
  }

  function renderReconciliationItem(item) {
    const ack = item.ack || {};
    const resolved = item.status === "resolved" || ROLE_IDS.every((id) => ack[id]);
    return `
      <div class="rt-item ${resolved ? "done" : ""}">
        <strong>${esc(item.issue || "一次需要被认真对待的矛盾")}</strong>
        <p>${esc(item.agreement || "还没有写下后续约定。")}</p>
        <div class="rt-inline">
          ${ROLE_IDS.map((id) => `<span class="rt-badge">${esc(roleLabel(id))}：${ack[id] ? "已确认" : "待确认"}</span>`).join("")}
          ${!ack[app.user && app.user.id] ? `<button class="primary" data-rt="reconcile-ack" data-id="${esc(item.id)}">我确认</button>` : ""}
          ${resolved ? `<button class="ghost" data-rt="reconcile-resolve" data-id="${esc(item.id)}">完成和解</button>` : ""}
        </div>
      </div>
    `;
  }

  // [新增] 相遇轨迹地图：手动地点转为动态连线，不接入外部地图服务。
  function renderMeetingMap() {
    const points = app.realtime.meetingMap?.points || [];
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>相遇轨迹地图</h3>
          <span>${points.length} 个地点</span>
        </div>
        <div class="rt-map-stage">${renderMapSvg(points)}</div>
        <div class="rt-form-row">
          <label>城市<input id="rtMapCity" placeholder="例如：杭州"></label>
          <label>见面地点<input id="rtMapPlace" placeholder="例如：西湖边"></label>
          <label>日期<input id="rtMapDate" type="date" value="${today()}"></label>
          <button class="primary" data-rt="map-add">${safeIcon("plus")}标记</button>
        </div>
        <div class="rt-stack">${points.slice().reverse().slice(0, 8).map((item) => `
          <div class="rt-item">
            <strong>${esc(item.city)} · ${esc(item.place)}</strong>
            <p>${esc(item.date || "")} ${esc(item.note || "")}</p>
            <button class="danger" data-rt="map-delete" data-id="${esc(item.id)}">删除</button>
          </div>
        `).join("") || `<div class="empty">还没有标记相遇地点。</div>`}</div>
      </div>
    `;
  }

  function renderMapSvg(points) {
    const normalized = points.map((item) => ({ ...item, ...pointPosition(item) }));
    const line = normalized.map((point) => `${point.x},${point.y}`).join(" ");
    return `
      <svg viewBox="0 0 100 58" role="img" aria-label="相遇轨迹">
        <defs><linearGradient id="rtMapLine" x1="0" x2="1"><stop stop-color="#ff8fab"/><stop offset="1" stop-color="#8dc8f4"/></linearGradient></defs>
        <rect x="1" y="1" width="98" height="56" rx="12"></rect>
        ${line ? `<polyline points="${line}" pathLength="1"></polyline>` : ""}
        ${normalized.map((point) => `<g><circle cx="${point.x}" cy="${point.y}" r="2.5"></circle><text x="${point.x + 2}" y="${point.y - 2}">${esc(point.city).slice(0, 6)}</text></g>`).join("")}
      </svg>
    `;
  }

  // [新增] 共同成长目标清单：短/中/长期目标分组，双方打卡监督。
  function renderGrowthGoals() {
    const goals = app.realtime.growthGoals || defaultGrowthGoals();
    const term = goalLabels[app.growthGoalTab] ? app.growthGoalTab : "short";
    const list = goals[term] || [];
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>共同成长目标</h3>
          <span>${goalLabels[term]}</span>
        </div>
        <div class="rt-list-tabs">
          ${Object.entries(goalLabels).map(([key, label]) => `<button class="${term === key ? "active" : ""}" data-rt="goal-tab" data-term="${key}">${label}</button>`).join("")}
        </div>
        <div class="rt-form-row">
          <label>目标<input id="rtGoalTitle" placeholder="例如：这个月一起读完一本书"></label>
          <label>备注<input id="rtGoalNote" placeholder="可选监督方式"></label>
          <button class="primary" data-rt="goal-add">${safeIcon("plus")}添加目标</button>
        </div>
        <div class="rt-stack">${list.length ? list.map((item) => renderGoalItem(term, item)).join("") : `<div class="empty">这一组还没有目标。</div>`}</div>
      </div>
    `;
  }

  function renderGoalItem(term, item) {
    const checks = item.checks || {};
    const done = ROLE_IDS.every((id) => checks[id]);
    return `
      <div class="rt-item ${done ? "done" : ""}">
        <strong>${esc(item.title || "未命名目标")}</strong>
        <p>${esc(item.note || "一起慢慢完成。")}</p>
        <div class="rt-inline">
          ${ROLE_IDS.map((id) => `<span class="rt-badge">${esc(roleLabel(id))}：${checks[id] ? "已打卡" : "未打卡"}</span>`).join("")}
          <button class="ghost" data-rt="goal-check" data-term="${term}" data-id="${esc(item.id)}">我打卡</button>
          <button class="danger" data-rt="goal-delete" data-term="${term}" data-id="${esc(item.id)}">删除</button>
        </div>
      </div>
    `;
  }

  // [新增] 默契拍卖场：双方用虚拟金币竞拍陪伴事项。
  function renderAuctionGame() {
    const auction = app.realtime.auction || defaultAuctionState();
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>默契拍卖场</h3>
          <button class="ghost" data-rt="auction-reset">新一轮</button>
        </div>
        <div class="rt-auction-wallets">
          ${ROLE_IDS.map((id) => `<span>${esc(roleLabel(id))}：${auction.coins?.[id] ?? 100} 金币</span>`).join("")}
        </div>
        <div class="rt-grid two">
          ${(auction.items || []).map(renderAuctionItem).join("")}
        </div>
      </div>
    `;
  }

  function renderAuctionItem(item) {
    const bids = item.bids || {};
    const winner = auctionWinner(item);
    return `
      <div class="rt-item">
        <strong>${esc(item.title)}</strong>
        <p>${winner ? `${esc(roleLabel(winner))} 暂时领先` : "还没有人出价"}</p>
        <div class="rt-inline">
          ${ROLE_IDS.map((id) => `<span class="rt-badge">${esc(roleLabel(id))} ${Number(bids[id] || 0)}</span>`).join("")}
          <button class="primary" data-rt="auction-bid" data-id="${esc(item.id)}">加 10 金币</button>
        </div>
      </div>
    `;
  }

  // [新增] 命运选择题：匿名作答，双方都选完后自动对比。
  function renderFateGame() {
    const fate = app.realtime.fate || defaultFateState();
    const current = fate.current;
    return `
      <div class="panel rt-stack rt-section">
        <div class="rt-card-title">
          <h3>命运选择题</h3>
          <button class="ghost" data-rt="fate-reset">换一题</button>
        </div>
        ${current ? renderFateQuestion(current) : `<div class="empty">点击换一题开始匿名选择。</div>`}
      </div>
    `;
  }

  function renderFateQuestion(current) {
    const answers = current.answers || {};
    const mine = app.user && answers[app.user.id];
    const bothDone = ROLE_IDS.every((id) => answers[id]);
    return `
      <div class="rt-game-result">
        <strong>${esc(current.text)}</strong>
        <div class="rt-quiz-options">
          ${(current.options || []).map((option) => `<button class="${mine === option ? "active" : ""}" data-rt="fate-answer" data-answer="${esc(option)}">${esc(option)}</button>`).join("")}
        </div>
        ${bothDone ? `
          <div class="rt-grid two">
            ${ROLE_IDS.map((id) => `<div class="rt-item"><strong>${esc(roleLabel(id))}</strong><p>${esc(answers[id])}</p></div>`).join("")}
          </div>
        ` : `<p class="rt-meta">已匿名作答 ${Object.keys(answers).length} / 2，双方都答完才展示对比。</p>`}
      </div>
    `;
  }

  function renderPresenceRows() {
    const rows = ROLE_IDS.map((id) => app.presence.find((item) => item.id === id) || {
      id,
      name: ROLE_FALLBACK[id],
      online: app.user && app.user.id === id,
      activity: "等待连接"
    });

    return rows.map((item) => `
      <div class="rt-presence-row">
        <span class="rt-dot ${item.online ? "online" : ""}"></span>
        <strong>${esc(roleLabel(item.id))}</strong>
        <span class="rt-meta">${item.online ? esc(item.activity || "在线") : "离线"}</span>
      </div>
    `).join("");
  }

  function renderMoodCards(moods) {
    return ROLE_IDS.map((id) => {
      const item = moods[id];
      return `
        <div class="rt-item">
          <strong>${esc(roleLabel(id))}：${esc(item && item.mood || "未打卡")}</strong>
          <p>${esc(item && item.note || "今天还没有留下心情。")}</p>
          ${item ? `<span class="rt-badge rt-actor-tag">${esc(displayActor(item.actor, item.actorName))}</span>` : ""}
        </div>
      `;
    }).join("");
  }

  function renderSweetTasks() {
    if (!app.realtime.tasks.length) return `<div class="empty">还没有小任务，发一个给${esc(roleLabel(otherRoleId()))}吧。</div>`;
    return app.realtime.tasks.slice(0, 12).map((item) => `
      <div class="rt-item ${item.done ? "done" : ""}">
        <strong>${esc(item.title || "未命名任务")}</strong>
        <p>${esc(item.detail || "没有备注")}</p>
        <div class="rt-inline">
          <button class="ghost" data-rt="task-toggle" data-id="${esc(item.id)}" data-done="${item.done ? "true" : "false"}">${item.done ? "恢复" : "完成"}</button>
          <button class="danger" data-rt="task-delete" data-id="${esc(item.id)}">删除</button>
          <span class="rt-badge">${esc(displayActor(item.actor, item.actorName || item.updatedBy || "我们"))}</span>
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
          <span class="rt-badge">${esc(displayActor(item.actor, item.actorName || "我们"))}</span>
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
          <span class="rt-badge">${esc(displayActor(item.actor, item.actorName || "我们"))}</span>
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
          <span class="rt-badge">${esc(displayActor(item.actor, item.actorName || "我们"))}</span>
        </div>
      </div>
    `).join("");
  }

  // [新增] 游戏卡片渲染：所有操作结果都从 realtime 状态读取，支持双端同步。
  function renderTruthDareCard() {
    const current = app.realtime.truthDare && app.realtime.truthDare.current;
    if (!current) {
      return `<div class="rt-game-result">先选分类，再抽一题。系统会避开最近抽过的题。</div>`;
    }
    return `
      <div class="rt-game-result">
        <span class="rt-badge">${esc(truthDareDecks[current.category]?.label || "题目")} · ${current.mode === "dare" ? "大冒险" : "真心话"}</span>
        <strong>${esc(current.text)}</strong>
        <small>${esc(displayActor(current.actor, current.actorName))} 抽到</small>
      </div>
    `;
  }

  function renderDateWheel() {
    const wheel = app.realtime.dateWheel || {};
    const current = wheel.current;
    const rotation = Number(wheel.rotation || 0);
    return `
      <div class="rt-wheel-shell">
        <div class="rt-date-wheel" style="--rt-wheel-rotation:${rotation}deg">
          <span>约会</span>
        </div>
        <div class="rt-game-result compact">
          <strong>${esc(current && current.text || "等待转出今晚灵感")}</strong>
          <small>${current ? `${esc(displayActor(current.actor, current.actorName))} 转出` : "双方看到同一个结果"}</small>
        </div>
      </div>
      <div class="rt-option-cloud">
        ${dateWheelOptions.slice(0, 8).map((item) => `<span>${esc(item)}</span>`).join("")}
      </div>
    `;
  }

  function renderFortuneCard() {
    const current = app.realtime.fortune && app.realtime.fortune.current;
    return `
      <div class="rt-game-result">
        <span class="rt-badge">小签文</span>
        <strong>${esc(current && current.text || "还没有抽签，今天的甜蜜答案等你翻开。")}</strong>
        <small>${current ? `${esc(displayActor(current.actor, current.actorName))} 抽到` : "抽签会同步到两个人屏幕"}</small>
      </div>
    `;
  }

  function renderPulseGame() {
    const pulse = app.realtime.pulse || defaultPulseState();
    const scores = pulse.scores || {};
    const total = Number(pulse.total || 0);
    const goal = Math.max(1, Number(pulse.goal || 30));
    const progress = Math.min(100, Math.round(total / goal * 100));
    const aScore = Number(scores.A || 0);
    const bScore = Number(scores.B || 0);
    const totalScores = Math.max(1, aScore + bScore);
    return `
      <div class="rt-pulse-stage ${app.gameFlash ? "is-flashing" : ""}">
        <div class="rt-pulse-heart">♡</div>
        <strong>${total} / ${goal}</strong>
        <span>${pulse.lastActor ? `${esc(displayActor(pulse.lastActor, pulse.lastActorName))} 刚刚点亮` : "一起把心动值点满"}</span>
        ${app.gameFlash ? `<em>${esc(app.gameFlash)}</em>` : ""}
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
      <div class="rt-pulse-scores">
        <div>
          <span>${esc(roleLabel("A"))}</span>
          <div class="rt-score-bar"><i style="width:${Math.round(aScore / totalScores * 100)}%"></i></div>
          <strong>${aScore}</strong>
        </div>
        <div>
          <span>${esc(roleLabel("B"))}</span>
          <div class="rt-score-bar"><i style="width:${Math.round(bScore / totalScores * 100)}%"></i></div>
          <strong>${bScore}</strong>
        </div>
      </div>
    `;
  }

  function renderQuizQuestion(question, index, active) {
    const mine = app.user && active.answers && active.answers[app.user.id] && active.answers[app.user.id][question.id];
    const otherId = otherRoleId();
    const other = otherId && active.answers && active.answers[otherId] && active.answers[otherId][question.id];
    return `
      <div class="rt-item">
        <div class="rt-card-title">
          <strong>${index + 1}. ${esc(question.text)}</strong>
          <span>${esc(question.category || "默契")}</span>
        </div>
        <div class="rt-quiz-options">
          ${question.options.map((option) => `
            <button class="${mine && mine.answer === option ? "active" : ""}" data-rt="quiz-answer" data-question="${question.id}" data-answer="${esc(option)}">${esc(option)}</button>
          `).join("")}
        </div>
        <p class="rt-meta">${esc(roleLabel(app.user && app.user.id))}：${esc(mine ? mine.answer : "未答")} · ${esc(roleLabel(otherId))}：${esc(other ? other.answer : "未答")}</p>
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
    const diff = both.filter((q) => a[q.id].answer !== b[q.id].answer).slice(0, 3);

    return `
      <div class="tool-result">
        已共同完成 ${both.length} / ${quizQuestions.length} 题。${done ? `默契分数 ${score} 分，${score >= 80 ? "非常同频" : score >= 50 ? "有很多可爱差异" : "适合认真聊聊彼此的小习惯"}。` : "等两个人都答完后自动出报告。"}
        ${diff.length ? `<p class="rt-meta">可爱分歧：${diff.map((q) => esc(q.text)).join(" / ")}</p>` : ""}
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
    setText("rtAccountStatus", app.user ? `当前：${roleLabel(app.user.id)}` : "未登录情侣账号");
    const other = app.presence.find((item) => app.user && item.id !== app.user.id);
    setText("rtOtherStatus", other && other.online ? `${roleLabel(other.id)}在线` : `${roleLabel(otherRoleId())}离线`);
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
          category: "涂鸦",
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

  function currentTheme() {
    const role = app.user && app.user.id;
    return app.realtime.themePrefs && role && app.realtime.themePrefs[role]
      ? app.realtime.themePrefs[role]
      : app.realtime.theme || "macaron";
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle("rt-theme-night", theme === "night");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "night" ? "#17151f" : "#fff3f6");
  }

  function sendMissYou() {
    if (!canSendMessage()) return;
    if (!app.user) {
      sendOperation("miss-you", { id: uuid(), message: "我想你啦" });
      return;
    }
    const baby = roleLabel(otherRoleId());
    const messages = [`我想${baby}啦`, `想马上见到${baby}`, `给${baby}一个远程抱抱`, `今天也很喜欢${baby}`];
    const message = messages[Math.floor(Math.random() * messages.length)];
    sendOperation("miss-you", { id: uuid(), message });
    showHeartBlast(app.user, message);
  }

  function showHeartBlast(actor, message) {
    const blast = document.createElement("div");
    blast.className = "rt-heart-blast";
    blast.innerHTML = `<strong>${esc(displayActor(actor, actor && actor.name))}：${esc(message || "我想你啦")}</strong>`;
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
    if (!canSendMessage()) return;
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

  function drawTruthDare() {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    const category = normalizeTruthDareCategory(app.truthDareCategory);
    const mode = app.truthDareMode === "dare" ? "dare" : "truth";
    const pool = getTruthDarePool(category, mode);
    const item = pickWithoutRecent(pool, app.realtime.truthDare && app.realtime.truthDare.recentIds);
    if (!item) return;
    const recentIds = updateRecentIds(app.realtime.truthDare && app.realtime.truthDare.recentIds, item.id, 12);
    sendOperation("truthDare.draw", { category, mode, item, recentIds });
    triggerGameFlash(mode === "dare" ? "大冒险！" : "真心话！");
  }

  function spinDateWheel() {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    const pool = dateWheelOptions.map((text, index) => ({ id: `date-${index}`, text }));
    const item = pickWithoutRecent(pool, app.realtime.dateWheel && app.realtime.dateWheel.recentIds);
    if (!item) return;
    const previous = Number(app.realtime.dateWheel && app.realtime.dateWheel.rotation || 0);
    const rotation = previous + 720 + Math.floor(Math.random() * 360);
    const recentIds = updateRecentIds(app.realtime.dateWheel && app.realtime.dateWheel.recentIds, item.id, 8);
    sendOperation("dateWheel.spin", { item, rotation, recentIds });
    triggerGameFlash("转盘启动");
  }

  function drawFortune() {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    const pool = fortuneNotes.map((text, index) => ({ id: `fortune-${index}`, text }));
    const item = pickWithoutRecent(pool, app.realtime.fortune && app.realtime.fortune.recentIds);
    if (!item) return;
    const recentIds = updateRecentIds(app.realtime.fortune && app.realtime.fortune.recentIds, item.id, 8);
    sendOperation("fortune.draw", { item, recentIds });
    triggerGameFlash("甜蜜签文");
  }

  function tapPulse() {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    sendOperation("pulse.tap", { amount: 1 });
  }

  function resetPulse() {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    sendOperation("pulse.reset", {});
  }

  function answerQuiz(questionId, answer) {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    sendOperation("quiz.answer", { questionId, answer });
  }

  function resetQuiz() {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    sendOperation("quiz.reset", { id: uuid() });
  }

  // [新增] 延时信笺：发送者可在投递前修改/撤回。
  function sendDelayedLetter() {
    if (!canSendMessage()) return;
    const title = valueOf("rtLetterTitle").trim();
    const text = valueOf("rtLetterText").trim();
    const rawTime = valueOf("rtLetterAt");
    const parsed = Date.parse(rawTime);
    if (!title || !text || Number.isNaN(parsed)) {
      toast("请写完整信笺标题、内容和投递时间。");
      return;
    }
    const deliverAt = new Date(parsed).toISOString();
    sendOperation("delayedLetter.create", { id: uuid(), title, text, deliverAt });
    setValue("rtLetterTitle", "");
    setValue("rtLetterText", "");
  }

  function updateDelayedLetter(id) {
    const item = (app.realtime.delayedLetters || []).find((entry) => entry.id === id);
    if (!item || item.actor !== (app.user && app.user.id) || Date.now() >= Date.parse(item.deliverAt || "")) return;
    sendOperation("delayedLetter.update", {
      id,
      title: valueOf(`rtLetterTitle-${id}`).trim(),
      text: valueOf(`rtLetterText-${id}`).trim()
    });
  }

  function withdrawDelayedLetter(id) {
    const item = (app.realtime.delayedLetters || []).find((entry) => entry.id === id);
    if (!item || item.actor !== (app.user && app.user.id) || Date.now() >= Date.parse(item.deliverAt || "")) return;
    sendOperation("delayedLetter.withdraw", { id });
  }

  // [新增] 限时悄悄话：只给接收方展示一次，读完立即发送销毁操作。
  function sendSecretWhisper() {
    if (!canSendMessage()) return;
    const text = valueOf("rtWhisperText").trim();
    if (!text) return toast("先写一句悄悄话。");
    sendOperation("whisper.send", { id: uuid(), to: otherRoleId(), text });
    setValue("rtWhisperText", "");
  }

  function openSecretWhisper(id) {
    const item = (app.realtime.whispers || []).find((entry) => entry.id === id);
    if (!item || item.to !== (app.user && app.user.id) || !item.text || item.readAt) return;
    const layer = document.createElement("div");
    layer.className = "rt-secret-layer";
    layer.innerHTML = `
      <div class="modal rt-stack">
        <h3>限时悄悄话</h3>
        <p>${esc(item.text)}</p>
        <button class="primary">我读完了，销毁</button>
      </div>
    `;
    layer.querySelector("button").addEventListener("click", () => {
      layer.remove();
      sendOperation("whisper.read", { id });
    });
    document.body.appendChild(layer);
  }

  // [新增] 时间胶囊。
  function createCapsule() {
    const title = valueOf("rtCapsuleTitle").trim();
    const parsed = Date.parse(valueOf("rtCapsuleAt"));
    if (!title || Number.isNaN(parsed)) return toast("请填写胶囊名和解封日期。");
    const unlockAt = new Date(parsed).toISOString();
    sendOperation("capsule.create", { id: uuid(), title, unlockAt });
    setValue("rtCapsuleTitle", "");
  }

  async function saveCapsuleEntry(id) {
    const text = valueOf(`rtCapsuleText-${id}`).trim();
    const file = document.getElementById(`rtCapsuleImage-${id}`)?.files?.[0];
    const image = file ? await readImageAsDataUrl(file) : "";
    if (!text && !image) return toast("请写入文字或选择图片。");
    sendOperation("capsule.entry", { id, text, image });
    setValue(`rtCapsuleText-${id}`, "");
  }

  // [新增] 自习房计时/安静模式/白噪音。
  function startStudyTimer() {
    const study = app.realtime.study || defaultStudyState();
    sendOperation("study.timer", {
      running: true,
      startedAt: new Date().toISOString(),
      elapsedSeconds: studyElapsed(study),
      goalMinutes: Number(study.goalMinutes || 25)
    });
  }

  function pauseStudyTimer() {
    const study = app.realtime.study || defaultStudyState();
    sendOperation("study.timer", {
      running: false,
      startedAt: "",
      elapsedSeconds: studyElapsed(study),
      goalMinutes: Number(study.goalMinutes || 25)
    });
  }

  function resetStudyTimer() {
    sendOperation("study.timer", { running: false, startedAt: "", elapsedSeconds: 0, goalMinutes: 25 });
  }

  function toggleQuietMode() {
    sendOperation("study.quiet", { quietMode: !Boolean(app.realtime.study?.quietMode) });
  }

  function setStudyNoise(noise) {
    sendOperation("study.noise", { noise: normalizeNoise(noise) });
  }

  function selectEmotion(emotion) {
    app.selectedEmotion = normalizeEmotion(emotion);
    renderAddon();
  }

  function saveEmotionSpectrum() {
    sendOperation("emotionSpectrum.check", {
      date: today(),
      emotion: app.selectedEmotion,
      note: valueOf("rtEmotionNote").trim()
    });
  }

  function savePreferenceBook() {
    const patch = {};
    preferenceFields.forEach(([key]) => {
      patch[key] = valueOf(`rtPref-${key}`).trim();
    });
    sendOperation("preference.update", { patch });
  }

  function addReconciliation() {
    const issue = valueOf("rtReconcileIssue").trim();
    const agreement = valueOf("rtReconcileAgreement").trim();
    if (!issue || !agreement) return toast("请写清矛盾点和后续约定。");
    sendOperation("reconciliation.add", { id: uuid(), issue, agreement });
    setValue("rtReconcileIssue", "");
    setValue("rtReconcileAgreement", "");
  }

  function acknowledgeReconciliation(id) {
    sendOperation("reconciliation.ack", { id });
  }

  function resolveReconciliation(id) {
    sendOperation("reconciliation.resolve", { id });
  }

  function resetAuction() {
    if (hasOpenReconciliation()) return toast("先完成和解契约，再开启娱乐小游戏。");
    sendOperation("auction.reset", { round: Number(app.realtime.auction?.round || 0) + 1 });
  }

  function bidAuctionItem(id) {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    sendOperation("auction.bid", { id, amount: 10 });
  }

  function resetFateQuestion() {
    if (hasOpenReconciliation()) return toast("先完成和解契约，再开启娱乐小游戏。");
    sendOperation("fate.reset", { question: randomFateQuestion() });
  }

  function answerFateQuestion(answer) {
    if (hasOpenReconciliation()) return toast("和解契约未完成，小游戏暂时锁定。");
    sendOperation("fate.answer", { answer });
  }

  function createGravityCertificate() {
    const level = gravityLevel(app.realtime.gravity?.points || 0);
    sendOperation("gravity.certificate", {
      id: uuid(),
      text: `你们已经积累到 Lv.${level} 引力值，继续把日常变成纪念。`
    });
  }

  function addMeetingPoint() {
    const city = valueOf("rtMapCity").trim();
    const place = valueOf("rtMapPlace").trim();
    const date = valueOf("rtMapDate") || today();
    if (!city || !place) return toast("请写城市和见面地点。");
    sendOperation("meeting.add", { id: uuid(), city, place, date });
    setValue("rtMapCity", "");
    setValue("rtMapPlace", "");
  }

  function deleteMeetingPoint(id) {
    sendOperation("meeting.delete", { id });
  }

  function drawMemory() {
    const pool = memoryPool();
    if (!pool.length) return toast("还没有可抽取的历史日记、留言或照片。");
    const memory = pool[Math.floor(Math.random() * pool.length)];
    sendOperation("memory.draw", { memory });
  }

  function addGrowthGoal() {
    const title = valueOf("rtGoalTitle").trim();
    const note = valueOf("rtGoalNote").trim();
    if (!title) return toast("先写一个共同成长目标。");
    sendOperation("growthGoal.add", { term: app.growthGoalTab, id: uuid(), title, note });
    setValue("rtGoalTitle", "");
    setValue("rtGoalNote", "");
  }

  function checkGrowthGoal(term, id) {
    sendOperation("growthGoal.check", { term, id });
  }

  function deleteGrowthGoal(term, id) {
    sendOperation("growthGoal.delete", { term, id });
  }

  function setAlbumCategory(index, category) {
    const legacy = getLegacyState();
    if (!legacy || !Array.isArray(legacy.album) || !legacy.album[index]) return;
    legacy.album[index].category = albumCategories.includes(category) ? category : "其他";
    if (typeof persistNow === "function") persistNow({ toast: "相册分类已更新。" });
    if (typeof renderAlbum === "function") renderAlbum();
    scheduleLegacySync("更新相册分类");
    renderAddon();
  }

  function notifyRemote(op) {
    const actor = displayActor(op.actor, op.actor && op.actor.name);
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
      "truthDare.draw": "抽了一题真心话大冒险",
      "dateWheel.spin": "转动了约会转盘",
      "fortune.draw": "抽了一支甜蜜签",
      "pulse.tap": "点亮了一次心动接力",
      "pulse.reset": "开启了新一轮心动接力",
      "quiz.answer": "回答了一道默契题",
      "delayedLetter.create": "放入了一封延时信笺",
      "delayedLetter.update": "修改了一封延时信笺",
      "delayedLetter.withdraw": "撤回了一封延时信笺",
      "whisper.send": "发送了一条限时悄悄话",
      "capsule.create": "创建了一个时间胶囊",
      "capsule.entry": "写入了时间胶囊",
      "study.timer": "更新了自习房计时",
      "study.quiet": "切换了安静模式",
      "emotionSpectrum.check": "记录了情绪光谱",
      "preference.update": "更新了偏爱记录本",
      "reconciliation.add": "登记了和解契约",
      "reconciliation.ack": "确认了和解契约",
      "auction.bid": "在默契拍卖场出价",
      "fate.answer": "回答了命运选择题",
      "gravity.certificate": "生成了电子纪念证书",
      "meeting.add": "标记了相遇地点",
      "memory.draw": "抽取了一段回忆",
      "growthGoal.add": "添加了共同成长目标",
      "growthGoal.check": "完成了一次目标打卡",
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
      "td-draw": "抽互动题",
      "date-wheel-spin": "转约会转盘",
      "fortune-draw": "抽甜蜜签",
      "pulse-tap": "点亮心动接力",
      "quiz-answer": "回答默契题",
      "letter-send": "写延时信笺",
      "whisper-send": "发送悄悄话",
      "capsule-entry": "写时间胶囊",
      "study-start": "云陪伴自习",
      "emotion-save": "记录情绪",
      "preference-save": "编辑偏爱记录",
      "auction-bid": "默契拍卖",
      "fate-answer": "命运选择"
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

  // [新增] 动态身份称谓系统：所有角色展示统一从这里转换。
  function roleLabel(roleId) {
    if (!roleId) return app.user ? "宝宝" : "对方";
    if (!app.user || !app.user.id) return ROLE_FALLBACK[roleId] || roleId;
    return roleId === app.user.id ? "我" : "宝宝";
  }

  function otherRoleId(baseId) {
    const current = baseId || app.user && app.user.id;
    if (current === "A") return "B";
    if (current === "B") return "A";
    return "";
  }

  function displayActor(actorOrId, actorName) {
    const actor = actorOrId && typeof actorOrId === "object" ? actorOrId : { id: actorOrId, name: actorName };
    if (actor && ROLE_IDS.includes(actor.id)) return roleLabel(actor.id);
    return actor && actor.name || actorName || "我们";
  }

  function possessiveRoleLabel(roleId) {
    const label = roleLabel(roleId);
    return label === "我" ? "我的" : `${label}的`;
  }

  function applyDynamicIdentityLabels() {
    if (!app.user || !app.user.id) return;
    const roots = [document.getElementById("app"), document.getElementById("mainNav"), document.getElementById("floatingBackup")].filter(Boolean);
    roots.forEach((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("[id^='rt'], .rt-account-layer, script, style, textarea, input, select")) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let node = walker.nextNode();
      while (node) {
        if (!app.identityTextOriginals.has(node)) app.identityTextOriginals.set(node, node.nodeValue);
        const original = app.identityTextOriginals.get(node);
        const next = identityText(original);
        if (node.nodeValue !== next) node.nodeValue = next;
        node = walker.nextNode();
      }
    });

    updateIdentityInputValue("profile.personA.name", "A");
    updateIdentityInputValue("profile.personB.name", "B");
  }

  function identityText(text) {
    const leading = text.match(/^\s*/)?.[0] || "";
    const trailing = text.match(/\s*$/)?.[0] || "";
    const value = text.trim();
    const exact = {
      "我": roleLabel("A"),
      "宝宝": roleLabel("B"),
      "我的档案": `${possessiveRoleLabel("A")}档案`,
      "宝宝档案": `${possessiveRoleLabel("B")}档案`,
      "A 城小天气": `${roleLabel("A")} 城小天气`,
      "B 城小天气": `${roleLabel("B")} 城小天气`,
      "情侣A": roleLabel("A"),
      "情侣B": roleLabel("B")
    };
    if (Object.prototype.hasOwnProperty.call(exact, value)) return `${leading}${exact[value]}${trailing}`;
    return text
      .replaceAll("情侣A", roleLabel("A"))
      .replaceAll("情侣B", roleLabel("B"))
      .replaceAll("A 城小天气", `${roleLabel("A")} 城小天气`)
      .replaceAll("B 城小天气", `${roleLabel("B")} 城小天气`);
  }

  function updateIdentityInputValue(bindPath, roleId) {
    const input = document.querySelector(`[data-bind="${bindPath}"]`);
    if (!input) return;
    const defaultValues = ["我", "宝宝", "情侣A", "情侣B", "角色A", "角色B"];
    if (defaultValues.includes(input.value)) input.value = roleLabel(roleId);
  }

  function normalizeTruthDareCategory(category) {
    return truthDareDecks[category] ? category : "daily";
  }

  function getTruthDarePool(category, mode) {
    const key = normalizeTruthDareCategory(category);
    const deck = truthDareDecks[key];
    const list = deck[mode === "dare" ? "dare" : "truth"] || [];
    return list.map((text, index) => ({ id: `${key}-${mode}-${index}`, text }));
  }

  function pickWithoutRecent(pool, recentIds) {
    if (!pool.length) return null;
    const recent = new Set(Array.isArray(recentIds) ? recentIds : []);
    const candidates = pool.filter((item) => !recent.has(item.id));
    const source = candidates.length ? candidates : pool;
    return source[Math.floor(Math.random() * source.length)];
  }

  function updateRecentIds(recentIds, id, limit) {
    const next = Array.isArray(recentIds) ? recentIds.filter((item) => item !== id) : [];
    next.unshift(id);
    return next.slice(0, limit);
  }

  function defaultPulseState() {
    return {
      round: 1,
      goal: 30,
      total: 0,
      scores: { A: 0, B: 0 },
      lastActor: "",
      lastActorName: "",
      updatedAt: ""
    };
  }

  function triggerGameFlash(text) {
    app.gameFlash = text || "";
    clearTimeout(app.gameFlashTimer);
    deferRender();
    app.gameFlashTimer = setTimeout(() => {
      app.gameFlash = "";
      renderAddon();
    }, 1200);
  }

  // [新增] 默认数据与工具函数，保证旧数据升级后也能直接合并运行。
  function defaultStudyState() {
    return { running: false, startedAt: "", elapsedSeconds: 0, goalMinutes: 25, quietMode: false, noise: "off", updatedAt: "" };
  }

  function defaultGrowthGoals() {
    return { short: [], mid: [], long: [] };
  }

  function defaultGravityState() {
    return { points: 0, level: 1, history: [], certificates: [] };
  }

  function defaultAuctionState() {
    return createAuctionRound(1, new Date().toISOString(), { actor: { id: "", name: "系统" } });
  }

  function createAuctionRound(round, at, op) {
    const fallbackAuctionCatalog = [
      "一次认真视频约会", "下次见面路线选择权", "睡前故事十分钟", "周末共同电影", "一次无条件夸夸", "一起完成一顿饭"
    ];
    return {
      round: Number(round || 1),
      coins: { A: 100, B: 100 },
      items: fallbackAuctionCatalog.map((title, index) => ({ id: `auction-${round}-${index}`, title, bids: {} })),
      createdAt: at,
      createdBy: op.actor && op.actor.name || "系统"
    };
  }

  function defaultFateState() {
    return {
      current: {
        id: "fate-1",
        text: "如果只剩一个周末，你们更想怎么过？",
        options: ["窝在家里", "去陌生城市"],
        answers: {},
        createdAt: new Date().toISOString(),
        createdBy: "系统"
      }
    };
  }

  function randomFateQuestion() {
    return clone(fateQuestions[Math.floor(Math.random() * fateQuestions.length)]);
  }

  function canSendMessage() {
    if (!app.realtime.study?.quietMode) return true;
    const now = Date.now();
    if (now - app.quietDraftBlockedAt > 1800) {
      app.quietDraftBlockedAt = now;
      toast("安静模式已开启，暂时不能发送消息，只保留在线陪伴状态。");
    }
    return false;
  }

  function hasOpenReconciliation() {
    return (app.realtime.reconciliations || []).some((item) => item.status !== "resolved");
  }

  function applyEntertainmentLock() {
    const tab = document.getElementById("tab-games");
    if (!tab) return;
    const locked = hasOpenReconciliation();
    tab.classList.toggle("rt-games-locked", locked);
    tab.querySelectorAll("button").forEach((button) => {
      if (button.closest(".bottom-nav")) return;
      button.disabled = locked;
      button.title = locked ? "和解契约完成后解锁" : "";
    });
  }

  function studyElapsed(study) {
    const base = Number(study.elapsedSeconds || 0);
    if (!study.running || !study.startedAt) return base;
    return Math.max(0, base + Math.floor((Date.now() - Date.parse(study.startedAt)) / 1000));
  }

  function normalizeNoise(noise) {
    return whiteNoiseOptions.some(([key]) => key === noise) ? noise : "off";
  }

  function syncNoisePlayback(noise) {
    if (noise === "off") {
      stopNoise();
      return;
    }
    startNoise(noise);
  }

  function startNoise(noise) {
    try {
      stopNoise();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      filter.type = noise === "waves" ? "lowpass" : noise === "cafe" ? "bandpass" : "highpass";
      filter.frequency.value = noise === "waves" ? 420 : noise === "cafe" ? 880 : 1200;
      const gain = ctx.createGain();
      gain.gain.value = noise === "white" ? 0.045 : 0.035;
      source.buffer = buffer;
      source.loop = true;
      source.connect(filter).connect(gain).connect(ctx.destination);
      source.start();
      app.noiseSource = source;
      app.noiseContext = ctx;
    } catch (error) {
      toast("浏览器暂时不允许播放白噪音，请再点一次。");
    }
  }

  function stopNoise() {
    try { app.noiseSource && app.noiseSource.stop(); } catch (error) {}
    try { app.noiseContext && app.noiseContext.close(); } catch (error) {}
    app.noiseSource = null;
    app.noiseContext = null;
  }

  function normalizeEmotion(emotion) {
    return emotionOptions.some((item) => item.key === emotion) ? emotion : "晴";
  }

  function normalizeGoalTerm(term) {
    return goalLabels[term] ? term : "short";
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
      "whisper.send": 1
    };
    const amount = rewards[op.type] || 0;
    if (!amount) return;
    realtime.gravity ||= defaultGravityState();
    realtime.gravity.points = Number(realtime.gravity.points || 0) + amount;
    realtime.gravity.level = gravityLevel(realtime.gravity.points);
    realtime.gravity.history = (realtime.gravity.history || []).concat({
      type: op.type,
      amount,
      actor: op.actor && op.actor.id || "",
      actorName: op.actor && op.actor.name || "",
      createdAt: at
    }).slice(-120);
    applyGravityEffects(realtime.gravity);
  }

  function gravityLevel(points) {
    return Math.max(1, Math.floor(Math.sqrt(Number(points || 0) / 12)) + 1);
  }

  function gravityBase(level) {
    return Math.pow(Math.max(0, level - 1), 2) * 12;
  }

  function gravityNext(level) {
    return Math.pow(level, 2) * 12;
  }

  function applyGravityEffects(gravity) {
    const level = gravityLevel(gravity && gravity.points);
    document.documentElement.classList.toggle("rt-gravity-glow", level >= 2);
    document.documentElement.classList.toggle("rt-gravity-bg", level >= 4);
  }

  function getLegacyAlbum() {
    const legacy = getLegacyState() || {};
    return Array.isArray(legacy.album) ? legacy.album.map((item, index) => ({ item, index })) : [];
  }

  function memoryPool() {
    const legacy = getLegacyState() || {};
    const pool = [];
    const collections = legacy.collections || {};
    if (Array.isArray(collections.diary)) {
      collections.diary.forEach((item) => pool.push({
        kind: "日记",
        title: item.title || item.date || "一篇日记",
        text: item.text || item.content || item.note || "",
        actor: item.actor,
        actorName: item.actorName
      }));
    }
    Object.entries(collections).forEach(([key, list]) => {
      if (key === "diary" || !Array.isArray(list)) return;
      list.slice(0, 30).forEach((item) => {
        if (item && (item.text || item.content || item.title)) {
          pool.push({ kind: "留言", title: item.title || key, text: item.text || item.content || item.note || "", actor: item.actor, actorName: item.actorName });
        }
      });
    });
    getLegacyAlbum().forEach(({ item }) => pool.push({
      kind: "照片",
      title: item.caption || item.title || "一张照片",
      text: item.category ? `分类：${item.category}` : "",
      image: item.src || "",
      actor: item.actor,
      actorName: item.actorName
    }));
    return pool.filter((item) => item.title || item.text || item.image);
  }

  function auctionWinner(item) {
    const bids = item.bids || {};
    const a = Number(bids.A || 0);
    const b = Number(bids.B || 0);
    if (!a && !b) return "";
    if (a === b) return "";
    return a > b ? "A" : "B";
  }

  function pointPosition(item) {
    if (Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))) return { x: Number(item.x), y: Number(item.y) };
    const seed = stableHash(`${item.city || ""}${item.place || ""}`);
    const n = parseInt(seed.slice(0, 6), 16) || 1;
    return { x: 10 + n % 80, y: 10 + Math.floor(n / 80) % 38 };
  }

  function dateTimeLocal(value) {
    const date = new Date(value);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }

  function remainingText(time) {
    if (!time || Number.isNaN(time)) return "等待时间";
    const diff = time - Date.now();
    if (diff <= 0) return "已到期";
    const minutes = Math.ceil(diff / 60000);
    if (minutes < 60) return `${minutes} 分钟后`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours < 24) return `${hours} 小时${rest ? ` ${rest} 分` : ""}后`;
    return `${Math.ceil(hours / 24)} 天后`;
  }

  function formatDuration(seconds) {
    seconds = Math.max(0, Number(seconds || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = seconds % 60;
    return [h, m, s].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function formatTime(input) {
    const time = Date.parse(input || "");
    if (!time) return "刚刚";
    return new Date(time).toLocaleString();
  }

  function defaultRealtimeState() {
    return {
      schema: 2,
      theme: "macaron",
      themePrefs: { A: "macaron", B: "macaron" },
      moods: {},
      tasks: [],
      tree: { level: 1, water: 0, totalWater: 0, lastWateredBy: "", lastWateredById: "", history: [] },
      doodle: { strokes: [], savedAt: "", savedBy: "", savedById: "" },
      music: { playlist: [], currentId: "", title: "", url: "", isPlaying: false, currentTime: 0, volume: 0.65, updatedAt: "", updatedBy: "", updatedById: "" },
      quiz: { active: { id: uuid(), createdAt: new Date().toISOString(), createdBy: "系统", answers: {} }, reports: [] },
      truthDare: { category: "daily", mode: "truth", current: null, recentIds: [], updatedAt: "" },
      dateWheel: { current: null, recentIds: [], rotation: 0, updatedAt: "" },
      fortune: { current: null, recentIds: [], updatedAt: "" },
      pulse: defaultPulseState(),
      delayedLetters: [],
      whispers: [],
      capsules: [],
      study: defaultStudyState(),
      emotionCalendar: {},
      preferenceBook: { likes: "", avoid: "", triggers: "", comfort: "", updatedAt: "" },
      reconciliations: [],
      auction: defaultAuctionState(),
      fate: defaultFateState(),
      gravity: defaultGravityState(),
      meetingMap: { points: [] },
      memoryDraw: { current: null, updatedAt: "" },
      growthGoals: defaultGrowthGoals(),
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

  function readImageAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve("");
      if (!/^image\//.test(file.type || "")) return reject(new Error("请选择图片文件。"));
      if (file.size > 4 * 1024 * 1024) return reject(new Error("图片超过 4MB，建议压缩后再上传。"));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }).catch((error) => {
      toast(error.message || "读取图片失败。");
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
