// Distancia Tierra–Marte y tiempo de luz, calculados con los elementos orbitales
// aproximados de JPL (E. M. Standish, "Approximate Positions of the Planets",
// tabla 1, válida de 1800 a 2050). El error en la distancia es muy pequeño
// (centésimas de minuto en el tiempo de luz).

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const DEG = Math.PI / 180;

// [valor en J2000, cambio por siglo]: a (UA), e, I (°), L (°), ϖ (°), Ω (°)
const ELEMENTS = {
  earth: {
    a: [1.00000261, 0.00000562],
    e: [0.01671123, -0.00004392],
    I: [-0.00001531, -0.01294668],
    L: [100.46457166, 35999.37244981],
    w: [102.93768193, 0.32327364],
    O: [0, 0],
  },
  mars: {
    a: [1.52371034, 0.00001847],
    e: [0.0933941, 0.00007882],
    I: [1.84969142, -0.00813131],
    L: [-4.55343205, 19140.30268499],
    w: [-23.94362959, 0.44441088],
    O: [49.55953891, -0.29257343],
  },
};

function heliocentric(planet, T) {
  const el = ELEMENTS[planet];
  const at = (k) => el[k][0] + el[k][1] * T;
  const a = at('a'), e = at('e'), I = at('I') * DEG, O = at('O') * DEG, wBar = at('w') * DEG;
  const w = wBar - O;
  let M = (at('L') * DEG - wBar) % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;

  // Ecuación de Kepler: E - e·sen(E) = M
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));

  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    sw * sI * xp + cw * sI * yp,
  ];
}

// Siglos julianos desde J2000 para una fecha en milisegundos (UTC).
function centuries(ms) {
  const jd = ms / 86400000 + 2440587.5;
  return (jd - 2451545) / 36525;
}

export function earthMarsDistanceKm(ms) {
  const T = centuries(ms);
  const e = heliocentric('earth', T);
  const m = heliocentric('mars', T);
  return Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]) * AU_KM;
}

// Segundos que tarda la luz (o una orden de radio) en ir de la Tierra a Marte.
export function lightTimeSeconds(ms) {
  return earthMarsDistanceKm(ms) / C_KM_S;
}
