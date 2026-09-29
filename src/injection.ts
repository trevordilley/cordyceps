import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DefinitionError, forEachTemplate, parseDefinition, selectRecipe, tokens } from './manifest.js';
import type { HarnessDefinition, JsonValue } from './manifest.js';

export type InjectionInputs = Record<string, string>;
export type Environment = Record<string, string | undefined>;
export interface GeneratedConfigFile { id: string; path: string; format: 'json' | 'toml' }
export interface RenderedInjection {
  environment(base: Environment): Environment;
  args: string[];
  configFiles: GeneratedConfigFile[];
  dispose(): Promise<void>;
}
function inputSnapshot(inputs: InjectionInputs, id: string): InjectionInputs {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(inputs)))
    throw new DefinitionError('INVALID_INPUT', id, '$.inputs', 'expected a plain string map');
  const result: InjectionInputs = Object.create(null);
  if (Object.getOwnPropertySymbols(inputs).length) throw new DefinitionError('INVALID_INPUT', id, '$.inputs', 'symbol keys are not allowed');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(inputs))) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' || descriptor.value.includes('\0') ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(descriptor.value))
      throw new DefinitionError('INVALID_INPUT', id, `$.inputs[${JSON.stringify(key)}]`, 'expected a named, valid Unicode string without NUL');
    result[key] = descriptor.value;
  }
  return result;
}
function validateInputs(definition: HarnessDefinition, mode: string, inputs: InjectionInputs) {
  selectRecipe(definition, mode);
  forEachTemplate(definition, mode, (value, field) => {
    for (const token of tokens(value, definition.id, field)) if (token.startsWith('input.') && !Object.hasOwn(inputs, token.slice(6)))
      throw new DefinitionError('MISSING_INPUT', definition.id, field, `required input ${JSON.stringify(token.slice(6))} is absent`);
  });
}
/** Run this before allocating a listener or filesystem resources. */
export function validateSelection(definition: HarnessDefinition, mode = 'interactive', inputs: InjectionInputs = {}): void {
  const snapshot = parseDefinition(definition);
  validateInputs(snapshot, mode, inputSnapshot(inputs, snapshot.id));
}
function substitute(value: string, replacements: Record<string, string>): string {
  // A single pass: caller inputs remain opaque even when they contain token-looking text.
  return value.replace(/\$\{([^}]+)\}/g, (_, token: string) => replacements[token]!);
}
function renderValue(value: JsonValue, replacements: Record<string, string>): JsonValue {
  if (typeof value === 'string') return substitute(value, replacements);
  if (Array.isArray(value)) return value.map(entry => renderValue(entry, replacements));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renderValue(entry, replacements)]));
  return value;
}
// JSON strings use TOML basic-string escapes too, except DEL which TOML requires escaped.
const quote = (value: string): string => JSON.stringify(value).replace(/\u007f/g, '\\u007f');
function tomlValue(value: JsonValue): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (Object.is(value, -0)) return '-0.0';
    // Unsafe JS integers are encoded as floats, never out-of-range TOML integers.
    return Number.isInteger(value) && !Number.isSafeInteger(value) ? value.toExponential() : String(value);
  }
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([key, entry]) => `${quote(key)} = ${tomlValue(entry)}`).join(', ')} }`;
  throw new TypeError('TOML has no null value');
}
function serialize(format: 'json' | 'toml', value: JsonValue): string {
  if (format === 'json') return `${JSON.stringify(value, null, 2)}\n`;
  return `${Object.entries(value as Record<string, JsonValue>).map(([key, entry]) => `${quote(key)} = ${tomlValue(entry)}`).join('\n')}\n`;
}
/** Creates isolated files only; never inspects or starts a consumer's executable. */
export async function renderInjection(definition: HarnessDefinition, mode: string, inputs: InjectionInputs,
  endpoint: { baseUrl: string; apiKey: string }, signal?: AbortSignal): Promise<RenderedInjection> {
  signal?.throwIfAborted();
  const snapshot = parseDefinition(definition);
  const values = inputSnapshot(inputs, snapshot.id);
  validateInputs(snapshot, mode, values);
  const recipe = selectRecipe(snapshot, mode);
  const mock = inputSnapshot(endpoint, snapshot.id);
  if (typeof mock.baseUrl !== 'string' || typeof mock.apiKey !== 'string')
    throw new DefinitionError('INVALID_INPUT', snapshot.id, '$.mock', 'baseUrl and apiKey are required strings');
  let directory: string | undefined;
  let disposing: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (!disposing) disposing = (directory ? fs.rm(directory, { recursive: true, force: true }) : Promise.resolve())
      .catch(error => { disposing = undefined; throw error; });
    return disposing;
  };
  try {
    // The directory also supports session.dir recipes with no declared config files.
    directory = await fs.mkdtemp(join(tmpdir(), 'cordyceps-'));
    signal?.throwIfAborted();
    const configFiles = recipe.configFiles.map(file => ({ id: file.id, path: join(directory!, file.path), format: file.format }));
    const replacements: Record<string, string> = Object.create(null);
    replacements['mock.baseUrl'] = mock.baseUrl;
    replacements['mock.apiKey'] = mock.apiKey;
    replacements['session.dir'] = directory;
    for (const file of configFiles) replacements[`config.${file.id}.path`] = file.path;
    for (const [key, value] of Object.entries(values)) replacements[`input.${key}`] = value;
    const env = Object.fromEntries(Object.entries(recipe.env).map(([key, value]) => [key, substitute(value, replacements)]));
    const args = recipe.args.map(value => substitute(value, replacements));
    for (const [index, file] of recipe.configFiles.entries()) {
      const target = configFiles[index]!.path;
      await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
      signal?.throwIfAborted();
      await fs.writeFile(target, serialize(file.format, renderValue(file.values, replacements)), { encoding: 'utf8', flag: 'wx', mode: 0o600, ...(signal ? { signal } : {}) });
      signal?.throwIfAborted();
    }
    signal?.throwIfAborted();
    return {
      environment(base) {
        const result = { ...base };
        for (const key of recipe.unsetEnv) delete result[key];
        // Object spread preserves even a literal __proto__ variable as data.
        return { ...result, ...env };
      },
      args, configFiles, dispose,
    };
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Injection failed and owned-directory rollback failed'); }
    throw error;
  }
}
