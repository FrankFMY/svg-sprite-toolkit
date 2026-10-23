import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { optimize } from 'svgo';
import { dirname } from 'node:path';
import { isRecord, normalizeConfig, requireFile, validateOutputs } from './__config.js';
import type { IconsConfig } from './__config.js';

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const MAX_BYTES = 2 * 1024 * 1024;
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const oneNumber = new RegExp(`^${number}$`, 'u');
const numbers = new RegExp(`^\\s*${number}(?:[\\s,]+${number})*\\s*$`, 'u');
const numericNames = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity']);
const common = ['id', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'vector-effect'];
const attributes: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
  svg: [], defs: [], symbol: ['viewBox', 'preserveAspectRatio'], g: [],
  path: ['d', 'pathLength'], circle: ['cx', 'cy', 'r'], rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  ellipse: ['cx', 'cy', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'], polygon: ['points'], use: ['href', 'x', 'y', 'width', 'height'], title: [], desc: [],
}).map(([tag, specific]) => [tag, new Set(tag === 'svg' || tag === 'defs' ? [] : [...common, ...specific])]));

export interface SyncResult { readonly keys: readonly string[] }
export interface BuildResult extends SyncResult {
  readonly selected: readonly string[];
  /** Selected symbols plus symbols needed by local references. */
  readonly included: readonly string[];
  readonly svg: string;
  readonly bytes: number;
}
export interface BuildOptions { signal?: AbortSignal }
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const literal = (value: string): string => JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const numericList = (value: string): number[] => value.trim().split(/[\s,]+/u).map(Number);

