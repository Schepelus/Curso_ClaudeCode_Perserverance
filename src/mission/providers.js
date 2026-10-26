import { lightTimeSeconds } from './lightTime.js';

// ---------- Calendario de la misión ----------
// Perseverance aterrizó el 18-02-2021 a las 20:55 UTC, a las 15:53 hora solar
// local de Marte, durante su sol 0. Un sol (día marciano) dura 88 775,244 s.
const SOL_MS = 88775244;
const LANDING_MS = Date.UTC(2021, 1, 18, 20, 55);
const SOL0_START_MS = LANDING_MS - (15 + 53 / 60) * (SOL_MS / 24);

export const msToSol = (ms) => (ms - SOL0_START_MS) / SOL_MS;
export const solToMs = (sol) => SOL0_START_MS + sol * SOL_MS;

// ---------- Proveedor 1: historial de manejos de la NASA ----------
const NASA_URL = '/nasa/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const BACKUP_URL = '/data/m20-waypoints-copia.json';

// Lee el archivo de la NASA (a través del intermediario de Vite). Si no hay
// internet o falla, usa la copia guardada y lo indica en `source`.
async function loadWaypoints() {
  try {
    const res = await fetch(NASA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Solo los puntos de fin de manejo (final = "y"): los intermedios no
    // llevan la distancia acumulada.
    const rows = json.features
      .map((f) => f.properties)
      .filter((p) => p.final === 'y')
      .map((p) => ({ sol: p.sol, dist_total_m: p.dist_total_m, elev_geoid: p.elev_geoid, tilt: p.tilt }));
    return { rows, source: 'NASA · en vivo' };
  } catch (err) {
    console.warn(`No se pudo leer el archivo de la NASA (${err.message}); uso la copia guardada.`);
    const backup = await (await fetch(BACKUP_URL)).json();
    const rows = backup.puntos.map(([sol, dist_total_m, elev_geoid, tilt]) => ({ sol, dist_total_m, elev_geoid, tilt }));
    return { rows, source: `NASA · copia del ${backup.guardado}` };
  }
}

export function createWaypointsProvider() {
  let cache = null;
  const load = () => (cache ??= loadWaypoints());
  return {
    name: 'NASA MMGIS · historial de manejos',
    supportsRequest: (channel) => channel.provider === 'nasa-waypoints',
    async request(channel) {
      const { rows, source } = await load();
      const { field } = channel;
      return { source, points: rows.map((r) => ({ sol: r.sol, value: r[field] })) };
    },
  };
}

// ---------- Proveedor 2: efemérides calculadas en el navegador ----------
export function createLightTimeProvider() {
  return {
    name: 'Cálculo orbital (efemérides JPL)',
    supportsRequest: (channel) => channel.provider === 'efemerides',
    supportsSubscribe: (channel) => channel.provider === 'efemerides',

    // Historial: un punto por sol, desde el aterrizaje hasta hoy.
    async request() {
      const today = Math.floor(msToSol(Date.now()));
      const points = [];
      for (let sol = 0; sol <= today; sol++) {
        points.push({ sol, value: lightTimeSeconds(solToMs(sol)) / 60 });
      }
      return { source: 'Cálculo en vivo', points };
    },

    // Tiempo real: un dato nuevo cada segundo.
    subscribe(channel, callback) {
      const emit = () => {
        const now = Date.now();
        callback({ sol: msToSol(now), value: lightTimeSeconds(now) / 60 });
      };
      emit();
      const id = setInterval(emit, 1000);
      return () => clearInterval(id);
    },
  };
}
