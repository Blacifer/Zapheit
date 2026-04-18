import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import sourceIdentifierPlugin from 'vite-plugin-source-identifier'

const isProd = process.env.BUILD_MODE === 'prod'
export default defineConfig({
  plugins: [
    react(),
    sourceIdentifierPlugin({
      enabled: !isProd,
      attributePrefix: 'data-matrix',
      includeProps: true,
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/')
          ) {
            return 'vendor-react';
          }

          if (id.includes('framer-motion')) {
            return 'vendor-motion';
          }

          if (
            id.includes('react-router-dom') ||
            id.includes('@tanstack/react-query')
          ) {
            return 'vendor-routing';
          }

          if (id.includes('@supabase') || id.includes('jose')) {
            return 'vendor-auth';
          }

          if (id.includes('recharts')) {
            return 'vendor-charts';
          }

          if (id.includes('reactflow')) {
            return 'vendor-flow';
          }

          if (id.includes('@sentry')) {
            return 'vendor-observability';
          }

          if (id.includes('cmdk') || id.includes('react-joyride')) {
            return 'vendor-ux';
          }

          if (id.includes('@radix-ui') || id.includes('lucide-react') || id.includes('class-variance-authority')) {
            return 'vendor-ui';
          }

          return undefined;
        },
      },
    },
  },
})
