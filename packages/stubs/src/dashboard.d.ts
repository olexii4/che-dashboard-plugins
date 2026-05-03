/*
 * Ambient type stubs for Eclipse Che Dashboard internals (@/*).
 * These allow plugins to be type-checked standalone without the full dashboard source tree.
 * When plugins run inside the dashboard, these are replaced by the real implementations.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module '@/*' {
  const value: any;
  export = value;
}
