import * as THREE from 'three';

// Texturas de arena procedurales y repetibles (tileables):
// - normalMap: ondulaciones del viento + grano fino, para el relieve.
// - map: variación de brillo del grano, se multiplica con los colores del terreno.
export function makeSandTextures(size = 512, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  const TAU = Math.PI * 2;
  const height = new Float32Array(size * size);
  const grain = new Float32Array(size * size);
  // Fases aleatorias para que las ondulaciones no se vean perfectas.
  const p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // Todas las frecuencias son enteras para que la textura se repita sin costuras.
      const warp = 0.025 * Math.sin(TAU * v + p1) + 0.012 * Math.sin(TAU * (2 * v + u) + p2);
      const phase = TAU * (14 * (u + warp));
      // Onda asimétrica: lado de barlovento suave, sotavento más abrupto.
      const ripple = Math.sin(phase) + 0.35 * Math.sin(2 * phase + 0.6);
      const ripMask = 0.65 + 0.35 * Math.sin(TAU * (2 * u + 3 * v) + p3);
      const g = rnd();
      const i = y * size + x;
      grain[i] = g;
      height[i] = ripple * ripMask * 0.4 + (g - 0.5) * 0.45;
    }
  }

  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  const normalData = new Uint8Array(size * size * 4);
  const colorData = new Uint8Array(size * size * 4);
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      normalData[i * 4] = (n.x * 0.5 + 0.5) * 255;
      normalData[i * 4 + 1] = (n.y * 0.5 + 0.5) * 255;
      normalData[i * 4 + 2] = (n.z * 0.5 + 0.5) * 255;
      normalData[i * 4 + 3] = 255;

      // Granos claros y oscuros dispersos sobre un tono base.
      const g = grain[i];
      let b = 0.9 + (g - 0.5) * 0.18 + height[i] * 0.05;
      if (g > 0.985) b += 0.25;
      if (g < 0.02) b -= 0.3;
      const c = THREE.MathUtils.clamp(b, 0, 1) * 255;
      colorData[i * 4] = c;
      colorData[i * 4 + 1] = c * 0.97;
      colorData[i * 4 + 2] = c * 0.94;
      colorData[i * 4 + 3] = 255;
    }
  }

  const setup = (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  const normalMap = setup(new THREE.DataTexture(normalData, size, size));
  const map = setup(new THREE.DataTexture(colorData, size, size));
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap };
}
