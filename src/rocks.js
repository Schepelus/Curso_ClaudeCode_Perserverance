import * as THREE from 'three';

// Ruido 3D en GLSL y relieve de roca: grano fino + grietas.
const rockNoiseGLSL = /* glsl */ `
  varying vec3 vRockPos;
  float rockHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float rockNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(rockHash(i), rockHash(i + vec3(1, 0, 0)), f.x),
          mix(rockHash(i + vec3(0, 1, 0)), rockHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(rockHash(i + vec3(0, 0, 1)), rockHash(i + vec3(1, 0, 1)), f.x),
          mix(rockHash(i + vec3(0, 1, 1)), rockHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float rockHeight(vec3 p) {
    float h = 0.0, a = 0.5;
    vec3 q = p * 7.0;
    for (int i = 0; i < 5; i++) {
      h += a * rockNoise(q);
      q *= 2.07;
      a *= 0.5;
    }
    // Grietas: valles finos donde el ruido cruza 0.5.
    float crack = 1.0 - abs(rockNoise(p * 2.5 + 11.0) * 2.0 - 1.0);
    return h - pow(crack, 24.0) * 0.3;
  }
`;

// Material de roca: relieve y color procedurales en espacio de objeto,
// así no hace falta mapa UV y no hay costuras.
export function makeRockMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: '#b07a5a', roughness: 0.92 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dustColor = { value: new THREE.Color('#c98a58') };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 dustColor;\n' + rockNoiseGLSL)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float rh = rockHeight(vRockPos);
        // Grietas oscuras, motas claras y variación de tono.
        diffuseColor.rgb *= 0.55 + 0.9 * rh;
        diffuseColor.rgb *= mix(vec3(0.85, 0.9, 1.0), vec3(1.1, 1.0, 0.92), rockNoise(vRockPos * 1.3));`
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // Bump procedural (misma técnica que bumpMap de three, con derivadas de pantalla).
          float bh = rh * 0.08;
          vec3 dpx = dFdx(-vViewPosition);
          vec3 dpy = dFdy(-vViewPosition);
          float dhx = dFdx(bh);
          float dhy = dFdy(bh);
          vec3 r1 = cross(dpy, normal);
          vec3 r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }
        // Polvo marciano acumulado en las caras que miran hacia arriba.
        float up = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        diffuseColor.rgb = mix(diffuseColor.rgb, dustColor, smoothstep(0.55, 0.95, up) * 0.55);`
      );
  };
  return material;
}
