import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/.cache/**', '**/test-results/**', '**/playwright-report/**', '**/*.tsbuildinfo'] } },
  preview: { port: 4173, strictPort: true },
});
