import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

process.env.VERCEL = '1';
globalThis.fetch = () => { throw new Error('Vercel transport must not use global fetch'); };
const { httpGet, httpPost } = await import('./danmu_api/utils/http-util.js');
const { Globals } = await import('./danmu_api/configs/globals.js');
Globals.logLevel = 'error';

let connectionId = 0;
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.url === '/slow') {
    await delay(250);
    if (res.destroyed) return;
  }
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/ok' }).end();
    return;
  }
  res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: req.socket.testId, connection: req.headers.connection,
    method: req.method, body: Buffer.concat(chunks).toString(), custom: req.headers['x-test'] }));
});
server.on('connection', socket => { socket.testId = ++connectionId; });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  await test('Vercel GET creates fresh connections, including after idle', async () => {
    const first = await httpGet(base + '/ok');
    await delay(200);
    const second = await httpGet(base + '/ok');
    assert.notEqual(first.data.id, second.data.id);
    const third = await httpGet(base + '/ok');
    assert.notEqual(second.data.id, third.data.id);
  });
  await test('POST preserves JSON payload and request headers', async () => {
    const response = await httpPost(base + '/ok', JSON.stringify({ title: '交锋' }),
      { headers: { 'content-type': 'application/json', 'x-test': 'retained' } });
    assert.equal(response.data.method, 'POST');
    assert.deepEqual(JSON.parse(response.data.body), { title: '交锋' });
    assert.equal(response.data.custom, 'retained');
  });
  await test('timeouts abort and a subsequent request still succeeds', async () => {
    await assert.rejects(httpGet(base + '/slow', { timeout: 30 }), { name: 'AbortError' });
    assert.equal((await httpGet(base + '/ok')).status, 200);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(httpGet(base + '/ok', { signal: controller.signal }), { name: 'AbortError' });
  });
  await test('redirect and allowed error status behavior is retained', async () => {
    assert.equal((await httpGet(base + '/redirect')).status, 200);
    assert.equal((await httpGet(base + '/redirect', { allow_redirects: false,
      validStatusCodes: [302] })).status, 302);
    assert.equal((await httpGet(base + '/missing', { validStatusCodes: [404] })).status, 404);
  });
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
