import { access, lstat, realpath, stat } from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';

/** All paths belong to the caller. Relative paths resolve against the current directory. */
export interface IconsConfig {
  source: string;
  selection: string;
  output: string;
  types: string;
  schema: string;
}
const fields = ['source', 'selection', 'output', 'types', 'schema'] as const;
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export function normalizeConfig(value: unknown, root = process.cwd()): Readonly<IconsConfig> {
  if (!isRecord(value)) throw new Error('Compiler config must be an object');
  for (const key of Object.keys(value)) {
    if (!(fields as readonly string[]).includes(key)) throw new Error(`Unknown compiler option: ${key}`);
  }
  const entries = fields.map((key) => {
    const path = value[key];
    // eslint-disable-next-line no-control-regex -- Reject control characters in filesystem paths.
    if (typeof path !== 'string' || !path.trim() || /[\x00-\x1f\x7f]/u.test(path) || /[/\\]$/u.test(path)) {
      throw new Error(`Invalid ${key} path`);
    }
    return [key, resolve(root, path)] as const;
  });
  if (new Set(entries.map(([, path]) => path)).size !== fields.length) {
    throw new Error('Source, selection and output paths must all be distinct');
  }
  return Object.freeze(Object.fromEntries(entries) as unknown as IconsConfig);
}
function outsideDependencies(path: string): void {
  if (path.split(/[/\\]/u).some((part) => part.toLowerCase() === 'node_modules')) {
    throw new Error(`Output path must not be inside node_modules: ${path}`);
  }
}
/** Reject symlinks and multiply linked files before creating or replacing any output. */
export async function validateOutputs(config: IconsConfig): Promise<void> {
  for (const path of [config.output, config.types, config.schema]) {
    outsideDependencies(path);
    let current = parse(path).root;
    for (const part of path.slice(current.length).split(sep)) {
      current = resolve(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error(`Output path must not contain symlinks: ${current}`);
        if (current === path) {
          if (!info.isFile() || info.nlink !== 1) throw new Error(`Output must be a regular, singly linked file: ${path}`);
        } else if (!info.isDirectory()) throw new Error(`Output parent must be a directory: ${current}`);
        outsideDependencies(await realpath(current));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
  }
  for (const input of [config.source, config.selection]) {
    try {
      const actual = await realpath(input);
      for (const output of [config.output, config.types, config.schema]) {
        if (actual === output) throw new Error('An output aliases an input file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export async function requireFile(path: string): Promise<void> {
  try {
    await access(path);
    if (!(await stat(path)).isFile()) throw new Error('Not a regular file');
  } catch (error) { throw new Error(`Cannot read input file ${path}`, { cause: error }); }
}
