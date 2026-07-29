import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    // Chunks manuales: cada capa futura (Canvas, R3F, shaders) entrará como su
    // propio chunk sin tocar esta configuracion.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-motion': ['framer-motion'],
          'vendor-data': ['@tanstack/react-query', '@supabase/supabase-js'],
        },
      },
    },
  },
});
