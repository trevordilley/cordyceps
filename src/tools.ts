import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { CapturedRequest, ToolCall, ToolDefinition } from './provider/types.js';

/** Validate a proposed call against this request's advertised tool and JSON Schema. */
export function validateToolCall(request: Pick<CapturedRequest, 'tools'>, call: ToolCall): ToolDefinition {
  const label = (tool: { name: string; namespace?: string }) => tool.namespace ? `${tool.namespace}.${tool.name}` : tool.name;
  const tool = request.tools.find(tool => tool.name === call.name && tool.namespace === call.namespace);
  if (!tool) throw new Error(`Tool "${label(call)}" was not offered. Available tools: ${request.tools.map(label).join(', ') || '(none)'}`);
  // Keep schemas and call inputs untouched; formats are annotations, not network lookups.
  const schema = structuredClone(tool.inputSchema);
  const modern = schema && typeof schema === 'object' && '$schema' in schema && typeof schema.$schema === 'string'
    && schema.$schema.includes('2020-12');
  const validator = modern ? new Ajv2020({ strict: false, allErrors: true, validateFormats: false })
    : new Ajv({ strict: false, allErrors: true, validateFormats: false });
  try {
    const validate = validator.compile(schema as object);
    if ('$async' in validate && validate.$async === true) throw new Error("Asynchronous tool schemas are not supported");
    if (!validate(call.input)) throw new Error(validator.errorsText(validate.errors));
  } catch (error) {
    throw new Error(`Invalid call to "${label(call)}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return structuredClone(tool);
}
