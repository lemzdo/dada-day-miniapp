const http = require('node:http');

function sendSse(response) {
  const startedAt = Date.now();
  let closed = false;
  const timers = [];

  response.writeHead(200, {
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  });

  const write = (event, data) => {
    if (!closed) response.write(`event: ${event}\ndata: ${JSON.stringify({ ...data, elapsedMs: Date.now() - startedAt })}\n\n`);
  };

  response.once('close', () => {
    closed = true;
    timers.splice(0).forEach(clearTimeout);
  });

  write('hello', { type: 'hello' });
  timers.push(setTimeout(() => write('half', { type: 'half', targetMs: 500 }), 500));
  timers.push(setTimeout(() => write('late', { type: 'late', targetMs: 1600 }), 1600));
  timers.push(setTimeout(() => {
    write('complete', { type: 'complete', targetMs: 3100 });
    if (!closed) response.end();
  }, 3100));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (request.method !== 'GET') {
    response.writeHead(404);
    response.end();
    return;
  }
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('HTTP_SMOKE_OK');
    return;
  }
  if (url.pathname === '/sse') {
    sendSse(response);
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('NOT_FOUND');
});

server.listen(9000, '0.0.0.0');
