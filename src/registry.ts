import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DefinitionError, parseDefinition } from './manifest.js';
import type { HarnessDefinition } from './manifest.js';

export interface HarnessRegistry {
  register(definition: unknown): void;
  loadFile(path: string): Promise<void>;
  get(id: string): HarnessDefinition;
  list(): HarnessDefinition[];
}
function decodeJson(source: string, path: string): unknown {
  try { return JSON.parse(source); }
  catch (cause) { throw new DefinitionError('INVALID_JSON', path, '$', 'could not parse definition JSON', { cause }); }
}
export function createRegistry({ builtins = true }: { builtins?: boolean } = {}): HarnessRegistry {
  const definitions = new Map<string, HarnessDefinition>();
  const registry: HarnessRegistry = {
    register(value) {
      const definition = parseDefinition(value);
      if (definitions.has(definition.id)) throw new DefinitionError('DUPLICATE_ID', definition.id, '$.id', 'definition ID is already registered');
      definitions.set(definition.id, definition);
    },
    async loadFile(path) { registry.register(decodeJson(await readFile(path, 'utf8'), path)); },
    get(id) {
      const definition = definitions.get(id);
      if (!definition) throw new DefinitionError('DEFINITION_NOT_FOUND', id, '$.id', 'definition is not registered');
      return structuredClone(definition);
    },
    list() { return [...definitions.values()].map(value => structuredClone(value)); },
  };
  if (builtins) for (const name of ['aider', 'amazon-q', 'amp', 'ante', 'antigravity', 'auggie', 'autohand', 'claude-code', 'claude-code-acp', 'cline', 'codebuddy', 'codex', 'command-code', 'continue-cli', 'copilot', 'crush', 'droid', 'dsh', 'freebuff', 'fx', 'gemini', 'goose', 'grok-build', 'hermes', 'kilocode', 'kimi-code', 'mastra-code', 'mimo', 'minimax', 'mistral-vibe', 'muse', 'omp', 'openclaude', 'openclaw', 'opencode', 'opencode2', 'pi', 'prime-agent', 'qwen', 'rovo-dev', 'zcode']) {
    const url = new URL(`../harnesses/${name}.json`, import.meta.url);
    registry.register(decodeJson(readFileSync(url, 'utf8'), url.pathname));
  }
  return registry;
}
