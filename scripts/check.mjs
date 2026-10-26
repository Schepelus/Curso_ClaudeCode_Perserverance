// Abre la página en un Chrome invisible (el Chrome instalado, sin descargar
// navegadores), guarda una captura y lista los errores de consola.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const URL = process.env.CHECK_URL || 'http://localhost:5173/';
const SHOT = 'screenshots/check.png';

async function isUp() {
  try {
    const res = await fetch(URL);
    return res.ok;
  } catch {
    return false;
  }
}

// Si el servidor de Vite no está corriendo, lo arrancamos solo para el check.
let server = null;
if (!(await isUp())) {
  console.log('Servidor no encontrado, arrancando Vite...');
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 60 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await isUp())) {
    console.log('Vite no arrancó:\n' + serverLog);
    server.kill();
    process.exit(1);
  }
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
const logs = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
  else if (msg.type() === 'log' || msg.type() === 'warning') logs.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => errors.push(`[request] ${req.url()} ${req.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });
// La página pone window.__ready = true cuando terminó de cargar (p. ej. el rover).
await page
  .waitForFunction(() => window.__ready === true, null, { timeout: 30000 })
  .catch(() => errors.push('[check] la página no marcó window.__ready en 30 s'));
// Damos tiempo a que el render (y las sombras) se estabilicen.
await page.waitForTimeout(3000);

mkdirSync('screenshots', { recursive: true });
await page.screenshot({ path: SHOT });

// Fotogramas por segundo durante 2 s, para vigilar el rendimiento.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (performance.now() - t0));
      };
      requestAnimationFrame(tick);
    })
);
console.log(`FPS: ${fps.toFixed(1)}`);

// Control de misión: los 4 datos deben cargar con números reales y la T debe ocultarlo.
const MISSION = ['distancia', 'altura', 'inclinacion', 'luz'];
await page
  .waitForFunction(() => window.__missionControl?.loaded === true, null, { timeout: 30000 })
  .catch(() => errors.push('[check] el control de misión no terminó de cargar en 30 s'));
const mission = await page.evaluate(() => {
  const s = window.__missionControl;
  if (!s) return null;
  const out = {};
  for (const [key, c] of Object.entries(s.channels)) {
    const card = document.querySelector(`.mc-card[data-channel="${key}"]`);
    out[key] = {
      name: c.name, unit: c.unit, source: c.source, value: c.value, points: c.points.length,
      shown: card?.querySelector('.mc-num')?.textContent,
      phrase: card?.querySelector('.mc-phrase')?.textContent,
    };
  }
  return out;
});
console.log('\nControl de misión:');
for (const key of MISSION) {
  const c = mission?.[key];
  if (!c || !Number.isFinite(c.value) || c.points < 2 || !c.shown || c.shown.includes('·')) {
    errors.push(`[check] el dato "${key}" no cargó`);
    console.log(`  ✗ ${key}: no cargó`);
    continue;
  }
  console.log(`  ✓ ${c.name}: ${c.shown} ${c.unit}  (${c.points} puntos · ${c.source})`);
  console.log(`      “${c.phrase}”`);
}

const panelVisible = () =>
  page.evaluate(() => {
    const el = document.getElementById('mission-control');
    return !!el && getComputedStyle(el).visibility !== 'hidden';
  });
await page.keyboard.press('KeyT');
await page.waitForTimeout(400);
const hiddenOk = !(await panelVisible());
await page.screenshot({ path: 'screenshots/check-sin-panel.png' });
await page.keyboard.press('KeyT');
await page.waitForTimeout(400);
const shownOk = await panelVisible();
console.log(`  ${hiddenOk && shownOk ? '✓' : '✗'} Tecla T: ${hiddenOk ? 'oculta' : 'NO oculta'} el panel y ${shownOk ? 'lo vuelve a mostrar' : 'NO lo vuelve a mostrar'}\n`);
if (!hiddenOk || !shownOk) errors.push('[check] la tecla T no oculta/muestra el control de misión');

// Prueba de manejo: avanza girando un poco y captura huellas + cámara siguiendo.
const DRIVE_SHOT = 'screenshots/check-drive.png';
await page.mouse.click(640, 360);
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyA');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyA');
await page.waitForTimeout(3500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(1500);
await page.screenshot({ path: DRIVE_SHOT });

await browser.close();
if (server) server.kill();

if (logs.length) {
  console.log('Mensajes de consola:');
  for (const l of logs) console.log('  ' + l.replace(/\n/g, '\n  '));
}
console.log(`Capturas guardadas en ${SHOT} y ${DRIVE_SHOT}`);
if (errors.length) {
  console.log(`\n${errors.length} error(es) de consola:`);
  for (const e of errors) console.log('  ' + e);
  process.exit(1);
}
console.log('Sin errores de consola.');
