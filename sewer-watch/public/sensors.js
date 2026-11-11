// 영천시 맨홀 센서 지점 정의 (데모용 예시 좌표)
// depth: 센서(맨홀 뚜껑 아래)부터 바닥까지 깊이(cm)
// base: 평상시 수위(cm), sensitivity: 강우에 대한 민감도(저지대일수록 큼)
window.SENSORS = [
  { id: "YC-01", name: "영천공설시장 앞",   area: "완산동",   lat: 35.9628, lng: 128.9395, depth: 180, base: 22, sensitivity: 1.25 },
  { id: "YC-02", name: "영천역 광장",       area: "문내동",   lat: 35.9612, lng: 128.9425, depth: 200, base: 25, sensitivity: 1.05 },
  { id: "YC-03", name: "금호강 영천교 하부", area: "창구동",   lat: 35.9668, lng: 128.9352, depth: 160, base: 30, sensitivity: 1.45 },
  { id: "YC-04", name: "영천시청 사거리",    area: "문외동",   lat: 35.9733, lng: 128.9386, depth: 190, base: 18, sensitivity: 0.85 },
  { id: "YC-05", name: "망정동 주택가",      area: "망정동",   lat: 35.9585, lng: 128.9300, depth: 170, base: 20, sensitivity: 1.15 },
  { id: "YC-06", name: "야사동 아파트단지",  area: "야사동",   lat: 35.9785, lng: 128.9530, depth: 210, base: 16, sensitivity: 0.75 },
  { id: "YC-07", name: "금호읍 행정복지센터", area: "금호읍",  lat: 35.9335, lng: 128.8735, depth: 175, base: 24, sensitivity: 1.10 },
  { id: "YC-08", name: "완산동 지하차도",    area: "완산동",   lat: 35.9600, lng: 128.9460, depth: 150, base: 28, sensitivity: 1.60 }
];

// 위험 단계 기준 (맨홀 깊이 대비 수위 비율)
window.LEVELS = [
  { key: "safe",    label: "안전", min: 0,    color: "#16a34a" },
  { key: "caution", label: "주의", min: 0.50, color: "#eab308" },
  { key: "warning", label: "경고", min: 0.70, color: "#f97316" },
  { key: "danger",  label: "위험", min: 0.85, color: "#dc2626" }
];
