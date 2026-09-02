/* global TextEncoder, ReadableStream, Response, module */
'use strict';

function readGarments(init) {
  try {
    const body = JSON.parse(String(init?.body || '{}'));
    const content = body.messages?.find((message) => message?.role === 'user')?.content;
    const inputs = JSON.parse(content);
    const garments = inputs?.[0]?.g;
    return Array.isArray(garments) ? garments.filter((value) => typeof value === 'string' && value.trim()) : [];
  } catch {
    return [];
  }
}

function readMeaning(init) {
  try {
    const body = JSON.parse(String(init?.body || '{}'));
    const content = body.messages?.find((message) => message?.role === 'user')?.content;
    const input = JSON.parse(content)?.[0];
    if (typeof input?.m === 'string') return input.m.trim();
    if (input?.m && typeof input.m === 'object') return String(input.m.meaning || input.m.text || '').trim();
  } catch { /* malformed provider input is covered by the production validator */ }
  return '';
}

function sseResponse(payload, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      if (status === 200) controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function successFetch(_url, init) {
  const garments = readGarments(init);
  const garment = garments[0] || '这套搭配';
  const meaning = readMeaning(init);
  const text = meaning ? `${garment}，${meaning}。` : `${garment}搭配简单日常。`;
  return sseResponse({
    choices: [{ delta: { content: JSON.stringify({ copies: [{ id: '1', text }] }) } }],
  });
}

function failureFetch(status, code = status === 429 ? 'rate_limit' : 'unauthorized') {
  return async function controlledFailureFetch() {
    return sseResponse({ error: { code } }, status);
  };
}

module.exports = { failureFetch, readGarments, readMeaning, successFetch };
