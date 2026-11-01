/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-SOUND.JS
   🎵 BROUILLON v1.0 — MOTEUR DE SONS (zéro fichier audio, zéro Ko)
   ═══════════════════════════════════════════════════════════════════
   Rôle :
     1. Synthétiser TOUS les sons par code (WebAudio) : aucun mp3 à
        télécharger, parfait pour l'offline et les réseaux lents.
     2. Respecter les règles des navigateurs : le son ne démarre qu'à
        partir du PREMIER geste de l'élève (pointerdown/touche).
     3. Préférence mémorisée : localStorage 'arvexa-sound' ('1'/'0').
        Coupure instantanée depuis le menu de la mascotte Arvy.
     4. API publique : window.ARVEXA_SOUND
        .play('nom') — joue un son nommé (liste ci-dessous)
        .enabled     — état actuel (booléen)
        .setEnabled(v) / .toggle()
     5. Journal de test : window.ARVEXA_SOUND_LOG (array) — chaque son
        joué y est poussé (léger, sert aux tests Playwright).

   SONS DISPONIBLES :
     tick      clic de bouton discret            select  choix d'une option (exam)
     pop       confirmation pays 🌍              correct bonne réponse ✨
     error     mauvaise réponse (doux)           fanfare examen réussi 🎉
     ding      révision générée 📖               premium pop-up Premium 👑
     open      modale/confirmation ouverte       celebrate petite célébration
     swoosh    plan rafraîchi (planificateur)    bell    notification 🔔
     online    retour d'internet ✨              ticktock fin de chrono
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'arvexa-sound';
  var enabled = true;
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch (e) {}

  var ctx = null, master = null, unlocked = false;
  var lastPlay = Object.create(null);

  // Journal public pour les tests (borné à 200 entrées).
  if (!Array.isArray(window.ARVEXA_SOUND_LOG)) window.ARVEXA_SOUND_LOG = [];
  function log(name) {
    try {
      var L = window.ARVEXA_SOUND_LOG;
      L.push(name); if (L.length > 200) L.splice(0, L.length - 200);
    } catch (e) {}
  }

  /* ── Initialisation paresseuse du contexte audio ─────────────────── */
  function ensure() {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.14; // volume général volontairement doux
      master.connect(ctx.destination);
    } catch (e) { ctx = null; return false; }
    return true;
  }

  function unlock() {
    if (unlocked) return;
    if (!ensure()) return;
    unlocked = true;
    try { if (ctx.state === 'suspended' && ctx.resume) ctx.resume(); } catch (e) {}
  }
  // Le premier geste déverrouille le son pour toute la session.
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  document.addEventListener('touchstart', unlock, true);

  /* ── Petits helpers de synthèse ──────────────────────────────────── */
  function tone(t0, freq, dur, opts) {
    opts = opts || {};
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, opts.slide), t0 + dur);
    var vol = (opts.vol == null ? 0.5 : opts.vol);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(t0, dur, fFrom, fTo, vol) {
    var n = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(fFrom, t0);
    f.frequency.exponentialRampToValueAtTime(fTo, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  /* ── Les recettes de sons ────────────────────────────────────────── */
  var N = { C5: 523.25, E5: 659.25, G5: 784, C6: 1046.5, A4: 440, Cs5: 554.37, E6: 1318.5 };
  var RECIPES = {
    tick:      function (t) { tone(t, 1650, 0.04, { vol: 0.35, slide: 1250 }); },
    select:    function (t) { tone(t, 950, 0.06, { vol: 0.4 }); },
    pop:       function (t) { tone(t, 380, 0.1, { vol: 0.55, slide: 780, type: 'sine' }); },
    correct:   function (t) { tone(t, N.E5, 0.1, { type: 'triangle', vol: 0.5 });
                               tone(t + 0.09, N.G5, 0.14, { type: 'triangle', vol: 0.5 }); },
    error:     function (t) { tone(t, 150, 0.09, { type: 'square', vol: 0.16 });
                               tone(t + 0.1, 118, 0.12, { type: 'square', vol: 0.16 }); },
    fanfare:   function (t) { var s = 0.11;
                               tone(t,            N.C5, s, { type: 'triangle', vol: 0.5 });
                               tone(t + s,        N.E5, s, { type: 'triangle', vol: 0.5 });
                               tone(t + 2 * s,    N.G5, s, { type: 'triangle', vol: 0.5 });
                               tone(t + 3 * s,    N.C6, 0.34, { type: 'triangle', vol: 0.55 });
                               tone(t + 3 * s,    N.E5, 0.34, { type: 'sine', vol: 0.3 });
                               tone(t + 3 * s,    N.G5, 0.34, { type: 'sine', vol: 0.3 }); },
    ding:      function (t) { tone(t, 1245, 0.32, { vol: 0.4 });
                               tone(t, 2490, 0.14, { vol: 0.14 }); },
    premium:   function (t) { var s = 0.085;
                               tone(t,            N.A4,  s, { type: 'triangle', vol: 0.45 });
                               tone(t + s,        N.Cs5, s, { type: 'triangle', vol: 0.45 });
                               tone(t + 2 * s,    N.E5,  s, { type: 'triangle', vol: 0.45 });
                               tone(t + 3 * s,    N.A4 * 2, 0.3, { type: 'triangle', vol: 0.5 });
                               tone(t + 3 * s,    N.Cs5 * 2, 0.3, { type: 'sine', vol: 0.16 }); },
    open:      function (t) { tone(t, 660, 0.07, { vol: 0.3 });
                               tone(t + 0.06, 880, 0.09, { vol: 0.26 }); },
    celebrate: function (t) { var f = [523.25, 659.25, 784, 1046.5, 1318.5];
                               for (var i = 0; i < f.length; i++)
                                 tone(t + i * 0.07, f[i], 0.09, { type: 'sine', vol: 0.42 }); },
    swoosh:    function (t) { noise(t, 0.26, 320, 1400, 0.28); },
    bell:      function (t) { tone(t, 880, 0.4, { vol: 0.32 });
                               tone(t, 1760, 0.2, { vol: 0.1 }); },
    online:    function (t) { tone(t, N.C5, 0.1, { vol: 0.4 });
                               tone(t + 0.1, N.G5, 0.16, { vol: 0.42 }); },
    ticktock:  function (t) { tone(t, 1000, 0.03, { vol: 0.22 }); }
  };

  /* ── Lecture ─────────────────────────────────────────────────────── */
  function play(name) {
    if (!enabled || document.hidden) return false;
    if (!ensure() || !unlocked) return false;
    var now = Date.now();
    var gap = (name === 'tick') ? 70 : 380; // anti-doublon
    if (lastPlay[name] && now - lastPlay[name] < gap) return false;
    var r = RECIPES[name];
    if (!r) return false;
    lastPlay[name] = now;
    try { r(ctx.currentTime); log(name); return true; }
    catch (e) { return false; }
  }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('arvexa-sound-change', { detail: { enabled: enabled } })); } catch (e) {}
  }

  /* ── Observateur de pop-up du site (Premium 👑 / confirmations) ─────
     Les pages ouvrent leurs pop-up en ajoutant la classe « show » à des
     overlays : .arvexa-popup-overlay (Premium) et .arvexa-confirm-overlay
     (confirmations arvexa-confirm.js). On joue un son à l'APPARITION
     seulement (jamais à la fermeture), avec anti-rebond de 1,5 s. */
  var lastOverlayAt = 0, overlayVisible = false;
  function checkOverlays() {
    var now = Date.now();
    var prem = document.querySelector('.arvexa-popup-overlay.show');
    var conf = document.querySelector('.arvexa-confirm-overlay.show');
    var vis = !!(prem || conf);
    if (vis && !overlayVisible && now - lastOverlayAt > 1500) {
      lastOverlayAt = now;
      play(prem ? 'premium' : 'open');
    }
    overlayVisible = vis;
  }
  try {
    var moOv = new MutationObserver(function () {
      if (moOv._t) return;
      moOv._t = setTimeout(function () { moOv._t = null; checkOverlays(); }, 220);
    });
    moOv.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  } catch (e) {}

  window.ARVEXA_SOUND = {
    play: play,
    setEnabled: setEnabled,
    toggle: function () { setEnabled(!enabled); return enabled; },
    get enabled() { return enabled; }
  };
})();
