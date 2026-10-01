import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/3d-web-structure-analyzer/',
  plugins: [react()],
  build: {
    // three.js alone is ~520 kB minified and cannot be split further.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Keep the large, rarely changing libraries in their own cacheable chunks.
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler/')) return 'react'
          return undefined
        },
      },
    },
  },
})
