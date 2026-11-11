// 영천 하수구 수위 알리미 - 서버 (외부 패키지 없이 Node.js 18+ 로 실행)
//   node server.js           → http://localhost:3000
//
// API
//   GET  /api/sensors        최신 실측값 목록 + 현재 강우량
//   POST /api/readings       센서(ESP32) 측정값 업로드
//                            {"id":"YC-01","distance_cm":120}  또는  {"id":"YC-01","level_cm":60}
//   POST /api/rain           강우량 설정/브로드캐스트 {"rain":45}
//   GET  /api/stream         Server-Sent Events (reading, rain 이벤트)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY || ""; // 설정하면 센서 업로드 시 x-api-key 헤더 필요
const PUBLIC = path.join(__dirname, "public");

const latest = new Map(); // id → reading
let rain = 0;
const clients = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 10_000) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); }
    });
  });
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,x-api-key",
    });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/api/sensors") {
    return send(res, 200, { readings: [...latest.values()], rain });
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(": connected\n\n");
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/readings") {
    if (API_KEY && req.headers["x-api-key"] !== API_KEY) return send(res, 401, { error: "invalid api key" });
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: "invalid json" }); }
    const { id, distance_cm, level_cm } = body;
    if (typeof id !== "string" || !id || (!isNum(distance_cm) && !isNum(level_cm))) {
      return send(res, 400, { error: "id 와 distance_cm 또는 level_cm(숫자)가 필요합니다" });
    }
    const reading = { id, receivedAt: Date.now() };
    if (isNum(level_cm)) reading.level_cm = level_cm;
    else reading.distance_cm = distance_cm;
    latest.set(id, reading);
    broadcast("reading", reading);
    console.log(`[reading] ${id}`, isNum(level_cm) ? `level=${level_cm}cm` : `distance=${distance_cm}cm`);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/rain") {
    let body;
    try { body = await readJson(req); } catch { return send(res, 400, { error: "invalid json" }); }
    if (!isNum(body.rain) || body.rain < 0) return send(res, 400, { error: "rain(mm/h, 0 이상 숫자)가 필요합니다" });
    rain = body.rain;
    broadcast("rain", { rain });
    return send(res, 200, { ok: true, rain });
  }

  send(res, 404, { error: "not found" });
}

function serveStatic(req, res, url) {
  const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url).catch((e) => { console.error(e); send(res, 500, { error: "server error" }); });
  } else {
    serveStatic(req, res, url);
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`영천 하수구 수위 알리미 → http://localhost:${PORT}`));
}
module.exports = server;
