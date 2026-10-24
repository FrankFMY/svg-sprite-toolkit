import Icon, { type IconProps } from '@frankfmy/svg-sprite-toolkit/Icon.svelte';
import type { ComponentProps } from 'svelte';
import type { IconKey } from './generated/icon-keys.js';
import { spriteUrl } from 'virtual:svg-sprite';
const key: IconKey='circle';
const good: IconProps={key,spriteUrl,width:24,title:'Circle'};
const component: ComponentProps<typeof Icon>=good;
// @ts-expect-error unknown key is rejected by generated types
const missing: IconKey='missing';
// @ts-expect-error spriteUrl is required
const noUrl: ComponentProps<typeof Icon>={key};
// @ts-expect-error width is a string or number
const invalidWidth: IconProps={key,spriteUrl,width:true};
// @ts-expect-error key is a string
const invalidKey: IconProps={key:1,spriteUrl};
void [component,missing,noUrl,invalidWidth,invalidKey];
