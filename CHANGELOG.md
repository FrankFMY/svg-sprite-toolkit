# Changelog

## 0.1.0

- Export an ESM compiler and declarations from the root and `/compiler`, with explicit caller-owned source, selection, sprite, type and schema paths.
- Provide `Icons.sync()` and serialized, cancellable `Icons.build()` with deterministic key ordering, safe TypeScript string literals, empty-input support and strict selection validation.
- Accept a documented geometry-only SVG subset; preserve symbol IDs, viewBoxes and local reference dependencies while rejecting active content and XML declarations that define entities.
- Export `viteSvgSprite` from `/vite`, including production assets, a virtual URL, development rebuilds, propagated errors and listener teardown.
- Export an optional Svelte 5 source renderer from `/Icon.svelte` and virtual-module types from `/client`.
- Include no artwork or pre-generated symbol inventory. License the tool under MIT and retain dependency notices.
