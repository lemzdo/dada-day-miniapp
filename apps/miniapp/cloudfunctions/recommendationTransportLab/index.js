/**
 * Lab-only CloudBase Web Function for measuring SSE transport.
 *
 * This intentionally contains no recommendation runtime, provider call,
 * persistence, cache, or production imports. Deploy it as a Web Function
 * named recommendationTransportLab with execution timeout >= 10 seconds.
 */
const http = require('node:http');

const EVENTS = [
  { atMs: 50, type: 'connection.accepted' },
  { atMs: 500, type: 'spike.500ms' },
  { atMs: 1500, type: 'spike.1500ms' },
  { atMs: 3000, type: 'spike.3000ms' },
];

function writeEvent(response, event, startedAt) {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify({
    type: event.type,
    targetMs: event.atMs,
    elapsedMs: Date.now() - startedAt,
  })}\n\n`);
}

function handle(request, response) {
  if (request.url !== '/sse' && request.url !== '/sse/') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'use /sse' }));
    return;
  }

  const startedAt = Date.now();
  let closed = false;
  const timers = [];
  response.writeHead(200, {
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-transport-lab': 'recommendationTransportLab',
  });

  request.on('close', () => {
    closed = true;
    timers.splice(0).forEach(clearTimeout);
  });

  EVENTS.forEach((event) => {
    timers.push(setTimeout(() => {
      if (!closed) writeEvent(response, event, startedAt);
    }, event.atMs));
  });
  timers.push(setTimeout(() => {
    if (!closed) {
      response.write('event: complete\ndata: {"type":"complete"}\n\n');
      response.end();
    }
  }, 3050));
}

const server = http.createServer(handle);
server.listen(9000, '0.0.0.0');
