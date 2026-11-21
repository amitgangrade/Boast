/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ mode }) => ({
  plugins: mode === 'test' ? [] : [react(), tailwindcss(), cloudflare()],
  test: {
    include: ['test/**/*.test.ts'],
  },
}))
