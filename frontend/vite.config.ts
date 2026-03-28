import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8300',
      '/ws': { target: 'ws://127.0.0.1:8300', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          if (
            id.includes('react-markdown') ||
            id.includes('remark-gfm') ||
            id.includes('rehype-highlight') ||
            id.includes('highlight.js') ||
            id.includes('mdast-util') ||
            id.includes('micromark') ||
            id.includes('hast-util') ||
            id.includes('unist-util') ||
            id.includes('vfile')
          ) {
            return 'markdown-vendor';
          }

          if (id.includes('framer-motion')) {
            return 'motion-vendor';
          }

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('scheduler')
          ) {
            return 'react-vendor';
          }

          return 'vendor';
        },
      },
    },
  },
})
