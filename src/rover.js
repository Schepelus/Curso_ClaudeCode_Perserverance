import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createTracks } from './tracks.js';
import { createWheels } from './wheels.js';

// Perseverance real: ~3 m de largo, 2.7 m de ancho, 2.2 m de alto (con mástil)
// y ruedas de 52,5 cm de diámetro.
const REAL_WHEEL_RADIUS = 0.525 / 2;
const REAL_HEIGHT = 2.2;
const MAX_SPEED = 3; // m/s (el real va a ~4 cm/s; aquí lo aceleramos para poder pasear)
const ACCEL = 2.5;
const TURN_RATE = 0.9; // rad/s
const CAMERA_PART = /cam|watson|lens/i;
const NOT_CAMERA = /cover|wiring|bracket/i;

const MERGE_ATTRIBUTES = ['position', 'normal', 'uv', 'uv1', 'color', 'tangent'];

// El modelo trae ~250 piezas sueltas y cada una cuesta una llamada de dibujo.
// Como el rover es rígido, juntamos todas las que comparten material en una
// sola malla. Las piezas en 'keep' (las cámaras) se conservan por separado
// y con su nombre, para poder usarlas más adelante.
function mergeStaticMeshes(root, keep) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const kept = new Set();
  keep.forEach((k) => k.traverse((o) => kept.add(o)));

  const batches = new Map();
  const merged = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || kept.has(o) || Array.isArray(o.material) || o.morphTargetInfluences) return;
    const g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!MERGE_ATTRIBUTES.includes(name)) g.deleteAttribute(name);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld));
    // Solo se pueden juntar geometrías con los mismos atributos y del mismo tipo.
    const signature = Object.entries(g.attributes)
      .map(([n, a]) => `${n}:${a.array.constructor.name}:${a.itemSize}:${a.normalized}`)
      .sort()
      .join(',');
    const key = `${o.material.uuid}|${signature}|${g.index ? 'i' : 'n'}`;
    if (!batches.has(key)) batches.set(key, { material: o.material, geos: [] });
    batches.get(key).geos.push(g);
    merged.push(o);
  });

  // Cada malla fusionada se reemplaza por un nodo vacío que conserva sus hijos.
  for (const o of merged) {
    const stub = new THREE.Object3D();
    stub.name = o.name;
    stub.position.copy(o.position);
    stub.quaternion.copy(o.quaternion);
    stub.scale.copy(o.scale);
    const parent = o.parent;
    parent.children[parent.children.indexOf(o)] = stub;
    stub.parent = parent;
    o.parent = null;
    for (const child of [...o.children]) stub.add(child);
  }

  for (const { material, geos } of batches.values()) {
    const geo = mergeGeometries(geos);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = 'rover_fusionado';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}

