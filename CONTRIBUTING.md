# Contributing

Use Node 22.12 or later and npm. Install with `npm ci`; run `npm run check` for lint, strict TypeScript/Svelte checks, compiler tests, and the ESM/declaration build. `bun test test` can also run the compiler tests. `npm pack` rebuilds the package and creates the distributable tarball.

Tests use only simple, newly written geometry and create temporary files under ignored `.qualification/`. Do not add third-party artwork, branding, generated key inventories, credentials, machine-specific paths, logs, or browser profiles to the repository or tarball.

Keep compiler imports independent of optional framework runtimes. When changing the parser, add both positive reference-preservation cases and negative active-content cases. When changing the plugin, verify a separate installed-tarball Vite/Svelte consumer: production and development rendering, both input watchers, error recovery, concurrent change bursts, base URLs, and server teardown. A production build alone does not exercise development behavior. Test generated keys and renderer props with positive and negative type examples.

Use explicit caller-owned output paths. Do not weaken the geometry subset to accept arbitrary SVG under a security claim. Changes to supported input or generated types are public API changes.

After changing runtime dependencies, run `node scripts/notices.mjs` to refresh the full license texts for the dependency versions in the lockfile. Review `npm pack --dry-run` and test the tarball from a separate project before distribution. Package scripts do not publish anything.
