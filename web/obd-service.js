/**
 * MotoGauge - OBD2 Communication Service
 * 100% Real Hardware Driver:
 * - Native Android Bluetooth SPP (via NativeOBD RFCOMM socket)
 * - Web Bluetooth BLE (via navigator.bluetooth GATT)
 * - Real ELM327 / STN AT-command handshake & PGM-FI/CAN protocol selection
 * - Live PID polling (RPM, TPS, Coolant, Battery, IAT)
 * - Mode 03 DTC read & Mode 04 MIL reset
 */

(function (window) {
  'use strict';

  class OBDService {
    constructor() {
      this.device = null;
      this.deviceName = '';
      this.server = null;
      this.service = null;
      this.rxChar = null;
      this.txChar = null;
      this.connected = false;
      this.polling = false;
      this.pollTimer = null;
      this.buffer = '';
      this.currentCommand = null;
      this.activeProtocol = 'ATSP5'; // Default to Honda KWP2000

      this.callbacks = {
        onConnect: null,
        onDisconnect: null,
        onStatusChange: null,
        onSensorData: null,
        onDTCFound: null,
        onError: null
      };
    }

    isNativeAvailable() {
      return !!(window.NativeOBD && typeof window.NativeOBD.isNativeAvailable === 'function');
    }

    isWebBluetoothSupported() {
      return !!(navigator && navigator.bluetooth);
    }

    getBondedDevices() {
      if (this.isNativeAvailable()) {
        try {
          const raw = window.NativeOBD.getBondedDevices();
          return JSON.parse(raw || '[]');
        } catch (e) {
          console.warn('Native getBondedDevices error:', e);
          return [];
        }
      }
      return [];
    }

    connectNative(address) {
      if (!this.isNativeAvailable()) return false;
      this._notifyStatus('กำลังเชื่อมต่อบลูทูธ ' + address + '...');
      return window.NativeOBD.connect(address);
    }

    async connectBLE() {
      if (!this.isWebBluetoothSupported()) {
        throw new Error('เบราว์เซอร์นี้ยังไม่รองรับ Web Bluetooth กรุณาใช้ Chrome หรือติดตั้งไฟล์ MotoGauge.apk บน Android');
      }

      this._notifyStatus('กำลังค้นหาอุปกรณ์บลูทูธ OBD2...');
      try {
        this.device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            '0000fff0-0000-1000-8000-00805f9b34fb',
            '0000ffe0-0000-1000-8000-00805f9b34fb',
            '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
            0xfff0,
            0xffe0
          ]
        });

        this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
        this._notifyStatus(`กำลังเชื่อมต่อ ${this.device.name || 'OBD2 Adapter'}...`);
        this.server = await this.device.gatt.connect();

        await this._findSerialCharacteristics();
        await this.txChar.startNotifications();
        this.txChar.addEventListener('characteristicvaluechanged', (e) => this._onDataReceived(e));

        this.connected = true;
        this.deviceName = this.device.name || 'OBD2 Device';
        this._notifyStatus('เชื่อมต่อบลูทูธสำเร็จ! กำลังตั้งค่า ELM327...');

        await this._initELM327();

        if (this.callbacks.onConnect) {
          this.callbacks.onConnect(this.deviceName);
        }
        this.startPolling();
        return true;
      } catch (err) {
        this.connected = false;
        if (this.callbacks.onError) this.callbacks.onError(err);
        throw err;
      }
    }

    async _findSerialCharacteristics() {
      const services = await this.server.getPrimaryServices();
      for (const s of services) {
        try {
          const chars = await s.getCharacteristics();
          for (const c of chars) {
            if (c.properties.write || c.properties.writeWithoutResponse) {
              this.rxChar = c;
            }
            if (c.properties.notify || c.properties.indicate) {
              this.txChar = c;
            }
          }
          if (this.rxChar && this.txChar) {
            this.service = s;
            return;
          }
        } catch (e) {
          // Continue scanning services
        }
      }
      if (!this.rxChar || !this.txChar) {
        throw new Error('ไม่พบ Serial Service ของตัวอ่าน OBD2 ในอุปกรณ์นี้');
      }
    }

    async _initELM327() {
      const initSequence = [
        'ATZ',      // Reset ELM327
        'ATE0',     // Echo Off
        'ATL0',     // Linefeeds Off
        'ATH0',     // Headers Off
        'ATS0',     // Spaces Off
        this.activeProtocol // Protocol (ATSP5 for Honda KWP, ATSP6 for CAN, ATSP0 for Auto)
      ];

      for (const cmd of initSequence) {
        await this.sendCommand(cmd, 600);
      }
      this._notifyStatus('ECU พร้อมอ่านข้อมูลเรียลไทม์');
    }

    setProtocol(protocolCode) {
      if (protocolCode === 'honda_kwp') {
        this.activeProtocol = 'ATSP5';
      } else if (protocolCode === 'honda_can' || protocolCode === 'yamaha_can') {
        this.activeProtocol = 'ATSP6';
      } else {
        this.activeProtocol = 'ATSP0';
      }
    }

    sendCommand(cmd, timeoutMs = 800) {
      return new Promise((resolve, reject) => {
        if (!this.connected) {
          return reject(new Error('ไม่ได้เชื่อมต่อกับอุปกรณ์ OBD2'));
        }

        const timer = setTimeout(() => {
          this.currentCommand = null;
          resolve(this.buffer);
        }, timeoutMs);

        this.currentCommand = {
          cmd,
          resolve: (res) => {
            clearTimeout(timer);
            resolve(res);
          },
          reject: (err) => {
            clearTimeout(timer);
            reject(err);
          }
        };

        this.buffer = '';

        if (this.isNativeAvailable()) {
          const sent = window.NativeOBD.sendCommand(cmd);
          if (!sent) {
            clearTimeout(timer);
            this.currentCommand = null;
            reject(new Error('ไม่สามารถส่งคำสั่งผ่าน Native Bluetooth ได้'));
          }
        } else if (this.rxChar) {
          const payload = new TextEncoder().encode(cmd + '\r');
          if (this.rxChar.properties.writeWithoutResponse) {
            this.rxChar.writeValueWithoutResponse(payload).catch(reject);
          } else {
            this.rxChar.writeValue(payload).catch(reject);
          }
        } else {
          clearTimeout(timer);
          this.currentCommand = null;
          reject(new Error('ไม่พบช่องทางการส่งข้อมูล Bluetooth'));
        }
      });
    }

    _onDataReceived(event) {
      const value = event.target.value;
      const chunk = new TextDecoder().decode(value);
      this._handleIncomingChunk(chunk);
    }

    _onNativeDataReceived(chunk) {
      this._handleIncomingChunk(chunk);
    }

    _handleIncomingChunk(chunk) {
      this.buffer += chunk;
      if (this.buffer.includes('>')) {
        const cleanResponse = this.buffer.replace('>', '').trim();
        if (this.currentCommand) {
          const handler = this.currentCommand.resolve;
          this.currentCommand = null;
          handler(cleanResponse);
        }
      }
    }

    _onNativeConnected(name) {
      this.connected = true;
      this.deviceName = name || 'OBD2 Device';
      this._notifyStatus('เชื่อมต่อสำเร็จ: ' + this.deviceName);
      this._initELM327().then(() => {
        if (this.callbacks.onConnect) this.callbacks.onConnect(this.deviceName);
        this.startPolling();
      }).catch(err => {
        if (this.callbacks.onError) this.callbacks.onError(err);
      });
    }

    _onNativeDisconnected() {
      this.connected = false;
      this.stopPolling();
      this._notifyStatus('การเชื่อมต่อบลูทูธถูกตัด');
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    }

    _onNativeError(msg) {
      if (this.callbacks.onError) this.callbacks.onError(new Error(msg));
    }

    startPolling() {
      if (this.polling) return;
      this.polling = true;
      this._pollLoop();
    }

    stopPolling() {
      this.polling = false;
      if (this.pollTimer) clearTimeout(this.pollTimer);
    }

    async _pollLoop() {
      if (!this.connected || !this.polling) return;

      try {
        // 1. Read Engine RPM (PID 010C)
        const rpmRaw = await this.sendCommand('010C', 300);
        const rpm = this._parseRPM(rpmRaw);

        // 2. Read TPS Throttle % (PID 0111)
        const tpsRaw = await this.sendCommand('0111', 300);
        const tps = this._parseTPS(tpsRaw);

        // 3. Read Engine Coolant/Oil Temp (PID 0105)
        const tempRaw = await this.sendCommand('0105', 300);
        const temp = this._parseTemp(tempRaw);

        // 4. Read Battery Voltage (ATRV)
        const voltRaw = await this.sendCommand('ATRV', 250);
        const volt = this._parseVoltage(voltRaw);

        // 5. Read Intake Air Temp (PID 010F)
        const iatRaw = await this.sendCommand('010F', 250);
        const iat = this._parseIAT(iatRaw);

        if (this.callbacks.onSensorData) {
          this.callbacks.onSensorData({
            rpm: rpm !== null ? rpm : undefined,
            tps: tps !== null ? tps : undefined,
            temp: temp !== null ? temp : undefined,
            volt: volt !== null ? volt : undefined,
            iat: iat !== null ? iat : undefined
          });
        }
      } catch (err) {
        console.warn('OBD polling cycle skipped:', err.message);
      }

      if (this.polling) {
        this.pollTimer = setTimeout(() => this._pollLoop(), 90);
      }
    }

    async readDTCs() {
      this.stopPolling();
      try {
        const res = await this.sendCommand('03', 1800);
        const codes = this._parseDTCs(res);
        if (this.callbacks.onDTCFound) {
          this.callbacks.onDTCFound(codes);
        }
        return codes;
      } finally {
        this.startPolling();
      }
    }

    async clearDTCs() {
      this.stopPolling();
      try {
        const res = await this.sendCommand('04', 2000);
        const success = res.includes('44') || res.includes('OK') || res.trim() === '';
        return success;
      } finally {
        this.startPolling();
      }
    }

    disconnect() {
      this.stopPolling();
      if (this.isNativeAvailable()) {
        try { window.NativeOBD.disconnect(); } catch (e) {}
      }
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        this.device.gatt.disconnect();
      }
      this._onDisconnected();
    }

    _onDisconnected() {
      this.connected = false;
      this.polling = false;
      this._notifyStatus('ไม่ได้เชื่อมต่อ');
      if (this.callbacks.onDisconnect) this.callbacks.onDisconnect();
    }

    _notifyStatus(msg) {
      if (this.callbacks.onStatusChange) this.callbacks.onStatusChange(msg);
    }

    // --- PID PARSERS (SAE J1979 / ISO 15031-5) ---

    _parseRPM(raw) {
      const clean = raw.replace(/\s+/g, '');
      const match = clean.match(/410C([0-9A-Fa-f]{4})/);
      if (match) {
        const hex = match[1];
        const a = parseInt(hex.substring(0, 2), 16);
        const b = parseInt(hex.substring(2, 4), 16);
        return Math.round(((a * 256) + b) / 4);
      }
      return null;
    }

    _parseTPS(raw) {
      const clean = raw.replace(/\s+/g, '');
      const match = clean.match(/4111([0-9A-Fa-f]{2})/);
      if (match) {
        const a = parseInt(match[1], 16);
        return Math.round((a * 100) / 255);
      }
      return null;
    }

    _parseTemp(raw) {
      const clean = raw.replace(/\s+/g, '');
      const match = clean.match(/4105([0-9A-Fa-f]{2})/);
      if (match) {
        const a = parseInt(match[1], 16);
        return a - 40;
      }
      return null;
    }

    _parseVoltage(raw) {
      const match = raw.match(/(\d+\.?\d*)\s*V?/i);
      if (match) {
        return parseFloat(match[1]);
      }
      return null;
    }

    _parseIAT(raw) {
      const clean = raw.replace(/\s+/g, '');
      const match = clean.match(/410F([0-9A-Fa-f]{2})/);
      if (match) {
        const a = parseInt(match[1], 16);
        return a - 40;
      }
      return null;
    }

    _parseDTCs(raw) {
      const clean = raw.replace(/\s+/g, '').toUpperCase();
      const codes = [];
      const dtcMatches = clean.match(/43([0-9A-F]+)/);
      if (dtcMatches) {
        const payload = dtcMatches[1];
        for (let i = 0; i < payload.length; i += 4) {
          const chunk = payload.substring(i, i + 4);
          if (chunk === '0000' || chunk.length < 4) continue;
          
          const highNibble = parseInt(chunk[0], 16);
          let category = 'P';
          if (highNibble >= 0x4 && highNibble <= 0x7) category = 'C';
          else if (highNibble >= 0x8 && highNibble <= 0xB) category = 'B';
          else if (highNibble >= 0xC && highNibble <= 0xF) category = 'U';

          const secondChar = (highNibble & 0x3).toString();
          const formattedCode = category + secondChar + chunk.substring(1);
          codes.push(formattedCode);
        }
      }
      return codes;
    }
  }

  window.obdService = new OBDService();

})(window);