export async function createRover({ scene, surfaceHeight, start, heading }) {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync('/models/perseverance.glb');
  draco.dispose();
  const model = gltf.scene;

  const cameraParts = [];
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // La transmisión (vidrio) obliga a renderizar la escena dos veces por
      // fotograma; la sustituimos por transparencia simple.
      for (const m of [o.material].flat()) {
        if (m.transmission > 0) {
          m.transmission = 0;
          m.transparent = true;
          m.opacity = 0.5;
        }
      }
    }
    if (CAMERA_PART.test(o.name) && !NOT_CAMERA.test(o.name)) cameraParts.push(o);
  });

  // Las 6 ruedas pasan a ser piezas independientes que giran y se orientan.
  const wheelSet = createWheels(model);

  // Escala real: la fijamos con las ruedas, que miden 52,5 cm de diámetro
  // (dato de la NASA). Si no se encontraran, usamos la altura total.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = wheelSet ? REAL_WHEEL_RADIUS / wheelSet.radius : REAL_HEIGHT / size.y;
  model.scale.setScalar(scale);

  // Origen del rover = centro del chasis a la altura de la base de las ruedas.
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  model.updateMatrixWorld(true);
  if (wheelSet) {
    // El rover gira sobre el centro de sus 6 ruedas (no sobre el del brazo).
    wheelSet.refresh();
    const n = wheelSet.wheels.length;
    model.position.x -= wheelSet.wheels.reduce((s, w) => s + w.local.x, 0) / n;
    model.position.z -= wheelSet.wheels.reduce((s, w) => s + w.local.z, 0) / n;
    model.updateMatrixWorld(true);
    wheelSet.refresh();
  }

  // Las huellas van bajo las ruedas, con su mismo ancho.
  const wheelWidth = wheelSet ? wheelSet.width : 0.4;
  const halfTrack = wheelSet ? Math.max(...wheelSet.wheels.map((w) => Math.abs(w.local.x))) : 1.1;

  const keep = [...cameraParts, ...(wheelSet?.wheels.map((w) => w.steer) ?? [])];
  mergeStaticMeshes(model, keep);

  const rover = new THREE.Group();
  rover.name = 'Perseverance';
  rover.add(model);
  scene.add(rover);

  console.log(
    `Perseverance cargado: ${(size.x * scale).toFixed(2)} x ${(size.y * scale).toFixed(2)} x ${(size.z * scale).toFixed(2)} m`
  );
  if (wheelSet) {
    console.log(
      `Ruedas: ${wheelSet.wheels.length} independientes, radio ${wheelSet.radius.toFixed(4)} m, ancho ${wheelSet.width.toFixed(2)} m`
    );
  }
  console.log('Piezas que son cámaras:\n' + cameraParts.map((o) => '  - ' + o.name).join('\n'));

  const tracks = createTracks(scene, surfaceHeight, wheelWidth);

  // ---------- Estado de conducción ----------
  const state = { x: start.x, z: start.z, heading, speed: 0 };
  let distSinceStamp = 0;
  let firstFrame = true;

  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const axisX = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const targetQ = new THREE.Quaternion();
  const halfLength = 1.3;
  const halfWidth = 1.1;

  function placeOnTerrain(dt) {
    fwd.set(Math.sin(state.heading), 0, Math.cos(state.heading));
    side.set(Math.cos(state.heading), 0, -Math.sin(state.heading));
    const { x, z } = state;
    const hF = surfaceHeight(x + fwd.x * halfLength, z + fwd.z * halfLength);
    const hB = surfaceHeight(x - fwd.x * halfLength, z - fwd.z * halfLength);
    const hL = surfaceHeight(x + side.x * halfWidth, z + side.z * halfWidth);
    const hR = surfaceHeight(x - side.x * halfWidth, z - side.z * halfWidth);

    // La suspensión rocker-bogie hace que el chasis siga la inclinación media.
    axisZ.copy(fwd).multiplyScalar(2 * halfLength).setY(hF - hB).normalize();
    axisX.copy(side).multiplyScalar(2 * halfWidth).setY(hL - hR).normalize();
    axisY.crossVectors(axisZ, axisX).normalize();
    axisX.crossVectors(axisY, axisZ).normalize();
    basis.makeBasis(axisX, axisY, axisZ);
    targetQ.setFromRotationMatrix(basis);

    const y = (hF + hB + hL + hR) / 4;
    if (firstFrame) {
      rover.quaternion.copy(targetQ);
      rover.position.set(x, y, z);
      firstFrame = false;
    } else {
      const k = 1 - Math.exp(-dt * 8);
      rover.quaternion.slerp(targetQ, k);
      rover.position.set(x, THREE.MathUtils.lerp(rover.position.y, y, k), z);
    }
  }

  function update(dt, input) {
    // Acelerador y freno suaves.
    const target = (input.forward - input.backward) * MAX_SPEED;
    const rate = target === 0 ? ACCEL * 1.5 : ACCEL;
    state.speed += THREE.MathUtils.clamp(target - state.speed, -rate * dt, rate * dt);

    // Gira sobre sí mismo incluso parado (el rover real puede girar en el sitio).
    const yawRate = (input.left - input.right) * TURN_RATE;
    state.heading += yawRate * dt;
    wheelSet?.update(dt, state.speed, yawRate);

    const step = state.speed * dt;
    state.x += Math.sin(state.heading) * step;
    state.z += Math.cos(state.heading) * step;
    placeOnTerrain(dt);

    distSinceStamp += Math.abs(step);
    if (distSinceStamp >= tracks.STAMP_LENGTH) {
      distSinceStamp = 0;
      for (const s of [-1, 1]) {
        tracks.stamp(state.x + side.x * halfTrack * s, state.z + side.z * halfTrack * s, state.heading);
      }
    }
  }

  placeOnTerrain(0);
  return { object: rover, update, state, cameraParts, wheels: wheelSet };
}
