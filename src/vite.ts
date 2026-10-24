import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { Icons } from './compiler.js';
import type { BuildResult, IconsConfig } from './compiler.js';
import { isRecord, normalizeConfig } from './internal/__config.js';

export interface SvgSpriteOptions extends IconsConfig {
  /** Relative output asset name, including any subdirectories. Default: icons.svg. */
  fileName?: string;
}
const virtualId = 'virtual:svg-sprite';
const resolvedId = '\0svg-sprite-toolkit:asset';

/** Generate a sprite before build, emit it as an asset, and rebuild it during development. */
export function viteSvgSprite(options: SvgSpriteOptions): Plugin {
  if (!isRecord(options)) throw new Error('SVG sprite options must be an object');
  const { fileName = 'icons.svg', ...paths } = options;
  if (typeof fileName !== 'string' || !/^[a-zA-Z0-9_/-]+\.svg$/u.test(fileName) || fileName.startsWith('/') || fileName.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('fileName must be a relative .svg asset path');
  }
  let config: ResolvedConfig;
  let icons: Icons;
  let server: ViteDevServer | undefined;
  let result: BuildResult | undefined;
  let failure: Error | undefined;
  let pending: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let requested = 0;
  let completed = 0;
  let disposed = false;
  let asset: string | undefined;
  let mount = '';

  const drain = async (): Promise<void> => {
    while (!disposed && completed < requested) {
      const revision = requested;
      controller = new AbortController();
      try {
        const next = await icons.build({ signal: controller.signal });
        if (disposed || revision !== requested) continue;
        result = next;
        failure = undefined;
        server?.ws.send({ type: 'full-reload', path: '*' });
      } catch (error) {
        if (disposed || revision !== requested) continue;
        failure = error instanceof Error ? error : new Error(String(error));
        config.logger.error(`[svg-sprite-toolkit] ${failure.message}`);
        server?.ws.send({ type: 'error', err: { message: failure.message, stack: failure.stack ?? '', plugin: 'svg-sprite-toolkit' } });
      } finally { completed = revision; }
    }
  };
  const schedule = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    requested++;
    controller?.abort();
    pending ??= drain().finally(() => { pending = undefined; });
    return pending;
  };
  const onInput = (path: string): void => {
    const absolute = resolve(path);
    if (absolute === icons.config.source || absolute === icons.config.selection) void schedule();
  };
  const dispose = async (): Promise<void> => {
    disposed = true;
    controller?.abort();
    if (server) {
      for (const event of ['add', 'change', 'unlink'] as const) server.watcher.off(event, onInput);
    }
    await pending;
  };
  return {
    name: 'svg-sprite-toolkit',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
      icons = new Icons(normalizeConfig(paths, config.root));
      const basePath = new URL(config.base, 'http://localhost').pathname;
      mount = `${basePath.endsWith('/') ? basePath : `${basePath}/`}${fileName}`;
    },
    async buildStart() {
      this.addWatchFile(icons.config.source);
      this.addWatchFile(icons.config.selection);
      await schedule();
      if (failure) throw failure;
      if (!result) throw new Error('Sprite build produced no result');
      if (config.command === 'build') asset = this.emitFile({ type: 'asset', fileName, source: result.svg });
    },
    resolveId(id) { if (id === virtualId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      if (config.command === 'build') {
        if (!asset) throw new Error('Sprite asset is unavailable');
        // SSR executes in Node: Rollup's file URL would expose a build-machine
        // path in the HTML. The browser must resolve the public Vite base instead.
        if (config.build.ssr) return `export const spriteUrl = ${JSON.stringify(`${config.base}${fileName}`)};`;
        return `export const spriteUrl = import.meta.ROLLUP_FILE_URL_${asset};`;
      }
      return `export const spriteUrl = ${JSON.stringify(mount)};`;
    },
    configureServer(viteServer) {
      server = viteServer;
      // Vite owns this watcher. Remove our listeners on close; never close a shared watcher.
      server.watcher.add([icons.config.source, icons.config.selection]);
      for (const event of ['add', 'change', 'unlink'] as const) server.watcher.on(event, onInput);
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (disposed || pathname !== mount) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.end(); return; }
        await pending;
        if (failure || !result) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(failure?.message ?? 'Sprite is unavailable');
          return;
        }
        response.setHeader('Content-Type', 'image/svg+xml');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(request.method === 'HEAD' ? undefined : result.svg);
      });
    },
    async closeBundle() { await dispose(); },
  };
}
