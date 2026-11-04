const CACHE="pdf-exam-quiz-shell-v1";
const SHELL=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  event.respondWith((async()=>{
    const cached=await caches.match(req);
    if(cached)return cached;
    try{
      const response=await fetch(req);
      if(response.ok && (url.origin===self.location.origin || url.hostname==="cdnjs.cloudflare.com")){
        const cache=await caches.open(CACHE);cache.put(req,response.clone());
      }
      return response;
    }catch(e){
      if(req.mode==="navigate")return caches.match("./index.html");
      throw e;
    }
  })());
});