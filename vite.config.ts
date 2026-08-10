import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(moduleId) {
            if (moduleId.includes('/firebase/') || moduleId.includes('node_modules\\firebase')) return 'firebase';
            if (['motion', 'lucide-react', 'react-hot-toast'].some((name) => moduleId.includes(`node_modules/${name}`) || moduleId.includes(`node_modules\\${name}`))) return 'ui';
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // File watching can be disabled to prevent flickering during automated edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
