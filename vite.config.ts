/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

export default defineConfig(({ isSsrBuild }) => ({
  // Rapier's ordinary build imports its WebAssembly as a module, which this
  // turns into something a browser can load. Instantiating it is asynchronous,
  // so the bundle carries a top-level await; that needs no plugin here because
  // the build targets es2022, which supports it natively.
  //
  // The alternative is the `-compat` build, which inlines the same WebAssembly
  // as base64: a third larger, impossible to stream, and cached with the game
  // code rather than separately from it.
  /**
   * Relative asset URLs, so the built game runs from whatever path it is served
   * at rather than only from the root of a domain.
   *
   * The default is '/', which emits `/assets/index-abc.js`. Hosted anywhere
   * under a subdirectory — which is how a publishing platform usually serves a
   * build — every one of those 404s and the page comes up blank with no error
   * that points at the cause. './' is the difference between a build that works
   * anywhere and one that works only at a domain root.
   */
  base: './',
  plugins: [wasm()],
  resolve: {
    alias: {
      /**
       * Rapier is loaded two ways, and the code imports it under one name.
       *
       * The browser gets the ordinary build, whose WebAssembly is a separate
       * file: a third smaller than base64, streamed and compiled while the rest
       * of the bundle parses, and cached on its own.
       *
       * The test runner gets the `-compat` build, because WebAssembly module
       * imports are not instantiated under Node here. That is safe rather than
       * merely convenient: the two packages ship a byte-identical
       * `rapier_wasm3d_bg.wasm` — same SHA-256 — so the tests exercise exactly
       * the physics that ships. Only the loading differs.
       *
       * The package also declares `module` but neither `main` nor `exports`,
       * which is why the browser side points at the entry file directly.
       */
      '@dimforge/rapier3d':
        process.env.VITEST || isSsrBuild
          ? '@dimforge/rapier3d-compat'
          : '@dimforge/rapier3d/rapier.js',
    },
  },
  server: { port: 5173, host: '127.0.0.1' },
  /**
   * The game server bundles everything it uses into one file.
   *
   * By default an SSR build leaves its packages as imports to be found in
   * node_modules at run time -- here that is `ws` and Rapier, both of which
   * are only installed for development. One self-contained file is what makes
   * the server's container a Node runtime and a single script, with no install
   * step and nothing to drift from what was tested.
   */
  ssr: { noExternal: true },
  // The browser's static files are no use to the server.
  publicDir: isSsrBuild ? false : 'public',
  test: {
    /**
     * Twenty seconds rather than vitest's five.
     *
     * This suite plays football: several tests run tens of thousands of
     * physics steps across seeded scenarios, and on a busy machine those sit
     * right at five seconds. Under load they failed one after another -- one,
     * then two, then three runs in a row -- and every failure was a timeout,
     * never a wrong answer. Five seconds is a default for unit tests; twenty
     * still catches a test that has genuinely hung.
     */
    testTimeout: 20_000,
  },
  build: {
    target: 'es2022',

    // Three is about 670kB minified (r186) and there is no getting it much
    // below that while using a renderer at all, so the default 500kB warning
    // fires on every build and means nothing. Set above it, so it means
    // something again.
    chunkSizeWarningLimit: 720,
    rolldownOptions: isSsrBuild ? {} : {
      output: {
        // Three and Rapier change far less often than the game does, so they
        // get their own chunks and stay in the browser cache across deploys.
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
          ],
        },
      },
    },
  },
}));
