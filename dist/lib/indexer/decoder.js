"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEventData = exports.decodeScVal = exports.normalizeNativeValue = exports.DecodeError = void 0;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
class DecodeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DecodeError';
    }
}
exports.DecodeError = DecodeError;
const normalizeNativeValue = (val) => {
    if (val === null || val === undefined)
        return null;
    if (typeof val === 'bigint')
        return val.toString();
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return val;
    }
    if (val instanceof Map) {
        const obj = {};
        for (const [k, v] of val.entries()) {
            obj[String(k)] = (0, exports.normalizeNativeValue)(v);
        }
        return obj;
    }
    if (Array.isArray(val)) {
        return val.map(exports.normalizeNativeValue);
    }
    if (val instanceof stellar_sdk_1.Address) {
        return val.toString();
    }
    if (typeof val === 'object') {
        if (typeof val.toString === 'function' && val.constructor?.name === 'Address') {
            return val.toString();
        }
        const obj = {};
        for (const [k, v] of Object.entries(val)) {
            obj[k] = (0, exports.normalizeNativeValue)(v);
        }
        return obj;
    }
    return val;
};
exports.normalizeNativeValue = normalizeNativeValue;
const decodeScVal = (val) => {
    if (val === null || val === undefined)
        return null;
    // Direct xdr.ScVal instance
    if (typeof val === 'object' && typeof val.toXDR === 'function') {
        try {
            return (0, exports.normalizeNativeValue)((0, stellar_sdk_1.scValToNative)(val));
        }
        catch {
            return null;
        }
    }
    // Wrapped XDR response object: { xdr: "base64..." }
    if (typeof val === 'object' && typeof val.xdr === 'string') {
        try {
            const parsed = stellar_sdk_1.xdr.ScVal.fromXDR(val.xdr, 'base64');
            return (0, exports.normalizeNativeValue)((0, stellar_sdk_1.scValToNative)(parsed));
        }
        catch {
            return null;
        }
    }
    // Base64 encoded ScVal string or literal string
    if (typeof val === 'string') {
        try {
            const parsed = stellar_sdk_1.xdr.ScVal.fromXDR(val, 'base64');
            return (0, exports.normalizeNativeValue)((0, stellar_sdk_1.scValToNative)(parsed));
        }
        catch {
            return val;
        }
    }
    if (typeof val === 'object') {
        return (0, exports.normalizeNativeValue)(val);
    }
    return val;
};
exports.decodeScVal = decodeScVal;
const decodeEventData = (event) => {
    try {
        if (!event || typeof event !== 'object') {
            return null;
        }
        const raw = event;
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
        const decodedTopics = [];
        for (const t of topicList) {
            const dec = (0, exports.decodeScVal)(t);
            if (dec !== null && dec !== undefined) {
                decodedTopics.push(String(dec));
            }
        }
        if (decodedTopics.length === 0 || !decodedTopics[0] || decodedTopics[0].trim() === '') {
            return null;
        }
        const topic = decodedTopics[0];
        // 6. Value and domain payload decoding
        let data = {};
        if (raw.value !== undefined && raw.value !== null) {
            const decVal = (0, exports.decodeScVal)(raw.value);
            if (decVal && typeof decVal === 'object' && !Array.isArray(decVal)) {
                data = decVal;
            }
            else if (Array.isArray(decVal)) {
                data = { values: decVal };
            }
            else if (decVal !== null && decVal !== undefined) {
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
    }
    catch {
        return null;
    }
};
exports.decodeEventData = decodeEventData;
