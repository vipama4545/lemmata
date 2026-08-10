import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // What shadcn's own components import themselves as. Kept in step with the `paths`
      // entry in tsconfig.json — Vite resolves the build, TypeScript resolves the editor,
      // and they have to agree.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // The API is proxied rather than called cross-origin, so the browser sees one origin
      // in development. That is not just tidiness: the session cookie is then an ordinary
      // first-party SameSite=Lax cookie, and none of the SameSite=None/Secure machinery a
      // cross-site setup needs has to be switched on to make signing in work locally.
      '/rpc': { target: 'http://localhost:4000', changeOrigin: false },
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
    },
  },
  optimizeDeps: {
    // A workspace package of plain TypeScript. Vite compiles it as source; pre-bundling it
    // would just add a stale copy to reason about.
    exclude: ['@georgian/shared'],
  },
})
