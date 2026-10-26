import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeSandTextures } from './sand.js';
import { makeRockMaterial } from './rocks.js';

// ---------- Utilidades ----------
const noise = new ImprovedNoise();

function fbm(x, z, octaves = 4, seed = 1.7) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise.noise(x * freq, z * freq, seed);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// Generador pseudoaleatorio con semilla, para que la escena sea siempre la misma.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);

// Altura del terreno: relieve amplio + crestas de dunas orientadas por el viento.
function heightAt(x, z) {
  const warp = fbm(x * 0.01, z * 0.01, 3) * 25;
  const u = x * 0.8 + z * 0.6 + warp;
  const duneMask = 0.6 + 0.6 * fbm(x * 0.006 + 10, z * 0.006, 2);
  const dunes = Math.pow(1 - Math.abs(Math.sin(u * 0.045)), 2.5) * 6 * duneMask;
  const base = fbm(x * 0.004, z * 0.004, 4) * 18;
  const small = fbm(x * 0.05, z * 0.05, 3) * 0.8;
  return base + dunes + small;
}

// ---------- Renderer, escena y cámara ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const horizonColor = new THREE.Color('#d9a066');
const zenithColor = new THREE.Color('#8a5a3c');

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(horizonColor, 0.0055);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 4000);
const camStart = new THREE.Vector3(0, 0, 40);
camStart.y = heightAt(camStart.x, camStart.z) + 4;
camera.position.copy(camStart);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, camStart.y + 3, -40);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.52;
controls.update();

// ---------- Sol de tarde ----------
const sunDir = new THREE.Vector3(-0.38, 0.14, -0.9).normalize();

const sunLight = new THREE.DirectionalLight(0xffc58a, 3.2);
sunLight.target.position.set(0, 0, -20);
sunLight.position.copy(sunLight.target.position).addScaledVector(sunDir, 250);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 600 });
sunLight.shadow.bias = -0.0005;
sunLight.shadow.normalBias = 0.05;
sunLight.shadow.radius = 4;
scene.add(sunLight, sunLight.target);

// Luz de cielo: rebote cálido del polvo arriba, suelo óxido abajo.
scene.add(new THREE.HemisphereLight(0xe8b07a, 0x6a3018, 1.3));

// ---------- Cielo color caramelo con halo solar ----------
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(2000, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      sunDir: { value: sunDir },
      horizon: { value: horizonColor },
      zenith: { value: zenithColor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 sunDir;
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(dir, sunDir), 0.0);
        // En Marte el atardecer tiene un halo azulado alrededor del sol.
        col = mix(col, vec3(0.50, 0.60, 0.70), pow(s, 220.0) * 0.6);
        col += vec3(1.0, 0.72, 0.42) * pow(s, 10.0) * 0.25;
        col += vec3(1.0, 0.92, 0.78) * pow(s, 900.0) * 0.6;
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99975, 0.99985, s) * 4.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

// ---------- Terreno con dunas ----------
const TERRAIN_SIZE = 900;
const terrainGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 400, 400).rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const dark = new THREE.Color('#6b3418');
  const rust = new THREE.Color('#a65a30');
  const dusty = new THREE.Color('#d39a64');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp((y + 6) / 26 + fbm(x * 0.03, z * 0.03, 2, 5.3) * 0.35, 0, 1);
    if (t < 0.5) c.lerpColors(dark, rust, t * 2);
    else c.lerpColors(rust, dusty, (t - 0.5) * 2);
    c.toArray(colors, i * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.computeVertexNormals();
}
// Arena: una baldosa de textura cada ~10 unidades, ondulaciones perpendiculares al viento.
const sand = makeSandTextures();
for (const tex of [sand.map, sand.normalMap]) {
  tex.repeat.set(TERRAIN_SIZE / 10, TERRAIN_SIZE / 10);
  tex.rotation = Math.atan2(0.6, 0.8);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
}
const terrain = new THREE.Mesh(
  terrainGeo,
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: sand.map,
    normalMap: sand.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.95,
    metalness: 0,
  })
);
terrain.receiveShadow = true;
terrain.castShadow = true;
scene.add(terrain);

