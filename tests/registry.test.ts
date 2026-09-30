import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRegistry } from '../src/registry.js';
import { DefinitionError, parseDefinition } from '../src/manifest.js';
import type { HarnessDefinition, InjectionRecipe } from '../src/manifest.js';
import { renderInjection, validateSelection } from '../src/injection.js';

const endpoint = { baseUrl: 'http://127.0.0.1:12345', apiKey: 'local-test-key' };
const definition = (override: InjectionRecipe = {}, modes: Record<string, InjectionRecipe> = { interactive: {} }): HarnessDefinition =>
  ({ schemaVersion: 1, id: 'fixture', provider: { adapter: 'anthropic-messages', override }, modes });
const pending: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of pending.splice(0).reverse()) await dispose(); });
function error(fn: () => unknown, code: string, field?: string) {
  try { fn(); throw new Error('Expected a definition error'); }
  catch (caught) {
    expect(caught).toBeInstanceOf(DefinitionError);
    expect((caught as DefinitionError).code).toBe(code);
    if (field) expect((caught as DefinitionError).field).toContain(field);
    expect((caught as Error).message).toContain((caught as DefinitionError).definitionId);
  }
}
async function render(value: HarnessDefinition, mode = 'interactive', inputs = {}) {
  const output = await renderInjection(value, mode, inputs, endpoint);
  pending.push(output.dispose);
  return output;
}

describe('registry snapshots and diagnostics', () => {
  test('register/get/list snapshots cannot mutate registered definitions', () => {
    const registry = createRegistry({ builtins: false });
    const value = definition({ env: { URL: '${mock.baseUrl}' } });
    registry.register(value);
    value.provider.override.env!.URL = 'changed';
    registry.get('fixture').provider.override.env!.URL = 'changed again';
    registry.list()[0]!.modes.interactive!.args = ['changed'];
    expect(registry.get('fixture').provider.override.env!.URL).toBe('${mock.baseUrl}');
    expect(registry.get('fixture').modes.interactive!.args).toBeUndefined();
    error(() => registry.register(definition()), 'DUPLICATE_ID', '$.id');
    error(() => registry.get('missing'), 'DEFINITION_NOT_FOUND');
    expect(registry.list()).toHaveLength(1);
  });
  test('loads local JSON through the same validator and does not replace a duplicate', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'registry-fixture-'));
    pending.push(() => fs.rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'local.json');
    await fs.writeFile(path, JSON.stringify(definition()));
    const registry = createRegistry({ builtins: false });
    await registry.loadFile(path);
    await expect(registry.loadFile(path)).rejects.toMatchObject({ code: 'DUPLICATE_ID' });
    await fs.writeFile(path, '{broken');
    await expect(registry.loadFile(path)).rejects.toMatchObject({ code: 'INVALID_JSON', field: '$' });
    await fs.writeFile(path, JSON.stringify({ ...definition(), executable: 'forbidden' }));
    await expect(registry.loadFile(path)).rejects.toMatchObject({ code: 'INVALID_DEFINITION', field: '$["executable"]' });
  });
  test.each([
    ['schema', { ...definition(), schemaVersion: 2 }, 'INVALID_DEFINITION', 'schemaVersion'],
    ['unknown field', { ...definition(), command: 'not a runner' }, 'INVALID_DEFINITION', 'command'],
    ['unknown recipe field', definition({}, { interactive: { binary: 'not supported' } as InjectionRecipe }), 'INVALID_DEFINITION', 'binary'],
    ['missing codec', { ...definition(), provider: { adapter: 'absent', override: {} } }, 'CODEC_NOT_FOUND', 'adapter'],
    ['empty modes', definition({}, {}), 'INVALID_DEFINITION', 'modes'],
    ['bad env value', definition({ env: { X: 1 as unknown as string } }), 'INVALID_DEFINITION', 'env'],
    ['bad env name', definition({ env: { 'A=B': 'x' } }), 'INVALID_DEFINITION', 'env'],
    ['null args', definition({ args: null as unknown as string[] }), 'INVALID_DEFINITION', 'args'],
    ['unknown token', definition({ args: ['${process.env.HOME}'] }), 'UNKNOWN_TOKEN', 'args'],
    ['malformed token', definition({ args: ['${mock.baseUrl'] }), 'UNKNOWN_TOKEN', 'args'],
    ['missing config', definition({ args: ['${config.absent.path}'] }), 'UNKNOWN_TOKEN', 'args'],
  ])('%s', (_name, value, code, field) => error(() => parseDefinition(value), code as string, field as string));
  test('rejects non-JSON input without executing getters or toJSON', () => {
    let called = false;
    const value = definition();
    Object.defineProperty(value, 'id', { get: () => { called = true; return 'bad'; }, enumerable: true });
    error(() => parseDefinition(value), 'INVALID_DEFINITION', 'id');
    expect(called).toBe(false);
    error(() => parseDefinition({ ...definition(), toJSON() { throw new Error('must not run'); } }), 'INVALID_DEFINITION');
    const cyclic: Record<string, unknown> = {};
    cyclic.loop = cyclic;
    error(() => parseDefinition({ ...definition(), cyclic }), 'INVALID_DEFINITION', 'loop');
    for (const bad of [Infinity, NaN, undefined, 2n, new Date(), () => 1]) {
      error(() => parseDefinition({ ...definition(), bad }), 'INVALID_DEFINITION', 'bad');
    }
    error(() => parseDefinition(definition({ args: new Array(2) })), 'INVALID_DEFINITION', 'args');
  });
});