function validateAttribute(tag: string, name: string, value: string): void {
  let valid = true;
  // eslint-disable-next-line no-control-regex -- Reject control characters in fragment identifiers.
  if (name === 'id') valid = value.length > 0 && value.length <= 128 && !/[\s\x00-\x1f\x7f#%]/u.test(value);
  else if (name === 'href') valid = tag === 'use' && value.startsWith('#') && value.length > 1;
  else if (name === 'viewBox') {
    const values = numericList(value);
    valid = numbers.test(value) && values.length === 4 && values.every(Number.isFinite) && values[2]! > 0 && values[3]! > 0;
  } else if (name === 'preserveAspectRatio') valid = /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/u.test(value);
  else if (name === 'd') valid = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]*$/u.test(value);
  else if (name === 'points' || name === 'stroke-dasharray') {
    const values = numericList(value);
    valid = (name === 'stroke-dasharray' && value === 'none') ||
      (numbers.test(value) && values.every(Number.isFinite) && (name === 'points' ? values.length % 2 === 0 : values.every((n) => n >= 0)));
  } else if (name === 'fill' || name === 'stroke') valid = /^(?:[a-zA-Z]+|#[0-9a-fA-F]{3,8})$/u.test(value);
  else if (name === 'transform') {
    const pieces = [...value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)/gu)];
    valid = pieces.length > 0 && value.replace(/(matrix|translate|scale|rotate|skewX|skewY)\s*\([^()]*\)/gu, '').trim().replaceAll(',', '') === '' && pieces.every((piece) => {
      const args = numericList(piece[2]!);
      const counts: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] };
      return numbers.test(piece[2]!) && args.every(Number.isFinite) && counts[piece[1]!]!.includes(args.length);
    });
  } else if (numericNames.has(name) || name === 'pathLength') {
    const n = Number(value);
    valid = oneNumber.test(value) && Number.isFinite(n);
    if (['r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'pathLength'].includes(name)) valid &&= n >= 0;
    if (name.endsWith('opacity')) valid &&= n >= 0 && n <= 1;
  } else {
    const enumerations: Record<string, string[]> = {
      'stroke-linecap': ['butt', 'round', 'square'], 'stroke-linejoin': ['miter', 'round', 'bevel'],
      'fill-rule': ['nonzero', 'evenodd'], 'clip-rule': ['nonzero', 'evenodd'], 'vector-effect': ['none', 'non-scaling-stroke'],
    };
    if (enumerations[name]) valid = enumerations[name].includes(value);
  }
  if (!valid) throw new Error(`Unsupported SVG attribute value: ${tag}.${name}`);
}
interface Parsed {
  keys: string[];
  symbols: Map<string, string>;
  definitions: Map<string, string>;
  dependencies: Map<string, Set<string>>;
}
/** Fail-closed geometry parser. No browser resources or script execution are enabled. */
export function parseSprite(source: string): Parsed {
  if (Buffer.byteLength(source) > MAX_BYTES) throw new Error('Sprite exceeds 2 MiB limit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) throw new Error('SVG doctype and entity declarations are forbidden');
  let dom: JSDOM | undefined;
  try {
    dom = new JSDOM(source, { contentType: 'image/svg+xml' });
    const document = dom.window.document;
    const root = document.documentElement;
    if (root.localName !== 'svg' || root.namespaceURI !== SVG) throw new Error('Expected an SVG namespace root');
    const all = [root, ...root.querySelectorAll('*')];
    if (all.length > 10000) throw new Error('Sprite exceeds 10000 element limit');
    const ids = new Map<string, Element>();
    const symbolElements = new Map<string, Element>();
    const references = new Map<Element, string>();
    const owners = new Map<Element, string>();
    const definitions = new Map<string, Element>();
    for (const element of all) {
      const tag = element.localName;
      const allowed = attributes[tag];
      if (element.namespaceURI !== SVG || element.prefix || !allowed || (tag === 'svg' && element !== root)) throw new Error(`Unsupported SVG element: ${tag}`);
      let depth = 0;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (++depth > 64) throw new Error('Sprite exceeds depth limit');
      }
      if (tag === 'symbol') {
        if (element.parentElement !== root && !(element.parentElement?.localName === 'defs' && element.parentElement.parentElement === root)) throw new Error('Symbols must be top-level');
        if (!element.hasAttribute('id')) throw new Error('Symbol is missing an id');
        symbolElements.set(element.id, element);
      }
      if (element.parentElement === root && !['symbol', 'defs'].includes(tag)) throw new Error('Root children must be symbols or defs');
      const globalDefinition = element.parentElement?.localName === 'defs' && element.parentElement.parentElement === root && tag !== 'symbol';
      if (globalDefinition) {
        if (!element.id) throw new Error('Global definitions need an id');
        definitions.set(element.id, element);
      }
      const owner = tag === 'symbol' || globalDefinition ? element.id : element.parentElement && owners.get(element.parentElement);
      if (owner) owners.set(element, owner);
      for (const attr of element.attributes) {
        if (attr.namespaceURI === XMLNS) {
          if (element !== root || !((attr.name === 'xmlns' && attr.value === SVG) || (attr.name === 'xmlns:xlink' && attr.value === XLINK))) throw new Error('Unsupported SVG namespace declaration');
          continue;
        }
        if (attr.namespaceURI && !(attr.namespaceURI === XLINK && attr.localName === 'href')) throw new Error(`Unsupported attribute namespace: ${attr.name}`);
        const name = attr.localName;
        if (!allowed.has(name)) throw new Error(`Unsupported SVG attribute: ${tag}.${attr.name}`);
        validateAttribute(tag, name, attr.value);
        if (name === 'href') {
          if (references.has(element)) throw new Error('Use must have exactly one href');
          references.set(element, attr.value.slice(1));
        }
      }
      if (element.hasAttribute('id')) {
        if (ids.has(element.id)) throw new Error(`Duplicate SVG id: ${literal(element.id)}`);
        ids.set(element.id, element);
      }
      if (tag === 'use' && !references.has(element)) throw new Error('Use is missing a local href');
      for (const child of element.childNodes) {
        if (child.nodeType === 7 || child.nodeType === 10) throw new Error('XML processing instructions are forbidden');
        if ((child.nodeType === 3 || child.nodeType === 4) && child.textContent?.trim() && !['title', 'desc'].includes(tag)) throw new Error('Text is allowed only in title and desc');
        if (child.nodeType === 1 && ['title', 'desc'].includes(tag)) throw new Error('Title and desc must contain plain text');
      }
    }
    for (const node of document.childNodes) if (node.nodeType === 7 || node.nodeType === 10) throw new Error('XML processing instructions are forbidden');
    for (const target of references.values()) if (!ids.has(target)) throw new Error(`Missing local reference: ${literal(target)}`);
    const visiting = new Set<Element>();
    const visited = new Set<Element>();
    const visit = (element: Element, depth: number): void => {
      if (visiting.has(element)) throw new Error('Cyclic local SVG reference');
      if (depth > 128) throw new Error('SVG reference depth limit exceeded');
      if (visited.has(element)) return;
      visiting.add(element);
      for (const child of element.children) visit(child, depth + 1);
      const target = references.get(element);
      if (target) visit(ids.get(target)!, depth + 1);
      visiting.delete(element); visited.add(element);
    };
    visit(root, 0);
    const roots = new Map([...definitions, ...symbolElements]);
    const dependencies = new Map<string, Set<string>>();
    for (const [key, element] of roots) {
      const needed = new Set<string>();
      const seen = new Set<Element>();
      const collect = (node: Element): void => {
        if (seen.has(node)) return;
        seen.add(node);
        const owner = owners.get(node);
        if (owner && owner !== key) needed.add(owner);
        for (const child of node.children) collect(child);
        const target = references.get(node);
        if (target) collect(ids.get(target)!);
      };
      collect(element);
      dependencies.set(key, needed);
    }
    return {
      keys: [...symbolElements.keys()].sort(compare),
      symbols: new Map([...symbolElements].map(([id, element]) => [id, element.outerHTML])),
      definitions: new Map([...definitions].map(([id, element]) => [id, element.outerHTML])),
      dependencies,
    };
  } catch (error) {
    throw new Error(`Invalid sprite: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally { dom?.window.close(); }
}
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
// JSON.stringify reorders integer-like object keys. Serialize entries explicitly so
// numeric symbol IDs obey the same code-unit ordering as types and sprite symbols.
function orderedJson(value: JsonValue, depth = 0): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => orderedJson(item, depth)).join(', ')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => compare(a, b));
  if (!entries.length) return '{}';
  const indent = '  '.repeat(depth);
  return `{\n${entries.map(([key, item]) => `${indent}  ${literal(key)}: ${orderedJson(item, depth + 1)}`).join(',\n')}\n${indent}}`;
}
function artifacts(keys: readonly string[]): { types: string; schema: string } {
  const types = `// Generated from caller-owned SVG symbols.\nexport type IconKey = ${keys.length ? keys.map(literal).join(' | ') : 'never'};\n`;
  const schema = orderedJson({
    $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'SVG symbol selection', type: 'object',
    additionalProperties: false, required: ['keys'], properties: {
      $schema: { type: 'string' }, keys: { type: 'object', additionalProperties: false,
        properties: Object.fromEntries(keys.map((id) => [id, { type: 'boolean' }])) },
    },
  }) + '\n';
  return { types, schema };
}
async function readInput(path: string): Promise<string> {
  await requireFile(path);
  if ((await stat(path)).size > MAX_BYTES) throw new Error(`Input exceeds 2 MiB limit: ${path}`);
  const content = await readFile(path, 'utf8');
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error(`Input exceeds 2 MiB limit: ${path}`);
  return content;
}
function selectionKeys(raw: string, available: readonly string[]): string[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) { throw new Error('Invalid selection JSON', { cause: error }); }
  if (!isRecord(value) || !isRecord(value.keys)) throw new Error('Selection must contain a keys object');
  if (Object.keys(value).some((key) => key !== 'keys' && key !== '$schema')) throw new Error('Unknown selection property');
  if ('$schema' in value && typeof value.$schema !== 'string') throw new Error('Selection $schema must be a string');
  const selected: string[] = [];
  for (const [key, enabled] of Object.entries(value.keys)) {
    if (typeof enabled !== 'boolean') throw new Error(`Selection value must be boolean: ${literal(key)}`);
    if (!available.includes(key)) throw new Error(`Unknown symbol in selection: ${literal(key)}`);
    if (enabled) selected.push(key);
  }
  return selected.sort(compare);
}
async function writeFiles(config: IconsConfig, files: [string, string][], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await validateOutputs(config);
  const staged: { temp: string; target: string }[] = [];
  try {
    for (const [target, content] of files) {
      try { if (await readFile(target, 'utf8') === content) continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.tmp`;
      const file = await open(temp, 'wx', 0o644);
      staged.push({ temp, target });
      try { await file.writeFile(content, 'utf8'); } finally { await file.close(); }
    }
    await validateOutputs(config);
    for (const { temp, target } of staged) { signal?.throwIfAborted(); await rename(temp, target); }
    signal?.throwIfAborted();
  } finally { await Promise.all(staged.map(({ temp }) => rm(temp, { force: true }))); }
}
/** An instance serializes all sync/build calls and remains usable after an error. */
export class Icons {
  readonly config: Readonly<IconsConfig>;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(config: IconsConfig) { this.config = normalizeConfig(config); }
  #enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.#tail.then(action);
    this.#tail = task.catch(() => undefined);
    return task;
  }
  /** Generate the full available-key union and schema without reading selection. */
  sync(): Promise<SyncResult> {
    return this.#enqueue(async () => {
      const { keys } = parseSprite(await readInput(this.config.source));
      const { types, schema } = artifacts(keys);
      await writeFiles(this.config, [[this.config.types, types], [this.config.schema, schema]]);
      return { keys };
    });
  }
  /** Validate inputs before writing a selected sprite, full-key union and schema. */
  build(options: BuildOptions = {}): Promise<BuildResult> {
    return this.#enqueue(async () => {
      options.signal?.throwIfAborted();
      const parsed = parseSprite(await readInput(this.config.source));
      const selected = selectionKeys(await readInput(this.config.selection), parsed.keys);
      const needed = new Set(selected);
      for (const key of needed) for (const dependency of parsed.dependencies.get(key)!) needed.add(dependency);
      const included = [...needed].filter((key) => parsed.symbols.has(key)).sort(compare);
      const definitions = [...needed].filter((key) => parsed.definitions.has(key)).sort(compare).map((key) => parsed.definitions.get(key)!).join('');
      const raw = `<svg xmlns="${SVG}"><defs>${definitions}${included.map((key) => parsed.symbols.get(key)!).join('')}</defs></svg>`;
      // Minimal explicit list: never clean IDs, remove viewBoxes, or inline use.
      const svg = optimize(raw, { plugins: ['removeComments'], multipass: false }).data + '\n';
      const { types, schema } = artifacts(parsed.keys);
      await writeFiles(this.config, [[this.config.output, svg], [this.config.types, types], [this.config.schema, schema]], options.signal);
      return { keys: parsed.keys, selected, included, svg, bytes: Buffer.byteLength(svg) };
    });
  }
}
