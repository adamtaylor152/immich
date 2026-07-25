import { defineConfig, UserConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: { src: '/src' },
    tsconfigPaths: true,
  },
  build: {
    rolldownOptions: {
      input: 'src/index.ts',
      output: {
        dir: 'dist',
      },
    },
    ssr: true,
  },
  ssr: {
    // bundle everything except Node built-ins and the better-sqlite3 native module (its
    // prebuilt .node binding is resolved at runtime via __dirname and cannot be bundled)
    noExternal: /^(?!node:|better-sqlite3).*$/,
    external: ['better-sqlite3'],
  },
  test: {
    name: 'cli:unit',
    globals: true,
    // Native module: keep it external so vitest doesn't try to transform its bindings.
    server: { deps: { external: ['better-sqlite3'] } },
  },
} as UserConfig);
