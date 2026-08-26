'use strict';

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function createUtf8ChunkDecoder() {
  let pending = new Uint8Array(0);

  function push(value, final = false) {
    if (typeof value === 'string') return value;
    const incoming = toBytes(value) || new Uint8Array(0);
    const bytes = new Uint8Array(pending.length + incoming.length);
    bytes.set(pending, 0);
    bytes.set(incoming, pending.length);
    pending = new Uint8Array(0);
    let result = '';
    let index = 0;
    while (index < bytes.length) {
      const lead = bytes[index];
      let width = 1;
      let codePoint = lead;
      if (lead >= 0xc2 && lead <= 0xdf) {
        width = 2;
        codePoint = lead & 0x1f;
      } else if (lead >= 0xe0 && lead <= 0xef) {
        width = 3;
        codePoint = lead & 0x0f;
      } else if (lead >= 0xf0 && lead <= 0xf4) {
        width = 4;
        codePoint = lead & 0x07;
      } else if (lead >= 0x80) {
        result += '\ufffd';
        index += 1;
        continue;
      }
      if (index + width > bytes.length) {
        if (!final) pending = bytes.slice(index);
        else result += '\ufffd';
        break;
      }
      let valid = true;
      for (let offset = 1; offset < width; offset += 1) {
        const byte = bytes[index + offset];
        if ((byte & 0xc0) !== 0x80) {
          valid = false;
          break;
        }
        codePoint = (codePoint << 6) | (byte & 0x3f);
      }
      const overlong = (width === 2 && codePoint < 0x80)
        || (width === 3 && codePoint < 0x800)
        || (width === 4 && codePoint < 0x10000);
      if (!valid || overlong || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        result += '\ufffd';
        index += 1;
        continue;
      }
      result += String.fromCodePoint(codePoint);
      index += width;
    }
    return result;
  }

  return { push, finish: () => push(new Uint8Array(0), true) };
}

function parseFrame(frame) {
  let event = 'message';
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const raw = data.join('\n');
  try {
    return { event, data: JSON.parse(raw), raw };
  } catch {
    return { event, data: null, raw };
  }
}

function createSseParser({ onEvent = () => {}, onMalformed = () => {} } = {}) {
  const decoder = createUtf8ChunkDecoder();
  let buffer = '';

  function consume(text) {
    buffer += text;
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    for (const rawFrame of frames) {
      const parsed = parseFrame(rawFrame);
      if (!parsed) continue;
      if (parsed.data === null) onMalformed(parsed);
      else onEvent(parsed);
    }
  }

  return {
    push(chunk) { consume(decoder.push(chunk)); },
    finish() {
      consume(decoder.finish());
      const parsed = buffer ? parseFrame(buffer) : null;
      buffer = '';
      if (parsed?.data === null) onMalformed(parsed);
      else if (parsed) onEvent(parsed);
    },
  };
}

function createRecommendationStreamConsumer({
  generation,
  isCurrent = () => true,
  onRecommendationReady = () => {},
  onCanonicalCopy = () => {},
  onDiagnostic = () => {},
  onComplete = () => {},
} = {}) {
  const expectedGeneration = String(generation || '');
  const pendingCopies = [];
  let batchId = '';
  let ready = false;
  let complete = false;

  function handle(frame) {
    const payload = frame?.data;
    if (!payload || typeof payload !== 'object' || !isCurrent()) return { status: 'stale' };
    if (String(payload.generation || '') !== expectedGeneration) return { status: 'stale' };
    const eventType = String(frame.event || payload.type || '');
    if (eventType === 'diagnostic') {
      onDiagnostic(payload);
      return { status: 'diagnostic' };
    }
    if (eventType === 'recommendation.ready') {
      const responseBatchId = payload.response?.batch?.batchId;
      if (!responseBatchId || payload.batchId !== responseBatchId || ready) return { status: 'invalid' };
      batchId = responseBatchId;
      ready = true;
      onRecommendationReady(payload.response, payload);
      for (const pending of pendingCopies.splice(0)) {
        if (pending.batchId === batchId) onCanonicalCopy(pending.copy, pending);
      }
      return { status: 'ready', batchId };
    }
    if (eventType === 'canonical.copy') {
      if (!payload.batchId || !payload.copy || payload.copy.outfitKey === undefined) return { status: 'invalid' };
      if (!ready) {
        pendingCopies.push(payload);
        return { status: 'buffered' };
      }
      if (payload.batchId !== batchId) return { status: 'stale' };
      onCanonicalCopy(payload.copy, payload);
      return { status: 'copy', batchId };
    }
    if (eventType === 'complete') {
      if (payload.batchId && ready && payload.batchId !== batchId) return { status: 'stale' };
      complete = true;
      onComplete(payload);
      return { status: 'complete', batchId };
    }
    return { status: 'ignored' };
  }

  return {
    handle,
    getState: () => ({ batchId, ready, complete, pendingCopyCount: pendingCopies.length }),
  };
}

module.exports = {
  createRecommendationStreamConsumer,
  createSseParser,
  createUtf8ChunkDecoder,
  parseFrame,
};
