import { createTelemetryAPI } from './telemetry.js';
import { createWaypointsProvider, createLightTimeProvider, msToSol } from './providers.js';
import './missionControl.css';

const nf = (digits) => new Intl.NumberFormat('es', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmt0 = nf(0), fmt1 = nf(1), fmt2 = nf(2);

function minSec(minutes) {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
}

// Ficha estilo Open MCT: hora de la misión (sol) como dominio y la medida como rango.
const values = (name, unit) => [
  { key: 'sol', name: 'Sol', hints: { domain: 1 } },
  { key: 'value', name, unit, hints: { range: 1 } },
];

// ---------- Los 4 canales de telemetría de Percy ----------
const CHANNELS = [
  {
    key: 'distancia',
    name: 'Distancia recorrida',
    unit: 'km',
    provider: 'nasa-waypoints',
    field: 'dist_total_m',
    scale: 0.001,
    telemetry: { values: values('Distancia', 'km') },
    format: (v) => fmt1.format(v),
    phrase: (v) =>
      v > 42.2
        ? `Percy ha recorrido ${fmt1.format(v)} km por Marte: más que una maratón entera (42 km), siempre manejando a paso de tortuga.`
        : `Percy ha recorrido ${fmt1.format(v)} km por Marte desde que aterrizó.`,
  },
  {
    key: 'altura',
    name: 'Altura del terreno',
    unit: 'm',
    provider: 'nasa-waypoints',
    field: 'elev_geoid',
    scale: 1,
    telemetry: { values: values('Altura', 'm') },
    format: (v) => fmt0.format(v),
    phrase: (v, points) => {
      const climb = v - points[0].value;
      return `Está ${fmt0.format(Math.abs(v))} m por debajo del “nivel del mar” de Marte, pero ya subió ${fmt0.format(climb)} m desde el fondo del cráter Jezero, donde aterrizó.`;
    },
  },
  {
    key: 'inclinacion',
    name: 'Inclinación',
    unit: '°',
    provider: 'nasa-waypoints',
    field: 'tilt',
    scale: 1,
    telemetry: { values: values('Inclinación', '°') },
    format: (v) => fmt1.format(v),
    phrase: (v, points) => {
      const max = Math.max(...points.map((p) => p.value));
      return `Al terminar su último manejo quedó ladeado ${fmt1.format(v)}°. Lo más empinado que ha pisado en toda la misión: ${fmt1.format(max)}°.`;
    },
  },
  {
    key: 'luz',
    name: 'Tiempo de luz Tierra–Marte',
    unit: 'min',
    provider: 'efemerides',
    telemetry: { values: values('Tiempo de luz', 'min') },
    live: true,
    format: (v) => fmt2.format(v),
    phrase: (v) =>
      `Una orden enviada ahora desde la Tierra tarda ${minSec(v)} en llegar a Percy: por eso no se maneja con joystick y él esquiva solo las rocas.`,
  },
];

// ---------- Gráfica de toda la misión ----------
function drawChart(canvas, points, todaySol, live) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(canvas);
  const accent = css.getPropertyValue('--mc-accent').trim();
  const grid = css.getPropertyValue('--mc-grid').trim();

  let min = Infinity, max = -Infinity;
  for (const p of points) { if (p.value < min) min = p.value; if (p.value > max) max = p.value; }
  if (live) { min = Math.min(min, live.value); max = Math.max(max, live.value); }
  const pad = (max - min) * 0.08 || 1;
  min -= pad; max += pad;
  const x = (sol) => (sol / todaySol) * (w - 2) + 1;
  const y = (v) => h - 2 - ((v - min) / (max - min)) * (h - 4);

  // Líneas guía: un año terrestre ≈ 355 soles.
  g.strokeStyle = grid;
  g.lineWidth = 1;
  for (let s = 355; s < todaySol; s += 355) {
    g.beginPath(); g.moveTo(Math.round(x(s)) + 0.5, 0); g.lineTo(Math.round(x(s)) + 0.5, h); g.stroke();
  }

  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(x(p.sol), y(p.value)) : g.moveTo(x(p.sol), y(p.value))));
  const last = points[points.length - 1];
  g.lineTo(x(last.sol), h); g.lineTo(x(points[0].sol), h); g.closePath();
  const fill = g.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, accent + '55');
  fill.addColorStop(1, accent + '00');
  g.fillStyle = fill;
  g.fill();

  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(x(p.sol), y(p.value)) : g.moveTo(x(p.sol), y(p.value))));
  g.strokeStyle = accent;
  g.lineWidth = 1.5;
  g.stroke();

  const now = live ?? last;
  g.fillStyle = accent;
  g.beginPath(); g.arc(x(now.sol), y(now.value), 3, 0, Math.PI * 2); g.fill();
}

