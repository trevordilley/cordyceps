import { expect, test } from 'bun:test';
import { readFile, access } from 'node:fs/promises';
import { createRegistry, prepare } from '../src/index.js';

for (const harness of ['gemini', 'qwen', 'mistral-vibe']) test(`${harness} recipe renders mock endpoint and disposable configuration via public imports`, async () => {
  const registry = createRegistry({ builtins: false });
  await registry.loadFile(new URL(`../harnesses/${harness}.json`, import.meta.url).pathname);
  const ai = await prepare({ harness, registry, mode: 'nonInteractive', inputs: { prompt: 'literal ${mock.apiKey}', model: 'fixture-model' } });
  const configs = ai.configFiles.map(f => f.path);
  try {
    const base = { KEEP: 'yes', GOOGLE_API_KEY: 'competing', GOOGLE_GENAI_USE_VERTEXAI: 'true' };
    const env = ai.environment(base);
    expect(base.GOOGLE_API_KEY).toBe('competing'); expect(env.KEEP).toBe('yes');
    expect(ai.args).toContain('literal ${mock.apiKey}');
    if (harness === 'gemini') {
      expect(env.GOOGLE_GEMINI_BASE_URL).toBe(ai.baseUrl); expect(env.GEMINI_API_KEY).toBe(ai.apiKey);
      expect(env.GOOGLE_API_KEY).toBeUndefined(); expect(env.GOOGLE_GENAI_USE_VERTEXAI).toBeUndefined();
      const settings = JSON.parse(await readFile(ai.configFiles.find(f => f.id === 'settings')!.path, 'utf8'));
      expect(settings.security.auth.selectedType).toBe('gemini-api-key');
    } else if (harness === 'qwen') {
      expect(env.OPENAI_BASE_URL).toBe(`${ai.baseUrl}/v1`); expect(env.OPENAI_API_KEY).toBe(ai.apiKey); expect(ai.args.slice(0, 2)).toEqual(['--auth-type', 'openai']);
    } else {
      expect(env.CORDYCEPS_API_KEY).toBe(ai.apiKey);
      const config = Bun.TOML.parse(await readFile(configs[0]!, 'utf8')) as any;
      expect(config.providers[0].api_base).toBe(`${ai.baseUrl}/v1`); expect(config.models[0].name).toBe('fixture-model'); expect(config.active_model).toBe('cordyceps');
    }
  } finally { await ai.dispose(); }
  for (const file of configs) await expect(access(file)).rejects.toThrow();
});
