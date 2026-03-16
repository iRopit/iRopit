const CACHE_VERSION = "v2";
const STATIC_CACHE = `iropit-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `iropit-dynamic-${CACHE_VERSION}`;
const IMAGE_CACHE = `iropit-images-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  "/",
  "/offline",
  "/manifest.json",
  "/logo.png",
  "/logo.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const CACHE_LIMITS = {
  [DYNAMIC_CACHE]: 50,
  [IMAGE_CACHE]: 30,
};

// Install — precache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k !== STATIC_CACHE &&
                k !== DYNAMIC_CACHE &&
                k !== IMAGE_CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Trim a cache to a max number of entries
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, chrome-extension, and Firebase/API requests
  if (
    request.method !== "GET" ||
    url.protocol === "chrome-extension:" ||
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("firebase") ||
    url.hostname.includes("identitytoolkit") ||
    url.hostname.includes("securetoken") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/webpack-hmr")
  ) {
    return;
  }

  // Images — cache first, fallback network
  if (
    request.destination === "image" ||
    /\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(IMAGE_CACHE).then((cache) => {
                cache.put(request, clone);
                trimCache(IMAGE_CACHE, CACHE_LIMITS[IMAGE_CACHE]);
              });
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Static assets (JS, CSS from _next/static) — cache first
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(STATIC_CACHE)
                .then((cache) => cache.put(request, clone));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navigation — network first, fallback cache, then offline page
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches
              .open(DYNAMIC_CACHE)
              .then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match("/offline")),
        ),
    );
    return;
  }

  // Everything else — stale while revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(request, clone);
              trimCache(DYNAMIC_CACHE, CACHE_LIMITS[DYNAMIC_CACHE]);
            });
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});

// Push notifications
self.addEventListener("push", (event) => {
  let data = { title: "iRopit", body: "New notification", icon: "/icons/icon-192.png" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || "/icons/icon-192.png",
      badge: "/icons/icon-48.png",
      vibrate: [100, 50, 100],
      data: data.url ? { url: data.url } : { url: "/dashboard" },
    }),
  );
});

// Notification click — open/focus tab
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.includes(targetUrl) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});
