const { test, before, after } = require("node:test");
const assert = require("node:assert");
const server = require("../server");

let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));

const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("정적 페이지 제공", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /영천 하수구 수위 알리미/);
});

test("경로 탈출 차단", async () => {
  const res = await fetch(base + "/..%2fserver.js");
  assert.notEqual(res.status, 200);
});

test("측정값 업로드 후 조회", async () => {
  assert.equal((await post("/api/readings", { id: "YC-01", distance_cm: 100 })).status, 200);
  const data = await (await fetch(base + "/api/sensors")).json();
  const r = data.readings.find((x) => x.id === "YC-01");
  assert.equal(r.distance_cm, 100);
});

test("잘못된 측정값 거부", async () => {
  assert.equal((await post("/api/readings", { id: "YC-01" })).status, 400);
  assert.equal((await post("/api/readings", { distance_cm: 50 })).status, 400);
  assert.equal((await post("/api/readings", { id: "YC-01", distance_cm: "50" })).status, 400);
});

test("강우량 설정", async () => {
  assert.equal((await post("/api/rain", { rain: 40 })).status, 200);
  assert.equal((await (await fetch(base + "/api/sensors")).json()).rain, 40);
  assert.equal((await post("/api/rain", { rain: -1 })).status, 400);
});
