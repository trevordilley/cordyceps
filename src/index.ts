import { prepare } from './session.js';
import { createRegistry } from './registry.js';

export { prepare, createRegistry };
export { DefinitionError } from './manifest.js';
export { getCodec, codecIds } from './provider/index.js';
export type * from './provider/types.js';
export type * from './session.js';
export type * from './registry.js';
export type * from './manifest.js';
export type * from './injection.js';
export type * from './observations.js';

/** Standalone entry point. No Playwright import or executable lifecycle. */
export const cordyceps = { prepare, createRegistry };
