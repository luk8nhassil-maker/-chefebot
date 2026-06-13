const CACHE = "chefebot-v2";
const OFFLINE = ["/pedidos", "/login"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener("push", e => {
  const data = e.data?.json() || { title: "Novo pedido! 🍕", body: "Tem pedido novo na fila." };
  e.waitUntil(
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

self.addEventListener("notificationclick", e => {
  e.notification.close();
  if (e.action === "abrir" || !e.action) {
    e.waitUntil(clients.openWindow("/pedidos"));
  }
});