// ---------- Rocas ----------
function makeRockGeometry(seed, roughness = 1, detail = 8) {
  // Se fusionan los vértices para que las normales sean suaves (sin facetas).
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = (noise.noise(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6) * 0.45
            + noise.noise(v.x * 4 + seed, v.y * 4, v.z * 4) * 0.12
            + noise.noise(v.x * 9 + seed, v.y * 9, v.z * 9) * 0.04) * roughness;
    v.multiplyScalar(1 + n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

const rockMaterial = makeRockMaterial();
const dummy = new THREE.Object3D();
const rockVariants = [makeRockGeometry(0), makeRockGeometry(7.3), makeRockGeometry(19.1)];
const ROCKS_PER_VARIANT = 140;
for (const geo of rockVariants) {
  const rocks = new THREE.InstancedMesh(geo, rockMaterial, ROCKS_PER_VARIANT);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const tint = new THREE.Color();
  for (let i = 0; i < ROCKS_PER_VARIANT; i++) {
    // Más densidad cerca de la cámara, para que se lean bien.
    const r = 6 + Math.pow(rand(), 1.6) * 220;
    const a = -Math.PI / 2 + (rand() - 0.5) * Math.PI * 1.4;
    const x = Math.cos(a) * r;
    const z = camStart.z + Math.sin(a) * r;
    // Las rocas cercanas son pequeñas; las grandes quedan a media distancia.
    const maxSize = THREE.MathUtils.clamp((r - 6) / 12, 0.15, 1) * 2.6;
    const s = 0.15 + Math.pow(rand(), 3) * maxSize;
    dummy.position.set(x, heightAt(x, z) - s * 0.25, z);
    dummy.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    dummy.scale.set(s * (0.8 + rand() * 0.6), s * (0.5 + rand() * 0.4), s * (0.8 + rand() * 0.6));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, tint.setHSL(0.05 + rand() * 0.03, 0.35, 0.35 + rand() * 0.2));
  }
  scene.add(rocks);
}

// ---------- Fobos y Deimos ----------
function makeMoon(radius, dir, seed, stretch) {
  // Lunas casi redondas, pálidas y algo veladas por el polvo del cielo.
  const geo = makeRockGeometry(seed, 0.35);
  const moon = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: '#d8cbbb',
      roughness: 1,
      emissive: '#e8d4bc',
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.9,
      fog: false,
    })
  );
  moon.scale.set(radius * stretch, radius, radius);
  moon.position.copy(dir).normalize().multiplyScalar(1400);
  moon.rotation.set(seed, seed * 0.5, 0);
  scene.add(moon);
  return moon;
}
const phobos = makeMoon(34, new THREE.Vector3(0.45, 0.32, -0.82), 3.1, 1.3);
const deimos = makeMoon(14, new THREE.Vector3(0.08, 0.4, -0.9), 11.7, 1.1);

// ---------- Polvo en suspensión ----------
function dustSprite() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
const DUST_COUNT = 4000;
const DUST_RANGE = 160;
const dustPos = new Float32Array(DUST_COUNT * 3);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPos[i * 3] = (rand() - 0.5) * DUST_RANGE * 2;
  dustPos[i * 3 + 1] = rand() * 30;
  dustPos[i * 3 + 2] = (rand() - 0.5) * DUST_RANGE * 2;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({
    size: 0.55,
    map: dustSprite(),
    color: '#ffd2a0',
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  })
);
scene.add(dust);

// ---------- Animación ----------
const clock = new THREE.Clock();
const wind = new THREE.Vector3(1.2, 0.05, 0.6);

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.elapsedTime;

  const p = dustGeo.attributes.position;
  for (let i = 0; i < DUST_COUNT; i++) {
    let x = p.array[i * 3] + wind.x * dt;
    let y = p.array[i * 3 + 1] + (wind.y + Math.sin(t + i) * 0.1) * dt;
    let z = p.array[i * 3 + 2] + wind.z * dt;
    if (x > DUST_RANGE) x -= DUST_RANGE * 2;
    if (z > DUST_RANGE) z -= DUST_RANGE * 2;
    if (y > 30) y = 0;
    p.array[i * 3] = x; p.array[i * 3 + 1] = y; p.array[i * 3 + 2] = z;
  }
  p.needsUpdate = true;
  dust.position.set(camera.position.x, heightAt(camera.position.x, camera.position.z) - 2, camera.position.z);

  phobos.rotation.y += dt * 0.02;
  deimos.rotation.y += dt * 0.01;
  sky.position.copy(camera.position);

  controls.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
