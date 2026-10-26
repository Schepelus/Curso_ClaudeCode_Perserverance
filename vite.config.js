import { defineConfig } from 'vite';

// El servidor de la NASA no permite que el navegador lea sus datos desde otra
// página (no envía cabeceras CORS). Vite hace de intermediario: lo que pidamos
// a /nasa/... lo trae de https://mars.nasa.gov/...
export default defineConfig({
  server: {
    proxy: {
      '/nasa': {
        target: 'https://mars.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nasa/, ''),
        // El intermediario se identifica con su propio nombre en lugar de reenviar
        // el del navegador (la NASA rechaza, por ejemplo, el Chrome invisible del check).
        headers: { 'User-Agent': 'marte-perseverance/0.1 (simulacion educativa; proxy de Vite)' },
      },
    },
  },
});
