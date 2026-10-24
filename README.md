# SVG Sprite Toolkit

A small compiler for **your own SVG symbol sprite**, a Vite plugin, and an optional Svelte 5 renderer. This package contains tooling, not an icon collection. No artwork or pre-generated icon keys are included.

I want symbol selection to be explicit: one source sprite, one selection file, and generated files in the consuming project. I also want the same compiler to run in Node and Bun, with predictable symbol IDs and useful type errors when a key changes.

The public root and `/compiler` export the compiler. `/vite` exports `viteSvgSprite`. `/Icon.svelte` is a Svelte 5 source component with a declaration file; it needs a Svelte compiler. `/client` is a type-only entry for the virtual Vite module. Importing the compiler does not load Svelte or Vite.

## Install and build

Requires Node 22.12 or later. Local runtime qualification uses Node 24.20.0 and Bun 1.4.2; Vite integration uses Vite 7.3.7 and Svelte 5.57.2. This is an ESM package; CommonJS is not provided. The manifest remains `private: true`; these instructions do not assume an npm registry publication.

To build a checkout:

```sh
git clone https://github.com/FrankFMY/svg-sprite-toolkit.git
cd svg-sprite-toolkit
npm ci
npm run check
npm pack
```

`npm pack` produces `frankfmy-svg-sprite-toolkit-0.1.1.tgz`. Copy it into a separate application directory and install it there:

```sh
npm install ./frankfmy-svg-sprite-toolkit-0.1.1.tgz
```

For the GitHub release, download and verify the archive before local installation:

```sh
curl --fail --location --output frankfmy-svg-sprite-toolkit-0.1.1.tgz \
  https://github.com/FrankFMY/svg-sprite-toolkit/releases/download/v0.1.1/frankfmy-svg-sprite-toolkit-0.1.1.tgz &&
curl --fail --location --output SHA256SUMS \
  https://github.com/FrankFMY/svg-sprite-toolkit/releases/download/v0.1.1/SHA256SUMS &&
sha256sum --check SHA256SUMS &&
npm install ./frankfmy-svg-sprite-toolkit-0.1.1.tgz
```

This works with npm 12's default restriction on direct URL dependencies without changing its policy. Require a successful checksum check before installing; use an equivalent SHA-256 verifier on platforms without `sha256sum`.

## Compiler quickstart

Create `artwork/source.svg` with geometry you own or may redistribute:

```xml
<svg xmlns="http://www.w3.org/2000/svg">
  <symbol id="circle" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="8"/>
  </symbol>
  <symbol id="square" viewBox="0 0 24 24">
    <rect x="4" y="4" width="16" height="16"/>
  </symbol>
</svg>
```

Create `icons.json`:

```json
{ "keys": { "circle": true, "square": false } }
```

Create `compile.mjs` and run `node compile.mjs` or `bun compile.mjs`:

```js
import { Icons } from '@frankfmy/svg-sprite-toolkit/compiler';

const icons = new Icons({
  source: 'artwork/source.svg',
  selection: 'icons.json',
  output: 'generated/icons.svg',
  types: 'generated/icon-keys.ts',
  schema: 'generated/icons.schema.json',
});

await icons.sync(); // All available keys and a schema; selection need not exist yet.
const result = await icons.build(); // Selected sprite AND refreshed keys/schema.
console.log(result.selected, result.included, result.bytes);
```

Every path is required. Compiler paths resolve against the current working directory; Vite paths resolve against the Vite project root. Inputs and outputs must be distinct. Outputs cannot be inside `node_modules`, pass through symlinks, replace multiply linked files, or alias an input. Use separate caller-owned paths for each compiler instance. No output path is inferred from the installed package.

`sync(): Promise<SyncResult>` returns `keys`. `build(options?: { signal?: AbortSignal }): Promise<BuildResult>` returns `keys`, `selected`, `included`, `svg`, and its UTF-8 `bytes`. `included` also accounts for symbols required by local references. Keys use UTF-16 code-unit ordering. The generated `IconKey` union describes **all available** symbols, including disabled ones; selection determines rendering availability. Empty sources generate `never`; empty selections generate an empty sprite. Unknown selection keys, even keys set to false, fail. The optional `$schema` string is accepted in selection JSON. All other configuration properties and non-boolean key values fail.

One instance serializes its calls and remains usable after rejection. Validation finishes before outputs are staged. Unchanged files are left untouched. Each replacement is atomic; the three files are not a filesystem transaction. An I/O failure, cancellation, or process termination can leave files from different completed stages: rerun the build. Cancellation is checked before each replacement. Independent instances/processes must not share output paths.

## Vite and Svelte quickstart

Install the optional peers and a Svelte Vite plugin in the consuming app:

```sh
npm install --save-dev vite@7.3.7 @sveltejs/vite-plugin-svelte@6.2.1
npm install svelte@5.57.2
```

