# MotoGauge - Motorcycle OBD2 Dashboard & Diagnostics

แอปพลิเคชันสำหรับเชื่อมต่อกล่อง ECU มอเตอร์ไซค์ผ่าน OBD2 รองรับทั้ง Android Native APK (RFCOMM SPP Bluetooth) และ Web Bluetooth บน Google Chrome

---

## โครงสร้างโฟลเดอร์ (Directory Structure)

```
motogauge-app/
├── web/                             # โค้ด Web UI และตรรกะการประมวลผล OBD2
│   ├── index.html                   # หน้าแดชบอร์ด, เครื่องมืออ่านโค้ด DTC, คู่มือต่อสาย
│   ├── styles.css                   # สไตล์ Dark Theme ดีไซน์สปอร์ต
│   ├── app.js                       # ตัวควบคุมหน้าจอและการโต้ตอบ
│   ├── obd-service.js               # ไดรเวอร์ ELM327 (รองรับทั้ง SPP และ BLE)
│   └── dtc-database.js              # ฐานข้อมูลรหัสไฟเครื่องยนต์ภาษาไทย
│
├── android/                         # โปรเจกต์ Android Native (Capacitor)
│   ├── app/src/main/java/           # Java Bridge (NativeOBDBridge สำหรับ RFCOMM SPP)
│   ├── gradle/wrapper/              # Gradle 8.14.3
│   └── gradlew.bat                  # Gradle Wrapper Script
│
├── releases/                        # ที่เก็บไฟล์ APK ที่บิลด์เสร็จแล้ว
│   └── MotoGauge.apk                # Android APK พร้อมติดตั้ง
│
├── e2e/                             # ชุดทดสอบ Integration E2E
│   └── motogauge.spec.ts
│
├── build-apk.bat                    # สคริปต์คลิกเดียวสำหรับ Sync และคอมไพล์ APK
├── capacitor.config.json            # การตั้งค่า Capacitor (ชี้ webDir: "web")
└── package.json                     # รายการ Dependencies สำหรับ Capacitor
```

---

## วิธีใช้งานและการบิลด์ (How to Run & Build)

### 1. เปิดใช้งานแบบ Web
เปิดไฟล์ `web/index.html` ผ่าน Google Chrome เพื่อทดสอบหน้าจอหรือเชื่อมต่อผ่าน Web Bluetooth

### 2. บิลด์ไฟล์ APK สำหรับ Android
- **วิธีง่าย (1-Click)**: ดับเบิ้ลคลิกไฟล์ `build-apk.bat`
- **วิธีผ่าน Terminal**:
  ```bash
  cd motogauge-app
  npx cap sync android
  cd android
  .\gradlew.bat assembleRelease
  ```
  ไฟล์ APK จะถูกส่งออกไปที่ `motogauge-app/releases/MotoGauge.apk` และ `MotoGauge.apk` ที่ Root

---

## แผนการพัฒนาในอนาคต (Roadmap)
อ่านรายละเอียดฟีเจอร์และทิศทางการพัฒนาเพิ่มเติมได้ที่: [ROADMAP.md](ROADMAP.md) (ประกอบด้วย Data Logging, จูนกล่องแต่ง Standalone แบบ Real-Time, และการวิจัยรีแมพกล่องเดิม)
