/**
 * MotoGauge E2E Specification
 * Conforms to replica-test guidelines (roles & accessible labels, no private CSS dependencies)
 */
import { test, expect } from '@playwright/test';

test.describe('MotoGauge End-to-End Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Fail on unhandled console errors or 5xx responses
    page.on('console', (msg) => {
      if (msg.type() === 'error') throw new Error(`Console error: ${msg.text()}`);
    });
    page.on('response', (res) => {
      if (res.status() >= 500) throw new Error(`${res.status()} on ${res.url()}`);
    });
    await page.goto('/index.html');
  });

  // FLOW F01: Quick Connect & Live Dash
  test('F01-H1: Bluetooth connect modal opens, scans, and shows device list', async ({ page }) => {
    const connectBtn = page.getByRole('button', { name: /เชื่อมต่อบลูทูธ/i });
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    const scanBtn = page.getByRole('button', { name: /สแกนหาอุปกรณ์บลูทูธ/i });
    await expect(scanBtn).toBeVisible();
    await scanBtn.click();

    // Verify scan feedback and device list display
    await expect(page.getByText(/vLinker/i)).toBeVisible();
  });

  test('F01-E2: Throttle simulation reacts on tachometer readout and TPS bar', async ({ page }) => {
    const slider = page.locator('#throttleSlider');
    await expect(slider).toBeVisible();
    await slider.fill('75');
    await slider.dispatchEvent('input');

    await expect(page.getByText('75%')).toBeVisible();
  });

  // FLOW F02: Scan & Clear Check Engine Light (DTC)
  test('F02-H1: Review fault codes and clear DTC at idle speed', async ({ page }) => {
    // Set engine to idle (TPS 0%, RPM ~1400)
    const slider = page.locator('#throttleSlider');
    await slider.fill('0');
    await slider.dispatchEvent('input');

    // Switch to Diagnostics screen
    await page.getByRole('button', { name: /สแกนโค้ด/i }).click();

    // Verify DTC P0122 card is visible with Thai description
    await expect(page.getByText('P0122')).toBeVisible();
    await expect(page.getByText(/ระบบเรือนลิ้นเร่ง/i)).toBeVisible();

    // Clear DTC
    page.on('dialog', (dialog) => dialog.accept());
    const clearBtn = page.getByRole('button', { name: /ลบโค้ดไฟเครื่องยนต์/i });
    await clearBtn.click();

    // Verify success banner appears
    await expect(page.getByText(/ระบบปกติ ไม่พบโค้ดความผิดปกติ/i)).toBeVisible({ timeout: 3000 });
  });

  test('F02-N1: Safety guard blocks clear command when engine RPM > 2000', async ({ page }) => {
    // Rev engine up to ~6000 RPM (TPS 50%)
    const slider = page.locator('#throttleSlider');
    await slider.fill('50');
    await slider.dispatchEvent('input');

    await page.getByRole('button', { name: /สแกนโค้ด/i }).click();

    let alertTriggered = false;
    page.on('dialog', async (dialog) => {
      expect(dialog.message()).toContain('คำเตือนความปลอดภัย');
      alertTriggered = true;
      await dialog.dismiss();
    });

    const clearBtn = page.getByRole('button', { name: /ลบโค้ดไฟเครื่องยนต์/i });
    await clearBtn.click();
    expect(alertTriggered).toBe(true);

    // Code must NOT be cleared
    await expect(page.getByText('P0122')).toBeVisible();
  });

  // FLOW F03: CC & Sprocket Calculation
  test('F03-H1: Wave 125i preset calculates 124.9 cc', async ({ page }) => {
    await page.getByRole('button', { name: /เครื่องคิดเลข/i }).click();
    await page.getByRole('button', { name: 'Wave 125i' }).click();

    await expect(page.locator('#resCcValue')).toHaveText('124.9');
    await expect(page.locator('#lblBore')).toHaveText('52.4');
    await expect(page.locator('#lblStroke')).toHaveText('57.9');
  });

  test('F03-H2: Sprocket ratio calculator updates gear ratio and tuning advice', async ({ page }) => {
    await page.getByRole('button', { name: /เครื่องคิดเลข/i }).click();
    await page.getByRole('button', { name: /อัตราทดสเตอร์/i }).click();

    // Select 15T Front, 34T Rear
    await page.locator('#frontTeethGroup').getByRole('button', { name: '15' }).click();
    await page.locator('#rearTeethGroup').getByRole('button', { name: '34' }).click();

    await expect(page.locator('#resSprocketRatio')).toHaveText('2.267');
    await expect(page.locator('#resSprocketDetail')).toContainText('เน้นปลายไหล');
  });

  // FLOW F04: Vehicle Profile & Settings
  test('F04-H1: Switch vehicle protocol to Yamaha XMAX 300', async ({ page }) => {
    await page.getByRole('button', { name: /ตั้งค่า/i }).click();
    await page.locator('#selectBikeProfile').selectOption('yamaha_can');

    await expect(page.locator('#protocolBadge')).toHaveText('YAMAHA CAN');
  });
});
