import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

/**
 * OneDrive-safe public dir copy.
 * Node's copyFileSync uses FICLONE by default, which fails with EPERM on
 * OneDrive-synced NTFS paths. This plugin copies via read+write instead.
 */
function safePublicCopy(): Plugin {
  return {
    name: 'safe-public-copy',
    enforce: 'post',
    writeBundle(options) {
      const publicDir = path.resolve(__dirname, 'public')
      const outDir = options.dir || path.resolve(__dirname, 'dist')
      if (!fs.existsSync(publicDir)) return

      const copyDir = (src: string, dest: string) => {
        fs.mkdirSync(dest, { recursive: true })
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const s = path.join(src, entry.name)
          const d = path.join(dest, entry.name)
          if (entry.isDirectory()) { copyDir(s, d) }
          else { fs.writeFileSync(d, fs.readFileSync(s)) }
        }
      }
      copyDir(publicDir, outDir)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), safePublicCopy()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8300',
      '/ws': { target: 'ws://127.0.0.1:8300', ws: true },
    },
  },
  build: {
    copyPublicDir: false,
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
