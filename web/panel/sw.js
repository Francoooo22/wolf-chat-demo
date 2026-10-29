// Service worker del panel: permite instalarlo como aplicación y recibir notificaciones push.
// No guarda datos de clientes en el dispositivo: solo la página base, para abrir sin conexión
// y mostrar el aviso de que falta internet.

const CACHE = 'wolf-panel-v1';
const BASE = ['./', 'panel.css', 'iconos/icono-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Solo la navegación: primero la red; sin conexión, la copia guardada.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(async () => (await caches.match('./'))
    || new Response('Sin conexión a internet.', { headers: { 'content-type': 'text/plain; charset=utf-8' } })));
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { cuerpo: e.data?.text() };
  }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Atención Wolf', {
    body: d.cuerpo || '',
    tag: d.conversacion || 'wolf',
    renotify: true,
    icon: 'iconos/icono-192.png',
    badge: 'iconos/insignia-96.png',
    data: { url: d.url, conversacion: d.conversacion },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { url, conversacion } = e.notification.data || {};
  e.waitUntil((async () => {
    const alcance = new URL(self.registration.scope).pathname;
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const panel = ventanas.find((v) => new URL(v.url).pathname.startsWith(alcance));
    if (panel) {
      await panel.focus();
      if (conversacion) panel.postMessage({ tipo: 'abrir', conversacion });
      return;
    }
    await self.clients.openWindow(url || self.registration.scope);
  })());
});
