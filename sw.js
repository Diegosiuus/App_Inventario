const CACHE_NAME = 'inventario-casa-v2';
const ARCHIVOS_APP = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Al instalar, guarda en caché el "esqueleto" de la app (no los datos de Supabase)
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_APP))
  );
  self.skipWaiting();
});

// Al activar, borra cachés antiguas de versiones anteriores (esto es lo que
// limpia la copia vieja de index.html que quedó atascada)
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      )
    )
  );
  self.clients.claim();
});

// Solo intercepta peticiones a nuestro propio origen (el HTML, el manifest, los iconos).
// Las peticiones a Supabase (otro dominio) pasan siempre directas a la red.
self.addEventListener('fetch', (evento) => {
  const url = new URL(evento.request.url);

  if (url.origin !== self.location.origin) {
    return; // deja pasar tal cual (Supabase, CDN de supabase-js, etc.)
  }

  // El HTML (la app en sí) va primero a la red, para no quedarnos nunca con una
  // versión vieja aunque hayamos subido cambios. Si no hay conexión, usamos la copia en caché.
  if (evento.request.mode === 'navigate' || evento.request.url.endsWith('.html')) {
    evento.respondWith(
      fetch(evento.request)
        .then((respuestaRed) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(evento.request, respuestaRed.clone()));
          return respuestaRed;
        })
        .catch(() => caches.match(evento.request))
    );
    return;
  }

  // El resto de archivos estáticos (iconos, manifest) sí pueden servirse desde caché primero,
  // ya que apenas cambian.
  evento.respondWith(
    caches.match(evento.request).then((respuestaCache) => {
      return respuestaCache || fetch(evento.request);
    })
  );
});