describe('preallocation validation', () => {
  test('mode and input lookup use own properties and never fallback', () => {
    error(() => validateSelection(definition(), 'acp'), 'RECIPE_NOT_FOUND', 'acp');
    error(() => validateSelection(definition(), 'toString'), 'RECIPE_NOT_FOUND');
    const value = definition({ args: ['${input.toString}'] });
    error(() => validateSelection(value), 'MISSING_INPUT', 'args');
    validateSelection(value, 'interactive', { toString: 'literal' });
    error(() => validateSelection(value, 'interactive', { toString: 3 as unknown as string }), 'INVALID_INPUT');
    validateSelection(definition({}, { acp: { args: ['${input.harnessPath}'] } }), 'acp', { harnessPath: '/opaque/not-inspected' });
  });
  test.each([
    ['same env twice', { env: { X: 'one' } }, { env: { X: 'one' } }],
    ['different env', { env: { X: 'one' } }, { env: { X: 'two' } }],
    ['set then remove', { env: { X: 'one' } }, { unsetEnv: ['X'] }],
    ['remove then set', { unsetEnv: ['X'] }, { env: { X: 'one' } }],
    ['same recipe set/remove', { env: { X: 'one' }, unsetEnv: ['X'] }, {}],
  ])('%s conflicts', (_name, common, mode) => error(() => parseDefinition(definition(common as InjectionRecipe, { interactive: mode as InjectionRecipe })), 'INJECTION_CONFLICT'));
  const file = (path: string, id = 'config') => ({ id, path, format: 'json' as const, values: {} });
  test.each(['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a//b', './a', 'a/../b', '${input.path}', 'trailing.', 'CON.txt'])('rejects unsafe file path %s', path => {
    error(() => parseDefinition(definition({ configFiles: [file(path)] })), 'INVALID_DEFINITION', 'path');
  });
  test.each([
    ['a.json', 'a.json', 'other'], ['a.json', 'A.JSON', 'other'], ['a', 'a/b', 'other'], ['a/b', 'a', 'other'], ['a', 'b', 'config'],
  ])('rejects overlapping files %s/%s', (first, second, id) => {
    error(() => parseDefinition(definition({ configFiles: [file(first)] }, { interactive: { configFiles: [file(second, id)] } })), 'INJECTION_CONFLICT');
  });
  test('rejects TOML null recursively and malformed JSON values', () => {
    error(() => parseDefinition(definition({ configFiles: [{ ...file('a.toml'), format: 'toml', values: { nested: [{ absent: null }] } }] })), 'INVALID_DEFINITION', 'absent');
    error(() => parseDefinition(definition({ configFiles: [{ ...file('a.json'), values: { x: NaN } }] })), 'INVALID_DEFINITION', 'x');
  });
  test('does not allocate for invalid recipes, codecs, tokens, inputs or aborted preparation', async () => {
    const spy = spyOn(fs, 'mkdtemp');
    try {
      const missingInput = definition({ args: ['${input.required}'] });
      for (const value of [missingInput, definition({ args: ['${bogus}'] }), definition({ env: { A: 'a' }, unsetEnv: ['A'] }),
        { ...definition(), provider: { adapter: 'absent', override: {} } }])
        await expect(renderInjection(value, 'interactive', {}, endpoint)).rejects.toBeInstanceOf(DefinitionError);
      await expect(renderInjection(definition(), 'acp', {}, endpoint)).rejects.toMatchObject({ code: 'RECIPE_NOT_FOUND' });
      await expect(renderInjection(definition(), 'interactive', {}, endpoint, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});

describe('rendering and lifecycle', () => {
  test('pure environment merge, common then mode args, and single-pass opaque inputs', async () => {
    const value = definition({ env: { ENDPOINT: '${mock.baseUrl}', TOKEN: '${mock.apiKey}' }, unsetEnv: ['REMOVE'], args: ['common'] },
      { acp: { args: ['--adapter-path', '${input.path}'], env: { OPAQUE: '${input.path}' }, unsetEnv: ['REMOVE'] } });
    const inputs = { path: '${mock.apiKey}/a b/"quoted"' };
    const promise = render(value, 'acp', inputs);
    value.provider.override.env!.ENDPOINT = 'changed';
    inputs.path = 'changed';
    const output = await promise;
    const base = Object.freeze({ KEEP: 'keep', REMOVE: 'remove', ENDPOINT: 'old', UNDEFINED: undefined });
    expect(output.environment(base)).toEqual({ KEEP: 'keep', UNDEFINED: undefined, ENDPOINT: endpoint.baseUrl, TOKEN: endpoint.apiKey, OPAQUE: '${mock.apiKey}/a b/"quoted"' });
    expect(base.REMOVE).toBe('remove');
    expect(output.args).toEqual(['common', '--adapter-path', '${mock.apiKey}/a b/"quoted"']);
    output.environment(base).TOKEN = 'changed';
    expect(output.environment(base).TOKEN).toBe(endpoint.apiKey);
  });
  test('JSON/TOML serialization preserves nested values, quoted keys, control characters and cross-file references', async () => {
    const data = { 'key."\\\n': 'quote" slash\\ newline\n return\r del\u007f emoji😀',
      mix: [true, 3, 1.25, 'text', { nested: ['x', false] }], empty: {}, array: [], big: 1e25,
      token: '${input.value}', ref: '${config.json.path}' };
    const output = await render(definition({ env: { DIRECTORY: '${session.dir}' }, configFiles: [
      { id: 'json', path: 'nested/data.json', format: 'json', values: { ...data, nullable: null } },
      { id: 'toml', path: 'data.toml', format: 'toml', values: data },
    ] }), 'interactive', { value: '"\n${not-evaluated}\n' });
    const expected = { ...data, token: '"\n${not-evaluated}\n', ref: output.configFiles[0]!.path };
    const json = JSON.parse(await fs.readFile(output.configFiles[0]!.path, 'utf8'));
    const toml = Bun.TOML.parse(await fs.readFile(output.configFiles[1]!.path, 'utf8'));
    expect(json).toEqual({ ...expected, nullable: null });
    expect(toml).toEqual(expected);
    const directory = output.environment({}).DIRECTORY!;
    expect(output.configFiles[0]!.path).toBe(join(directory, 'nested/data.json'));
    const fileStat = await fs.stat(output.configFiles[0]!.path);
    if (process.platform !== 'win32') expect(fileStat.mode & 0o777).toBe(0o600);
    await Promise.all([output.dispose(), output.dispose()]);
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('JSON array-root native configuration retains substitutions and rejects invalid roots', async () => {
    const connections = [{ name: 'controlled', baseURL: '${mock.baseUrl}/v1',
      apiKey: '${mock.apiKey}', label: '${input.label}', nested: [null, '${config.connections.path}'] }];
    const output = await render(definition({ configFiles: [
      { id: 'connections', path: 'connections.json', format: 'json', values: connections },
    ] }), 'interactive', { label: 'quote"\n${not-expanded}' });
    const path = output.configFiles[0]!.path;
    expect(JSON.parse(await fs.readFile(path, 'utf8'))).toEqual([{ name: 'controlled',
      baseURL: endpoint.baseUrl + '/v1', apiKey: endpoint.apiKey,
      label: 'quote"\n${not-expanded}', nested: [null, path] }]);
    expect(connections[0]!.apiKey).toBe('${mock.apiKey}');
    for (const [format, values] of [['toml', []], ['json', null], ['json', 'scalar'], ['json', 1]]) {
      error(() => parseDefinition({ ...definition(), provider: { adapter: 'anthropic-messages', override: {
        configFiles: [{ id: 'bad', path: 'bad.json', format, values }],
      } } }), 'INVALID_DEFINITION', 'values');
    }
    error(() => parseDefinition(definition({ configFiles: [
      { id: 'bad', path: 'bad.json', format: 'json', values: ['${unknown.token}'] },
    ] })), 'UNKNOWN_TOKEN', 'values');
    await output.dispose();
    await expect(fs.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('TOML control escapes have exact portable syntax (Bun 1.3.13 parser mishandles these escapes)', async () => {
    const output = await render(definition({ configFiles: [{ id: 'controls', path: 'control.toml', format: 'toml',
      values: { control: '\t\b\f\u0001\u001f\u007f', 'quoted.key': '"\\\n' } }] }));
    expect(await fs.readFile(output.configFiles[0]!.path, 'utf8')).toBe(
      '"control" = "\\t\\b\\f\\u0001\\u001f\\u007f"\n"quoted.key" = "\\"\\\\\\n"\n');
  });
  test('concurrent renderings have separate owned directories; cleanup leaves caller files intact', async () => {
    const value = definition({ env: { DIRECTORY: '${session.dir}' }, configFiles: [{ id: 'config', path: 'data.json', format: 'json', values: {} }] });
    const [first, second] = await Promise.all([render(value), render(value)]);
    expect(first.configFiles[0]!.path).not.toBe(second.configFiles[0]!.path);
    const callerDirectory = await fs.mkdtemp(join(tmpdir(), 'registry-caller-'));
    pending.push(() => fs.rm(callerDirectory, { recursive: true, force: true }));
    const callerFile = join(callerDirectory, 'keep.txt');
    await fs.writeFile(callerFile, 'keep');
    // A consumer-created symlink in an owned directory must not delete its target.
    await fs.symlink(callerDirectory, join(first.environment({}).DIRECTORY!, 'external'), 'dir');
    await first.dispose();
    expect(await fs.readFile(callerFile, 'utf8')).toBe('keep');
    expect(await fs.readFile(second.configFiles[0]!.path, 'utf8')).toBe('{}\n');
  });
  test('rolls back a real file write failure after partial config creation', async () => {
    const original = fs.mkdtemp;
    let directory = '';
    const spy = spyOn(fs, 'mkdtemp').mockImplementation(async (...args: Parameters<typeof fs.mkdtemp>) => {
      directory = await original(...args) as string;
      return directory;
    });
    try {
      await expect(renderInjection(definition({ configFiles: [
        { id: 'first', path: 'first.json', format: 'json', values: {} },
        { id: 'bad', path: `${'x'.repeat(300)}.json`, format: 'json', values: {} },
      ] }), 'interactive', {}, endpoint)).rejects.toMatchObject({ code: 'ENAMETOOLONG' });
      expect(directory).not.toBe('');
      await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { spy.mockRestore(); }
  });
  test('abort after acquiring a directory rolls it back', async () => {
    const original = fs.mkdtemp;
    const controller = new AbortController();
    let directory = '';
    const spy = spyOn(fs, 'mkdtemp').mockImplementation(async (...args: Parameters<typeof fs.mkdtemp>) => {
      directory = await original(...args) as string;
      controller.abort(new Error('cancel preparation'));
      return directory;
    });
    try {
      await expect(renderInjection(definition(), 'interactive', {}, endpoint, controller.signal)).rejects.toThrow('cancel preparation');
      await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { spy.mockRestore(); }
  });
  test('cleanup failures surface and dispose can retry', async () => {
    const output = await render(definition({ env: { DIRECTORY: '${session.dir}' } }));
    const spy = spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup failed'));
    try { await expect(output.dispose()).rejects.toThrow('cleanup failed'); }
    finally { spy.mockRestore(); }
    await output.dispose();
    await expect(fs.stat(output.environment({}).DIRECTORY!)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('bundled documented recipes', () => {
  test('bundled and file-loaded definitions match; CLI recipes do not imply ACP', async () => {
    const bundled = createRegistry();
    expect(bundled.list().map(value => value.id)).toEqual(['claude-code', 'codex', 'claude-code-acp', 'aider', 'cline', 'copilot', 'goose', 'droid', 'opencode', 'crush', 'gemini', 'qwen', 'mistral-vibe', 'antigravity', 'amazon-q', 'auggie', 'rovo-dev', 'amp']);
    const local = createRegistry({ builtins: false });
    for (const id of ['claude-code', 'codex']) {
      await local.loadFile(new URL(`../harnesses/${id}.json`, import.meta.url).pathname);
      expect(local.get(id)).toEqual(bundled.get(id));
      validateSelection(bundled.get(id));
      error(() => validateSelection(bundled.get(id), 'acp'), 'RECIPE_NOT_FOUND');
    }
    await local.loadFile(new URL('../harnesses/claude-code-acp.json', import.meta.url).pathname);
    expect(local.get('claude-code-acp')).toEqual(bundled.get('claude-code-acp'));
    validateSelection(bundled.get('claude-code-acp'), 'acp');
    error(() => validateSelection(bundled.get('claude-code-acp')), 'RECIPE_NOT_FOUND');
    for (const id of ['aider', 'cline', 'copilot', 'goose', 'droid', 'opencode', 'crush', 'gemini', 'qwen', 'mistral-vibe', 'antigravity', 'amazon-q', 'auggie', 'rovo-dev', 'amp']) {
      await local.loadFile(new URL(`../harnesses/${id}.json`, import.meta.url).pathname);
      expect(local.get(id)).toEqual(bundled.get(id));
      for (const mode of Object.keys(bundled.get(id).modes)) {
        validateSelection(bundled.get(id), mode, { prompt: 'fixture', model: 'fixture-model' });
      }
      error(() => validateSelection(bundled.get(id), 'acp'), 'RECIPE_NOT_FOUND');
    }
    const claude = await render(bundled.get('claude-code'), 'nonInteractive');
    expect(claude.args).toEqual(['--print']);
    expect(claude.environment({ ANTHROPIC_AUTH_TOKEN: 'old', CLAUDE_CODE_USE_VERTEX: '1' })).toMatchObject({ ANTHROPIC_BASE_URL: endpoint.baseUrl, ANTHROPIC_API_KEY: endpoint.apiKey });
    expect(claude.environment({ ANTHROPIC_AUTH_TOKEN: 'old' })).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    const codex = await render(bundled.get('codex'), 'nonInteractive');
    expect(codex.args).toEqual(['exec']);
    const config = Bun.TOML.parse(await fs.readFile(codex.configFiles[0]!.path, 'utf8'));
    expect(config).toEqual({ model_provider: 'cordyceps', model_providers: { cordyceps: {
      name: 'Cordyceps mock provider', base_url: `${endpoint.baseUrl}/v1`, env_key: 'CORDYCEPS_API_KEY', wire_api: 'responses', supports_websockets: false,
    } } });
    expect(codex.environment({}).CODEX_HOME).toBe(dirname(codex.configFiles[0]!.path));
  });
});
