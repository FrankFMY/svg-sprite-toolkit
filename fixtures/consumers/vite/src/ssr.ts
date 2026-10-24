import { render } from 'svelte/server';
import Icon from '@frankfmy/svg-sprite-toolkit/Icon.svelte';
export const html = render(Icon,{props:{key:'circle',spriteUrl:'/demo/assets/icons.svg',title:'Circle',width:24,height:24}}).body;
