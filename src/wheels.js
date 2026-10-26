import * as THREE from 'three';

// Las 6 ruedas de Perseverance vienen en el modelo de la NASA como una sola
// pieza (Wheels_objs). Aquí las separamos en 6 ruedas independientes y les
// damos la cinemática real de un rover rocker-bogie:
//  - Cada rueda gira según la distancia que recorre su punto de contacto con
//    el suelo (rodadura sin deslizamiento: ω = v / r).
//  - Las 4 ruedas de las esquinas tienen dirección propia y se orientan hacia
//    donde se mueve su eje; las 2 del medio son fijas, como en el rover real.
//    Por eso, al girar sobre sí mismo, las esquinas se ponen en diagonal.
const MAX_STEER = Math.PI / 2;
const STEER_RATE = 2.5; // rad/s, velocidad de los motores de dirección

// k-medias en una dimensión, para encontrar los 3 ejes (delantero, medio, trasero).
function threeClusters(values) {
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  const c = [min, (min + max) / 2, max];
  for (let it = 0; it < 12; it++) {
    const sum = [0, 0, 0], n = [0, 0, 0];
    for (const v of values) {
      const k = nearest(c, v);
      sum[k] += v;
      n[k]++;
    }
    for (let k = 0; k < 3; k++) if (n[k]) c[k] = sum[k] / n[k];
  }
  return c.sort((a, b) => a - b);
}
const nearest = (c, v) => {
  let best = 0;
  for (let k = 1; k < c.length; k++) if (Math.abs(v - c[k]) < Math.abs(v - c[best])) best = k;
  return best;
};

// Geometría con solo los triángulos indicados y solo los vértices que usan
// (si compartiera todos los vértices, sus medidas abarcarían las 6 ruedas).
function subGeometry(geo, triangles) {
  const src = geo.index.array;
  const remap = new Map();
  const index = new Uint32Array(triangles.length * 3);
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const old = src[t * 3 + k];
      if (!remap.has(old)) remap.set(old, remap.size);
      index[i * 3 + k] = remap.get(old);
    }
  });
  const sub = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const size = attr.itemSize;
    const data = new attr.array.constructor(remap.size * size);
    for (const [old, now] of remap) {
      for (let c = 0; c < size; c++) data[now * size + c] = attr.array[old * size + c];
    }
    sub.setAttribute(name, new THREE.BufferAttribute(data, size, attr.normalized));
  }
  sub.setIndex(new THREE.BufferAttribute(index, 1));
  return sub;
}

