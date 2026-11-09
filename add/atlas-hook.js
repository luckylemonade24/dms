/* atlas-hook.js —— 回退 snap，全局 pixelated，逐 frame scale + 支持混合模式 */
(function () {
  'use strict';

  const ATLAS_URL = '卡牌/texture.webp';
  const BG_IMAGE_URL = 'url("' + ATLAS_URL + '")';
  const DATA_URL  = '卡牌/data.json';
  const CARD_W    = 264;
  const CARD_H    = 375;
  
  // 图层总数（跟 extract.py 输出的层数保持一致）
  const LAYERS_N  = 19; 
  const KEY_CACHE_MAX = 1000;

  // 整数混合模式映射回 CSS
  const BLEND_CSS = [
    '', 'multiply', 'screen', 'overlay',
    'darken', 'lighten', 'color-dodge', 'color-burn',
    'hard-light', 'soft-light', 'difference', 'exclusion',
    'hue', 'saturation', 'color', 'luminosity'
  ];

  const index      = Object.create(null);
  const layerIndex = Object.create(null);
  const frames     = [];
  const frameCache = Object.create(null);
  const pending       = new Map();
  const pendingUpdate = new Set();
  const keyCache      = new Map();
  const posCache      = new Map();

  const _valid = [];
  const _needsOverlay = [];
  const _sizesW = [];
  const _sizesH = [];
  const _sizesOl = [];
  const _sizesOt = [];
  const _sizesOw = [];
  const _sizesOh = [];
  const _newParents = [];
  const _seenParents = new Set();

  let ready = false;
  let rafScheduled = false;
  let observerStarted = false;
  let domScanned = false;
  let warnedOrder = false;
  let atlasW = 0;
  let atlasH = 0;

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const nwDesc  = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
  const nhDesc  = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');

  const TRANSPARENT_CARD =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="264" height="375"/>');

  const ATLAS_PATH_RE = /卡牌\/高清卡\/[^"'/]+详情\.png/i;
  const IMG_SRC_RE    = /(<img\b[^>]*?\ssrc\s*=\s*)(["'])([^"']*?卡牌\/高清卡\/[^"']*?详情\.png)\2/gi;

  const ATL_STYLE = document.createElement('style');
  ATL_STYLE.textContent =
    '.__atl_layer{position:absolute;background-repeat:no-repeat;' +
    'image-rendering:pixelated !important;' +
    'background-image:' + BG_IMAGE_URL + ';background-size:var(--atl-size);}';
  document.head.appendChild(ATL_STYLE);

  function isAtlasPath(s) { return typeof s === 'string' && ATLAS_PATH_RE.test(s); }

  function buildFrame(fid) {
    if (fid < 0) return null;
    const cached = frameCache[fid];
    if (cached) return cached;
    const p = fid * 6;
    const fr = {
      x: frames[p], y: frames[p + 1],
      w: frames[p + 2], h: frames[p + 3],
      scale: frames[p + 5]
    };
    frameCache[fid] = fr;
    return fr;
  }

  function rewriteHTML(html) {
    if (typeof html !== 'string' || html.indexOf('卡牌/高清卡/') < 0) return html;
    return html.replace(IMG_SRC_RE, function (m, pre, q, url) {
      return pre + q + TRANSPARENT_CARD + q + ' data-atlas-src=' + q + url + q;
    });
  }

  const origInnerHTMLDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (origInnerHTMLDesc && origInnerHTMLDesc.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: true,
      get() { return origInnerHTMLDesc.get.call(this); },
      set(v) { origInnerHTMLDesc.set.call(this, rewriteHTML(v)); },
    });
  }

  const origInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
  Element.prototype.insertAdjacentHTML = function (pos, html) {
    return origInsertAdjacentHTML.call(this, pos, rewriteHTML(html));
  };

  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this.tagName === 'IMG' && name === 'src' &&
        typeof value === 'string' && isAtlasPath(value)) {
      origSetAttribute.call(this, 'data-atlas-src', value);
      return origSetAttribute.call(this, name, TRANSPARENT_CARD);
    }
    return origSetAttribute.call(this, name, value);
  };

  async function init() {
    preloadTextureAsync();
    try {
      const data = await fetch(DATA_URL, { cache: 'default' }).then(r => r.json());
      const f = data.f, c = data.c, u = data.u;

      atlasW = data.a[0][1];
      atlasH = data.a[0][2];

      for (let i = 0; i < f.length; i++) frames.push(f[i]);

      for (let i = 0; i < u.length; i += 4) {
        if (u[i + 1] >= 0) index[u[i]] = buildFrame(u[i + 1]);
      }

      // 步长：1个卡名 + N层 * 4个参数(fid, dx, dy, blend)
      const stride = 1 + LAYERS_N * 4;
      for (let i = 0; i < c.length; i += stride) {
        const arr = new Array(LAYERS_N);
        for (let j = 0; j < LAYERS_N; j++) {
          const p = i + 1 + j * 4;
          const fid = c[p];
          arr[j] = { fid, dx: c[p + 1], dy: c[p + 2], blend: c[p + 3] };
          if (fid >= 0) buildFrame(fid);
        }
        layerIndex[c[i]] = arr;
      }
    } catch (e) {
      console.error('[atlas-hook] init failed:', e);
      window.__atlasFailed = true;
    } finally {
      ready = true;
      const tasks = Array.from(pending);
      pending.clear();
      for (let i = 0; i < tasks.length; i++) {
        try { handle(tasks[i][0], tasks[i][1]); } catch (e) { console.error(e); }
      }
      try { scanDom(); } catch (e) {}
      window.__atlasReady = true;
    }
  }

  function preloadTextureAsync() {
    const img = new Image();
    img.onload = () => { if (img.decode) img.decode().catch(() => {}); };
    img.onerror = () => { window.__atlasFailed = true; };
    srcDesc.set.call(img, ATLAS_URL);
  }

  function findKey(v) {
    if (!v || typeof v !== 'string') return null;
    if (keyCache.has(v)) return keyCache.get(v);

    let result = null;
    const c0 = v.charCodeAt(0);
    if (!(c0 === 100 && v.charCodeAt(1) === 97) &&
        !(c0 === 98  && v.charCodeAt(1) === 108)) {
      let dec = v;
      if (v.indexOf('%') >= 0) { try { dec = decodeURIComponent(v); } catch (e) { dec = v; } }
      const q = dec.indexOf('?');
      if (q >= 0) dec = dec.slice(0, q);
      const slash = dec.lastIndexOf('/');
      let name = slash >= 0 ? dec.slice(slash + 1) : dec;
      if (name.length > 6 && name.indexOf('详情') >= 0) {
        const tail = name.slice(-6);
        if (tail === '详情.png' || tail.toLowerCase() === '详情.png') {
          name = name.slice(0, -6);
        }
      }
      if (index[name] || layerIndex[name]) result = name;
    }

    if (keyCache.size > KEY_CACHE_MAX) keyCache.clear();
    keyCache.set(v, result);
    return result;
  }

  function scheduleAtlasUpdate(img) {
    if (!img._atlasKey) return;
    pendingUpdate.add(img);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flushAtlasUpdates);
    }
  }

  function flushAtlasUpdates() {
    rafScheduled = false;
    if (!pendingUpdate.size) return;
    processBatch(pendingUpdate);
    pendingUpdate.clear();
  }

  function processBatch(imgs) {
    _valid.length = 0;
    _needsOverlay.length = 0;

    for (const img of imgs) {
      const k = img._atlasKey;
      if (!k) continue;
      _valid.push(img);
      if (layerIndex[k]) _needsOverlay.push(img);
    }
    if (!_valid.length) return;

    _newParents.length = 0;
    _seenParents.clear();
    for (let i = 0; i < _needsOverlay.length; i++) {
      const p = _needsOverlay[i].parentNode;
      if (p && !p._atlas_checked && !_seenParents.has(p)) {
        _seenParents.add(p);
        _newParents.push(p);
      }
    }
    const parentPos = new Array(_newParents.length);
    for (let i = 0; i < _newParents.length; i++) parentPos[i] = getComputedStyle(_newParents[i]).position;

    for (let i = 0; i < _newParents.length; i++) {
      const p = _newParents[i];
      if (parentPos[i] === 'static') p.style.position = 'relative';
      if (!p.style.isolation) p.style.isolation = 'isolate';
      p._atlas_checked = true;
    }

    _sizesW.length = 0;
    _sizesH.length = 0;
    _sizesOl.length = 0;
    _sizesOt.length = 0;
    _sizesOw.length = 0;
    _sizesOh.length = 0;
    for (let i = 0; i < _valid.length; i++) {
      const img = _valid[i];
      const hasLayer = !!layerIndex[img._atlasKey];
      _sizesW.push(img.clientWidth  || img.offsetWidth  || CARD_W);
      _sizesH.push(img.clientHeight || img.offsetHeight || CARD_H);
      if (hasLayer) {
        _sizesOl.push(img.offsetLeft);
        _sizesOt.push(img.offsetTop);
        _sizesOw.push(img.offsetWidth);
        _sizesOh.push(img.offsetHeight);
      } else {
        _sizesOl.push(0); _sizesOt.push(0); _sizesOw.push(0); _sizesOh.push(0);
      }
    }

    for (let i = 0; i < _valid.length; i++) {
      const img = _valid[i];
      if (img._atlasFit === undefined) {
        const cs = getComputedStyle(img);
        img._atlasFit = cs.objectFit || 'fill';
        img._atlasPos = cs.objectPosition || '50% 50%';
      }
    }

    for (let i = 0; i < _valid.length; i++) {
      const img = _valid[i];
      const k = img._atlasKey;
      const w  = _sizesW[i];
      const h  = _sizesH[i];
      const ol = _sizesOl[i];
      const ot = _sizesOt[i];
      const ow = _sizesOw[i];
      const oh = _sizesOh[i];

      if (layerIndex[k]) {
        let overlay = img._atlasOverlay;
        const parent = img.parentNode;
        if (!overlay || !overlay.isConnected || overlay.parentNode !== parent) {
          if (overlay && overlay.parentNode) overlay.remove();
          if (parent) {
            overlay = document.createElement('div');
            overlay.className = '__atlas_overlay';
            overlay.style.cssText =
              'position:absolute;pointer-events:none;overflow:hidden;z-index:-1;' +
              'content-visibility:auto;contain-intrinsic-size:auto 264px 375px;' +
              'left:' + ol + 'px;top:' + ot + 'px;width:' + ow + 'px;height:' + oh + 'px;';
            overlay._lastCss =
              'position:absolute;pointer-events:none;overflow:hidden;z-index:-1;' +
              'content-visibility:auto;contain-intrinsic-size:auto 264px 375px;' +
              'left:' + ol + 'px;top:' + ot + 'px;width:' + ow + 'px;height:' + oh + 'px;';
            parent.insertBefore(overlay, img);
            img._atlasOverlay = overlay;
          }
        }
      }

      applyCard(img, k, w, h, ol, ot, ow, oh, img._atlasFit, img._atlasPos);
    }
  }

  function parsePos(posRaw) {
    if (!posRaw) return [50, 50];
    const cached = posCache.get(posRaw);
    if (cached) return cached;

    let px = 50, py = 50;
    const parts = posRaw.split(/\s+/);
    if (parts.length >= 2) {
      const a = parts[0], b = parts[1];
      if (a === 'left') px = 0; else if (a === 'right') px = 100;
      else if (a === 'top') py = 0; else if (a === 'bottom') py = 100;
      else { const n = parseFloat(a); if (!isNaN(n)) px = n; }
      if (b === 'top') py = 0; else if (b === 'bottom') py = 100;
      else if (b === 'left') px = 0; else if (b === 'right') px = 100;
      else { const n = parseFloat(b); if (!isNaN(n)) py = n; }
    }
    const r = [px, py];
    posCache.set(posRaw, r);
    return r;
  }

  function layerDiv(left, top, fw, fh, bx, by, as, blend) {
    const scaleX = as;
    const scaleY = as;
    let s = '<div class="__atl_layer" style="left:' + left + 'px;top:' + top + 'px;' +
            'width:' + (fw * scaleX) + 'px;height:' + (fh * scaleY) + 'px;';
            
    if (blend && blend !== 0) {
      s += 'mix-blend-mode:' + BLEND_CSS[blend] + ';';
    }
    
    if (as !== 1) {
      s += 'background-size:' + (atlasW * scaleX) + 'px ' + (atlasH * scaleY) + 'px;';
    }
    s += 'background-position:' + (-bx * scaleX) + 'px ' + (-by * scaleY) + 'px;"></div>';
    return s;
  }

  function buildLayers(overlay, name, sx, sy, offsetX, offsetY) {
    let html = '';
    const all = index['all'];
    if (all) {
      // 底图没有混合模式，传 0
      html += layerDiv(0, 0, CARD_W, CARD_H, all.x, all.y, all.scale, 0);
    }

    const layers = layerIndex[name];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      if (L.fid < 0) continue;
      const f = frameCache[L.fid];
      if (!f) continue;
      html += layerDiv(L.dx, L.dy, f.w, f.h, f.x, f.y, f.scale, L.blend);
    }

    // 创建 264x375 的虚拟画布，再整体缩放适配 193px 的容器
    const wrapperStyle = `position:absolute;left:${offsetX}px;top:${offsetY}px;width:${CARD_W}px;height:${CARD_H}px;transform-origin:0 0;transform:scale(${sx}, ${sy});`;
    overlay.innerHTML = `<div class="atl-wrapper" style="${wrapperStyle}">${html}</div>`;
    overlay._lastName = name;
  }

  function updateLayers(overlay, name, sx, sy, offsetX, offsetY) {
    let wrapper = overlay.firstChild;
    if (!wrapper) return;

    wrapper.style.left = offsetX + 'px';
    wrapper.style.top = offsetY + 'px';
    wrapper.style.transform = `scale(${sx}, ${sy})`;

    let child = wrapper.firstChild;
    if (!child) return;

    const all = index['all'];
    if (all) {
      const as = all.scale;
      const st = child.style;
      st.left = '0px';
      st.top = '0px';
      st.width = (CARD_W * as) + 'px';
      st.height = (CARD_H * as) + 'px';
      if (as !== 1) st.backgroundSize = (atlasW * as) + 'px ' + (atlasH * as) + 'px';
      st.backgroundPosition = (-all.x * as) + 'px ' + (-all.y * as) + 'px';
      st.mixBlendMode = '';
      child = child.nextSibling;
    }

    const layers = layerIndex[name];
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      if (L.fid < 0) continue;
      const f = frameCache[L.fid];
      if (!f) continue;
      if (!child) return;
      const as = f.scale;
      const st = child.style;
      st.left = L.dx + 'px';
      st.top = L.dy + 'px';
      st.width = (f.w * as) + 'px';
      st.height = (f.h * as) + 'px';
      if (as !== 1) st.backgroundSize = (atlasW * as) + 'px ' + (atlasH * as) + 'px';
      st.backgroundPosition = (-f.x * as) + 'px ' + (-f.y * as) + 'px';
      
      // 动态更新混合模式
      st.mixBlendMode = (L.blend && L.blend !== 0) ? BLEND_CSS[L.blend] : '';
      
      child = child.nextSibling;
    }
  }

  function applyCard(img, name, elemW, elemH, ol, ot, ow, oh, fit, posRaw) {
    if (img._atlasName === name &&
        img._atlasW === elemW &&
        img._atlasH === elemH &&
        img._atlasOl === ol &&
        img._atlasOt === ot &&
        img._atlasOw === ow &&
        img._atlasOh === oh) {
      return;
    }
    img._atlasName = name;
    img._atlasW = elemW;
    img._atlasH = elemH;
    img._atlasOl = ol;
    img._atlasOt = ot;
    img._atlasOw = ow;
    img._atlasOh = oh;

    const fr = index[name];
    if (fr) {
      removeOverlay(img);
      if (img._atlasCleared !== false) {
        img._atlasCleared = false;
        img.style.contentVisibility = 'auto';
        img.style.containIntrinsicSize = 'auto 264px 375px';
      }
      img.style.imageRendering = 'pixelated';

      const as = fr.scale;
      const origW = fr.w * as;
      const origH = fr.h * as;

      let sx = elemW / origW, sy = elemH / origH;
      let offsetX = 0, offsetY = 0;
      if (fit === 'cover' || fit === 'contain') {
        const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
        sx = sy = s;
        const pp = parsePos(posRaw);
        offsetX = (elemW - origW * s) * (pp[0] / 100);
        offsetY = (elemH - origH * s) * (pp[1] / 100);
      }
      const scaleX = as * sx, scaleY = as * sy;
      const st = img.style;
      st.backgroundImage    = BG_IMAGE_URL;
      st.backgroundSize     = (atlasW * scaleX) + 'px ' + (atlasH * scaleY) + 'px';
      st.backgroundPosition = (-fr.x * scaleX + offsetX) + 'px ' + (-fr.y * scaleY + offsetY) + 'px';
      st.backgroundRepeat   = 'no-repeat';
      return;
    }

    const layers = layerIndex[name];
    if (!layers) return;

    if (img._atlasCleared !== true) {
      img._atlasCleared = true;
      img.style.contentVisibility = '';
      img.style.containIntrinsicSize = '';
      img.style.backgroundImage = '';
      img.style.backgroundSize = '';
      img.style.backgroundPosition = '';
      img.style.backgroundRepeat = '';
      img.style.imageRendering = '';
    }

    const overlay = img._atlasOverlay;
    if (!overlay) return;

    let sx = elemW / CARD_W, sy = elemH / CARD_H;
    let offsetX = 0, offsetY = 0;
    if (fit === 'cover' || fit === 'contain') {
      const s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
      sx = sy = s;
      const pp = parsePos(posRaw);
      offsetX = (elemW - CARD_W * s) * (pp[0] / 100);
      offsetY = (elemH - CARD_H * s) * (pp[1] / 100);
    }

    const bgSize = atlasW + 'px ' + atlasH + 'px';
    const cssStr =
      'position:absolute;pointer-events:none;overflow:hidden;z-index:-1;' +
      'content-visibility:auto;contain-intrinsic-size:auto 264px 375px;' +
      'left:' + ol + 'px;top:' + ot + 'px;width:' + ow + 'px;height:' + oh + 'px;';

    if (overlay._lastCss !== cssStr) {
      overlay.style.cssText = cssStr;
      overlay._lastCss = cssStr;
      overlay._lastBgSize = null;
    }

    if (overlay._lastBgSize !== bgSize) {
      overlay.style.setProperty('--atl-size', bgSize);
      overlay._lastBgSize = bgSize;
    }

    if (overlay._lastName !== name) {
      buildLayers(overlay, name, sx, sy, offsetX, offsetY);
    } else {
      updateLayers(overlay, name, sx, sy, offsetX, offsetY);
    }
  }

  function removeOverlay(img) {
    if (img._atlasOverlay && img._atlasOverlay.parentNode) img._atlasOverlay.remove();
    img._atlasOverlay = null;
  }

  function applyAtlas(img, key, originalSrc) {
    if (img._atlasKey !== key) {
      img._atlasFit = undefined;
      img._atlasPos = undefined;
    }
    img._atlasKey = key;
    img._rawSrc = originalSrc;
    if (srcDesc.get.call(img) !== TRANSPARENT_CARD) {
      srcDesc.set.call(img, TRANSPARENT_CARD);
    }
    scheduleAtlasUpdate(img);
  }

  function applyNormal(img, src) {
    if (img._atlasKey) {
      img._atlasKey = null;
      img._atlasName = null;
      img._atlasFit = undefined;
      img._atlasPos = undefined;
      img._atlasCleared = undefined;
      pendingUpdate.delete(img);
      removeOverlay(img);
      const st = img.style;
      st.contentVisibility = '';
      st.containIntrinsicSize = '';
      st.backgroundImage = '';
      st.backgroundSize = '';
      st.backgroundPosition = '';
      st.backgroundRepeat = '';
      st.imageRendering = '';
    }
    img._rawSrc = src;
    if (srcDesc.get.call(img) !== src) srcDesc.set.call(img, src);
  }

  function handle(img, src) {
    if (!ready) {
      img._pendingSrc = src;
      img._rawSrc = src;
      pending.set(img, src);
      if (srcDesc.get.call(img) !== TRANSPARENT_CARD) srcDesc.set.call(img, TRANSPARENT_CARD);
      return;
    }
    if (!warnedOrder && typeof src === 'string' && src.indexOf('/缩略卡/') >= 0) {
      warnedOrder = true;
      console.warn('[atlas-hook] ⚠️ 顺序错：atlas-hook 必须在路径重写脚本之前加载！src =', src);
    }
    const k = findKey(src);
    if (k) { applyAtlas(img, k, src); return; }
    applyNormal(img, src);
  }

  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this._rawSrc !== undefined ? this._rawSrc : srcDesc.get.call(this); },
    set(v) {
      this._rawSrc = v;
      if (typeof v !== 'string' || v.length < 8) { applyNormal(this, v); return; }
      const c0 = v.charCodeAt(0);
      if (c0 === 100 && v.charCodeAt(1) === 97) {
        if (!this._atlasKey) applyNormal(this, v);
        return;
      }
      if (c0 === 98 && v.charCodeAt(1) === 108) { applyNormal(this, v); return; }
      handle(this, v);
    },
  });

  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get() { return this._atlasKey ? CARD_W : nwDesc.get.call(this); },
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get() { return this._atlasKey ? CARD_H : nhDesc.get.call(this); },
  });

  const origDraw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (img) {
    if (img && img._atlasKey) {
      const fr = index[img._atlasKey];
      if (fr) {
        const n = arguments.length;
        if (n === 3) return origDraw.call(this, img, fr.x, fr.y, fr.w, fr.h, arguments[1], arguments[2], fr.w, fr.h);
        if (n === 5) return origDraw.call(this, img, fr.x, fr.y, fr.w, fr.h, arguments[1], arguments[2], arguments[3], arguments[4]);
        if (n === 9) return origDraw.call(this, img, fr.x + arguments[1], fr.y + arguments[2], arguments[3], arguments[4], arguments[5], arguments[6], arguments[7], arguments[8]);
      }
    }
    return origDraw.apply(this, arguments);
  };

  function handleFromDom(img) {
    const orig = img.getAttribute('data-atlas-src');
    if (orig) {
      if (!ready) {
        if (!img._pendingSrc) {
          img._pendingSrc = orig;
          img._rawSrc = orig;
          pending.set(img, orig);
        }
        return;
      }
      const k = findKey(orig);
      if (k) {
        if (img._atlasKey !== k) {
          img._atlasKey = k;
          img._rawSrc = orig;
          img._atlasFit = undefined;
          img._atlasPos = undefined;
          if (srcDesc.get.call(img) !== TRANSPARENT_CARD) srcDesc.set.call(img, TRANSPARENT_CARD);
        }
        scheduleAtlasUpdate(img);
      } else if (img._rawSrc !== orig) {
        img._rawSrc = orig;
        img._atlasKey = null;
        img._atlasName = null;
        img._atlasFit = undefined;
        img._atlasPos = undefined;
        img._atlasCleared = undefined;
        pendingUpdate.delete(img);
        removeOverlay(img);
        srcDesc.set.call(img, orig);
      }
      return;
    }

    const cur = img.getAttribute('src');
    if (!cur) return;
    const c0 = cur.charCodeAt(0);
    if (c0 === 100 && cur.charCodeAt(1) === 97) {
      if (img._atlasKey) scheduleAtlasUpdate(img);
      return;
    }
    if (c0 === 98 && cur.charCodeAt(1) === 108) return;

    if (!ready) {
      if (!img._pendingSrc) {
        img._pendingSrc = cur;
        img._rawSrc = cur;
        pending.set(img, cur);
        srcDesc.set.call(img, TRANSPARENT_CARD);
      }
      return;
    }

    const k = findKey(cur);
    if (k) {
      if (img._atlasKey !== k) {
        img._atlasKey = k;
        img._rawSrc = cur;
        img._atlasFit = undefined;
        img._atlasPos = undefined;
        if (srcDesc.get.call(img) !== TRANSPARENT_CARD) srcDesc.set.call(img, TRANSPARENT_CARD);
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
    const imgs = document.getElementsByTagName('img');
    for (let i = 0; i < imgs.length; i++) handleFromDom(imgs[i]);
  }

  const mo = new MutationObserver(mutations => {
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.type === 'childList') {
        const added = m.addedNodes;
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (node.nodeType !== 1) continue;
          if (node.className === '__atl_layer' || node.className === '__atlas_overlay' || node.className === 'atl-wrapper') continue;
          if (node.tagName === 'IMG') handleFromDom(node);
          if (node.getElementsByTagName) {
            const imgs = node.getElementsByTagName('img');
            for (let k = 0; k < imgs.length; k++) handleFromDom(imgs[k]);
          }
        }
      } else if (m.type === 'attributes' && m.attributeName === 'src' && m.target.tagName === 'IMG') {
        if (m.target._atlasKey) {
          const s = m.target.getAttribute('src');
          if (s && s.charCodeAt(0) === 100 && s.charCodeAt(1) === 97) continue;
        }
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanDom);
  else scanDom();

  init();
})();