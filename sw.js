/*
 * Minimal service-worker streaming bridge for WebTorrent's browser Server API.
 * Uses the message protocol expected by WebTorrent's BrowserServer.
 */
const PORT_TIMEOUT_MS = 5000;
let cancellable = false;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  const base = self.registration.scope + 'webtorrent/';
  if (!url.includes(base)) return;

  if (url.includes(base + 'keepalive/')) {
    event.respondWith(Promise.resolve(new Response(null, { status: 204 })));
    return;
  }

  if (url.includes(base + 'cancel/')) {
    event.respondWith(Promise.resolve(new Response(new ReadableStream({
      cancel() { cancellable = true; }
    }))));
    return;
  }

  event.respondWith(serveTorrentRequest(event));
});

async function serveTorrentRequest(event) {
  const { request } = event;
  const { url, method, headers, destination } = request;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!windows.length) return new Response('No active player tab', { status: 503 });

  let resolved;
  try {
    resolved = await Promise.race([
      new Promise((resolve) => {
        let answered = false;
        for (const windowClient of windows) {
          const channel = new MessageChannel();
          channel.port1.onmessage = ({ data }) => {
            if (answered) return;
            answered = true;
            resolve({ data, port: channel.port1 });
          };
          windowClient.postMessage({
            url,
            method,
            headers: Object.fromEntries(headers.entries()),
            scope: self.registration.scope,
            destination,
            type: 'webtorrent'
          }, [channel.port2]);
        }
      }),
      new Promise((resolve) => setTimeout(() => resolve(null), PORT_TIMEOUT_MS))
    ]);
  } catch (error) {
    return new Response('Streaming bridge error', { status: 502 });
  }

  if (!resolved) return new Response('Streaming request timed out. Keep the player page open and try again.', { status: 504 });
  const { data, port } = resolved;
  if (!data || data.body !== 'STREAM') {
    try { port.postMessage(false); port.close(); } catch (_) {}
    return new Response(data?.body ?? 'Torrent file unavailable', {
      status: data?.status || 404,
      headers: data?.headers || { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  let timeout = null;
  const cleanup = () => {
    try { port.postMessage(false); } catch (_) {}
    try { port.close(); } catch (_) {}
    clearTimeout(timeout);
    port.onmessage = null;
  };

  return new Response(new ReadableStream({
    pull(controller) {
      return new Promise((resolve) => {
        port.onmessage = ({ data: chunk }) => {
          if (chunk) {
            controller.enqueue(chunk);
          } else {
            cleanup();
            controller.close();
          }
          resolve();
        };

        if (!cancellable && destination !== 'document') {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            cleanup();
            try { controller.close(); } catch (_) {}
            resolve();
          }, PORT_TIMEOUT_MS);
        }
        port.postMessage(true);
      });
    },
    cancel() { cleanup(); }
  }), data);
}