export function createWheels(model) {
  const wheelsRoot = model.getObjectByName('Wheels_objs');
  if (!wheelsRoot) return null;

  // Trabajamos en el espacio local del modelo (antes de su escala/desplazamiento).
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const parts = [];
  wheelsRoot.traverse((o) => {
    if (!o.isMesh || !o.geometry.index) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toModel, o.matrixWorld));
    const pos = geo.attributes.position;
    const idx = geo.index.array;
    const triCount = idx.length / 3;
    const centroids = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const v = idx[t * 3 + k];
        centroids[t * 3] += pos.getX(v) / 3;
        centroids[t * 3 + 1] += pos.getY(v) / 3;
        centroids[t * 3 + 2] += pos.getZ(v) / 3;
      }
    }
    parts.push({ mesh: o, geo, centroids, triCount });
  });

  // 1) Cada triángulo se asigna a una rueda: lado (x) y eje (z).
  const zs = [];
  let xMin = Infinity, xMax = -Infinity;
  for (const p of parts) {
    for (let t = 0; t < p.triCount; t++) {
      zs.push(p.centroids[t * 3 + 2]);
      xMin = Math.min(xMin, p.centroids[t * 3]);
      xMax = Math.max(xMax, p.centroids[t * 3]);
    }
  }
  const axles = threeClusters(zs);
  const xMid = (xMin + xMax) / 2;
  const wheelOf = (p, t) => nearest(axles, p.centroids[t * 3 + 2]) * 2 + (p.centroids[t * 3] > xMid ? 1 : 0);

  const boxes = Array.from({ length: 6 }, () => new THREE.Box3());
  const v = new THREE.Vector3();
  for (const p of parts) {
    const idx = p.geo.index.array;
    for (let t = 0; t < p.triCount; t++) {
      const w = wheelOf(p, t);
      for (let k = 0; k < 3; k++) boxes[w].expandByPoint(v.fromBufferAttribute(p.geo.attributes.position, idx[t * 3 + k]));
    }
  }

  // 2) Centro y radio de cada rueda: el diámetro es su largo a lo largo del eje z.
  const wheels = boxes.map((box, i) => {
    const radius = (box.max.z - box.min.z) / 2;
    const center = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + radius, (box.min.z + box.max.z) / 2);
    const axle = Math.floor(i / 2);
    const steer = new THREE.Object3D();
    steer.name = `rueda_${['trasera', 'media', 'delantera'][axle]}_${i % 2 ? 'izquierda' : 'derecha'}`;
    steer.position.copy(center);
    const spin = new THREE.Object3D();
    steer.add(spin);
    model.add(steer);
    return {
      steer,
      spin,
      center,
      radius,
      radiusWorld: radius,
      corner: axle !== 1,
      // Posición en el espacio del rover (metros), para calcular su velocidad.
      local: new THREE.Vector3(),
      tris: parts.map(() => ({ spin: [], fixed: [] })),
      angle: 0,
    };
  });

  // 3) Lo que está dentro del círculo de la rueda gira; lo de encima (el motor
  //    de dirección) solo se orienta con ella.
  parts.forEach((p, pi) => {
    for (let t = 0; t < p.triCount; t++) {
      const w = wheels[wheelOf(p, t)];
      const dy = p.centroids[t * 3 + 1] - w.center.y;
      const dz = p.centroids[t * 3 + 2] - w.center.z;
      (Math.hypot(dy, dz) <= w.radius * 1.03 ? w.tris[pi].spin : w.tris[pi].fixed).push(t);
    }
  });
  for (const w of wheels) {
    parts.forEach((p, pi) => {
      for (const [kind, node] of [['spin', w.spin], ['fixed', w.steer]]) {
        const list = w.tris[pi][kind];
        if (!list.length) continue;
        const geo = subGeometry(p.geo, list).translate(-w.center.x, -w.center.y, -w.center.z);
        const mesh = new THREE.Mesh(geo, p.mesh.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        node.add(mesh);
      }
    });
    delete w.tris;
    // Ancho de la banda de rodadura (solo la parte que gira).
    model.updateMatrixWorld(true);
    const spinBox = new THREE.Box3().setFromObject(w.spin).applyMatrix4(toModel);
    w.width = spinBox.max.x - spinBox.min.x;
  }
  wheelsRoot.removeFromParent();

  // Recalcula medidas en metros cuando cambia la escala o posición del modelo.
  function refresh() {
    model.updateMatrix();
    for (const w of wheels) {
      w.radiusWorld = w.radius * model.scale.x;
      w.local.copy(w.center).applyMatrix4(model.matrix);
    }
  }
  refresh();

  // ---------- Física de rodadura ----------
  // v: velocidad del rover hacia delante (m/s); yawRate: giro (rad/s, + = izquierda).
  function update(dt, v, yawRate) {
    for (const w of wheels) {
      // Velocidad del eje de la rueda en el plano del rover: v + ω × r.
      const vx = yawRate * w.local.z;
      const vz = v - yawRate * w.local.x;
      const speed = Math.hypot(vx, vz);

      if (w.corner && speed > 1e-3) {
        // La rueda apunta hacia donde se mueve su eje; si eso queda hacia
        // atrás, apunta al revés y rueda en reversa.
        let target = Math.atan2(vx, vz);
        if (target > MAX_STEER) target -= Math.PI;
        if (target < -MAX_STEER) target += Math.PI;
        const step = STEER_RATE * dt;
        w.steer.rotation.y += THREE.MathUtils.clamp(target - w.steer.rotation.y, -step, step);
      }

      // Rodadura: solo cuenta la parte de la velocidad en la dirección de la
      // rueda (la componente lateral sería derrape).
      const a = w.steer.rotation.y;
      const rolling = vx * Math.sin(a) + vz * Math.cos(a);
      w.angle += (rolling / w.radiusWorld) * dt;
      w.spin.rotation.x = w.angle;
    }
  }

  const avg = (f) => wheels.reduce((s, w) => s + f(w), 0) / wheels.length;
  return {
    wheels,
    update,
    refresh,
    get radius() { return avg((w) => w.radiusWorld); },
    get width() { return avg((w) => w.width * model.scale.x); },
  };
}
