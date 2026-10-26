import * as THREE from 'three';

// Huellas de las ruedas: tramos cortos de "banda de rodadura" que se estampan
// sobre el terreno a medida que el rover avanza. Se guardan en un InstancedMesh
// usado como búfer circular, así las huellas más viejas se reciclan.
const MAX_STAMPS = 6000;
const STAMP_LENGTH = 0.3;

function treadTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  // Hundimiento general de la huella, más marcado en el centro.
  const across = g.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(255,255,255,0)');
  across.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  across.addColorStop(0.85, 'rgba(255,255,255,0.55)');
  across.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 64);
  // Marcas de los tacos (grousers) de la rueda, en diagonal.
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 6;
  for (let y = -16; y < 80; y += 21) {
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(32, y + 8);
    g.lineTo(56, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createTracks(scene, surfaceHeight, wheelWidth) {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: '#3d1a0b',
    roughness: 1,
    alphaMap: treadTexture(),
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.InstancedMesh(geo, material, MAX_STAMPS);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  let next = 0;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const basis = new THREE.Matrix4();
  const up = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3(wheelWidth, 1, STAMP_LENGTH * 1.05);

  function normalAt(x, z, out) {
    const e = 0.4;
    out.set(
      surfaceHeight(x - e, z) - surfaceHeight(x + e, z),
      2 * e,
      surfaceHeight(x, z - e) - surfaceHeight(x, z + e)
    );
    return out.normalize();
  }

  // Estampa un tramo de huella centrado en (x, z), orientado según 'heading'.
  function stamp(x, z, heading) {
    normalAt(x, z, up);
    fwd.set(Math.sin(heading), 0, Math.cos(heading));
    side.crossVectors(up, fwd).normalize();
    fwd.crossVectors(side, up).normalize();
    basis.makeBasis(side, up, fwd);
    q.setFromRotationMatrix(basis);
    pos.set(x, surfaceHeight(x, z) + 0.01, z);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(next, m);
    next = (next + 1) % MAX_STAMPS;
    mesh.count = Math.min(mesh.count + 1, MAX_STAMPS);
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { stamp, STAMP_LENGTH };
}
