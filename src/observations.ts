/** Explicit consumer instrumentation; these records are never inferred from HTTP. */
export interface InputObservation {
  timestamp: number;
  data: unknown;
  metadata?: unknown;
}

export type ProtocolDirection = "client-to-agent" | "agent-to-client";

/** The complete native message lives in payload; observer metadata stays outside it. */
export interface ProtocolObservation {
  timestamp: number;
  direction: ProtocolDirection;
  payload: unknown;
  metadata?: unknown;
}

export interface ConsumerObservations {
  readonly inputs: readonly InputObservation[];
  readonly protocolMessages: readonly ProtocolObservation[];
  recordInput(data: unknown, metadata?: unknown): InputObservation;
  recordProtocolMessage(direction: ProtocolDirection, payload: unknown, metadata?: unknown): ProtocolObservation;
}

/** Clone both at ingestion and at read time, including binary input and extensions. */
export function createObservations(ensureActive: () => void): ConsumerObservations {
  const inputs: InputObservation[] = [];
  const protocolMessages: ProtocolObservation[] = [];
  return {
    get inputs() { return structuredClone(inputs); },
    get protocolMessages() { return structuredClone(protocolMessages); },
    recordInput(data, metadata) {
      ensureActive();
      const record = structuredClone({ timestamp: Date.now(), data, ...(metadata === undefined ? {} : { metadata }) });
      inputs.push(record);
      return structuredClone(record);
    },
    recordProtocolMessage(direction, payload, metadata) {
      ensureActive();
      if (direction !== "client-to-agent" && direction !== "agent-to-client") {
        throw new TypeError("Protocol direction must be client-to-agent or agent-to-client");
      }
      const record = structuredClone({ timestamp: Date.now(), direction, payload, ...(metadata === undefined ? {} : { metadata }) });
      protocolMessages.push(record);
      return structuredClone(record);
    },
  };
}
