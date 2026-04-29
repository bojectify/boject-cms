module.exports = function () {
  return {
    autoDetect: true,
    // cms integration tests share a single Postgres database (boject_test)
    // and each booted Nuxt dev server, so they cannot run in parallel.
    // Vitest's `fileParallelism: false` is honoured by the CLI but not by
    // Wallaby's runner — force single-worker here.
    workers: { initial: 1, regular: 1, restart: true },
  };
};
