import type { Component } from 'svelte';

export interface IconProps {
  key: string;
  /** A same-origin sprite URL without a fragment. */
  spriteUrl: string;
  title?: string;
  class?: string;
  style?: string;
  width?: number | string;
  height?: number | string;
}
declare const Icon: Component<IconProps>;
export default Icon;
