export interface TranscriptOptions {
  /** Redaction is on by default. Raw session captures remain available separately. */
  redact?: boolean;
  /** Extra sensitive values to remove even from free text and streamed output. */
  secrets?: readonly string[];
}
const sensitive = /^(?:authorization|proxy-authorization|cookie|set-cookie|(?:[a-z0-9]+[-_])*(?:api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|password|passwd|secret|client[-_]?secret|credentials?|signature))$/i;
const urlPattern = /https?:\/\/[^\s<>"'`]+/g;
const marker = '[REDACTED]';
const decode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

/** Export a JSON-safe snapshot; known credential fields and URL credentials are scrubbed. */
export function exportTranscript<T>(value: T, options: TranscriptOptions = {}, knownSecrets: readonly string[] = []): T {
  const ancestors = new WeakSet<object>();
  const plain = (input: unknown): unknown => {
    if (typeof input === "bigint") return input.toString();
    if (input && typeof input === "object") {
      if (ancestors.has(input)) return "[Circular]";
      ancestors.add(input);
    }
    try {
    if (input instanceof Error) return { name: input.name, message: input.message, stack: input.stack,
      ...(input.cause === undefined ? {} : { cause: plain(input.cause) }),
      ...(input instanceof AggregateError ? { errors: input.errors.map(plain) } : {}) };
    if (input instanceof Uint8Array) return Buffer.from(input).toString('utf8');
    if (Array.isArray(input)) return input.map(plain);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, plain(value)]));
    return input;
    } finally { if (input && typeof input === "object") ancestors.delete(input); }
  };
  const snapshot = plain(value);
  if (options.redact === false) return snapshot as T;
  const secrets = new Set([...knownSecrets, ...(options.secrets ?? [])].filter(Boolean));
  const remember = (value: unknown) => {
    if (typeof value === 'string' && value) {
      secrets.add(value); secrets.add(decode(value));
      if (/^(Bearer|Basic) /i.test(value)) secrets.add(value.slice(value.indexOf(' ') + 1));
    } else if (Array.isArray(value)) value.forEach(remember);
  };
  const visit = (input: unknown) => {
    if (typeof input === 'string') {
      try { const parsed: unknown = JSON.parse(input); if (typeof parsed === 'object' && parsed !== null) visit(parsed); } catch {}
      for (const match of input.matchAll(urlPattern)) {
        try {
          const url = new URL(match[0]);
          if (url.username) remember(url.username);
          if (url.password) remember(url.password);
          for (const [key, value] of url.searchParams) if (sensitive.test(key)) remember(value);
        } catch {}
      }
      // HTTP request paths may be relative URLs.
      if (input.startsWith('/')) {
        try { for (const [key, value] of new URL(input, 'http://localhost').searchParams) if (sensitive.test(key)) remember(value); } catch {}
      }
    } else if (Array.isArray(input)) input.forEach(visit);
    else if (input && typeof input === 'object') for (const [key, value] of Object.entries(input)) {
      if (sensitive.test(key)) remember(value);
      visit(value);
    }
  };
  visit(snapshot);
  const literals = [...secrets].flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])
    .filter(Boolean).sort((a, b) => b.length - a.length);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = literals.length ? new RegExp([...new Set(literals)].map(escape).join('|'), 'g') : undefined;
  const scrubUrl = (source: string, relative = false): string => {
    try {
      const url = new URL(source, 'http://localhost');
      if (url.username) url.username = marker;
      if (url.password) url.password = marker;
      for (const key of [...url.searchParams.keys()]) if (sensitive.test(key)) url.searchParams.set(key, marker);
      return relative ? url.pathname + url.search + url.hash : url.toString();
    } catch { return source; }
  };
  const scrub = (input: unknown): unknown => {
    if (typeof input === 'string') {
      try {
        const parsed: unknown = JSON.parse(input);
        if (typeof parsed === 'object' && parsed !== null) return JSON.stringify(scrub(parsed));
      } catch {}
      let text = input.replace(urlPattern, url => scrubUrl(url));
      if (text.startsWith('/')) text = scrubUrl(text, true);
      return pattern ? text.replace(pattern, marker) : text;
    }
    if (Array.isArray(input)) return input.map(scrub);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, sensitive.test(key) ? marker : scrub(value)]));
    return input;
  };
  return scrub(snapshot) as T;
}
