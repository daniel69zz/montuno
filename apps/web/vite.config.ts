import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// La web habla con la API por el mismo origen (proxy en dev): sin CORS y con cookies/tokens simples.
const API = process.env.MONTUNO_API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // Pollar exige un origen autorizado exacto (http://localhost:5173)
    proxy: { '/api': API, '/health': API, '/ready': API },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
