import { rpc as SorobanRpc, scValToNative, xdr, Address } from '@stellar/stellar-sdk';

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export type DecodedEvent = {
  eventId: string;
  ledger: number;
  txHash: string;
  contractId: string;
  topic: string;
  topics: string[];
  data: Record<string, unknown>;
  timestamp: number;
};

export const normalizeNativeValue = (val: unknown): unknown => {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return val.toString();
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (val instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of val.entries()) {
      obj[String(k)] = normalizeNativeValue(v);
    }
    return obj;
  }
  if (Array.isArray(val)) {
    return val.map(normalizeNativeValue);
  }
  if (val instanceof Address) {
    return val.toString();
  }
  if (typeof val === 'object') {
    if (typeof (val as any).toString === 'function' && (val as any).constructor?.name === 'Address') {
      return (val as any).toString();
    }
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      obj[k] = normalizeNativeValue(v);
    }
    return obj;
  }
  return val;
};

export const decodeScVal = (val: unknown): unknown => {
  if (val === null || val === undefined) return null;

  // Direct xdr.ScVal instance
  if (typeof val === 'object' && typeof (val as any).toXDR === 'function') {
    try {
      return normalizeNativeValue(scValToNative(val as any));
    } catch {
      return null;
    }
  }

  // Wrapped XDR response object: { xdr: "base64..." }
  if (typeof val === 'object' && typeof (val as any).xdr === 'string') {
    try {
      const parsed = xdr.ScVal.fromXDR((val as any).xdr, 'base64');
      return normalizeNativeValue(scValToNative(parsed));
    } catch {
      return null;
    }
  }

  // Base64 encoded ScVal string or literal string
  if (typeof val === 'string') {
    try {
      const parsed = xdr.ScVal.fromXDR(val, 'base64');
      return normalizeNativeValue(scValToNative(parsed));
    } catch {
      return val;
    }
  }

  if (typeof val === 'object') {
    return normalizeNativeValue(val);
  }

  return val;
};

export const decodeEventData = (
  event: (SorobanRpc.Api.EventResponse & Record<string, unknown>) | unknown,
): DecodedEvent | null => {
  try {
    if (!event || typeof event !== 'object') {
      return null;
    }

    const raw = event as Record<string, unknown>;

    // 1. Strict envelope validation: event ID
    const eventId = raw.id;
    if (!eventId || typeof eventId !== 'string' || eventId.trim() === '') {
      return null;
    }

    // 2. Strict envelope validation: ledger
    const ledger = raw.ledger;
    if (typeof ledger !== 'number' || !Number.isInteger(ledger) || ledger <= 0) {
      return null;
    }

    // 3. Strict envelope validation: txHash
    const txHash = raw.txHash;
    if (!txHash || typeof txHash !== 'string' || txHash.trim() === '' || txHash === 'unknown') {
      return null;
    }

    // 4. Strict envelope validation: contractId
    const contractId = raw.contractId;
    if (!contractId || typeof contractId !== 'string' || contractId.trim() === '' || contractId === 'unknown') {
      return null;
    }

    // 5. Strict topic decoding and validation
    const rawTopics = raw.topic;
    const topicList = Array.isArray(rawTopics)
      ? rawTopics
      : (rawTopics !== undefined && rawTopics !== null ? [rawTopics] : []);

    if (topicList.length === 0) {
      return null;
    }

    const decodedTopics: string[] = [];
    for (const t of topicList) {
      const dec = decodeScVal(t);
      if (dec !== null && dec !== undefined) {
        decodedTopics.push(String(dec));
      }
    }

    if (decodedTopics.length === 0 || !decodedTopics[0] || decodedTopics[0].trim() === '') {
      return null;
    }

    const topic = decodedTopics[0];

    // 6. Value and domain payload decoding
    let data: Record<string, unknown> = {};
    if (raw.value !== undefined && raw.value !== null) {
      const decVal = decodeScVal(raw.value);
      if (decVal && typeof decVal === 'object' && !Array.isArray(decVal)) {
        data = decVal as Record<string, unknown>;
      } else if (Array.isArray(decVal)) {
        data = { values: decVal };
      } else if (decVal !== null && decVal !== undefined) {
        data = { value: decVal };
      }
    }

    // 7. Timestamp derivation
    const timestamp = raw.ledgerClosedAt
      ? Math.floor(new Date(String(raw.ledgerClosedAt)).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    return {
      eventId,
      ledger,
      txHash,
      contractId,
      topic,
      topics: decodedTopics,
      data,
      timestamp,
    };
  } catch {
    return null;
  }
};

