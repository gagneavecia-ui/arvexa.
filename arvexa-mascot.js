/* ═══════════════════════════════════════════════════════════════════
   ARVEXA SCHOOL — ARVEXA-MASCOT.JS
   🦉 BROUILLON v1.0 — « ARVY », LE MINI PERSONNAGE DU SITE
   ═══════════════════════════════════════════════════════════════════
   Rôle :
     1. Dessiner Arvy (petit hibou scolaire) en SVG PUR dans le code —
        aucune image à télécharger (~5 Ko), animé uniquement en CSS.
     2. S'AJOUTER par-dessus le site sans rien modifier : les pages
        restent identiques, Arvy vit dans son propre coin en bas à
        droite. 100 % tokens du site → mode clair/sombre automatique.
     3. Réagir à la vie du site :
        - exam réussi (≥ 50 %)  → saute de joie + confettis 🎉
        - exam < 50 %           → encourage doucement 💪
        - pays confirmé 🌍, révision prête 📖, plan rafraîchi 🗓️,
          retour d'internet ✨ → bulle de message
        - inactif 3 min         → s'endort 😴 (un clic le réveille)
     4. Menu au tap : Sons ON/OFF (lié à ARVEXA_SOUND), Salut 👋,
        Cacher Arvy. Préférence « caché » mémorisée
        (localStorage 'arvexa-mascot' = '0') ; ?mascot=1 le fait
        réapparaître et efface la préférence ; ?mascot=0 le cache.
     5. API de test : window.ARVEXA_MASCOT { say, celebrate, hide, show }.
     Accessibilité : aria-label, respect de prefers-reduced-motion.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.ARVEXA_MASCOT) return; // déjà chargé

  /* ── Réglages ────────────────────────────────────────────────────── */
  var KEY_HIDDEN = 'arvexa-mascot';
  var qs = '';
  try { qs = window.location.search || ''; } catch (e) {}
  var forcedShow = /mascot=1/.test(qs);
  var forcedHide = /mascot=0/.test(qs);
  var hidden = false;
  try {
    if (forcedShow) { localStorage.removeItem(KEY_HIDDEN); hidden = false; }
    else if (forcedHide) hidden = true;
    else hidden = localStorage.getItem(KEY_HIDDEN) === '0';
  } catch (e) {}

  var REDUCED = false;
  try { REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var lastSay = 0, lastCelebrate = 0, idleTimer = null, bubbleTimer = null;

  var HELLOS = ["Salut, moi c'est Arvy ! 👋", "Prêt(e) à réviser ? ✨", "Je reste dans ce coin si tu as besoin !"];
  var PRAISE = ['Bravo ! 🎉', 'Excellent travail ! 🏆', 'Tu progresses vite ! ✨'];
  var OKAY   = ['Passable, continue ! 💪', 'Tu y es presque ! 📚'];
  var COURAGE = ['Courage, on révise ensemble ! 💪', 'Chaque erreur fait grandir ! 🌱', 'Ne lâche rien, tu vas y arriver ! 💪'];

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ── CSS injecté (100 % tokens, replis sombres comme le site) ────── */
  var CSS = ''
    + '.axm-root{position:fixed;right:16px;bottom:calc(18px + env(safe-area-inset-bottom,0px));'
    + 'width:64px;height:64px;z-index:2000000000;border:none;background:none;padding:0;margin:0;'
    + 'cursor:pointer;-webkit-tap-highlight-color:transparent;outline-offset:4px;'
    + 'font-family:inherit;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35))}'
    + '.axm-root:active .axm-svg{transform:scale(.94)}'
    + '@media (max-width:480px){.axm-root{width:58px;height:58px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}}'
    + '.axm-svg{width:100%;height:100%;display:block;transform-origin:50% 90%;'
    + (REDUCED ? '' : 'animation:axm-bob 3.4s ease-in-out infinite;') + '}'
    + '@keyframes axm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}'
    + '.axm-root.axm-jump .axm-svg{' + (REDUCED ? '' : 'animation:axm-jump .5s ease-in-out 2, axm-bob 3.4s ease-in-out 1s infinite;') + '}'
    + '@keyframes axm-jump{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-12px) rotate(-4deg)}60%{transform:translateY(0) rotate(0)}80%{transform:translateY(-6px) rotate(3deg)}}'
    + '.axm-root.axm-tilt .axm-svg{' + (REDUCED ? '' : 'animation:axm-tilt 1.3s ease-in-out;') + '}'
    + '@keyframes axm-tilt{0%,100%{transform:rotate(0)}20%{transform:rotate(-7deg)}45%{transform:rotate(6deg)}70%{transform:rotate(-4deg)}}'
    + '.axm-eyelid{transform-origin:center top;transform:scaleY(0)}'
    + '.axm-root.axm-sleep .axm-eyelid{transform:scaleY(1)}'
    + '.axm-root:not(.axm-sleep) .axm-eyelid{' + (REDUCED ? 'transform:scaleY(.06)'
      : 'animation:axm-blink 4.6s linear infinite;') + '}'
    + '@keyframes axm-blink{0%,95.5%,100%{transform:scaleY(0)}97.5%{transform:scaleY(1)}}'
    + '.axm-root.axm-wave .axm-wing-r{transform-origin:78% 22%;'
    + (REDUCED ? '' : 'animation:axm-wave .8s ease-in-out 2;') + '}'
    + '@keyframes axm-wave{0%,100%{transform:rotate(0)}30%{transform:rotate(38deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(28deg)}}'
    + '.axm-root.axm-sleep .axm-eye-pupil{opacity:.25}'
    /* Bulles (discussions + menu) */
    + '.axm-bubble{position:fixed;z-index:2000000001;max-width:min(78vw,260px);'
    + 'background:var(--bg-surface,#141414);color:var(--text-light,#F5F0E8);'
    + 'border:1px solid rgba(184,134,11,.4);border-radius:14px;border-bottom-right-radius:4px;'
    + 'padding:10px 13px;font-size:13.5px;line-height:1.45;'
    + 'box-shadow:0 10px 26px rgba(0,0,0,.4);overflow-wrap:anywhere;'
    + 'opacity:0;pointer-events:none;transform:translateY(6px);transition:opacity .18s,transform .18s}'
    + '.axm-bubble.axm-show{opacity:1;pointer-events:auto;transform:translateY(0)}'
    + '.axm-bubble .axm-menu-title{font-weight:700;color:var(--accent-bright,#E0B84A);font-size:12.5px;'
    + 'text-transform:uppercase;letter-spacing:.4px;margin:0 0 8px}'
    + '.axm-bubble button{display:flex;align-items:center;gap:8px;width:100%;margin:4px 0;'
    + 'background:rgba(184,134,11,.1);border:1px solid rgba(184,134,11,.25);color:inherit;'
    + 'border-radius:999px;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;text-align:left}'
    + '.axm-bubble button:hover{background:rgba(184,134,11,.2)}'
    /* Confettis */
    + '.axm-confetti{position:fixed;z-index:2000000002;width:7px;height:11px;border-radius:2px;'
    + 'pointer-events:none;top:0;left:0;will-change:transform,opacity;}'
    + (REDUCED ? '' :
        '@keyframes axm-fall{0%{opacity:1;transform:translate(0,0) rotate(0)}'
      + '100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(var(--rot))}}')
    /* Zzz de sommeil */
    + '.axm-zzz{position:fixed;z-index:2000000001;font-size:13px;font-weight:700;'
    + 'color:var(--text-dim,#8A8A7A);pointer-events:none;'
    + (REDUCED ? '' : 'animation:axm-z 2.6s ease-out infinite;') + '}'
    + '@keyframes axm-z{0%{opacity:0;transform:translate(0,0)}25%{opacity:1}100%{opacity:0;transform:translate(-26px,-44px)}}';

  /* ── Le personnage en SVG pur ────────────────────────────────────── */
  var SVG = ''
    + '<svg class="axm-svg" viewBox="0 0 120 120" aria-hidden="true">'
    + '<defs><linearGradient id="axm-gold" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#E8C565"/><stop offset="1" stop-color="#B8860B"/></linearGradient></defs>'
    /* touffes d'oreilles */
    + '<path d="M32 30 L38 14 L46 28 Z" fill="#9A7209"/>'
    + '<path d="M88 30 L82 14 L74 28 Z" fill="#9A7209"/>'
    /* corps-tête */
    + '<ellipse cx="60" cy="66" rx="34" ry="33" fill="url(#axm-gold)"/>'
    /* ventre */
    + '<ellipse cx="60" cy="76" rx="20" ry="20" fill="#F7ECD2"/>'
    /* ailes */
    + '<ellipse class="axm-wing-l" cx="27" cy="70" rx="9" ry="16" fill="#9A7209"/>'
    + '<ellipse class="axm-wing-r" cx="93" cy="70" rx="9" ry="16" fill="#9A7209"/>'
    /* yeux */
    + '<circle cx="47" cy="55" r="12" fill="#FFFFFF"/>'
    + '<circle cx="73" cy="55" r="12" fill="#FFFFFF"/>'
    + '<circle class="axm-eye-pupil" cx="47" cy="56" r="5.2" fill="#262019"/>'
    + '<circle class="axm-eye-pupil" cx="73" cy="56" r="5.2" fill="#262019"/>'
    + '<circle cx="49" cy="53.6" r="1.7" fill="#FFFFFF"/>'
    + '<circle cx="75" cy="53.6" r="1.7" fill="#FFFFFF"/>'
    + '<rect class="axm-eyelid" x="35" y="43" width="24" height="24" rx="12" fill="#B8860B"/>'
    + '<rect class="axm-eyelid" x="61" y="43" width="24" height="24" rx="12" fill="#B8860B"/>'
    /* bec */
    + '<path d="M56 63 L64 63 L60 71 Z" fill="#E07B39"/>'
    /* casquette de diplomé */
    + '<g class="axm-cap">'
    + '<rect x="58" y="26" width="4" height="12" fill="#262019"/>'
    + '<path d="M60 14 L92 24 L60 34 L28 24 Z" fill="#262019"/>'
    + '<path d="M60 14 L92 24 L60 34 Z" fill="#1A1512"/>'
    + '<circle cx="92" cy="24" r="2.6" fill="#E0B84A"/>'
    + '<path d="M92 24 q10 8 4 20" stroke="#E0B84A" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
    + '</g>'
    /* pattes */
    + '<ellipse cx="50" cy="99" rx="6.5" ry="3.4" fill="#E07B39"/>'
    + '<ellipse cx="70" cy="99" rx="6.5" ry="3.4" fill="#E07B39"/>'
    + '</svg>';

  /* ── Construction du DOM ─────────────────────────────────────────── */
  var root, bubble, zzzTimer = null;
  function build() {
    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('button');
    root.type = 'button';
    root.className = 'axm-root';
    root.setAttribute('aria-label', 'Arvy, ton copain de révision — ouvrir le menu');
    root.innerHTML = SVG;
    document.body.appendChild(root);

    bubble = document.createElement('div');
    bubble.className = 'axm-bubble';
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-label', 'Menu Arvy');
    document.body.appendChild(bubble);

    root.addEventListener('click', onRootClick);
    // Délégation des actions du menu (attaché UNE fois, quand la bulle existe).
    bubble.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-axm]');
      if (!b) return;
      var act = b.getAttribute('data-axm');
      if (act === 'sound') {
        var snd = window.ARVEXA_SOUND;
        if (snd) {
          var on = snd.toggle();
          b.querySelector('span').textContent = 'Sons : ' + (on ? 'Activés' : 'Coupés');
          b.firstChild.textContent = on ? '🔊' : '🔇';
          if (on) ARV('pop');
        }
      } else if (act === 'hello') {
        hideBubble(); wave(); ARV('pop'); say(pick(HELLOS));
      } else if (act === 'hide') {
        hideMe();
      }
    });

    armIdle();
    document.addEventListener('pointerdown', wake, true);
    window.addEventListener('online', function () {
      say('Internet est revenu ✨'); ARV('online');
    });
  }

  /* ── Bulles ──────────────────────────────────────────────────────── */
  function say(msg, ms) {
    var now = Date.now();
    if (now - lastSay < 6000 && ms !== 0) return; // anti-spam, sauf bulles urgentes
    lastSay = now;
    showBubble('<div>' + msg + '</div>');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, ms || 3800);
  }
  function showBubble(html) {
    bubble.innerHTML = html;
    bubble.classList.add('axm-show');
    positionBubble();
  }
  function hideBubble() { bubble.classList.remove('axm-show'); }
  function positionBubble() {
    var r = root.getBoundingClientRect();
    var bw = Math.min(260, Math.max(180, bubble.offsetWidth || 200));
    var left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.right - bw));
    var top = r.top - bubble.offsetHeight - 10;
    bubble.style.left = left + 'px';
    bubble.style.top = Math.max(8, top) + 'px';
  }

  /* ── Menu au tap ─────────────────────────────────────────────────── */
  function menuOpen() { return bubble.classList.contains('axm-show') && bubble.querySelector('.axm-menu-title'); }
  function onRootClick() {
    stopZzz();
    if (menuOpen()) { hideBubble(); return; }
    var snd = window.ARVEXA_SOUND;
    var on = snd ? snd.enabled : true;
    showBubble(
      '<div class="axm-menu-title">🦉 Arvy</div>'
      + '<button type="button" data-axm="sound">' + (on ? '🔊' : '🔇') + '<span>Sons : ' + (on ? 'Activés' : 'Coupés') + '</span></button>'
      + '<button type="button" data-axm="hello"><span>👋</span><span>Fais-moi coucou !</span></button>'
      + '<button type="button" data-axm="hide"><span>🙈</span><span>Cacher Arvy</span></button>'
    );
    ARV('open');
  }
  function hideMe() {
    try { localStorage.setItem(KEY_HIDDEN, '0'); } catch (e) {}
    root.remove(); bubble.remove();
  }
  function showMe() {
    if (!root.isConnected) { document.body.appendChild(root); document.body.appendChild(bubble); }
    try { localStorage.removeItem(KEY_HIDDEN); } catch (e) {}
  }

  /* ── Animations nommées ──────────────────────────────────────────── */
  function flashClass(cls, ms) {
    if (!root.isConnected) return;
    root.classList.add(cls);
    setTimeout(function () { root.classList.remove(cls); }, ms || 1100);
  }
  function wave() { flashClass('axm-wave', 1800); }
  function celebrate() {
    var now = Date.now();
    if (now - lastCelebrate < 8000) return;
    lastCelebrate = now;
    stopZzz();
    flashClass('axm-jump', 1100);
    confetti();
  }
  function encourage() { flashClass('axm-tilt', 1400); }
  function confetti() {
    if (REDUCED) return;
    var colors = ['#E0B84A', '#3AB67E', '#E07B39', '#F7ECD2', '#9A7209'];
    var r = root.getBoundingClientRect();
    for (var i = 0; i < 12; i++) {
      var c = document.createElement('span');
      c.className = 'axm-confetti';
      c.style.background = colors[i % colors.length];
      c.style.left = (r.left + r.width / 2) + 'px';
      c.style.top = (r.top + r.height / 2) + 'px';
      c.style.setProperty('--dx', (Math.random() * 140 - 70) + 'px');
      c.style.setProperty('--dy', (60 + Math.random() * 90) + 'px');
      c.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
      document.body.appendChild(c);
      setTimeout(function (el) { return function () { el.remove(); }; }(c), 950);
    }
  }

  /* ── Sommeil d'inactivité ────────────────────────────────────────── */
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (!root.isConnected || menuOpen()) return;
      root.classList.add('axm-sleep');
      startZzz();
    }, 180000);
  }
  function startZzz() {
    if (!root.isConnected || REDUCED) return;
    stopZzz();
    var n = 0;
    zzzTimer = setInterval(function () {
      var z = document.createElement('span');
      z.className = 'axm-zzz'; z.textContent = n % 2 ? 'z' : 'Z';
      var r = root.getBoundingClientRect();
      z.style.left = (r.left + r.width * 0.72) + 'px';
      z.style.top = (r.top - 4) + 'px';
      document.body.appendChild(z);
      setTimeout(function (el) { return function () { el.remove(); }; }(z), 2600);
      if (++n > 5) stopZzz();
    }, 900);
  }
  function stopZzz() {
    clearInterval(zzzTimer); zzzTimer = null;
    root.classList.remove('axm-sleep');
  }
  function wake() { if (root.classList.contains('axm-sleep')) stopZzz(); armIdle(); }

  /* ── Son utilitaire ──────────────────────────────────────────────── */
  function ARV(name) { try { if (window.ARVEXA_SOUND) window.ARVEXA_SOUND.play(name); } catch (e) {} }

  /* ── Réactions aux événements du site ────────────────────────────── */
  document.addEventListener('arvexa-exam-result', function (e) {
    var p = Number(e.detail && e.detail.percentage);
    if (!isFinite(p)) return;
    if (p >= 50) { celebrate(); ARV('fanfare'); say(pick(p >= 70 ? PRAISE : OKAY)); }
    else { encourage(); ARV('error'); say(pick(COURAGE)); }
  });
  document.addEventListener('arvexa-exam-select', function () { ARV('select'); });
  document.addEventListener('arvexa-revision-ready', function () {
    ARV('ding'); say('Bonne révision ! 📖');
  });
  document.addEventListener('arvexa-plan-refresh', function () { ARV('swoosh'); });
  window.addEventListener('arvexa-country-change', function (e) {
    // ✅ seulement sur confirmation RÉELLE de l'élève — l'adoption du
    // profil (fromProfile) arrive à CHAQUE chargement : pas de bulle répétée.
    if (e.detail && e.detail.confirmed && !e.detail.fromProfile) { ARV('pop'); say('Pays enregistré ! 🌍', 3000); }
  });
  window.addEventListener('arvexa-sound-change', function () {
    // ✅ met le libellé du menu à jour SUR PLACE (l'ancienne version
    // re-basculait onRootClick → le menu se fermait dès qu'on coupait le son).
    if (!menuOpen()) return;
    var b = bubble.querySelector('button[data-axm="sound"]');
    if (!b || !window.ARVEXA_SOUND) return;
    var on = window.ARVEXA_SOUND.enabled;
    if (b.firstChild) b.firstChild.textContent = on ? '🔊' : '🔇';
    var span = b.querySelector('span');
    if (span) span.textContent = 'Sons : ' + (on ? 'Activés' : 'Coupés');
  });

  /* ── API publique ────────────────────────────────────────────────── */
  window.ARVEXA_MASCOT = {
    say: function (m) { say(m, 0); },
    celebrate: celebrate,
    hide: hideMe,
    show: showMe,
    get visible() { return !!(root && root.isConnected); }
  };

  /* ── Démarrage ───────────────────────────────────────────────────── */
  function start() {
    if (hidden) return;
    if (!document.body) { setTimeout(start, 60); return; }
    build();
    try {
      if (!sessionStorage.getItem('arvexa-mascot-hello')) {
        // ✅ le flag est posé AU MOMENT de l'affichage (pas à la planification) :
        // index.html se recharge une fois au 1ᵉʳ chargement — si le rechargement
        // tombe avant le délai, la bienvenue a encore lieu après.
        setTimeout(function () {
          try { sessionStorage.setItem('arvexa-mascot-hello', '1'); } catch (e) {}
          wave(); say(pick(HELLOS));
        }, 900);
      }
    } catch (e) {}
  }
  start();
})();
