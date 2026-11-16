import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = __dirname
const packages = resolve(root, '../../packages')

const alias: Record<string, string> = {
  '@nexus/shared/constants': resolve(packages, 'shared/src/constants.ts'),
  '@nexus/shared': resolve(packages, 'shared/src/index.ts'),
  '@nexus/core': resolve(packages, 'core/src/index.ts'),
  '@nexus/cordis': resolve(packages, 'cordis/src/index.ts'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    ssr: { noExternal: true },
    build: {
      outDir: resolve(root, 'dist/main'),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: resolve(root, 'src/main/index.ts') },
        external: ['@anthropic-ai/claude-agent-sdk'],
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    resolve: { alias },
    ssr: { noExternal: true },
    build: {
      outDir: resolve(root, 'dist/preload'),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: resolve(root, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: { alias, dedupe: ['react', 'react-dom'] },
    build: {
      outDir: resolve(root, 'dist/renderer'),
      emptyOutDir: true,
      minify: true,
      cssMinify: true,
      rollupOptions: {
        input: resolve(root, 'src/renderer/index.html'),
        output: {
          manualChunks: (id: string) => {
            if (!id.includes('node_modules')) return undefined
            if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
            return undefined
          },
        },
      },
    },
    server: { port: 5273 },
  },
})
