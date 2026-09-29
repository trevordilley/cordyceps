/** Provider HTTP data only. No ACP identities are inferred here. */
export interface RawHttpRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}
export interface ToolDefinition { name: string; inputSchema: unknown; raw: unknown }
export interface ToolResult { id: string; text: string; isError: boolean; raw: unknown }
export interface DecodedRequest {
  model: string;
  stream: boolean;
  text: string;
  tools: ToolDefinition[];
  toolResults: ToolResult[];
  body: unknown;
}
export interface CapturedRequest extends DecodedRequest {
  id: string;
  timestamp: number;
  raw: RawHttpRequest;
}
export interface ToolCall { id: string; name: string; input: unknown }
export type ProviderEvent = { text: string } | { toolCall: ToolCall };
export type ScriptedResponse =
  | { text: string; toolCall?: never; stream?: never; error?: never }
  | { toolCall: ToolCall; text?: never; stream?: never; error?: never }
  | { stream: AsyncIterable<ProviderEvent>; text?: never; toolCall?: never; error?: never }
  | { error: { status: number; message: string; type?: string }; text?: never; toolCall?: never; stream?: never };
export interface EncodedResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<string | Uint8Array>;
}
/** Core owns socket IO/backpressure; codecs own wire framing and stream terminal events. */
export interface ProviderCodec {
  id: string;
  matches(method: string, path: string): boolean;
  decode(raw: RawHttpRequest): DecodedRequest;
  encode(request: CapturedRequest, response: ScriptedResponse, signal: AbortSignal): EncodedResponse;
}
