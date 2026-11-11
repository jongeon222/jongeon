/*
 * 영천 하수구 수위 알리미 - 맨홀 센서 노드 (ESP32 + JSN-SR04T 방수 초음파 센서)
 *
 * 원리: 맨홀 뚜껑 아래에 초음파 센서를 아래로 향하게 달고,
 *       "센서 ~ 수면" 거리를 재서 서버로 보냄.  수위 = 맨홀 깊이 - 거리
 *
 * 배선
 *   JSN-SR04T  VCC → 5V,  GND → GND,  TRIG → GPIO 5,  ECHO → GPIO 18 (전압분배 1k/2k 권장)
 *   부저(선택)  + → GPIO 25,  - → GND
 *   LED(선택)   빨강 → GPIO 26 (220Ω 저항)
 *
 * Arduino IDE: 보드 "ESP32 Dev Module" 선택 후 업로드
 */
#include <WiFi.h>
#include <HTTPClient.h>

// ===== 설정 =====
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* SERVER    = "http://192.168.0.10:3000/api/readings";  // 서버 PC의 IP
const char* SENSOR_ID = "YC-01";      // public/sensors.js 의 id 와 일치
const char* API_KEY   = "";           // 서버에 API_KEY 를 설정했다면 같은 값
const float DEPTH_CM  = 180.0;        // 센서 ~ 맨홀 바닥 거리 (설치 후 실측)
const float DANGER_RATIO = 0.85;      // 현장 경보 기준 (깊이 대비)

const int PIN_TRIG = 5;
const int PIN_ECHO = 18;
const int PIN_BUZZER = 25;
const int PIN_LED = 26;

const unsigned long NORMAL_INTERVAL_MS = 10000; // 평상시 10초
const unsigned long ALERT_INTERVAL_MS  = 3000;  // 위험 시 3초

// 초음파 1회 측정 (cm), 실패 시 -1
float measureOnce() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(5);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(20);              // JSN-SR04T 는 10us 이상
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000UL); // 최대 약 5m
  if (us == 0) return -1;
  return us * 0.0343f / 2.0f;
}

// 5회 측정 후 중앙값 (하수구 내부 반사·물보라 노이즈 제거)
float measureMedian() {
  float v[5];
  int n = 0;
  for (int i = 0; i < 5; i++) {
    float d = measureOnce();
    if (d > 20 && d < 450) v[n++] = d;  // JSN-SR04T 최소 측정거리 약 20cm
    delay(60);
  }
  if (n == 0) return -1;
  for (int i = 0; i < n; i++)
    for (int j = i + 1; j < n; j++)
      if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }
  return v[n / 2];
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi 연결 중");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250);
    Serial.print(".");
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " 완료" : " 실패");
}

bool upload(float distance) {
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(SERVER);
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) http.addHeader("x-api-key", API_KEY);
  String body = String("{\"id\":\"") + SENSOR_ID + "\",\"distance_cm\":" + String(distance, 1) + "}";
  int code = http.POST(body);
  http.end();
  Serial.printf("업로드 %s → HTTP %d\n", body.c_str(), code);
  return code == 200;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  connectWifi();
}

void loop() {
  float distance = measureMedian();
  bool danger = false;

  if (distance > 0) {
    float level = DEPTH_CM - distance;
    if (level < 0) level = 0;
    danger = level / DEPTH_CM >= DANGER_RATIO;
    Serial.printf("거리 %.1fcm, 수위 %.1fcm (%.0f%%)\n", distance, level, level / DEPTH_CM * 100);
    upload(distance);
  } else {
    Serial.println("측정 실패 (센서/배선 확인)");
  }

  // 통신이 끊겨도 현장에서 경보가 울리도록 로컬 경보
  digitalWrite(PIN_LED, danger ? HIGH : LOW);
  if (danger) {
    for (int i = 0; i < 3; i++) { tone(PIN_BUZZER, 2000, 200); delay(300); }
  }

  delay(danger ? ALERT_INTERVAL_MS : NORMAL_INTERVAL_MS);
}
