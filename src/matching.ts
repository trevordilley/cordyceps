import { object, textContent } from './provider/common.js';
import type { CapturedRequest, DecodedRequest, ToolResult } from './provider/types.js';
import type { RequestPredicate } from './session.js';

export interface CapturedMessage { role: string; text: string; toolResults: ToolResult[]; raw: unknown }
export type TextMatcher = string | RegExp | ((text: string) => boolean);
const testText = (text: string, matcher: TextMatcher) => typeof matcher === 'string' ? text === matcher
  : typeof matcher === 'function' ? matcher(text) : new RegExp(matcher.source, matcher.flags).test(text);

/** Preserve provider message boundaries; system text and tool output are not user text. */
export function normalizeMessages(request: DecodedRequest): CapturedMessage[] {
  const body = request.body;
  if (!object(body)) return [];
  const result: CapturedMessage[] = [];
  const add = (role: string, text: string, raw: unknown, parts: unknown[] = []) => {
    const candidates = new Set([raw, ...parts]);
    result.push({ role, text, raw, toolResults: request.toolResults.filter(tool => candidates.has(tool.raw)) });
  };
  if (body.system !== undefined) add('system', textContent(body.system, ['text']).join('\n'), body.system);
  if (typeof body.instructions === 'string') add('system', body.instructions, body.instructions);
  const entries = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  if (typeof body.input === 'string') add('user', body.input, body.input);
  for (const entry of entries) {
    if (!object(entry)) continue;
    if (entry.type === 'function_call_output') { add('tool', '', entry); continue; }
    if (typeof entry.role !== 'string') continue;
    const parts = Array.isArray(entry.content) ? entry.content : [];
    add(entry.role, entry.role === 'tool' ? '' : textContent(entry.content, ['text', 'input_text', 'output_text']).join('\n'), entry, parts);
  }
  const google = [body.systemInstruction, ...(Array.isArray(body.contents) ? body.contents : [])];
  for (const content of google) {
    if (!object(content)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [];
    add(content === body.systemInstruction ? 'system' : content.role === 'model' ? 'assistant' : String(content.role ?? 'user'),
      parts.flatMap(part => object(part) && typeof part.text === 'string' && part.thought !== true ? [part.text] : []).join('\n'), content, parts);
  }
  if (object(body.conversationState)) {
    const state = body.conversationState;
    for (const entry of [...(Array.isArray(state.history) ? state.history : []), state.currentMessage]) {
      if (!object(entry)) continue;
      for (const [field, role] of [['userInputMessage', 'user'], ['assistantResponseMessage', 'assistant']] as const) {
        const message = entry[field];
        if (!object(message)) continue;
        const context = message.userInputMessageContext;
        const parts = object(context) && Array.isArray(context.toolResults) ? context.toolResults : [];
        add(role, typeof message.content === 'string' ? message.content : '', message, parts);
      }
    }
  }
  return result;
}

export const match = {
  /** Matches the last textual user message exactly (or by RegExp/predicate). */
  lastUserMessage(matcher: TextMatcher): RequestPredicate {
    return request => {
      const message = [...request.messages].reverse().find(message => message.role === 'user' && message.text.length > 0);
      return Boolean(message && testText(message.text, matcher));
    };
  },
  /** Matches results in the final message(s), never an earlier conversation turn. */
  toolResult(options: { id?: string; text?: TextMatcher; isError?: boolean }): RequestPredicate {
    return request => {
      const latest: ToolResult[] = [];
      for (const message of [...request.messages].reverse()) {
        if (!message.toolResults.length) break;
        latest.push(...message.toolResults);
      }
      return latest.some(result => (options.id === undefined || result.id === options.id)
        && (options.text === undefined || testText(result.text, options.text))
        && (options.isError === undefined || result.isError === options.isError));
    };
  },
};
