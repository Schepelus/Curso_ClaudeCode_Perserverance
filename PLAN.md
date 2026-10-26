# Plan: Paisaje de Marte con Vite + Three.js

## Contexto
Carpeta casi vacía (solo CLAUDE.md). Objetivo: paisaje marciano cinematográfico visible en vivo en VS Code (Simple Browser o navegador externo en localhost:5173), con autoverificación vía `npm run check`.

## Pasos
0. Guardar este plan como `PLAN.md` en la raíz del proyecto.
1. **Arranque rápido (<2 min)**: crear a mano `package.json` (vite, three, playwright-core), `index.html`, `src/main.js` con escena mínima (terreno + cielo + luz). `npm install` y `npm run dev` en background (puerto 5173). Avisar la URL.
2. **Escena completa** (`src/main.js`, módulos en `src/`):
   - Terreno: PlaneGeometry grande desplazado con ruido (dunas suaves + ondulaciones), color óxido con vertex colors.
   - Rocas: IcosahedronGeometry deformadas, InstancedMesh, dispersas.
   - Cielo: shader en esfera con gradiente caramelo/butterscotch, halo cerca del sol; `scene.fog` color polvo.
   - Sol de tarde: DirectionalLight cálida baja, sombras PCFSoft, + HemisphereLight; disco solar con brillo.
   - Fobos y Deimos: esferas pequeñas irregulares en el cielo, visibles en cámara.
   - Partículas de polvo flotando, ACES tone mapping, cámara con leve movimiento + OrbitControls.
3. **`npm run check`** (`scripts/check.mjs`): playwright-core con `chromium.launch({ channel: 'chrome', headless: true })` (Chrome instalado, sin descargar navegadores); abre localhost:5173 (arranca Vite si no está), espera render, guarda `screenshots/check.png`, imprime errores de consola/pageerror y sale con código ≠0 si hay errores. Flags WebGL: `--use-angle=swiftshader` / `--enable-unsafe-swiftshader` por si no hay GPU en headless.
4. **Iterar**: correr check tras cada mejora grande, ver captura, corregir. Máx 3 rondas.

## Listo cuando
`npm run check` sin errores y la captura muestra dunas, rocas, cielo caramelo con polvo, sol cálido con sombras suaves y ambas lunas.
