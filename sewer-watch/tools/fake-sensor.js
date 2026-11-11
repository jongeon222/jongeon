// 하드웨어 없이 "실제 센서" 를 흉내내는 스크립트 (발표 시연용)
//   node tools/fake-sensor.js [센서ID] [서버주소]
//   예) node tools/fake-sensor.js YC-08 http://localhost:3000
// 수위가 점점 차오르다가(위험 단계 도달) 다시 빠지는 과정을 3초 간격으로 전송합니다.
const id = process.argv[2] || "YC-08";
const base = process.argv[3] || "http://localhost:3000";
const DEPTH = 150; // sensors.js 의 YC-08 깊이와 맞춤

let level = 30;
let dir = 1;

async function sendOnce() {
  level += dir * (4 + Math.random() * 3);
  if (level >= DEPTH * 0.95) dir = -1;
  if (level <= 25) dir = 1;
  const distance_cm = Math.round((DEPTH - level) * 10) / 10; // 초음파 센서는 "수면까지 거리"를 잼
  try {
    const res = await fetch(`${base}/api/readings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.API_KEY || "" },
      body: JSON.stringify({ id, distance_cm }),
    });
    console.log(`${id} 거리 ${distance_cm}cm → 수위 ${Math.round(level)}cm (${res.status})`);
  } catch (e) {
    console.error("전송 실패:", e.message);
  }
}

sendOnce();
setInterval(sendOnce, 3000);