Use `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSvgSprite } from '@frankfmy/svg-sprite-toolkit/vite';

export default defineConfig({
  base: '/demo/',
  plugins: [
    viteSvgSprite({
      source: 'artwork/source.svg',
      selection: 'icons.json',
      output: 'generated/icons.svg',
      types: 'src/generated/icon-keys.ts',
      schema: 'generated/icons.schema.json',
      fileName: 'assets/icons.svg',
    }),
    svelte(),
  ],
});
```

Add to `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="@frankfmy/svg-sprite-toolkit/client" />
```

Use the component in a `.svelte` file:

```svelte
<script lang="ts">
  import Icon from '@frankfmy/svg-sprite-toolkit/Icon.svelte';
  import { spriteUrl } from 'virtual:svg-sprite';
  import type { IconKey } from './generated/icon-keys';
  const key: IconKey = 'circle';
</script>

<Icon {key} {spriteUrl} title="Circle" width={24} height={24} />
```

Run Vite or the compiler once before checking imports of the generated key file. The renderer accepts a string key; assign it to the caller's generated `IconKey` type to check membership. It does not mutate package declarations or merge a global icon-key type. `spriteUrl` is required; prefer the virtual module so Vite controls the base/asset URL. Outside Vite, supply a same-origin sprite URL without a fragment. Keys are fragment-encoded. A `title` makes the SVG an accessible image; without one it is decorative. `class`, `style`, `width`, and `height` are supported; dimensions default to `1em`.

The plugin compiles before Vite builds, emits the selected sprite under `fileName` (default `icons.svg`), and resolves the virtual URL for both absolute and relative Vite bases. Do not also copy that asset through `publicDir` or point compiler output into Vite's output/public directories. Development handles input add/change/unlink events, coalesces queued rebuilds, cancels superseded work, and awaits the current build before serving. Invalid input produces a Vite error overlay and HTTP 500 at the sprite endpoint until fixed; a production build rejects. Teardown aborts queued work and removes the plugin's listeners from Vite's shared watcher. The plugin does not own or close Vite's watcher. It does not open a separate watcher for direct compiler calls.

## Supported SVG and limits

This is a fail-closed **geometry subset**, not a sanitizer for arbitrary SVG. Unsupported input is rejected, never silently stripped. The whole input is checked, including unselected symbols.

- The root must be `svg` in the SVG namespace, with only namespace declarations. Its children are `symbol` and `defs`; symbols must be top-level or inside root `defs`.
- Supported geometry: `g`, `path`, `circle`, `rect`, `ellipse`, `line`, `polyline`, `polygon`, and `use`; `title` and `desc` accept plain text. Global definitions need IDs. IDs must be unique; symbols need nonempty IDs without whitespace, control characters, `#`, or `%`, and at most 128 characters.
- Symbols retain `viewBox` and `preserveAspectRatio`. Basic numeric geometry, transforms, fill/stroke colors, opacity, line joins/caps, dash arrays, fill rules, and non-scaling strokes are supported. Paint values are plain color names or hex colors, including `none` and `currentColor`; CSS functions and paint-server URLs are not supported. Geometry syntax is conservatively checked; this is not a complete SVG path grammar validator.
- `use` accepts only a local `#id` reference, including `xlink:href`. Referenced definitions and symbols are retained, including their IDs. Missing or cyclic references fail. SVGO uses only its explicit `removeComments` plugin; ID cleanup, viewBox removal, and reference rewriting are disabled.
- Scripts, event attributes, styles, links, external URLs, images, animation, HTML/foreign namespaces, filters, gradients, clipping/masking, XML processing instructions, doctypes, and entity declarations are rejected. Standard XML escaping and numeric character references are parsed before attribute checks.
- Inputs are limited to 2 MiB each, 10,000 elements, 64 structural levels, and 128 reference traversal levels. JSDOM windows are closed after parsing; external resource loading and script execution are not enabled.

Use local files and output directories you control. This is not a sandbox against another process concurrently replacing directories, nor a CPU/memory isolation boundary for hostile workloads. It does not fetch artwork, grant artwork licenses, validate design quality, support arbitrary editor exports, or minimize path geometry. Cross-origin external-symbol rendering is not a supported renderer use case.

## Ownership and development

The MIT license covers the **tool**. Input artwork and any rights in generated artwork remain governed by their owners' licenses. Supplying artwork does not relicense it under MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for tool and dependency terms.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local checks and [CHANGELOG.md](CHANGELOG.md) for API changes.

## Author and contact

Created and maintained by [Artem Prianishnikov (Артем Прянишников / FrankFMY)](https://github.com/FrankFMY).

- Email: [Pryanishnikovartem@gmail.com](mailto:Pryanishnikovartem@gmail.com)
- Telegram: [@FrankFMY](https://t.me/FrankFMY)
- Website: [frankfmy.com](https://frankfmy.com)
- Profiles: [GitHub](https://github.com/FrankFMY) · [LinkedIn](https://www.linkedin.com/in/frankfmy/) · [X](https://x.com/FrankFMY)
