/* 영천 하수구 수위 알리미 - 프론트엔드
 * - 데모 모드: 브라우저에서 강우량에 따른 수위를 시뮬레이션
 * - 라이브 모드: server.js 가 실행 중이면 실제 센서(ESP32) 데이터를 SSE로 수신,
 *   실제 데이터가 없는 지점은 계속 시뮬레이션으로 채움
 */
(() => {
  "use strict";

  const LEVELS = window.LEVELS;
  const HISTORY_MAX = 360;          // 지점별 보관 데이터 수
  const TICK_MS = 1000;             // 화면 갱신 주기
  const LIVE_TIMEOUT_MS = 60_000;   // 이 시간 동안 실측값 없으면 시뮬레이션으로 복귀
  const HYSTERESIS = 0.03;          // 단계 하향 시 여유폭 (경계에서 알림 반복 방지)
  const RAIN_TO_CM = 1.7;           // 강우 1mm/h 당 수위 상승(cm) × 민감도
  const TAU_SEC = 600;              // 수위 반응 시간상수(초, 시뮬레이션 시간)

  // ---------- 상태 ----------
  const state = {
    mode: "demo",
    rain: 0,
    simTime: Date.now() - 40 * 20_000, // 초기 이력(약 13분)만큼 과거에서 시작
    selected: null,
    sensors: new Map(),
    scenario: null,
  };

  for (const s of window.SENSORS) {
    state.sensors.set(s.id, {
      ...s,
      level: s.base + Math.random() * 4,
      history: [],
      rank: 0,
      lastReal: 0,
    });
  }

  // ---------- 유틸 ----------
  const $ = (id) => document.getElementById(id);
  const fmtTime = (t) => new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  function rankOf(ratio) {
    let r = 0;
    LEVELS.forEach((lv, i) => { if (ratio >= lv.min) r = i; });
    return r;
  }

  // 히스테리시스 적용: 올라갈 땐 즉시, 내려갈 땐 기준 - 3% 아래로 떨어져야 하향
  function nextRank(prev, ratio) {
    const raw = rankOf(ratio);
    if (raw >= prev) return raw;
    return ratio < LEVELS[prev].min - HYSTERESIS ? raw : prev;
  }

  // 최근 데이터로 상승 속도(cm/분) 계산 (최소제곱 직선)
  function riseRate(hist) {
    const pts = hist.slice(-30);
    if (pts.length < 5) return 0;
    const t0 = pts[0].t;
    const xs = pts.map((p) => (p.t - t0) / 60000);
    const ys = pts.map((p) => p.level);
    const n = pts.length;
    const mx = xs.reduce((a, b) => a + b) / n;
    const my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    return den ? num / den : 0;
  }

  // 위험 단계 도달까지 예상 시간(분)
  function etaToDanger(s, rate) {
    const dangerCm = s.depth * LEVELS[3].min;
    if (s.level >= dangerCm || rate <= 0.05) return null;
    return (dangerCm - s.level) / rate;
  }

  // ---------- 시뮬레이션 ----------
  function simulate(dtSec) {
    const now = Date.now();
    for (const s of state.sensors.values()) {
      if (now - s.lastReal < LIVE_TIMEOUT_MS) continue; // 실측 중인 센서는 건너뜀
      const target = s.base + state.rain * RAIN_TO_CM * s.sensitivity;
      const k = 1 - Math.exp(-dtSec / TAU_SEC);
      s.level += (target - s.level) * k + (Math.random() - 0.5) * 0.8;
      s.level = Math.max(0, Math.min(s.depth * 1.05, s.level));
    }
  }

  function record() {
    for (const s of state.sensors.values()) {
      s.history.push({ t: state.simTime, level: s.level });
      if (s.history.length > HISTORY_MAX) s.history.shift();
      const ratio = s.level / s.depth;
      const r = nextRank(s.rank, ratio);
      if (r !== s.rank) onRankChange(s, s.rank, r);
      s.rank = r;
    }
  }

  // ---------- 알림 ----------
  let audioCtx = null;
  function beep(times) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "square";
        o.frequency.value = 880;
        g.gain.value = 0.08;
        o.connect(g).connect(audioCtx.destination);
        const st = audioCtx.currentTime + i * 0.35;
        o.start(st);
        o.stop(st + 0.2);
      }
    } catch { /* 오디오 미지원 */ }
  }

  function toast(msg, cls) {
    const el = $("toast");
    el.textContent = msg;
    el.className = `toast show ${cls}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.className = "toast"), 5000);
  }

  function pushLog(msg, cls) {
    const ul = $("alertLog");
    ul.querySelector(".empty")?.remove();
    const li = document.createElement("li");
    li.className = cls;
    li.innerHTML = `<time>${fmtTime(state.simTime)}</time><span></span>`;
    li.querySelector("span").textContent = msg;
    ul.prepend(li);
    while (ul.children.length > 50) ul.lastChild.remove();
  }

  function onRankChange(s, prev, next) {
    const lv = LEVELS[next];
    const pct = Math.round((s.level / s.depth) * 100);
    if (next > prev && next >= 1) {
      const msg = `[${lv.label}] ${s.name}(${s.area}) 수위 ${Math.round(s.level)}cm (${pct}%)`;
      pushLog(msg, lv.key);
      toast(msg, lv.key);
      if (next >= 2) {
        beep(next === 3 ? 3 : 1);
        navigator.vibrate?.(next === 3 ? [400, 150, 400, 150, 400] : [250]);
        notify(`영천 하수구 ${lv.label} 알림`, `${s.name} 수위 ${pct}% — ${next === 3 ? "즉시 접근 금지·대피" : "주의하세요"}`);
      }
    } else if (next < prev && prev >= 2) {
      pushLog(`[해제] ${s.name} ${LEVELS[prev].label} → ${lv.label}`, "info");
    }
  }

  function notify(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, tag: title, renotify: true }));
      } else {
        new Notification(title, { body });
      }
    } catch { /* 일부 모바일 브라우저는 new Notification 미지원 */ }
  }

  $("notifyBtn").addEventListener("click", async () => {
    beep(0); // 사용자 동작으로 오디오 잠금 해제
    if (!("Notification" in window)) return toast("이 브라우저는 알림을 지원하지 않습니다.", "info");
    const p = await Notification.requestPermission();
    $("notifyBtn").textContent = p === "granted" ? "🔔 알림 켜짐" : "🔕 알림 거부됨";
  });

  // ---------- 지도 ----------
  let map = null;
  const markers = new Map();
  function initMap() {
    if (!window.L) { $("map").textContent = "지도를 불러올 수 없습니다 (인터넷 연결 확인)"; return; }
    map = L.map("map", { zoomControl: true }).setView([35.962, 128.925], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    for (const s of state.sensors.values()) {
      const m = L.circleMarker([s.lat, s.lng], { radius: 10, weight: 2, color: "#fff", fillOpacity: 0.9 })
        .addTo(map)
        .on("click", () => select(s.id));
      markers.set(s.id, m);
    }
  }

  // ---------- 차트 ----------
  let chart = null;
  function initChart() {
    if (!window.Chart) return;
    const line = (label, color, dash) => ({ label, data: [], borderColor: color, borderWidth: 1.5, borderDash: dash, pointRadius: 0, fill: false });
    chart = new Chart($("chart"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "수위(cm)", data: [], borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,.18)", fill: true, pointRadius: 0, tension: 0.25, borderWidth: 2 },
          line("주의", LEVELS[1].color, [4, 4]),
          line("경고", LEVELS[2].color, [4, 4]),
          line("위험", LEVELS[3].color, [6, 3]),
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        scales: {
          x: { ticks: { maxTicksLimit: 6, color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.1)" } },
          y: { beginAtZero: true, ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.1)" } },
        },
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 12 } } },
      },
    });
  }

  // ---------- 렌더링 ----------
  function select(id) {
    state.selected = id;
    const s = state.sensors.get(id);
    if (map && s) map.panTo([s.lat, s.lng]);
    render();
    if (window.innerWidth < 900) $("detailCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function render() {
    const list = [...state.sensors.values()];
    const counts = [0, 0, 0, 0];
    list.forEach((s) => counts[s.rank]++);
    $("cntSafe").textContent = counts[0];
    $("cntCaution").textContent = counts[1];
    $("cntWarning").textContent = counts[2];
    $("cntDanger").textContent = counts[3];

    // 상단 배너
    const worst = Math.max(...list.map((s) => s.rank));
    const banner = $("banner");
    banner.className = `banner ${LEVELS[worst].key}`;
    if (worst === 0) {
      $("bannerTitle").textContent = "모든 지점 안전";
      $("bannerText").textContent = "현재 위험 지점이 없습니다.";
    } else {
      const names = list.filter((s) => s.rank === worst).map((s) => s.name).join(", ");
      $("bannerTitle").textContent = `${LEVELS[worst].label} 단계 발령`;
      $("bannerText").textContent = worst === 3 ? `${names} — 즉시 접근 금지, 저지대 대피` : names;
    }

    // 강우
    $("rainVal").textContent = Math.round(state.rain);
    $("rainIcon").textContent = state.rain >= 50 ? "⛈" : state.rain >= 20 ? "🌧" : state.rain >= 3 ? "🌦" : "☀️";

    // 목록 (위험한 순)
    const ul = $("sensorList");
    const sorted = list.slice().sort((a, b) => b.level / b.depth - a.level / a.depth);
    ul.innerHTML = "";
    for (const s of sorted) {
      const lv = LEVELS[s.rank];
      const pct = Math.min(100, (s.level / s.depth) * 100);
      const rate = riseRate(s.history);
      const li = document.createElement("li");
      li.className = `sensor ${lv.key}${state.selected === s.id ? " selected" : ""}`;
      li.tabIndex = 0;
      li.innerHTML = `
        <div class="s-head">
          <span class="s-name"></span>
          <span class="pill ${lv.key}">${lv.label}</span>
        </div>
        <div class="gauge"><div class="fill" style="width:${pct}%;background:${lv.color}"></div>
          <i style="left:50%"></i><i style="left:70%"></i><i style="left:85%"></i></div>
        <div class="s-meta">
          <span>${Math.round(s.level)} / ${s.depth}cm (${Math.round(pct)}%)</span>
          <span>${rate > 0.05 ? "▲" : rate < -0.05 ? "▼" : "–"} ${Math.abs(rate).toFixed(1)}cm/분</span>
          <span class="src">${Date.now() - s.lastReal < LIVE_TIMEOUT_MS ? "📡 실측" : "🧪 시뮬"}</span>
        </div>`;
      li.querySelector(".s-name").textContent = `${s.name} · ${s.area}`;
      li.addEventListener("click", () => select(s.id));
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") select(s.id); });
      ul.appendChild(li);

      const m = markers.get(s.id);
      if (m) {
        m.setStyle({ fillColor: lv.color, radius: 9 + s.rank * 2 });
        m.bindTooltip(`${s.name}<br>${lv.label} · ${Math.round(pct)}%`);
      }
    }

    renderDetail();
  }

  function renderDetail() {
    const s = state.sensors.get(state.selected);
    if (!s) return;
    const lv = LEVELS[s.rank];
    const rate = riseRate(s.history);
    const eta = etaToDanger(s, rate);
    const pct = Math.round((s.level / s.depth) * 100);
    $("detailTitle").textContent = `${s.name} (${s.id})`;
    $("detailBody").innerHTML = `
      <div class="kv"><span>상태</span><b class="pill ${lv.key}">${lv.label}</b></div>
      <div class="kv"><span>현재 수위</span><b>${Math.round(s.level)}cm / 깊이 ${s.depth}cm (${pct}%)</b></div>
      <div class="kv"><span>변화 속도</span><b>${rate >= 0 ? "+" : ""}${rate.toFixed(2)} cm/분</b></div>
      <div class="kv"><span>위험 도달 예측</span><b>${s.rank === 3 ? "이미 위험 단계" : eta == null ? "상승 추세 없음" : `약 ${Math.max(1, Math.round(eta))}분 후`}</b></div>
      <div class="kv"><span>위치</span><b>경북 영천시 ${s.area}</b></div>`;

    if (chart) {
      const h = s.history;
      chart.data.labels = h.map((p) => fmtTime(p.t));
      chart.data.datasets[0].data = h.map((p) => +p.level.toFixed(1));
      [1, 2, 3].forEach((i) => (chart.data.datasets[i].data = h.map(() => s.depth * LEVELS[i].min)));
      chart.options.scales.y.max = s.depth;
      chart.update("none");
    }
  }

  // ---------- 강우 조작 ----------
  function setRain(v) {
    state.rain = v;
    $("rainSlider").value = Math.round(v);
  }
  $("rainSlider").addEventListener("input", (e) => { stopScenario(); setRain(+e.target.value); });
  document.querySelectorAll("[data-rain]").forEach((b) =>
    b.addEventListener("click", () => { stopScenario(); setRain(+b.dataset.rain); }));

  // 집중호우 시나리오: 60초 동안 0→85mm/h, 40초 유지, 60초 동안 감소
  function stopScenario() { clearInterval(state.scenario); state.scenario = null; }
  $("stormBtn").addEventListener("click", () => {
    beep(0);
    stopScenario();
    $("fastSim").checked = true;
    pushLog("⛈ 집중호우 시나리오 시작", "info");
    const start = Date.now();
    state.scenario = setInterval(() => {
      const t = (Date.now() - start) / 1000;
      if (t < 60) setRain((t / 60) * 85);
      else if (t < 100) setRain(85);
      else if (t < 160) setRain(85 * (1 - (t - 100) / 60));
      else { setRain(0); stopScenario(); pushLog("시나리오 종료", "info"); }
    }, 500);
  });

  // ---------- 라이브 모드 (server.js) ----------
  function applyReading(r) {
    const s = state.sensors.get(r.id);
    if (!s) return;
    if (typeof r.level_cm === "number") s.level = r.level_cm;
    else if (typeof r.distance_cm === "number") s.level = Math.max(0, s.depth - r.distance_cm);
    else return;
    s.lastReal = Date.now();
  }

  async function tryLive() {
    try {
      const res = await fetch("api/sensors", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      state.mode = "live";
      $("modeBadge").textContent = "라이브";
      $("modeBadge").classList.add("live");
      (data.readings || []).forEach((r) => { if (Date.now() - r.receivedAt < LIVE_TIMEOUT_MS) applyReading(r); });
      if (typeof data.rain === "number") setRain(data.rain);
      const es = new EventSource("api/stream");
      es.addEventListener("reading", (e) => applyReading(JSON.parse(e.data)));
      es.addEventListener("rain", (e) => { stopScenario(); setRain(JSON.parse(e.data).rain); });
    } catch {
      state.mode = "demo"; // 서버 없음 → 순수 데모
    }
  }

  // ---------- 메인 루프 ----------
  function tick() {
    const speed = $("fastSim").checked ? 20 : 1;
    const dt = (TICK_MS / 1000) * speed;
    state.simTime += dt * 1000;
    simulate(dt);
    record();
    render();
  }

  // 초기 이력을 조금 채워서 그래프가 비어 있지 않게
  for (let i = 0; i < 40; i++) { state.simTime += 20_000; simulate(20); record(); }

  initMap();
  initChart();
  select(window.SENSORS[0].id);
  tryLive();
  setInterval(tick, TICK_MS);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
