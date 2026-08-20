const CACHE_VERSION = "chefebot-pwa-v3";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith("chefebot-") && key !== STATIC_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function ehRecursoEstaticoSeguro(url) {
  return url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png";
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Dados operacionais, autenticação, pedidos, Pix e integrações nunca entram
  // no cache do PWA. O servidor continua sendo sempre a fonte da verdade.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match(OFFLINE_URL);
        return offline || Response.error();
      })
    );
    return;
  }

  if (!ehRecursoEstaticoSeguro(url)) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || !response.ok) return response;
        const copia = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(request, copia));
        return response;
      });
    })
  );
});

self.addEventListener("push", event => {
  const data = event.data?.json() || { title: "Novo pedido! 🍕", body: "Tem pedido novo na fila." };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [200, 100, 200, 100, 200],
      tag: "novo-pedido",
      renotify: true,
      requireInteraction: true,
      actions: [
        { action: "abrir", title: "Ver pedido" },
        { action: "fechar", title: "Fechar" }
      ]
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  if (event.action === "abrir" || !event.action) {
    event.waitUntil(clients.openWindow("/pedidos"));
  }
});
