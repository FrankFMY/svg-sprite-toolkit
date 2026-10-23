import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const root = resolve('.');
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const packages = new Map();
async function visit(name, from) {
  const require = createRequire(resolve(from, 'package.json'));
  let entry;
  try { entry = require.resolve(`${name}/package.json`); }
  catch { entry = require.resolve(name); }
  let directory = dirname(entry);
  let metadata;
  while (directory.startsWith(root)) {
    try { metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (metadata?.name === name) break;
    directory = dirname(directory); metadata = undefined;
  }
  if (!metadata || metadata.name !== name) throw new Error(`Cannot resolve local dependency ${name}`);
  const key = `${name}@${metadata.version}`;
  if (packages.has(key)) return;
  const licenses = (await readdir(directory)).filter((file) => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/iu.test(file)).sort();
  if (!licenses.length && !metadata.license) throw new Error(`No license information for ${key}`);
  if (!licenses.length) console.log(`${key}: distribution declares ${metadata.license}; no separate license text is shipped.`);
  const texts = await Promise.all(licenses.map(async (file) => `### ${file}\n\n\`\`\`text\n${(await readFile(resolve(directory, file), 'utf8')).trim()}\n\`\`\`\n`));
  packages.set(key, `## ${key}\n\nDeclared license: ${metadata.license ?? 'See license text'}.\n\n${texts.length ? texts.join('\n') : 'The upstream package distribution declares this license in package.json but ships no separate license text. Dependency code is not bundled in this toolkit tarball.\n'}`);
  for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) await visit(dependency, directory);
}
for (const name of Object.keys(manifest.dependencies).sort()) await visit(name, root);
const text = '# Third-party notices\n\nThe toolkit is MIT licensed. Dependencies are installed separately and retain their own licenses. The following notices reproduce all available license files and identify metadata-only declarations from the runtime dependency versions resolved by package-lock.json. No artwork is distributed with the toolkit.\n\n' + [...packages.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, text]) => text).join('\n');
await writeFile('THIRD_PARTY_NOTICES.md', text.replace(/\r\n/g, '\n'));
console.log(`Recorded full distributed license texts for ${packages.size} runtime dependency packages.`);
