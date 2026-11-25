import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  server: {
    port: 9000,
    host: true,
    watch: {
      // Ignora file temporanei e cartelle di servizio: la sorveglianza di un .tmp
      // bloccato faceva crashare il server (EBUSY) mentre un file veniva riscritto
      // (editor con salvataggio atomico, script, strumenti esterni).
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/*.tmpdir/**',
        '**/*.tmp',
        '**/*.swp',
        '**/docs/**',
      ],
    },
  }
});
