/* atlas-hook.js —— 必须在「路径重写脚本」和「业务代码」之前加载 */
(function () {
  'use strict';

  const ATLASES = [
    { json: '卡牌/texture-0.json', image: '卡牌/texture-0.webp' },
    { json: '卡牌/texture-1.json', image: '卡牌/texture-1.webp' },
  ];

  const index = {};
  const atlasImgs = {};
  const pending = [];
  let ready = false;
  let observerStarted = false;
  let domScanned = false;

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

  // ===== 透明占位图（SVG 264x375，字符串短）=====
  const TRANSPARENT_CARD =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="264" height="375"></svg>');

  const ATLAS_PATH_RE = /卡牌\/高清卡\/[^"'\/]+详情\.png/i;
  function isAtlasPath(s) {
    return typeof s === 'string' && ATLAS_PATH_RE.test(s);
  }

  // ===== HTML 字符串改写：把卡牌 img 的 src 提前换成透明图 =====
  const IMG_SRC_RE =
    /(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*?卡牌\/高清卡\/[^"']*?详情\.png)\2/gi;
  function rewriteHTML(html) {
    if (typeof html !== 'string' || html.indexOf('卡牌/高清卡/') < 0) return html;
    return html.replace(IMG_SRC_RE, function (m, pre, q, url) {
      return pre + q + TRANSPARENT_CARD + q + ' data-atlas-src=' + q + url + q;
    });
  }

  // ===== hook innerHTML =====
  const origInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (origInnerHTMLDesc && origInnerHTMLDesc.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      get() { return origInnerHTMLDesc.get.call(this); },
      set(v) { origInnerHTMLDesc.set.call(this, rewriteHTML(v)); },
    });
  }

  // ===== hook insertAdjacentHTML =====
  const origInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) {
    return origInsertAdjacentHTML.call(this, pos, rewriteHTML(html));
  };

  // ===== hook setAttribute =====
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this.tagName === 'IMG' && String(name).toLowerCase() === 'src' && isAtlasPath(value)) {
      origSetAttribute.call(this, 'data-atlas-src', value);
      return origSetAttribute.call(this, name, TRANSPARENT_CARD);
    }
    return origSetAttribute.call(this, name, value);
  };

  // ===== 正确尺寸透明图（按帧尺寸缓存）=====
  const transCache = {};
  function getTransparent(w, h) {
    const k = w + 'x' + h;
    if (transCache[k]) return transCache[k];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    transCache[k] = c.toDataURL('image/png');
    return transCache[k];
  }

  // ===== fetch + blob URL 加载图集 =====
  async function loadAtlasImage(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('解码失败: ' + url + ' type=' + blob.type + ' size=' + blob.size));
      srcDesc.set.call(img, blobUrl);
    });
    if (img.decode) await img.decode().catch(() => {});
    return { img, blobUrl };
  }

  async function init() {
    try {
      const results = await Promise.all(ATLASES.map(async (a) => {
        const jsonRes = await fetch(a.json, { cache: 'no-cache' });
        if (!jsonRes.ok) throw new Error('json HTTP ' + jsonRes.status + ' ' + a.json);
        const json = await jsonRes.json();
        const { img, blobUrl } = await loadAtlasImage(a.image);
        return { a, json, img, blobUrl };
      }));

      for (const { a, json, img, blobUrl } of results) {
        const aw = json.meta.size.w, ah = json.meta.size.h;
        atlasImgs[blobUrl] = img;
        for (const [path, data] of Object.entries(json.frames)) {
          const f = data.frame;
          index[path] = { atlasUrl: blobUrl, x: f.x, y: f.y, w: f.w, h: f.h, atlasW: aw, atlasH: ah };
        }
        console.log('[atlas-hook] loaded', a.image);
      }
      console.log('[atlas-hook] ✅ ready, frames =', Object.keys(index).length);
    } catch (e) {
      console.error('[atlas-hook] ❌ init failed:', e);
      window.__atlasFailed = true;
    } finally {
      ready = true;
      pending.splice(0).forEach(fn => { try { fn(); } catch (err) { console.error(err); } });
      try { scanDom(); } catch (e) {}
      window.__atlasReady = true;
    }
  }

  function findKey(v) {
    if (!v || typeof v !== 'string') return null;
    if (v.indexOf('data:') === 0 || v.indexOf('blob:') === 0) return null;
    let dec;
    try { dec = decodeURIComponent(v); } catch (e) { dec = v; }
    for (const k in index) if (dec.endsWith(k)) return k;
    return null;
  }

  // ===== 背景更新 =====
  const ro = (typeof ResizeObserver !== 'undefined')
    ? new ResizeObserver(entries => { for (const e of entries) updateAtlasBackground(e.target); })
    : null;

  function scheduleAtlasUpdate(img) {
    updateAtlasBackground(img);
    if (img._atlasScheduled) return;
    img._atlasScheduled = true;
    requestAnimationFrame(() => { img._atlasScheduled = false; updateAtlasBackground(img); });
    if (ro && !img._atlasRO) {
      img._atlasRO = true;
      try { ro.observe(img); } catch (e) {}
    }
  }

  // 核心修复：模拟 object-fit 和 object-position
  function updateAtlasBackground(img) {
    const f = img._atlasFrame;
    if (!f) return;
    let w = img.clientWidth || img.offsetWidth;
    let h = img.clientHeight || img.offsetHeight;
    if (!w || !h) { w = f.w; h = f.h; }

    const style = window.getComputedStyle(img);
    const fit = style.objectFit || 'fill'; 
    
    let sx = w / f.w, sy = h / f.h;
    let offsetX = 0, offsetY = 0;
    let bgW = f.w * sx;
    let bgH = f.h * sy;

    if (fit === 'cover') {
      // 完美模拟 object-fit: cover (保持比例，覆盖容器)
      const s = Math.max(sx, sy);
      sx = sy = s;
      bgW = f.w * s;
      bgH = f.h * s;
      
      // 模拟 object-position (默认 center center)
      let pos = style.objectPosition.split(' ');
      let px = 50, py = 50;
      if (pos.length === 2) {
        px = parseFloat(pos[0]) || 50;
        py = parseFloat(pos[1]) || 50;
      }
      offsetX = (w - bgW) * (px / 100);
      offsetY = (h - bgH) * (py / 100);
    } else if (fit === 'contain') {
      // 完美模拟 object-fit: contain (保持比例，完整显示)
      const s = Math.min(sx, sy);
      sx = sy = s;
      bgW = f.w * s;
      bgH = f.h * s;
      
      let pos = style.objectPosition.split(' ');
      let px = 50, py = 50;
      if (pos.length === 2) {
        px = parseFloat(pos[0]) || 50;
        py = parseFloat(pos[1]) || 50;
      }
      offsetX = (w - bgW) * (px / 100);
      offsetY = (h - bgH) * (py / 100);
    }

    img.style.backgroundImage = 'url("' + f.atlasUrl + '")';
    img.style.backgroundSize = (f.atlasW * sx) + 'px ' + (f.atlasH * sy) + 'px';
    img.style.backgroundPosition = (-f.x * sx + offsetX) + 'px ' + (-f.y * sy + offsetY) + 'px';
    img.style.backgroundRepeat = 'no-repeat';
  }

  function applyAtlas(img, key, originalSrc) {
    const f = index[key];
    img._atlasKey = key;
    img._rawSrc = originalSrc;
    img._atlasFrame = f;
    srcDesc.set.call(img, getTransparent(f.w, f.h));
    scheduleAtlasUpdate(img);
  }

  function applyNormal(img, src) {
    img._atlasKey = null;
    delete img._atlasFrame;
    img._rawSrc = src;
    img.style.backgroundImage = '';
    img.style.backgroundSize = '';
    img.style.backgroundPosition = '';
    img.style.backgroundRepeat = '';
    if (ro && img._atlasRO) { try { ro.unobserve(img); } catch (e) {} img._atlasRO = false; }
    srcDesc.set.call(img, src);
  }

  function handle(img, src) {
    if (!ready) {
      img._pendingSrc = src;
      srcDesc.set.call(img, getTransparent(264, 375));
      pending.push(() => handle(img, img._pendingSrc));
      return;
    }
    if (typeof src === 'string' && src.indexOf('/缩略卡/') >= 0) {
      console.warn('[atlas-hook] ⚠️ 顺序错：atlas-hook 必须在路径重写脚本之前加载！src =', src);
    }
    const k = findKey(src);
    if (k) { applyAtlas(img, k, src); return; }
    applyNormal(img, src);
  }

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this._rawSrc !== undefined ? this._rawSrc : srcDesc.get.call(this); },
    set(v) { this._rawSrc = v; handle(this, v); },
  });

  const nwDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
  const nhDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true, get() { return this._atlasFrame ? this._atlasFrame.w : nwDesc.get.call(this); },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true, get() { return this._atlasFrame ? this._atlasFrame.h : nhDesc.get.call(this); },
  });

  const origDraw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (img) {
    const args = Array.prototype.slice.call(arguments, 1);
    if (img && img._atlasKey) {
      const f = index[img._atlasKey];
      const atlas = atlasImgs[f.atlasUrl];
      if (atlas && atlas.complete) {
        if (args.length === 2) return origDraw.call(this, atlas, f.x, f.y, f.w, f.h, args[0], args[1], f.w, f.h);
        if (args.length === 4) return origDraw.call(this, atlas, f.x, f.y, f.w, f.h, args[0], args[1], args[2], args[3]);
        if (args.length === 8) return origDraw.call(this, atlas, f.x + args[0], f.y + args[1], args[2], args[3], args[4], args[5], args[6], args[7]);
      }
    }
    return origDraw.apply(this, [img].concat(args));
  };

  function handleFromDom(img) {
    const orig = img.getAttribute('data-atlas-src');
    const cur = img.getAttribute('src');

    if (orig) {
      if (!ready) {
        if (!img._pendingSrc) {
          img._pendingSrc = orig;
          img._rawSrc = orig;
          pending.push(() => handle(img, orig));
        }
        return;
      }
      const k = findKey(orig);
      if (k) {
        if (img._atlasKey !== k) {
          img._atlasKey = k;
          img._rawSrc = orig;
          img._atlasFrame = index[k];
          srcDesc.set.call(img, getTransparent(index[k].w, index[k].h));
        }
        scheduleAtlasUpdate(img);
      } else if (img._rawSrc !== orig) {
        img._rawSrc = orig;
        img._atlasKey = null;
        delete img._atlasFrame;
        srcDesc.set.call(img, orig);
      }
      return;
    }

    if (cur && cur.indexOf('data:') === 0) {
      if (img._atlasFrame) scheduleAtlasUpdate(img);
      return;
    }
    if (!cur || cur.indexOf('blob:') === 0) return;

    if (!ready) {
      if (!img._pendingSrc) {
        img._pendingSrc = cur;
        img._rawSrc = cur;
        srcDesc.set.call(img, getTransparent(264, 375));
        pending.push(() => handle(img, cur));
      }
      return;
    }

    const k = findKey(cur);
    if (k) {
      if (img._atlasKey !== k) {
        img._atlasKey = k;
        img._rawSrc = cur;
        img._atlasFrame = index[k];
        srcDesc.set.call(img, getTransparent(index[k].w, index[k].h));
      }
      scheduleAtlasUpdate(img);
    } else if (!img._atlasKey) {
      if (img._rawSrc === undefined) {
        img._rawSrc = cur;
        srcDesc.set.call(img, cur);
      }
    }
  }

  function scanDom() {
    if (domScanned) return;
    domScanned = true;
    document.querySelectorAll('img').forEach(handleFromDom);
  }

  const mo = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG') handleFromDom(node);
          if (node.querySelectorAll) node.querySelectorAll('img').forEach(handleFromDom);
        }
      } else if (m.type === 'attributes' && m.attributeName === 'src' && m.target.tagName === 'IMG') {
        handleFromDom(m.target);
      }
    }
  });

  function startObserver() {
    if (observerStarted) return;
    observerStarted = true;
    mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
    });
  }

  startObserver();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanDom);
  } else {
    scanDom();
  }

  init();
})();