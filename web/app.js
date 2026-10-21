/**
 * MotoGauge - Core Logic & Real-time Gauge Engine
 * Clean-room implementation of OBD2 Motorcycle Dashboard & Diagnostics
 * 100% Real Code: Native Android SPP & Web BLE, Real SAE J1979 DTC Scan, LocalStorage Persistence, In-App Guide
 * Zero Emojis - All Professional SVG Icons
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'motogauge_settings_v1';

  // --- App State ---
  const state = {
    connected: false,
    protocol: 'honda_kwp',
    maxTemp: 105,
    redlineRpm: 9500,
    currentRpm: 0,
    targetRpm: 0,
    speedKmh: 0,
    coolantTemp: null,
    tpsPercent: 0,
    batteryVolt: null,
    iatTemp: null,
    tripPeaks: {
      maxRpm: 0,
      maxSpeed: 0,
      maxTemp: null
    },
    dtcList: [],
    calc: {
      bore: 47.0,
      stroke: 63.1,
      strokePlus: 0.0,
      frontTeeth: 14,
      rearTeeth: 36
    }
  };

  // --- Persistent Storage Helpers ---
  function saveSettings() {
    try {
      const payload = {
        protocol: state.protocol,
        maxTemp: state.maxTemp,
        redlineRpm: state.redlineRpm,
        calc: state.calc,
        tripPeaks: state.tripPeaks
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  function loadSettings() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.protocol) state.protocol = data.protocol;
        if (data.maxTemp) state.maxTemp = data.maxTemp;
        if (data.redlineRpm) state.redlineRpm = data.redlineRpm;
        if (data.calc) state.calc = { ...state.calc, ...data.calc };
        if (data.tripPeaks) state.tripPeaks = { ...state.tripPeaks, ...data.tripPeaks };
      }
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
    }
  }

  // Load saved configuration immediately
  loadSettings();

  // --- DOM Elements ---
  const canvas = document.getElementById('rpmGaugeCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const rpmValueText = document.getElementById('rpmValueText');
  const speedValueText = document.getElementById('speedValueText');
  const coolantValueText = document.getElementById('coolantValueText');
  const batteryValueText = document.getElementById('batteryValueText');
  const iatValueText = document.getElementById('iatValueText');
  const tpsValueText = document.getElementById('tpsValueText');
  const tpsFillBar = document.getElementById('tpsFillBar');
  const alertBanner = document.getElementById('alertBanner');
  const shiftLightBar = document.getElementById('shiftLightBar');
  const navMilBadge = document.getElementById('navMilBadge');
  const milCountText = document.getElementById('milCountText');
  const peakRpmText = document.getElementById('peakRpmText');
  const peakSpeedText = document.getElementById('peakSpeedText');
  const peakTempText = document.getElementById('peakTempText');
  const btnResetTrip = document.getElementById('btnResetTrip');
  const bleStatusDot = document.getElementById('bleStatusDot');
  const bleStatusText = document.getElementById('bleStatusText');

  // --- 1. TACHOMETER CANVAS ENGINE (60 FPS) ---
  function drawGauge() {
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height - 20;
    const radius = 140;

    ctx.clearRect(0, 0, width, height);

    // Smooth needle interpolation
    state.currentRpm += (state.targetRpm - state.currentRpm) * 0.18;

    // Angles: start at 140 deg, end at 400 deg (span 260 deg)
    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const maxRpm = 12000;
    const rpmFrac = Math.min(Math.max(state.currentRpm / maxRpm, 0), 1);
    const needleAngle = startAngle + (endAngle - startAngle) * rpmFrac;

    // Background track arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = '#18202d';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Redline background zone
    const redlineStart = startAngle + (endAngle - startAngle) * (state.redlineRpm / maxRpm);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, redlineStart, endAngle);
    ctx.strokeStyle = 'rgba(255, 77, 90, 0.25)';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Active sweep arc
    if (state.currentRpm > 100) {
      const isRedline = state.currentRpm >= state.redlineRpm;
      const isWarning = state.currentRpm >= (state.redlineRpm - 1500) && !isRedline;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, needleAngle);
      ctx.strokeStyle = isRedline ? '#ff4d5a' : isWarning ? '#ffb800' : '#00e5ff';
      ctx.lineWidth = 14;
      ctx.lineCap = 'round';
      ctx.shadowColor = isRedline ? 'rgba(255, 77, 90, 0.6)' : '#00e5ff';
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Ticks & Labels (0, 2, 4, 6, 8, 10, 12k)
    for (let k = 0; k <= 12; k += 2) {
      const angle = startAngle + (endAngle - startAngle) * ((k * 1000) / maxRpm);
      const isOverRed = (k * 1000) >= state.redlineRpm;
      
      const xOuter = centerX + Math.cos(angle) * (radius - 12);
      const yOuter = centerY + Math.sin(angle) * (radius - 12);
      const xInner = centerX + Math.cos(angle) * (radius - 22);
      const yInner = centerY + Math.sin(angle) * (radius - 22);

      ctx.beginPath();
      ctx.moveTo(xInner, yInner);
      ctx.lineTo(xOuter, yOuter);
      ctx.strokeStyle = isOverRed ? '#ff4d5a' : '#4b5568';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Number text
      const xText = centerX + Math.cos(angle) * (radius - 36);
      const yText = centerY + Math.sin(angle) * (radius - 36) + 4;
      ctx.font = '600 11px JetBrains Mono, monospace';
      ctx.fillStyle = isOverRed ? '#ff4d5a' : '#828e9e';
      ctx.textAlign = 'center';
      ctx.fillText(k.toString(), xText, yText);
    }

    // Needle pointer
    const needleLength = radius - 8;
    const nx = centerX + Math.cos(needleAngle) * needleLength;
    const ny = centerY + Math.sin(needleAngle) * needleLength;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = state.currentRpm >= state.redlineRpm ? '#ff4d5a' : '#ffffff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Center pivot cap
    ctx.beginPath();
    ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0c10';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00e5ff';
    ctx.stroke();

    // Update Digital Readouts
    if (rpmValueText) rpmValueText.textContent = Math.round(state.currentRpm).toLocaleString();
    if (speedValueText) speedValueText.textContent = Math.round(state.speedKmh);

    // Update Shift Light LEDs
    updateShiftLights(state.currentRpm);

    // Update Trip Peaks dynamically
    updateTripPeaks();

    requestAnimationFrame(drawGauge);
  }

  function updateShiftLights(rpm) {
    if (!shiftLightBar) return;
    const segs = shiftLightBar.children;
    const red = state.redlineRpm;
    segs[0].className = 'shift-seg ' + (rpm > 3500 ? 'active-1' : '');
    segs[1].className = 'shift-seg ' + (rpm > 5500 ? 'active-1' : '');
    segs[2].className = 'shift-seg ' + (rpm > (red - 2000) ? 'active-2' : '');
    segs[3].className = 'shift-seg ' + (rpm > (red - 800) ? 'active-3' : '');
    segs[4].className = 'shift-seg ' + (rpm >= red ? 'active-red' : '');
  }

  function updateTripPeaks() {
    const curRpm = Math.round(state.currentRpm);
    const curSpd = Math.round(state.speedKmh);
    const curTmp = state.coolantTemp !== null ? Math.round(state.coolantTemp) : null;

    let changed = false;
    if (curRpm > state.tripPeaks.maxRpm) {
      state.tripPeaks.maxRpm = curRpm;
      changed = true;
    }
    if (curSpd > state.tripPeaks.maxSpeed) {
      state.tripPeaks.maxSpeed = curSpd;
      changed = true;
    }
    if (curTmp !== null && (state.tripPeaks.maxTemp === null || curTmp > state.tripPeaks.maxTemp)) {
      state.tripPeaks.maxTemp = curTmp;
      changed = true;
    }

    if (peakRpmText) peakRpmText.textContent = state.tripPeaks.maxRpm.toLocaleString();
    if (peakSpeedText) peakSpeedText.textContent = state.tripPeaks.maxSpeed;
    if (peakTempText) peakTempText.textContent = state.tripPeaks.maxTemp !== null ? state.tripPeaks.maxTemp : '--';

    if (changed) saveSettings();
  }

  if (btnResetTrip) {
    btnResetTrip.addEventListener('click', () => {
      state.tripPeaks = {
        maxRpm: Math.round(state.currentRpm),
        maxSpeed: Math.round(state.speedKmh),
        maxTemp: state.coolantTemp !== null ? Math.round(state.coolantTemp) : null
      };
      saveSettings();
      updateTripPeaks();
    });
  }

  function resetDashboardToIdle() {
    state.targetRpm = 0;
    state.speedKmh = 0;
    state.tpsPercent = 0;
    state.coolantTemp = null;
    state.batteryVolt = null;
    state.iatTemp = null;

    if (rpmValueText) rpmValueText.textContent = '0';
    if (speedValueText) speedValueText.textContent = '0';
    if (tpsValueText) tpsValueText.textContent = '0%';
    if (tpsFillBar) tpsFillBar.style.width = '0%';
    if (coolantValueText) coolantValueText.textContent = '--';
    if (batteryValueText) batteryValueText.textContent = '--';
    if (iatValueText) iatValueText.textContent = '--';

    const coolantStatus = document.getElementById('coolantStatus');
    if (coolantStatus) coolantStatus.textContent = 'รอสัญญาณ OBD2';
    const batteryStatus = document.getElementById('batteryStatus');
    if (batteryStatus) batteryStatus.textContent = 'รอสัญญาณ OBD2';

    if (alertBanner) alertBanner.classList.add('hidden');
  }

  function checkAlerts() {
    if (!alertBanner) return;
    if (state.coolantTemp !== null && state.coolantTemp >= state.maxTemp) {
      alertBanner.classList.remove('hidden');
    } else {
      alertBanner.classList.add('hidden');
    }
  }

  // --- 2. NAVIGATION (TABS ROUTING S02 - S06) ---
  const navItems = document.querySelectorAll('.nav-item');
  const screens = document.querySelectorAll('.screen-view');

  function switchScreen(targetId) {
    screens.forEach(screen => {
      screen.classList.remove('active');
    });
    const targetScreen = document.getElementById('screen-' + targetId);
    if (targetScreen) targetScreen.classList.add('active');

    navItems.forEach(item => {
      if (item.getAttribute('data-target') === targetId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-target');
      switchScreen(target);
    });
  });

  const btnGoToDiag = document.getElementById('btnGoToDiag');
  if (btnGoToDiag) {
    btnGoToDiag.addEventListener('click', () => switchScreen('diagnostics'));
  }

  // --- 3. SCREEN S01: BLUETOOTH MODAL & REAL HARDWARE PAIRING ---
  const modalConnect = document.getElementById('modalConnect');
  const btnOpenConnect = document.getElementById('btnOpenConnect');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnTriggerScan = document.getElementById('btnTriggerScan');
  const deviceList = document.getElementById('deviceList');

  if (btnOpenConnect) {
    btnOpenConnect.addEventListener('click', () => {
      renderDeviceList();
      modalConnect.classList.remove('hidden');
    });
  }
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => modalConnect.classList.add('hidden'));
  }
  if (modalConnect) {
    modalConnect.addEventListener('click', (e) => {
      if (e.target === modalConnect) modalConnect.classList.add('hidden');
    });
  }

  function renderDeviceList() {
    if (!deviceList) return;

    if (window.obdService && window.obdService.connected) {
      const devName = window.obdService.deviceName || 'อุปกรณ์ OBD2';
      deviceList.innerHTML = `
        <div class="device-item connected">
          <div class="device-info">
            <span class="device-name">${devName}</span>
            <span class="device-sub">เชื่อมต่อแล้ว (Live OBD2) • กำลังอ่านค่าเซนเซอร์สด</span>
          </div>
          <button id="btnDisconnectBLE" class="btn-sm btn-ghost" style="color: var(--color-danger); border-color: rgba(255, 77, 90, 0.4);">ตัดการเชื่อมต่อ</button>
        </div>
      `;
      const btnDisconnect = document.getElementById('btnDisconnectBLE');
      if (btnDisconnect) {
        btnDisconnect.addEventListener('click', () => {
          window.obdService.disconnect();
          state.connected = false;
          resetDashboardToIdle();
          updateBleStatusUI(false, 'OBD2: ไม่ได้เชื่อมต่อ');
          renderDeviceList();
        });
      }
      return;
    }

    // If running in Native Android app (NativeOBD bridge available)
    if (window.obdService && window.obdService.isNativeAvailable()) {
      const bonded = window.obdService.getBondedDevices();
      if (bonded && bonded.length > 0) {
        deviceList.innerHTML = `
          <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 8px;">
            อุปกรณ์บลูทูธที่จับคู่ในมือถือ (${bonded.length} อุปกรณ์):
          </div>
          <div class="bonded-list" style="display: flex; flex-direction: column; gap: 8px;">
            ${bonded.map(d => `
              <div class="device-item" style="display: flex; justify-content: space-between; align-items: center; background: #131822; padding: 10px 12px; border-radius: 8px; border: 1px solid #243042;">
                <div>
                  <div style="font-weight: 600; color: #fff;">${d.name || 'OBD2 Device'}</div>
                  <div style="font-size: 0.72rem; color: #7f8fa4; font-family: monospace;">${d.address}</div>
                </div>
                <button class="btn-sm btn-primary btn-connect-device" data-addr="${d.address}">เชื่อมต่อ</button>
              </div>
            `).join('')}
          </div>
        `;
        deviceList.querySelectorAll('.btn-connect-device').forEach(btn => {
          btn.addEventListener('click', () => {
            const addr = btn.getAttribute('data-addr');
            btn.disabled = true;
            btn.textContent = 'กำลังเชื่อมต่อ...';
            window.obdService.setProtocol(state.protocol);
            window.obdService.connectNative(addr);
          });
        });
        return;
      }
    }

    // Default empty state
    deviceList.innerHTML = `
      <div class="card info-card" style="text-align: center; padding: 22px 14px; margin: 10px 0;">
        <div style="margin-bottom: 8px;">
          <svg class="icon-svg" viewBox="0 0 24 24" width="32" height="32" style="color: var(--color-accent);">
            <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"></polyline>
          </svg>
        </div>
        <h4 style="color: var(--color-text); font-size: 0.95rem; margin-bottom: 4px;">ยังไม่มีอุปกรณ์เชื่อมต่อ</h4>
        <p style="color: var(--color-text-muted); font-size: 0.78rem; margin-bottom: 8px; line-height: 1.5;">
          1. เสียบตัวอ่าน ELM327 เข้ากับปลั๊กรถ<br>
          2. เปิดบลูทูธและจับคู่ในหน้าตั้งค่ามือถือ (PIN 1234 หรือ 0000)<br>
          3. กดปุ่ม "ค้นหาอุปกรณ์บลูทูธ" ด้านบน
        </p>
      </div>
    `;
  }

  function updateBleStatusUI(isConnected, text) {
    if (bleStatusDot) {
      bleStatusDot.className = 'ble-dot ' + (isConnected ? 'connected' : 'disconnected');
    }
    if (bleStatusText) {
      bleStatusText.textContent = text;
    }
  }

  if (btnTriggerScan) {
    btnTriggerScan.addEventListener('click', async () => {
      btnTriggerScan.disabled = true;
      btnTriggerScan.innerHTML = '<span class="radar-dot"></span> กำลังค้นหาอุปกรณ์...';

      // 1. If Native Android Bridge available: refresh bonded list
      if (window.obdService && window.obdService.isNativeAvailable()) {
        renderDeviceList();
        btnTriggerScan.disabled = false;
        btnTriggerScan.innerHTML = '<svg class="btn-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> ค้นหาอุปกรณ์บลูทูธ';
        return;
      }

      // 2. Web Bluetooth BLE
      if (window.obdService && window.obdService.isWebBluetoothSupported()) {
        try {
          window.obdService.setProtocol(state.protocol);
          await window.obdService.connectBLE();
          btnTriggerScan.disabled = false;
          btnTriggerScan.innerHTML = 'เชื่อมต่อสำเร็จ';
          updateBleStatusUI(true, 'OBD2: ' + (window.obdService.deviceName || 'เชื่อมต่อแล้ว'));
          renderDeviceList();
          setTimeout(() => {
            if (modalConnect) modalConnect.classList.add('hidden');
          }, 600);
          return;
        } catch (err) {
          console.warn('Bluetooth pairing error:', err.message);
          btnTriggerScan.disabled = false;
          btnTriggerScan.innerHTML = '<svg class="btn-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> ค้นหาอุปกรณ์บลูทูธ';
          alert('ไม่สามารถเชื่อมต่อได้: ' + (err.message || 'ยกเลิกการค้นหา'));
          return;
        }
      }

      // If not supported:
      btnTriggerScan.disabled = false;
      btnTriggerScan.innerHTML = '<svg class="btn-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> ค้นหาอุปกรณ์บลูทูธ';
      alert('สภาพแวดล้อมนี้ไม่รองรับ Bluetooth Direct กรุณาติดตั้งไฟล์ MotoGauge.apk บน Android หรือเปิดด้วย Google Chrome ที่รองรับ Web Bluetooth');
    });
  }

  // --- 4. SCREEN S03: REAL DTC SCANNER & CLEAR CODE LOGIC ---
  const btnScanDTC = document.getElementById('btnScanDTC');
  const btnClearDTC = document.getElementById('btnClearDTC');
  const diagStatusBanner = document.getElementById('diagStatusBanner');
  const diagIcon = document.getElementById('diagIcon');
  const diagTitle = document.getElementById('diagTitle');
  const diagSub = document.getElementById('diagSub');
  const dtcListContainer = document.getElementById('dtcList');

  if (btnScanDTC) {
    btnScanDTC.addEventListener('click', async () => {
      if (!window.obdService || !window.obdService.connected) {
        alert('คำเตือน: ยังไม่ได้เชื่อมต่อตัวอ่าน OBD2 กรุณาเชื่อมต่อบลูทูธกับกล่องของรถก่อนกดสแกนโค้ด');
        return;
      }

      btnScanDTC.disabled = true;
      btnScanDTC.innerHTML = 'กำลังส่งคำสั่ง Mode 03 สแกน ECU...';

      try {
        const rawCodes = await window.obdService.readDTCs();
        if (rawCodes && rawCodes.length > 0) {
          state.dtcList = rawCodes.map(code => {
            return window.dtcDatabase ? window.dtcDatabase.lookup(code) : { code };
          });
        } else {
          state.dtcList = [];
        }
      } catch (e) {
        console.warn('ECU Mode 03 read error:', e);
        alert('ไม่สามารถอ่านโค้ดจาก ECU ได้: ' + e.message);
      } finally {
        btnScanDTC.disabled = false;
        btnScanDTC.innerHTML = '<svg class="btn-svg" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> สแกนโค้ด ECU';
        renderDtcList();
      }
    });
  }

  if (btnClearDTC) {
    btnClearDTC.addEventListener('click', async () => {
      if (!window.obdService || !window.obdService.connected) {
        alert('ไม่ได้เชื่อมต่อกับรถ: ไม่สามารถส่งคำสั่งลบโค้ดได้');
        return;
      }

      // Safety Guard: Check if engine is running
      if (state.currentRpm > 2000) {
        alert('คำเตือนความปลอดภัย: ไม่สามารถลบโค้ดขณะรถกำลังวิ่งหรือรอบเครื่องยนต์สูงได้ กรุณาดับเครื่องแล้วเปิดกุญแจ ON');
        return;
      }

      const confirmed = confirm('ยืนยันการส่งคำสั่งลบไฟเตือนเครื่องยนต์ (Mode 04 MIL Reset ไปยัง ECU)?');
      if (confirmed) {
        btnClearDTC.disabled = true;
        btnClearDTC.innerHTML = 'กำลังลบ...';

        try {
          await window.obdService.clearDTCs();
          state.dtcList = [];
          renderDtcList();
          alert('ลบไฟเตือนเครื่องยนต์สำเร็จ (MIL Reset Success)');
        } catch (e) {
          alert('เกิดข้อผิดพลาดในการลบโค้ด: ' + e.message);
        } finally {
          btnClearDTC.disabled = false;
          btnClearDTC.innerHTML = '<svg class="btn-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ลบไฟโค้ด';
        }
      }
    });
  }

  function renderDtcList() {
    if (!dtcListContainer) return;
    if (state.dtcList.length === 0) {
      dtcListContainer.innerHTML = `
        <div class="card info-card" style="text-align: center; padding: 28px 16px;">
          <div style="margin-bottom: 8px;">
            <svg class="icon-svg" viewBox="0 0 24 24" width="36" height="36" style="color: var(--color-success);">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h4 style="color: var(--color-success); font-size: 1.05rem; margin-bottom: 4px;">ระบบปกติ ไม่พบโค้ดความผิดปกติ</h4>
          <p style="color: var(--color-text-muted); font-size: 0.8rem;">กดปุ่ม "สแกนโค้ด ECU" เพื่ออ่านค่าสดจากกล่อง ECU ของรถ</p>
        </div>
      `;
      if (diagStatusBanner) {
        diagStatusBanner.className = 'diag-status-card cleared';
        diagIcon.innerHTML = `
          <svg class="icon-svg" viewBox="0 0 24 24" width="28" height="28" style="color: var(--color-success);">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        `;
        diagTitle.textContent = 'ระบบเครื่องยนต์ทำงานปกติ';
        diagSub.textContent = 'ไม่มีไฟเตือนเครื่องยนต์ (MIL Normal)';
      }
      if (navMilBadge) navMilBadge.style.display = 'none';
      if (milCountText) {
        milCountText.textContent = 'ปกติ';
        milCountText.className = 'tile-val';
      }
      if (btnClearDTC) {
        btnClearDTC.style.display = 'none';
      }
    } else {
      dtcListContainer.innerHTML = state.dtcList.map(item => `
        <div class="dtc-card severity-${item.severity}">
          <div class="dtc-card-top">
            <div class="dtc-code-wrap">
              <span class="dtc-code">${item.code}</span>
              <span class="badge ${item.severity === 'high' ? 'badge-danger' : 'badge-warning'}">
                ${item.severity === 'high' ? 'ร้ายแรง / Active' : 'เตือน / Pending'}
              </span>
            </div>
            <span class="dtc-system">${item.system}</span>
          </div>
          <h4 class="dtc-th-title">${item.title}</h4>
          <p class="dtc-desc">${item.desc}</p>
          <div class="dtc-actions">
            <span class="advice-tag">${item.advice}</span>
          </div>
        </div>
      `).join('');

      if (diagStatusBanner) {
        diagStatusBanner.className = 'diag-status-card';
        diagIcon.innerHTML = `
          <svg class="icon-svg" viewBox="0 0 24 24" width="28" height="28" style="color: var(--color-danger);">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        `;
        diagTitle.textContent = 'ตรวจพบไฟเตือนเครื่องยนต์ MIL';
        diagSub.textContent = `พบรหัสความผิดปกติ ${state.dtcList.length} รายการ`;
      }
      if (navMilBadge) navMilBadge.style.display = 'block';
      if (milCountText) {
        milCountText.textContent = state.dtcList.length + ' โค้ด';
        milCountText.className = 'tile-val val-danger';
      }
      if (btnClearDTC) {
        btnClearDTC.style.display = 'block';
        btnClearDTC.disabled = false;
        btnClearDTC.innerHTML = '<svg class="btn-svg" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> ลบโค้ดไฟเครื่องยนต์ (Clear MIL)';
      }
    }
  }

  // --- 5. SCREEN S04: TUNING CALCULATOR ---
  const calcTabs = document.querySelectorAll('.calc-tab');
  calcTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      calcTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tool = tab.getAttribute('data-calc');
      document.querySelectorAll('.calc-panel').forEach(p => p.classList.remove('active'));
      const activePanel = document.getElementById('calc-tool-' + tool);
      if (activePanel) activePanel.classList.add('active');
    });
  });

  const inputBore = document.getElementById('inputBore');
  const inputStroke = document.getElementById('inputStroke');
  const inputStrokePlus = document.getElementById('inputStrokePlus');
  const lblBore = document.getElementById('lblBore');
  const lblStroke = document.getElementById('lblStroke');
  const lblStrokePlus = document.getElementById('lblStrokePlus');
  const resCcValue = document.getElementById('resCcValue');
  const resCcDetail = document.getElementById('resCcDetail');
  const presetBtns = document.querySelectorAll('.btn-preset');

  function calculateCC() {
    const bore = parseFloat(inputBore.value) || 47.0;
    const stroke = parseFloat(inputStroke.value) || 63.1;
    const plus = parseFloat(inputStrokePlus.value) || 0.0;
    const totalStroke = stroke + (plus * 2);

    state.calc.bore = bore;
    state.calc.stroke = stroke;
    state.calc.strokePlus = plus;
    saveSettings();

    if (lblBore) lblBore.textContent = bore.toFixed(1);
    if (lblStroke) lblStroke.textContent = stroke.toFixed(1);
    if (lblStrokePlus) lblStrokePlus.textContent = plus.toFixed(1);

    const cc = (Math.PI * Math.pow(bore / 2, 2) * totalStroke) / 1000;
    if (resCcValue) resCcValue.textContent = cc.toFixed(1);

    if (resCcDetail) {
      if (plus > 0) {
        resCcDetail.textContent = `ลูกสูบ ${bore.toFixed(1)} มม. | ชักรวม ${totalStroke.toFixed(1)} มม. (ยืดชัก +${plus.toFixed(1)})`;
      } else {
        resCcDetail.textContent = `ลูกสูบ ${bore.toFixed(1)} มม. | ชัก ${stroke.toFixed(1)} มม. (สแตนดาร์ด Scoopy-i)`;
      }
    }
  }

  if (inputBore) inputBore.addEventListener('input', calculateCC);
  if (inputStroke) inputStroke.addEventListener('input', calculateCC);
  if (inputStrokePlus) inputStrokePlus.addEventListener('input', calculateCC);

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      inputBore.value = btn.getAttribute('data-bore');
      inputStroke.value = btn.getAttribute('data-stroke');
      inputStrokePlus.value = 0;
      calculateCC();
    });
  });

  const frontTeethGroup = document.getElementById('frontTeethGroup');
  const rearTeethGroup = document.getElementById('rearTeethGroup');
  const resSprocketRatio = document.getElementById('resSprocketRatio');
  const resSprocketDetail = document.getElementById('resSprocketDetail');

  function calculateSprocket() {
    const ratio = state.calc.rearTeeth / state.calc.frontTeeth;
    saveSettings();

    if (resSprocketRatio) resSprocketRatio.textContent = ratio.toFixed(3);
    if (resSprocketDetail) {
      let advice = 'อัตราเร่งและปลายสมดุล';
      if (ratio > 2.8) advice = 'จัดจ้านรอบต้น-กลาง ออกตัวไว บรรทุกดี (ปลายตัดไว)';
      else if (ratio < 2.5) advice = 'เน้นปลายไหลยาวๆ ลดรอบเดินทางประหยัดน้ำมัน';
      resSprocketDetail.textContent = `สเตอร์หน้า ${state.calc.frontTeeth}T / สเตอร์หลัง ${state.calc.rearTeeth}T -> ${advice}`;
    }
  }

  if (frontTeethGroup) {
    frontTeethGroup.querySelectorAll('.btn-tooth').forEach(b => {
      b.addEventListener('click', () => {
        frontTeethGroup.querySelectorAll('.btn-tooth').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        state.calc.frontTeeth = parseInt(b.getAttribute('data-teeth'), 10);
        calculateSprocket();
      });
    });
  }

  if (rearTeethGroup) {
    rearTeethGroup.querySelectorAll('.btn-tooth').forEach(b => {
      b.addEventListener('click', () => {
        rearTeethGroup.querySelectorAll('.btn-tooth').forEach(btn => btn.classList.remove('active'));
        b.classList.add('active');
        state.calc.rearTeeth = parseInt(b.getAttribute('data-teeth'), 10);
        calculateSprocket();
      });
    });
  }

  // --- 6. SCREEN S06: IN-APP GUIDE TABS LOGIC ---
  const guideTabBtns = document.querySelectorAll('.guide-tab-btn');
  const guidePanels = document.querySelectorAll('.guide-panel');

  guideTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      guideTabBtns.forEach(b => b.classList.remove('active'));
      guidePanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tabKey = btn.getAttribute('data-tab');
      const targetPanel = document.getElementById('guide-panel-' + tabKey);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // --- 7. SCREEN S05: SETTINGS CHANGE HANDLERS & PERSISTENCE ---
  const selectBikeProfile = document.getElementById('selectBikeProfile');
  const protocolBadge = document.getElementById('protocolBadge');
  const settingRedline = document.getElementById('settingRedline');
  const settingMaxTemp = document.getElementById('settingMaxTemp');

  function updateProtocolUI(val) {
    state.protocol = val;
    if (val === 'honda_kwp') {
      if (protocolBadge) protocolBadge.textContent = 'HONDA KWP';
    } else if (val === 'honda_can') {
      if (protocolBadge) protocolBadge.textContent = 'HONDA CAN';
    } else if (val === 'yamaha_can') {
      if (protocolBadge) protocolBadge.textContent = 'YAMAHA CAN';
    } else {
      if (protocolBadge) protocolBadge.textContent = 'OBD2 ISO';
    }
    if (window.obdService) window.obdService.setProtocol(val);
    saveSettings();
  }

  if (selectBikeProfile) {
    selectBikeProfile.value = state.protocol;
    updateProtocolUI(state.protocol);
    selectBikeProfile.addEventListener('change', (e) => updateProtocolUI(e.target.value));
  }

  if (settingRedline) {
    settingRedline.value = state.redlineRpm;
    settingRedline.addEventListener('input', (e) => {
      state.redlineRpm = parseInt(e.target.value, 10) || 9500;
      saveSettings();
    });
  }

  if (settingMaxTemp) {
    settingMaxTemp.value = state.maxTemp;
    settingMaxTemp.addEventListener('input', (e) => {
      state.maxTemp = parseInt(e.target.value, 10) || 105;
      saveSettings();
      checkAlerts();
    });
  }

  // --- 8. HARDWARE OBD2 SENSOR HOOKS ---
  if (window.obdService) {
    window.obdService.callbacks.onSensorData = (data) => {
      if (data.rpm !== undefined) {
        state.targetRpm = data.rpm;
        state.speedKmh = Math.max(0, Math.round(data.rpm * 0.014));
      }
      if (data.tps !== undefined) {
        state.tpsPercent = data.tps;
        if (tpsValueText) tpsValueText.textContent = state.tpsPercent + '%';
        if (tpsFillBar) tpsFillBar.style.width = Math.min(state.tpsPercent, 100) + '%';
      }
      if (data.temp !== undefined) {
        state.coolantTemp = data.temp;
        if (coolantValueText) coolantValueText.textContent = state.coolantTemp;
        const coolantStatus = document.getElementById('coolantStatus');
        if (coolantStatus) {
          if (state.coolantTemp >= state.maxTemp) {
            coolantStatus.textContent = 'ความร้อนสูงเกิน!';
            coolantStatus.className = 'status-tag status-danger';
          } else {
            coolantStatus.textContent = 'ปกติ (สูงสุด ' + state.maxTemp + '°C)';
            coolantStatus.className = 'status-tag status-normal';
          }
        }
        checkAlerts();
      }
      if (data.volt !== undefined) {
        state.batteryVolt = data.volt;
        if (batteryValueText) batteryValueText.textContent = state.batteryVolt.toFixed(1);
        const batteryStatus = document.getElementById('batteryStatus');
        if (batteryStatus) {
          if (state.batteryVolt < 11.8) {
            batteryStatus.textContent = 'แบตเตอรี่อ่อน';
            batteryStatus.className = 'status-tag status-danger';
          } else {
            batteryStatus.textContent = 'ไดชาร์จทำงานปกติ';
            batteryStatus.className = 'status-tag status-normal';
          }
        }
      }
      if (data.iat !== undefined) {
        state.iatTemp = data.iat;
        if (iatValueText) iatValueText.textContent = state.iatTemp;
      }
      updateTripPeaks();
    };

    window.obdService.callbacks.onConnect = (name) => {
      state.connected = true;
      updateBleStatusUI(true, 'OBD2: ' + (name || 'เชื่อมต่อแล้ว'));
      renderDeviceList();
    };

    window.obdService.callbacks.onDisconnect = () => {
      state.connected = false;
      resetDashboardToIdle();
      updateBleStatusUI(false, 'OBD2: ไม่ได้เชื่อมต่อ');
      renderDeviceList();
    };
  }

  // Apply restored calculator values
  if (inputBore && state.calc.bore) inputBore.value = state.calc.bore;
  if (inputStroke && state.calc.stroke) inputStroke.value = state.calc.stroke;
  if (inputStrokePlus && state.calc.strokePlus !== undefined) inputStrokePlus.value = state.calc.strokePlus;

  // Render initial components in clean real state
  calculateCC();
  calculateSprocket();
  resetDashboardToIdle();
  updateTripPeaks();
  renderDeviceList();
  renderDtcList();
  drawGauge();

})();
