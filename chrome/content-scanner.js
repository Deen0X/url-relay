(function() {
  const STREAM_RE = /\.(m3u8|mp4|webm|mkv|ts|mpd)(\?|$)/i;
  const SEEN = new Set();

  function isStream(url) {
    return url && typeof url === 'string' && STREAM_RE.test(url);
  }

  /* capturar poster de pagina (og:image) como fallback */
  function getPagePoster() {
    const og = document.querySelector('meta[property="og:image"]');
    if (og) return og.getAttribute('content');
    const link = document.querySelector('link[rel="image_src"]');
    if (link) return link.getAttribute('href');
    return null;
  }

  let PAGE_POSTER = getPagePoster();

  function getVideoContext(el) {
    let poster = el.poster || PAGE_POSTER || null;
    if (!poster && el.readyState >= 2) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 90;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0, 160, 90);
        poster = canvas.toDataURL('image/webp', 0.3);
      } catch (e) {}
    }
    let label = '';
    if (el.closest) {
      const section = el.closest('[class*="lecture"], [class*="course"], section, article, .item, [class*="video"], [class*="player"]');
      if (section) {
        const titles = section.querySelectorAll('h1, h2, h3, h4, h5, [class*="title"], [class*="name"], [class*="heading"]');
        if (titles.length) label = titles[0].textContent.trim().slice(0, 120);
      }
    }
    if (!label) label = document.title.slice(0, 120);
    return { poster, label };
  }

  function getVideoMeta(el) {
    const meta = {};
    if (el.videoWidth > 0) meta.width = el.videoWidth;
    if (el.videoHeight > 0) meta.height = el.videoHeight;
    if (el.duration > 0 && isFinite(el.duration)) meta.duration = Math.round(el.duration);
    meta.isPlaying = el.currentTime > 0 && !el.paused && !el.ended;
    return meta;
  }

  function report(url, source, extra) {
    if (!url || url.startsWith('blob:') || SEEN.has(url)) return;
    SEEN.add(url);
    try {
      chrome.runtime.sendMessage({
        type: 'stream:detected',
        url: url,
        source: source,
        title: document.title || '',
        poster: (extra && extra.poster) || PAGE_POSTER,
        label: (extra && extra.label) || document.title.slice(0, 120),
        width: (extra && extra.width) || null,
        height: (extra && extra.height) || null,
        duration: (extra && extra.duration) || null,
        isPlaying: !!(extra && extra.isPlaying),
      });
    } catch (e) {}
  }

  function scanVideoElement(el) {
    if (!el.src || !isStream(el.src)) return;
    try {
      const ctx = getVideoContext(el);
      const meta = getVideoMeta(el);
      Object.assign(ctx, meta);
      report(el.src, el.tagName.toLowerCase(), ctx);
    } catch (e) {}
  }

  function scanSourceElement(el) {
    if (!el.src || !isStream(el.src)) return;
    try {
      const parent = el.closest('video') || el.closest('audio');
      const ctx = parent ? { ...getVideoContext(parent), ...getVideoMeta(parent) } : {};
      report(el.src, 'source', ctx);
    } catch (e) {}
  }

  function detectYoutube() {
    try {
      const host = location.hostname.replace(/^www\./, '');
      let videoId = null;
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        videoId = new URLSearchParams(location.search).get('v');
      } else if (host === 'youtu.be') {
        videoId = location.pathname.slice(1).split('/')[0];
      }
      if (!videoId) return;
      const titleEl = document.querySelector('h1.ytd-watch-metadata') || document.querySelector('h1');
      const title = (titleEl && titleEl.textContent.trim()) || document.title.replace(' - YouTube', '').trim();
      const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      setTimeout(() => {
        if (!SEEN.has(location.href)) {
          SEEN.add(location.href);
          chrome.runtime.sendMessage({
            type: 'stream:detected',
            url: location.href,
            source: 'youtube',
            title: document.title || '',
            poster: thumb,
            label: title.slice(0, 120),
            width: null,
            height: null,
            duration: null,
            isPlaying: false,
          });
        }
      }, 1500);
    } catch (e) {}
  }

  function fullScan() {
    PAGE_POSTER = getPagePoster();
    detectYoutube();
    document.querySelectorAll('video[src], audio[src]').forEach(el => scanVideoElement(el));
    document.querySelectorAll('video source[src]').forEach(el => scanSourceElement(el));
    document.querySelectorAll('iframe[src]').forEach(el => {
      const src = el.src;
      if (src && (src.includes('streamtape') || src.includes('mega') || src.includes('ok.ru') ||
          src.includes('vk.com') || src.includes('dailymotion'))) report(src, 'iframe');
    });
    try {
      performance.getEntriesByType('resource').forEach(e => {
        if (isStream(e.name)) report(e.name, 'performance');
      });
    } catch (e) {}
  }

  /* PerformanceObserver */
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (isStream(entry.name)) report(entry.name, 'performance');
      }
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (e) {}

  /* MutationObserver */
  try {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
            scanVideoElement(node);
            node.querySelectorAll('source').forEach(s => scanSourceElement(s));
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('video[src], audio[src]').forEach(el => scanVideoElement(el));
            node.querySelectorAll('source[src]').forEach(el => scanSourceElement(el));
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  /* escanear inicial */
  fullScan();

  /* escuchar mensaje de rescan desde popup */
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'rescan') {
        SEEN.clear();
        fullScan();
      }
    });
  } catch (e) {}

  function onUrlChanged() {
    SEEN.clear();
    try { chrome.runtime.sendMessage({ type: 'streams:clear' }); } catch (e) {}
    setTimeout(fullScan, 100);
  }

  /* detectar navegación SPA (cambio de URL sin recargar página) */
  let lastUrl = location.href;
  try {
    window.addEventListener('popstate', onUrlChanged);
    const origPushState = history.pushState;
    history.pushState = function() {
      origPushState.apply(this, arguments);
      onUrlChanged();
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function() {
      origReplaceState.apply(this, arguments);
      onUrlChanged();
    };
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChanged();
      }
    }, 1000);
  } catch (e) {}

  /* verificación periódica: detectar qué stream se está reproduciendo */
  setInterval(() => {
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      if (!v.src && !v.currentSrc) continue;
      const isPlaying = v.currentTime > 0 && !v.paused && !v.ended;
      if (!isPlaying) continue;
      let url = v.currentSrc || v.src;
      /* si es blob, buscar URL real desde <source> o performance */
      if (url.startsWith('blob:')) {
        const srcEl = v.querySelector('source[src]');
        if (srcEl && srcEl.src && !srcEl.src.startsWith('blob:')) {
          url = srcEl.src;
        } else {
          const entries = performance.getEntriesByType('resource');
          for (const e of entries) {
            if (e.name.match(/\.(m3u8|mp4|webm|mkv|mpd)(\?|$)/i)) { url = e.name; break; }
          }
        }
      }
      if (url && !url.startsWith('blob:')) {
        try {
          chrome.runtime.sendMessage({
            type: 'stream:active',
            url: url,
            isPlaying: true,
            currentTime: Math.round(v.currentTime),
          });
        } catch (e) {}
      }
    }
  }, 2000);
})();
