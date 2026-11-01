/* ============================================================
 * 基础音效  audio.js
 * 使用 WebAudio 实时合成（无需音频素材文件）：
 *   - 出牌 / 攻击 / 受击 / 召唤 / 治疗 / 死亡 / 胜利 / 失败 / 金币 / 点击
 *   - 简易五声音阶循环 BGM
 * ========================================================== */
var Sfx = (function () {
  'use strict';

  var ac = null, master = null, bgmGain = null;
  var enabled = true;
  var sfxVol = 0.55, bgmVol = 0.18;
  var bgmTimer = null, bgmIdx = 0, bgmOn = false;

  function ensure() {
    if (ac) return ac;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
      master = ac.createGain(); master.gain.value = enabled ? 1 : 0; master.connect(ac.destination);
      bgmGain = ac.createGain(); bgmGain.gain.value = bgmVol; bgmGain.connect(master);
    } catch (e) { ac = null; }
    return ac;
  }
  function unlock() {
    var a = ensure();
    if (a && a.state === 'suspended') { try { a.resume(); } catch (e) { } }
  }

  function beep(freq, dur, type, vol, when, target) {
    var a = ensure(); if (!a || !enabled) return;
    var t0 = a.currentTime + (when || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime((vol || 0.3) * sfxVol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    o.connect(g); g.connect(target || master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function sweep(f0, f1, dur, type, vol) {
    var a = ensure(); if (!a || !enabled) return;
    var t0 = a.currentTime;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sawtooth';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime((vol || 0.25) * sfxVol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  var LIB = {
    click: function () { beep(680, 0.055, 'square', 0.30); },
    play: function () { beep(520, 0.07, 'square', 0.32); beep(780, 0.09, 'square', 0.24, 0.05); },
    summon: function () { sweep(300, 720, 0.2, 'square', 0.30); beep(900, 0.08, 'triangle', 0.22, 0.11); },
    attack: function () { sweep(520, 120, 0.17, 'sawtooth', 0.34); },
    hit: function () { beep(150, 0.12, 'square', 0.36); beep(90, 0.16, 'sawtooth', 0.26, 0.02); },
    heal: function () { beep(523, 0.1, 'sine', 0.3); beep(784, 0.15, 'sine', 0.26, 0.09); },
    death: function () { sweep(320, 58, 0.32, 'triangle', 0.32); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { beep(f, 0.16, 'square', 0.32, i * 0.12); }); },
    lose: function () { [400, 330, 262, 196].forEach(function (f, i) { beep(f, 0.24, 'triangle', 0.32, i * 0.16); }); },
    coin: function () { beep(1200, 0.06, 'square', 0.28); beep(1600, 0.09, 'square', 0.24, 0.05); },
    relic: function () { [784, 988, 1175].forEach(function (f, i) { beep(f, 0.14, 'triangle', 0.3, i * 0.08); }); }
  };
  function play(name) { if (!enabled) return; var f = LIB[name]; if (f) { unlock(); f(); } }

  /* ---------- BGM：简易五声音阶循环 ---------- */
  var SCALE = [220, 262, 294, 330, 392, 440, 523];
  var SEQ = [0, 2, 4, 2, 5, 4, 2, 0, 3, 4, 6, 4, 2, 0];
  function bgmStart() {
    if (!enabled || bgmTimer) return;
    if (!ensure()) return;
    unlock();
    bgmOn = true; bgmIdx = 0;
    bgmTimer = setInterval(function () {
      if (!bgmOn || !enabled) return;
      var n = SCALE[SEQ[bgmIdx % SEQ.length]];
      beep(n, 0.5, 'triangle', 0.20, 0, bgmGain);
      if (bgmIdx % 4 === 0) beep(n / 2, 0.95, 'sine', 0.16, 0, bgmGain);
      bgmIdx++;
    }, 520);
  }
  function bgmStop() { bgmOn = false; if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; } }

  function setEnabled(v) { enabled = !!v; if (master) master.gain.value = enabled ? 1 : 0; if (!enabled) bgmStop(); else unlock(); }
  function isEnabled() { return enabled; }
  function setVolumes(s, b) {
    if (s != null) sfxVol = Math.max(0, Math.min(1, s));
    if (b != null) { bgmVol = Math.max(0, Math.min(1, b)); if (bgmGain) bgmGain.gain.value = bgmVol; }
  }
  function getVolumes() { return { sfx: sfxVol, bgm: bgmVol }; }

  return {
    play: play, unlock: unlock,
    bgmStart: bgmStart, bgmStop: bgmStop,
    setEnabled: setEnabled, isEnabled: isEnabled,
    setVolumes: setVolumes, getVolumes: getVolumes
  };
})();
