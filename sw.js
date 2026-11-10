const CACHE="pdf-exam-quiz-v2";
const SHELL=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!=="pdf-exam-quiz-v2").map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  e.respondWith((async()=>{
    const cached=await caches.match(req);if(cached)return cached;
    try{
      const response=await fetch(req);
      if(response.ok&&(url.origin===self.location.origin||url.hostname==="cdnjs.cloudflare.com")){
        const c=await caches.open(CACHE);c.put(req,response.clone()).catch(()=>{});
      }
      return response;
    }catch(err){
      if(req.mode==="navigate")return caches.match("./index.html");
      throw err;
    }
  })());
});