// ---------- Panel ----------
export function createMissionControl() {
  const api = createTelemetryAPI();
  api.addProvider(createWaypointsProvider());
  api.addProvider(createLightTimeProvider());
  CHANNELS.forEach((c) => api.addChannel(c));

  const state = { visible: true, loaded: false, channels: {} };
  window.__missionControl = state;

  const panel = document.createElement('aside');
  panel.id = 'mission-control';
  panel.setAttribute('aria-label', 'Control de misión');
  panel.innerHTML = `
    <header class="mc-head">
      <div class="mc-title"><span class="mc-dot"></span>CONTROL DE MISIÓN</div>
      <div class="mc-sub">Perseverance · <span class="mc-sol">sol —</span> en Marte</div>
      <kbd class="mc-key" title="Ocultar">T</kbd>
    </header>
    <div class="mc-cards"></div>`;
  document.body.appendChild(panel);
  const cardsEl = panel.querySelector('.mc-cards');
  const solEl = panel.querySelector('.mc-sol');

  const todaySol = () => msToSol(Date.now());
  const updateSol = () => (solEl.textContent = `sol ${fmt0.format(Math.floor(todaySol()))}`);
  updateSol();
  setInterval(updateSol, 10000);

  const views = new Map();
  for (const channel of api.getChannels()) {
    const meta = api.getMetadata(channel);
    const card = document.createElement('section');
    card.className = 'mc-card loading';
    card.dataset.channel = channel.key;
    card.innerHTML = `
      <div class="mc-row">
        <h3>${channel.name}${channel.live ? ' <span class="mc-live">● EN VIVO</span>' : ''}</h3>
        <div class="mc-value"><span class="mc-num">···</span> <span class="mc-unit">${meta.range.unit}</span></div>
      </div>
      <canvas class="mc-chart" aria-label="Gráfica de ${channel.name} durante la misión"></canvas>
      <div class="mc-axis"><span>aterrizaje</span><span class="mc-axis-end">hoy</span></div>
      <p class="mc-phrase">Cargando datos…</p>
      <div class="mc-source">Proveedor: <span class="mc-prov">—</span></div>`;
    cardsEl.appendChild(card);
    views.set(channel.key, {
      card,
      num: card.querySelector('.mc-num'),
      chart: card.querySelector('.mc-chart'),
      phrase: card.querySelector('.mc-phrase'),
      prov: card.querySelector('.mc-prov'),
      axisEnd: card.querySelector('.mc-axis-end'),
    });
  }

  function render(channel) {
    const v = views.get(channel.key);
    const s = state.channels[channel.key];
    const current = s.live ?? s.points[s.points.length - 1];
    v.num.textContent = channel.format(current.value);
    v.phrase.textContent = channel.phrase(current.value, s.points);
    drawChart(v.chart, s.points, todaySol(), s.live);
  }

  const loads = api.getChannels().map(async (channel) => {
    const v = views.get(channel.key);
    try {
      const { source, points: raw } = await api.request(channel);
      const points = channel.scale ? raw.map((p) => ({ sol: p.sol, value: p.value * channel.scale })) : raw;
      const last = points[points.length - 1];
      state.channels[channel.key] = { name: channel.name, unit: channel.unit, source, points, value: last.value };
      v.prov.textContent = channel.live ? source : `${source} · hasta el sol ${fmt0.format(last.sol)}`;
      v.axisEnd.textContent = `hoy · sol ${fmt0.format(Math.floor(todaySol()))}`;
      v.card.classList.remove('loading');
      render(channel);

      api.subscribe(channel, (datum) => {
        const s = state.channels[channel.key];
        s.live = datum;
        s.value = datum.value;
        if (state.visible) render(channel);
      });
    } catch (err) {
      v.card.classList.add('error');
      v.phrase.textContent = 'No se pudieron cargar los datos.';
      console.error(`Control de misión: falló "${channel.name}":`, err);
    }
  });
  Promise.all(loads).then(() => (state.loaded = true));

  // Tecla T: mostrar u ocultar.
  function setVisible(visible) {
    state.visible = visible;
    panel.classList.toggle('mc-hidden', !visible);
    panel.setAttribute('aria-hidden', String(!visible));
    if (visible) api.getChannels().forEach((c) => state.channels[c.key] && render(c));
  }
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && !e.repeat) setVisible(!state.visible);
  });
  panel.querySelector('.mc-key').addEventListener('click', () => setVisible(false));

  addEventListener('resize', () => api.getChannels().forEach((c) => state.channels[c.key] && render(c)));
  return { setVisible };
}
