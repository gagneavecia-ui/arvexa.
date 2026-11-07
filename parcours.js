/*! parcours.js — v1.0 — ARVEXA School
================================================================
MODÈLE A — « Ton parcours vers le BAC » (demande propriétaire :
remplacer la navigation par matières par UNE route guidée façon
Duolingo : 52 étapes mélangeant les 4 matières jusqu'au BAC,
examens blancs aux étapes 13/26/39/52).

Ce fichier :
  - charge cours/parcours.json (52 étapes, 57 chapitres, comptes
    de sections RÉELS calculés sur les fragments existants) ;
  - calcule l'étape courante depuis arvexa_read_parts (déjà
    synchronisé par compte via arvexa-sync.js) ;
  - affiche : étape N/52 + bouton Commencer/Continuer + progression
    globale % + streak 🔥 + prochaine échéance (examen blanc) ;
  - les examens blancs se valident manuellement (« Marquer comme
    fait ») : localStorage arvexa_parcours_exams.
Zéro dépendance, zéro réseau obligatoire (échec fetch → bloc masqué).
================================================================ */
(function () {
  'use strict';

  var PK_EXAM = 'arvexa_parcours_exams';
  var READ_KEY = 'arvexa_read_parts';
  var ACT_KEY = 'arvexa_daily_activity';
  var TABS = ['cours', 'exercices', 'corrections'];

  function $(id) { return document.getElementById(id); }
  function LS(k, d) {
    try { return JSON.parse(localStorage.getItem(k) || d) || JSON.parse(d); }
    catch (e) { return JSON.parse(d); }
  }

  /* ── Jours & streak (même règle que les badges du module) ── */
  function dayStr(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function computeStreak() {
    var act = LS(ACT_KEY, '{}');
    var streak = 0, cursor = new Date();
    var active = function (d) { return (Number(act[dayStr(d)]) || 0) > 0; };
    if (!active(cursor)) cursor.setDate(cursor.getDate() - 1);
    while (active(cursor) && streak < 365) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }

  /* ── Lecture effective : quels morceaux de ce chapitre sont lus ? ── */
  function chapterProgress(subject, ch, sections) {
    var read = LS(READ_KEY, '[]');
    var set = {};
    for (var i = 0; i < read.length; i++) set[read[i]] = true;
    var done = 0, total = 0, firstUnread = null;
    TABS.forEach(function (tab) {
      var n = (sections && sections[tab]) || 0;
      for (var p = 0; p < n; p++) {
        total++;
        var key = subject + '_' + ch + '_' + tab + '_' + p;
        if (set[key]) { done++; }
        else if (!firstUnread) firstUnread = { tab: tab, part: p };
      }
    });
    return { done: done, total: total, firstUnread: firstUnread, complete: total > 0 && done === total };
  }

  function examDoneMap() { return LS(PK_EXAM, '{}'); }

  /* ── État des étapes ── */
  function stepLocked(step) {
    if (step.type === 'examen') return false;
    return step.available === false || !step.sectionsTotal;
  }
  function stepState(step, exams) {
    if (step.type === 'examen') return { done: !!exams[step.n], progress: exams[step.n] ? 1 : 0 };
    if (stepLocked(step)) return { done: false, locked: true, progress: 0, read: 0, total: 0 };
    var done = 0, read = 0, total = 0;
    step.chapters.forEach(function (c) {
      var p = chapterProgress(step.subject, c.i, c.sections);
      total += p.total; read += p.done;
      if (p.complete) done++;
    });
    return { done: done === step.chapters.length, progress: total ? read / total : 0, read: read, total: total };
  }

  function linkForChapter(step, chObj, curSt) {
    var sub = step.subject;
    var p = chapterProgress(sub, chObj.i, chObj.sections);
    if (p.complete || !p.firstUnread) {
      return 'chapitre.html?subject=' + sub + '&chapter=' + chObj.i;
    }
    var started = p.done > 0;
    if (started && p.firstUnread) {
      return 'lecture.html?subject=' + sub + '&chapter=' + chObj.i +
        '&tab=' + p.firstUnread.tab + '&part=' + p.firstUnread.part;
    }
    return 'chapitre.html?subject=' + sub + '&chapter=' + chObj.i;
  }

  /* ── Date estimée d'une étape (proportionnelle jusqu'au BAC) ── */
  function bacDate() {
    if (typeof window.ARVEXA_getExamDate === 'function') {
      try { return window.ARVEXA_getExamDate(); } catch (e) {}
    }
    var n = new Date(), y = n.getFullYear();
    var j = new Date(y, 5, 1);
    return n < j ? j : new Date(y + 1, 5, 1);
  }
  function estimateStepDate(now, lastDone, stepN) {
    var bac = bacDate();
    var remSteps = Math.max(52 - lastDone, 1);
    var remDays = Math.max((bac - now) / 86400000, 1);
    var t = Math.min(Math.max(stepN - lastDone, 0), remSteps);
    return new Date(now.getTime() + (t * remDays / remSteps) * 86400000);
  }
  function fmtDate(d) {
    try { return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return d.toDateString(); }
  }

  /* ── Rendu ── */
  function render(data) {
    var card = $('parcoursCard');
    if (!card) return;
    var steps = data.steps || [];
    var exams = examDoneMap();

    var states = steps.map(function (s) { return stepState(s, exams); });
    var availCount = 0, lockedCount = 0, doneCount = 0;
    states.forEach(function (st) {
      if (st.locked) lockedCount++;
      else { availCount++; if (st.done) doneCount++; }
    });
    var curIdx = states.findIndex(function (s) { return !s.done && !s.locked; });
    var terminal = false;
    if (curIdx === -1) { terminal = true; curIdx = steps.length - 1; } // tout le disponible est fini
    var cur = steps[curIdx], curSt = states[curIdx];

    /* — Entête de l'étape — */
    var kick = $('parcoursStepKicker');
    if (kick) {
      if (terminal) kick.textContent = '🎉 Tout le contenu disponible est terminé';
      else kick.textContent = 'Étape ' + cur.n + '/52' + (curSt.done ? ' — dernière étape 🎓' : (doneCount > 0 ? ' · en cours' : ' · à commencer'));
    }

    var ttl = $('parcoursStepTitle');
    if (ttl) ttl.textContent = terminal ? 'Cap sur le BAC — révise avec un examen blanc !' : cur.title;

    var meta = $('parcoursStepMeta');
    if (meta) {
      var sub = data.subjects[cur.subject] || {};
      var bits = [];
      if (sub.icon) bits.push('<i class="fas ' + sub.icon + '"></i>');
      if (sub.label) bits.push('<span>' + sub.label + '</span>');
      if (curSt.locked) {
        bits.push('<span>⏳ En préparation — bientôt disponible</span>');
      } else if (cur.type === 'chapitre') {
        if (cur.chapters.length > 1) bits.push('<span>2 chapitres</span>');
        if (cur.sectionsTotal) bits.push('<span>' + cur.sectionsTotal + ' sections</span>');
      } else {
        bits.push('<span>Interro écrit grand format</span>');
      }
      if (!terminal && cur.duration_min) bits.push('<span>≈ ' + cur.duration_min + ' min</span>');
      meta.innerHTML = bits.join('');
      if (sub.color) meta.style.setProperty('--pc-color', sub.color);
    }

    /* — CTA principale — */
    var cta = $('parcoursStepCta'), alt = $('parcoursAltLinks');
    if (cta) {
      if (curSt.locked) {
        cta.removeAttribute('href');
        cta.classList.add('is-locked');
        cta.textContent = '🔒 Chapitre en préparation';
        if (alt) {
          alt.innerHTML = '';
          var ml = document.createElement('a');
          ml.className = 'parcours-alt-link';
          ml.href = 'matiere.html?subject=' + cur.subject;
          ml.textContent = 'Voir la matière dans l\'accès libre';
          alt.appendChild(ml);
        }
      } else if (terminal) {
        cta.href = 'exam.html';
        cta.classList.remove('is-locked');
        cta.textContent = '🧪 Entraîne-toi avec un examen blanc';
        if (alt) alt.innerHTML = '';
      } else if (cur.type === 'examen') {
        cta.href = 'exam.html?subject=' + cur.subject;
        cta.classList.remove('is-locked');
        cta.textContent = '🧪 Faire l\u2019examen blanc';
        if (alt) {
          alt.innerHTML = '';
          if (!curSt.done) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'parcours-alt-btn';
            b.textContent = '✓ Examen terminé — valider l\u2019étape';
            b.addEventListener('click', function () {
              var m = examDoneMap();
              m[cur.n] = dayStr(new Date());
              try { localStorage.setItem(PK_EXAM, JSON.stringify(m)); } catch (e) {}
              render(data);
            });
            alt.appendChild(b);
          }
        }
      } else {
        cta.classList.remove('is-locked');
        // premier chapitre de l'étape non terminé
        var target = null;
        for (var i = 0; i < cur.chapters.length; i++) {
          var p = chapterProgress(cur.subject, cur.chapters[i].i, cur.chapters[i].sections);
          if (!p.complete) { target = { ch: cur.chapters[i], started: p.done > 0 }; break; }
        }
        if (!target) target = { ch: cur.chapters[0], started: false };
        cta.href = linkForChapter(cur, target.ch, curSt);
        cta.textContent = (target.started ? '📖 Continuer l\u2019étape' : '🚀 Commencer l\u2019étape');
        cta.removeAttribute('aria-disabled');
        if (alt) {
          alt.innerHTML = '';
          cur.chapters.forEach(function (c) {
            var p = chapterProgress(cur.subject, c.i, c.sections);
            if (target && c.i === target.ch.i) return;
            var a = document.createElement('a');
            a.className = 'parcours-alt-link' + (p.complete ? ' is-done' : '');
            a.href = linkForChapter(cur, c, curSt);
            a.textContent = (p.complete ? '✓ ' : '') + c.title;
            alt.appendChild(a);
          });
        }
      }
    }

    /* — Progression globale (rapportée au contenu disponible) — */
    var fill = $('parcoursProgFill');
    var pct = availCount ? Math.round(doneCount / availCount * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    var lab = $('parcoursProgLabel');
    if (lab) {
      var txt = pct + '% du contenu disponible · ' + doneCount + '/' + availCount + ' étapes';
      if (lockedCount) txt += ' · ' + lockedCount + ' en préparation';
      lab.textContent = txt;
    }

    /* — Stats : chapitres + streak — */
    var chaptersDone = 0, chaptersTotal = 0;
    steps.forEach(function (s, k) {
      if (s.type !== 'chapitre' || states[k].locked) return;
      chaptersTotal += s.chapters.length;
      if (states[k].done) chaptersDone += s.chapters.length;
    });
    var cd = $('parcoursChaptersStat');
    if (cd) cd.textContent = chaptersDone + '/' + chaptersTotal + ' chapitres';
    var stEl = $('parcoursStreakStat');
    if (stEl) {
      var stk = computeStreak();
      stEl.textContent = stk > 0 ? '🔥 ' + stk + ' jour' + (stk > 1 ? 's' : '') : '🔥 Lance-toi aujourd\u2019hui';
    }

    /* — Prochaine échéance : prochain examen blanc — */
    var ech = $('parcoursEcheance');
    if (ech) {
      var nextExam = null;
      for (var e = 0; e < steps.length; e++) {
        if (steps[e].type === 'examen' && !states[e].done) { nextExam = steps[e]; break; }
      }
      var now = new Date();
      var lastDone = 0;
      for (var b = curIdx - 1; b >= 0; b--) {
        if (states[b].done && !states[b].locked) { lastDone = steps[b].n; break; }
      }
      if (terminal || (curSt.done && !curSt.locked)) lastDone = Math.max(lastDone, cur.n);
      if (nextExam) {
        var est = estimateStepDate(now, lastDone, nextExam.n);
        ech.innerHTML = '🗓️ Prochaine échéance : <strong>' + nextExam.title + '</strong> · vers le ' + fmtDate(est) + ' <em>(estimée)</em>';
      } else {
        ech.innerHTML = '🎓 Prochaine échéance : <strong>' + (window.ARVEXA_BAC_DATE && window.ARVEXA_BAC_DATE.label || 'BAC') + '</strong> · ' + fmtDate(bacDate());
      }
    }

    /* — Frise des étapes — */
    var tl = $('parcoursTimeline');
    if (tl) {
      tl.innerHTML = '';
      steps.forEach(function (s, k) {
        var d = document.createElement('span');
        var cls = 'parcours-dot';
        if (states[k].done) cls += ' done';
        else if (k === curIdx && !terminal) cls += ' current';
        if (states[k].locked) cls += ' locked';
        if (s.type === 'examen') cls += ' exam';
        d.className = cls;
        d.title = 'Étape ' + s.n + ' — ' + s.title + (states[k].locked ? ' (en préparation)' : '');
        tl.appendChild(d);
      });
    }
  }

  function hideCard() {
    var w = $('parcoursSection');
    if (w) w.style.display = 'none';
  }

  function boot() {
    var card = $('parcoursCard');
    if (!card) return;
    fetch('cours/parcours.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        card.classList.add('is-ready');
        render(data);
        window.addEventListener('storage', function (ev) {
          if (!ev || !ev.key || ev.key === READ_KEY || ev.key === ACT_KEY || ev.key === PK_EXAM) render(data);
        });
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden) render(data);
        });
        window.addEventListener('focus', function () { render(data); });
        if (window.ArvexaProgress && typeof window.ArvexaProgress.onChange === 'function') {
          try { window.ArvexaProgress.onChange(function () { render(data); }); } catch (e) {}
        }
      })
      .catch(function (err) {
        console.warn('[Parcours] parcours.json indisponible :', err && err.message);
        hideCard();
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
