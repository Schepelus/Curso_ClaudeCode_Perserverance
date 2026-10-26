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
  server = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await isUp()); i++) await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
page.on('requestfailed', (req) => errors.push(`[request] ${req.url()} ${req.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle' });
// Damos tiempo a que el render (y las sombras) se estabilicen.
await page.waitForTimeout(4000);

mkdirSync('screenshots', { recursive: true });
await page.screenshot({ path: SHOT });
await browser.close();
if (server) server.kill();

console.log(`Captura guardada en ${SHOT}`);
if (errors.length) {
  console.log(`\n${errors.length} error(es) de consola:`);
  for (const e of errors) console.log('  ' + e);
  process.exit(1);
}
console.log('Sin errores de consola.');
