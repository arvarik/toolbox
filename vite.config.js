import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'))
process.env.VITE_APP_VERSION = pkg.version

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xyflow') || id.includes('@dagrejs')) {
              return 'vendor-flow'
            }
            if (id.includes('katex') || id.includes('rehype-katex') || id.includes('remark-math')) {
              return 'vendor-math'
            }
            if (id.includes('react-syntax-highlighter')) {
              return 'vendor-syntax'
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons'
            }
            if (id.includes('react-router')) {
              return 'vendor-router'
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('zustand')) {
              return 'vendor-react'
            }
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.js',
  },
})

