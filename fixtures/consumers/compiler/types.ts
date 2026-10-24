import { Icons, type IconsConfig, type BuildResult, type BuildOptions, type SyncResult } from '@frankfmy/svg-sprite-toolkit';
import { Icons as Compiler } from '@frankfmy/svg-sprite-toolkit/compiler';
import type { IconKey } from './generated/keys.js';
const config: IconsConfig = { source:'s',selection:'c',output:'o',types:'t',schema:'j' };
const options: BuildOptions = { signal: new AbortController().signal };
const build: Promise<BuildResult> = new Icons(config).build(options);
const sync: Promise<SyncResult> = new Compiler(config).sync();
const key: IconKey = 'circle';
// @ts-expect-error unknown key must not typecheck
const badKey: IconKey = 'missing';
// @ts-expect-error explicit source path is required
new Icons({ selection:'c',output:'o',types:'t',schema:'j' });
// @ts-expect-error unknown option must not typecheck
new Icons({ ...config, unknown: true });
void [build,sync,key,badKey];
