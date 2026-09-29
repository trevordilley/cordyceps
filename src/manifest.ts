import { codecIds } from './provider/index.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ConfigFileDefinition {
  id: string;
  path: string;
  format: 'json' | 'toml';
  values: { [key: string]: JsonValue };
}
export interface InjectionRecipe {
  env?: Record<string, string>;
  unsetEnv?: string[];
  args?: string[];
  configFiles?: ConfigFileDefinition[];
}
export interface HarnessDefinition {
  schemaVersion: 1;
  id: string;
  provider: { adapter: string; override: InjectionRecipe };
  modes: Record<string, InjectionRecipe>;
}
export type DefinitionErrorCode = 'INVALID_DEFINITION' | 'DUPLICATE_ID' | 'DEFINITION_NOT_FOUND'
  | 'CODEC_NOT_FOUND' | 'RECIPE_NOT_FOUND' | 'UNKNOWN_TOKEN' | 'MISSING_INPUT'
  | 'INVALID_INPUT' | 'INJECTION_CONFLICT' | 'INVALID_JSON';
export class DefinitionError extends Error {
  constructor(public readonly code: DefinitionErrorCode, public readonly definitionId: string,
    public readonly field: string, detail: string, options?: ErrorOptions) {
    super(`${code}: definition ${JSON.stringify(definitionId)} at ${field}: ${detail}`, options);
    this.name = 'DefinitionError';
  }
}
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const at = (parent: string, key: string | number) => `${parent}[${JSON.stringify(key)}]`;
function fail(id: string, field: string, detail: string, code: DefinitionErrorCode = 'INVALID_DEFINITION'): never {
  throw new DefinitionError(code, id, field, detail);
}
function object(value: unknown, id: string, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(id, field, 'expected a plain JSON object');
}
function fields(value: Record<string, unknown>, allowed: string[], required: string[], id: string, field: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(id, at(field, key), 'unknown field');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(id, at(field, key), 'required field');
}
function string(value: unknown, id: string, field: string): asserts value is string {
  if (typeof value !== 'string') fail(id, field, 'expected a string');
  if (value.includes('\0')) fail(id, field, 'NUL is not allowed');
  // Reject unpaired surrogates rather than silently changing file data on UTF-8 encoding.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
    fail(id, field, 'expected valid Unicode');
}
function named(value: unknown, id: string, field: string) {
  string(value, id, field);
  if (!identifier.test(value)) fail(id, field, 'expected letters, digits, underscores or hyphens, starting with a letter or digit');
}
/** Clone data without invoking getters/toJSON, accepting only finite, acyclic JSON values. */
function json(value: unknown, id: string, field: string, ancestors = new Set<object>(), depth = 0): JsonValue {
  if (depth > 64) fail(id, field, 'maximum nesting depth is 64');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { string(value, id, field); return value; }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') fail(id, field, 'expected a finite JSON value');
  if (ancestors.has(value)) fail(id, field, 'cyclic data is not allowed');
  if (!Array.isArray(value)) object(value, id, field);
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length) fail(id, field, 'symbol keys are not JSON');
  const result: JsonValue[] | Record<string, JsonValue> = Array.isArray(value) ? [] : Object.create(null);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(descriptors, i)) fail(id, at(field, i), 'sparse arrays are not JSON');
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(id, at(field, key), 'expected enumerable data property');
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) fail(id, at(field, key), 'unexpected array property');
    string(key, id, at(field, key));
    Object.defineProperty(result, key, { value: json(descriptor.value, id, at(field, key), ancestors, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  ancestors.delete(value);
  return result;
}
export function tokens(value: string, id: string, field: string): string[] {
  const found: string[] = [];
  let offset = 0;
  while ((offset = value.indexOf('${', offset)) !== -1) {
    const end = value.indexOf('}', offset + 2);
    const token = end === -1 ? '' : value.slice(offset + 2, end);
    if (!/^(mock\.(baseUrl|apiKey)|session\.dir|config\.[A-Za-z0-9][A-Za-z0-9_-]*\.path|input\.[A-Za-z0-9][A-Za-z0-9_-]*)$/.test(token))
      fail(id, field, 'unknown or malformed substitution token', 'UNKNOWN_TOKEN');
    found.push(token);
    offset = end + 1;
  }
  return found;
}
export function visitStrings(value: JsonValue, field: string, visit: (value: string, field: string) => void): void {
  if (typeof value === 'string') visit(value, field);
  else if (Array.isArray(value)) value.forEach((entry, index) => visitStrings(entry, at(field, index), visit));
  else if (value && typeof value === 'object')
    for (const [key, entry] of Object.entries(value)) visitStrings(entry, at(field, key), visit);
}
function recipe(value: unknown, id: string, field: string) {
  object(value, id, field);
  fields(value, ['env', 'unsetEnv', 'args', 'configFiles'], [], id, field);
  if (Object.hasOwn(value, 'env')) {
    object(value.env, id, `${field}.env`);
    for (const [key, entry] of Object.entries(value.env)) {
      if (!envName.test(key)) fail(id, at(`${field}.env`, key), 'invalid environment variable name');
      string(entry, id, at(`${field}.env`, key));
    }
  }
  for (const key of ['unsetEnv', 'args'] as const) if (Object.hasOwn(value, key)) {
    const entries = value[key];
    if (!Array.isArray(entries)) fail(id, `${field}.${key}`, 'expected an array');
    entries.forEach((entry, index) => {
      string(entry, id, at(`${field}.${key}`, index));
      if (key === 'unsetEnv' && !envName.test(entry)) fail(id, at(`${field}.${key}`, index), 'invalid environment variable name');
    });
  }
  if (Object.hasOwn(value, 'configFiles')) {
    if (!Array.isArray(value.configFiles)) fail(id, `${field}.configFiles`, 'expected an array');
    value.configFiles.forEach((file, index) => {
      const path = at(`${field}.configFiles`, index);
      object(file, id, path);
      fields(file, ['id', 'path', 'format', 'values'], ['id', 'path', 'format', 'values'], id, path);
      named(file.id, id, `${path}.id`);
      string(file.path, id, `${path}.path`);
      // Portable, static paths only: no traversal, absolute paths, aliases or filesystem-specific names.
      if (!file.path || file.path.split('/').some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)))
        fail(id, `${path}.path`, 'expected a portable session-relative file path without traversal or tokens');
      if (file.format !== 'json' && file.format !== 'toml') fail(id, `${path}.format`, 'expected json or toml');
      object(file.values, id, `${path}.values`);
      if (file.format === 'toml') {
        const check = (entry: unknown, location: string): void => {
          if (entry === null) fail(id, location, 'TOML has no null value');
          if (typeof entry === 'object') for (const [key, child] of Object.entries(entry!)) check(child, at(location, key));
        };
        check(file.values, `${path}.values`);
      }
    });
  }
}
export interface SelectedRecipe { env: Record<string, string>; unsetEnv: string[]; args: string[]; configFiles: ConfigFileDefinition[] }
/** Conflicts describe declarations, not arbitrary consumer flags or effective harness settings. */
export function selectRecipe(definition: HarnessDefinition, mode: string): SelectedRecipe {
  const id = definition.id;
  if (!Object.hasOwn(definition.modes, mode)) fail(id, at('$.modes', mode), 'requested recipe is absent; no mode fallback', 'RECIPE_NOT_FOUND');
  const result: SelectedRecipe = { env: Object.create(null), unsetEnv: [], args: [], configFiles: [] };
  const assigned = new Map<string, string>();
  const removed = new Set<string>();
  for (const [source, entry] of [['$.provider.override', definition.provider.override], [at('$.modes', mode), definition.modes[mode]!]] as const) {
    for (const [key, value] of Object.entries(entry.env ?? {})) {
      if (assigned.has(key) || removed.has(key)) fail(id, at(`${source}.env`, key), 'environment variable has more than one declaration', 'INJECTION_CONFLICT');
      assigned.set(key, source);
      result.env[key] = value;
    }
    for (const [index, key] of (entry.unsetEnv ?? []).entries()) {
      if (assigned.has(key)) fail(id, at(`${source}.unsetEnv`, index), 'environment variable is both assigned and removed', 'INJECTION_CONFLICT');
      removed.add(key);
    }
    result.args.push(...entry.args ?? []);
    for (const [index, file] of (entry.configFiles ?? []).entries()) {
      const normalized = file.path.toLowerCase();
      for (const existing of result.configFiles) {
        const previous = existing.path.toLowerCase();
        if (existing.id === file.id || previous === normalized || previous.startsWith(`${normalized}/`) || normalized.startsWith(`${previous}/`))
          fail(id, at(`${source}.configFiles`, index), 'duplicate file ID or overlapping file paths', 'INJECTION_CONFLICT');
      }
      result.configFiles.push(file);
    }
  }
  result.unsetEnv = [...removed];
  const fileIds = new Set(result.configFiles.map(file => file.id));
  forEachTemplate(definition, mode, (value, field) => {
    for (const token of tokens(value, id, field)) if (token.startsWith('config.') && !fileIds.has(token.slice(7, -5)))
      fail(id, field, 'token references a config file absent from this mode', 'UNKNOWN_TOKEN');
  });
  return result;
}
export function forEachTemplate(definition: HarnessDefinition, mode: string, visit: (value: string, field: string) => void) {
  for (const [source, entry] of [['$.provider.override', definition.provider.override], [at('$.modes', mode), definition.modes[mode]!]] as const) {
    for (const [key, value] of Object.entries(entry.env ?? {})) visit(value, at(`${source}.env`, key));
    (entry.args ?? []).forEach((value, i) => visit(value, at(`${source}.args`, i)));
    (entry.configFiles ?? []).forEach((file, i) => visitStrings(file.values, `${source}.configFiles[${i}].values`, visit));
  }
}
/** Validate and capture an independent JSON snapshot. No filesystem or process inspection. */
export function parseDefinition(value: unknown): HarnessDefinition {
  const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'id') : undefined;
  const id = typeof descriptor?.value === 'string' ? descriptor.value : '<unknown>';
  const data = json(value, id, '$');
  object(data, id, '$');
  fields(data, ['schemaVersion', 'id', 'provider', 'modes'], ['schemaVersion', 'id', 'provider', 'modes'], id, '$');
  if (data.schemaVersion !== 1) fail(id, '$.schemaVersion', 'expected schemaVersion 1');
  named(data.id, id, '$.id');
  object(data.provider, id, '$.provider');
  fields(data.provider, ['adapter', 'override'], ['adapter', 'override'], id, '$.provider');
  string(data.provider.adapter, id, '$.provider.adapter');
  if (!(codecIds as readonly string[]).includes(data.provider.adapter)) fail(id, '$.provider.adapter', 'provider codec is not registered', 'CODEC_NOT_FOUND');
  recipe(data.provider.override, id, '$.provider.override');
  object(data.modes, id, '$.modes');
  if (!Object.keys(data.modes).length) fail(id, '$.modes', 'expected at least one mode');
  for (const [mode, entry] of Object.entries(data.modes)) { named(mode, id, at('$.modes', mode)); recipe(entry, id, at('$.modes', mode)); }
  const definition = data as unknown as HarnessDefinition;
  for (const mode of Object.keys(definition.modes)) selectRecipe(definition, mode);
  return definition;
}
