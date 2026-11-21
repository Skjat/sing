// Тренажёр: проводит одно упражнение любого типа и возвращает результат.

import * as audio from './audio.js';
import { Roll } from './roll.js';
import { h, clear, put, icon, plural } from './ui.js';
import { noteName, noteFull, centsText } from './music.js';
import { HoldDetector, segmentNotes, median, percentile } from './pitch.js';
import { scoreAligned, scoreSustain, summarizeNotes, positionStats, rootStats, foldToOctave, biasText, voicedSeconds } from './scoring.js';
import { T, patternTimeline, countBeat, estimateSeconds } from './timeline.js';
import { tipFor, compareWithPrev } from './tips.js';

const r1 = (x) => Math.round(x * 10) / 10;
const num = (x) => String(x).replace('.', ',');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/**
 * Опоздания, которым можно верить: только повторы, где спетое узнаваемо повторяет
 * рисунок мелодии. Если таких меньше трети, момент вступления не определён.
 */
function trustedLags(scores) {
  const good = scores.filter((s) => s.fit != null && s.fit <= 45).map((s) => s.lag);
  return good.length >= Math.max(1, Math.ceil(scores.length / 3)) ? good : null;
}

// ---------- Режимы ----------

function patternMode(ex, api) {
  const own = ex.refMode === 'own';
  const noteDur = ex.noteDur || median(ex.reps[0].notes.map((n) => n.dur));
  const semis = ex.reps[0].notes.map((n) => n.midi - ex.reps[0].root);
  const lowest = Math.min(...semis);
  const highest = Math.max(...semis);
  const inRange = (midi) => midi >= ex.range.lo && midi <= ex.range.hi;
  const scores = [];
  let line = [];
  let idx = 0;
  let scheduled = -1;
  return {
    start(now) {
      line = patternTimeline(ex.reps, noteDur, now, own).map((seg) => ({
        ...seg,
        beyond: seg.rep.notes.some((n) => !inRange(n.midi)),
        ref: own
          ? [{ midi: seg.rep.notes[0].midi, start: seg.refStart, dur: seg.refLen - 0.3, ref: true, label: 'сыграйте ' + noteName(seg.rep.notes[0].midi) }]
          : seg.rep.notes.map((n) => ({ midi: n.midi, start: seg.refStart + n.start, dur: n.dur, ref: true })),
        sing: seg.rep.notes.map((n) => ({ midi: n.midi, start: seg.singStart + n.start, dur: n.dur })),
      }));
      api.progress(0, line.length);
    },
    tick(now) {
      const cur = line[idx];
      if (!cur) return;
      if (scheduled < idx && now >= cur.refStart - 0.25) {
        scheduled = idx;
        if (!own) audio.playNotes(cur.rep.notes, cur.refStart, 0.6);
        // Два щелчка в темпе попевки: на них вдох, после второго — вступление.
        audio.playTick(cur.ticks[0]);
        audio.playTick(cur.ticks[1], true);
        if (ex.headphones) audio.playNotes(cur.rep.notes, cur.singStart, 0.22);
      }
      const from = noteName(cur.rep.notes[0].midi);
      const about = ex.lyric || (cur.beyond ? `От ${from} · за пределами диапазона: легко и тихо` : `Попевка от ${from}`);
      if (now < cur.refStart) {
        api.listen(false);
        api.count('');
        api.status('Приготовьтесь', about);
      } else if (now < cur.ticks[0] - 0.05) {
        api.listen(false);
        api.count('');
        api.status(own ? `Сыграйте ${noteFull(cur.rep.notes[0].midi)}` : 'Слушайте', about);
      } else if (now < cur.singStart - 0.1) {
        api.listen(false);
        api.count(now < cur.ticks[1] - 0.05 ? '2' : '1');
        api.status('Вдох', ex.lyric || 'Вступайте сразу после второго щелчка');
      } else if (now < cur.singEnd + T.maxLag + 0.1) {
        // Слушаем дольше самой попевки: опоздавшее вступление тоже засчитывается.
        api.listen(true);
        api.count('');
        api.status(ex.lyric ? 'Пойте' : `Пойте: «${ex.syllable}»`, about);
      } else {
        api.listen(false);
        const sc = scoreAligned(cur.sing, api.frames(), { tol: ex.tol, skipFrac: ex.slide ? 0.55 : undefined, maxLag: T.maxLag });
        scores.push({ root: cur.rep.root, lag: sc.lagSec, fit: sc.fit, hits: sc.hits, notes: sc.notes });
        api.dot(idx, sc.hitRate >= 75 ? 'ok' : sc.hitRate >= 45 ? 'warn' : 'bad');
        idx++;
        api.progress(idx, line.length);
        if (idx >= line.length) api.finish(this.result());
      }
    },
    view(now) {
      const targets = [];
      for (let i = Math.max(0, idx - 1); i < Math.min(line.length, idx + 2); i++) targets.push(...line[i].ref, ...line[i].sing);
      const cur = line[Math.min(idx, line.length - 1)];
      const active = cur.sing.find((t) => now >= t.start && now < t.start + t.dur);
      return {
        targets, lagOk: T.maxLag, target: active ? active.midi : null,
        lo: cur.rep.root + lowest - 4, hi: cur.rep.root + highest + 4,
      };
    },
    result() {
      const flat = scores.flatMap((s) => s.notes);
      const inside = flat.filter((n) => inRange(n.midi));
      const outside = flat.filter((n) => !inRange(n.midi));
      const all = summarizeNotes(inside.length ? inside : flat);
      const lags = trustedLags(scores);
      const hitAbove = outside.filter((n) => n.hit && n.midi > ex.range.hi).map((n) => n.midi);
      const hitBelow = outside.filter((n) => n.hit && n.midi < ex.range.lo).map((n) => n.midi);
      return {
        score: scores.length ? all.hitRate : null,
        m: {
          hitRate: all.hitRate, notes: all.total, missed: all.missed,
          avgAbsCents: all.avgAbsCents, biasCents: all.biasCents, stdCents: all.stdCents,
          // У скольжений оценивается только конец ноты, момент вступления по нему не определить.
          lagSec: lags && !ex.slide ? Math.round(median(lags) * 100) / 100 : null,
          reps: rootStats(scores).map((r) => ({ from: noteName(r.root), hitRate: r.hitRate, bias: r.bias })),
          degrees: positionStats(scores.map((s) => s.notes), semis),
          beyond: outside.length ? {
            notes: outside.length, hits: outside.filter((n) => n.hit).length,
            topHit: hitAbove.length ? Math.max(...hitAbove) : null,
            lowHit: hitBelow.length ? Math.min(...hitBelow) : null,
          } : undefined,
        },
        partial: scores.length < ex.reps.length,
      };
    },
  };
}

function sustainMode(ex, api) {
  const own = ex.refMode === 'own';
  // Нота считается «той самой», пока голос не дальше двух допусков от цели.
  const band = Math.max(60, (ex.tol ?? 50) * 2);
  const out = [];
  let i = 0;
  let singStart = 0;
  let refStart = 0;
  let started = null;
  let lastVoiced = null;
  let onTarget = 0;
  let lastTick = null;
  const begin = (now) => {
    started = lastVoiced = lastTick = null;
    onTarget = 0;
    refStart = now + 0.8;
    if (ex.free) singStart = refStart;
    else {
      if (!own) audio.playNote(ex.notes[i], refStart, 1.2, 0.6);
      singStart = refStart + (own ? 2.6 : 1.6);
    }
    api.progress(i, ex.notes.length);
  };
  return {
    start: begin,
    tick(now, f) {
      const target = ex.notes[i];
      if (now < singStart) {
        api.listen(false);
        api.status(own ? `Сыграйте ${noteFull(target)}` : 'Слушайте', noteFull(target));
        return;
      }
      api.listen(true);
      const dt = lastTick == null ? 0 : Math.min(0.1, now - lastTick);
      lastTick = now;
      if (f && f.midi != null) {
        if (started == null) started = now;
        lastVoiced = now;
        // Таймер идёт только на верной ноте.
        if (!ex.free && Math.abs(f.midi - target) * 100 <= band) onTarget += dt;
      }
      const held = ex.free ? (started == null ? 0 : now - started) : onTarget;
      api.big(started == null ? '' : held.toFixed(1) + ' с');
      api.status(ex.free ? 'Тяните «а» как можно дольше' : `Тяните: «${ex.syllable}»`,
        ex.free ? 'Любая удобная нота' : `${noteFull(target)} · цель ${ex.holdSec} с на этой ноте`);
      const silent = started != null && now - lastVoiced > 0.7;
      const noStart = started == null && now - singStart > 12;
      const enough = !ex.free && onTarget >= ex.holdSec;
      // Если ученик долго поёт мимо цели, попытку заканчиваем сами.
      const astray = !ex.free && started != null && now - started > ex.holdSec * 2.5 + 4;
      if (silent || noStart || enough || astray || now - singStart > 75) {
        const win = api.frames().filter((fr) => fr.t >= singStart);
        if (ex.free) {
          const vals = win.filter((fr) => fr.midi != null).map((fr) => fr.midi);
          out.push({ midi: vals.length ? Math.round(median(vals)) : null, heldSec: voicedSeconds(win, (fr) => fr.midi != null) });
        } else {
          const sc = scoreSustain(target, win, ex.tol, band);
          out.push(sc);
          api.dot(i, sc.heldSec >= ex.holdSec * 0.8 && sc.inTol >= 70 ? 'ok' : sc.heldSec > 0 ? 'warn' : 'bad');
        }
        api.big('');
        i++;
        if (i >= ex.notes.length) api.finish(this.result());
        else begin(now + 0.6);
      }
    },
    view() {
      const target = ex.notes[Math.min(i, ex.notes.length - 1)];
      if (ex.free) return { targets: [], lo: ex.range.lo - 3, hi: ex.range.hi + 3 };
      return { targets: [{ midi: target, start: singStart, dur: ex.holdSec * 2.5 + 4 }], lo: target - 6, hi: target + 6, target };
    },
    result() {
      const done = out.filter((o) => o.heldSec > 0);
      return {
        score: ex.free ? null : (done.length ? Math.round(mean(out.map((o) => (o.heldSec > 0 ? o.inTol : 0)))) : 0),
        m: {
          notes: out.map((o) => ({ note: o.midi == null ? null : noteName(o.midi), heldSec: o.heldSec, cents: o.cents ?? null, std: o.std ?? null, inTol: o.inTol ?? null })),
          bestHeldSec: out.length ? Math.max(...out.map((o) => o.heldSec)) : 0,
          avgStdCents: ex.free ? null : (done.length ? Math.round(mean(done.map((o) => o.std || 0))) : null),
          biasCents: ex.free ? null : (done.length ? Math.round(mean(done.map((o) => o.cents || 0))) : null),
        },
        partial: out.length < ex.notes.length,
      };
    },
  };
}

function glideMode(ex, api) {
  const out = [];
  let i = 0;
  let repStart = 0;
  let started = null;
  let lastVoiced = null;
  let pauseUntil = 0;
  const begin = (now) => {
    repStart = now;
    started = lastVoiced = null;
    api.progress(i, ex.reps);
  };
  return {
    start: (now) => begin(now + 0.5),
    tick(now, f) {
      if (now < pauseUntil || now < repStart) { api.listen(false); return; }
      api.listen(true);
      api.status(ex.down ? 'Скользите сверху вниз' : 'Скользите снизу вверх и обратно', `На звук: ${ex.sound}`);
      if (f && f.midi != null) {
        if (started == null) started = now;
        lastVoiced = now;
      }
      const ended = started != null && now - lastVoiced > 0.8 && lastVoiced - started > 0.8;
      if (ended || now - repStart > 20) {
        const vals = api.frames().filter((fr) => fr.t >= repStart && fr.midi != null).map((fr) => fr.midi);
        if (vals.length > 20) {
          const low = Math.round(percentile(vals, 0.04));
          const high = Math.round(percentile(vals, 0.96));
          out.push({ low, high });
          api.status(`Охват: ${noteName(low)} – ${noteName(high)}`, 'Вдохните и повторите');
        } else {
          out.push(null);
          api.status('Не расслышал звук', 'Попробуйте чуть громче');
        }
        i++;
        if (i >= ex.reps) api.finish(this.result());
        else { pauseUntil = now + 1.8; begin(pauseUntil); }
      }
    },
    view() {
      return { targets: [], zone: ex.zone, lo: Math.min(ex.range.lo, ex.zone.lo) - 3, hi: Math.max(ex.range.hi, ex.zone.hi) + 3 };
    },
    result() {
      const ok = out.filter(Boolean);
      if (!ok.length) return { score: 0, m: { reps: 0 }, partial: true };
      const low = Math.min(...ok.map((o) => o.low));
      const high = Math.max(...ok.map((o) => o.high));
      const z = ex.zone;
      const cover = Math.max(0, Math.min(high, z.hi) - Math.max(low, z.lo)) / Math.max(1, z.hi - z.lo);
      return {
        score: Math.round(Math.min(1, cover) * 100),
        m: { reps: ok.length, low, high, lowName: noteName(low), highName: noteName(high), span: high - low, zone: `${noteName(z.lo)}–${noteName(z.hi)}`, zoneLo: z.lo, zoneHi: z.hi },
        partial: out.length < ex.reps,
      };
    },
  };
}

function matchMode(ex, api) {
  const own = ex.refMode === 'own';
  const interval = ex.mode === 'interval';
  const out = [];
  let i = 0;
  let phase = 'ref';
  let refStart = 0;
  let singStart = 0;
  let okSince = null;
  let fbEnd = 0;
  const LIMIT = 7;
  const toSing = (at) => { phase = 'sing'; singStart = at; okSince = null; api.action(null); };
  const begin = (now) => {
    const it = ex.items[i];
    api.progress(i, ex.items.length);
    if (own) {
      phase = 'wait';
      api.action('Пою', () => toSing(audio.now() + 0.2));
    } else {
      phase = 'ref';
      refStart = now + 0.6;
      audio.playNote(interval ? it.root : it.midi, refStart, 1.1, 0.6);
      singStart = refStart + 1.45;
    }
  };
  return {
    start: begin,
    tick(now, f) {
      const it = ex.items[i];
      if (phase === 'wait') {
        api.listen(false);
        api.status(`Сыграйте ${noteFull(interval ? it.root : it.midi)}`, interval ? `Затем спойте: ${it.prompt}` : 'Затем нажмите «Пою» и спойте эту ноту');
      } else if (phase === 'ref') {
        api.listen(false);
        api.status('Слушайте', interval ? it.prompt : noteFull(it.midi));
        if (now >= singStart) toSing(singStart);
      } else if (phase === 'sing') {
        if (now < singStart) return;
        api.listen(true);
        api.status(interval ? 'Спойте второй звук' : 'Спойте эту ноту', interval ? it.prompt : noteFull(it.midi));
        if (f && f.midi != null && Math.abs(f.midi - it.midi) * 100 <= ex.tol) okSince = okSince ?? now;
        else if (f && f.midi != null) okSince = null;
        const ok = okSince != null && now - okSince >= 0.6;
        if (ok || now - singStart > LIMIT) {
          const from = ok ? okSince : singStart;
          const cents = api.frames().filter((fr) => fr.t >= from && fr.midi != null && Math.abs(fr.midi - it.midi) < 6).map((fr) => (fr.midi - it.midi) * 100);
          const med = median(cents);
          out.push({ midi: it.midi, ok, sec: ok ? r1(okSince - singStart) : null, cents: med == null ? null : Math.round(med) });
          phase = 'fb';
          api.listen(false);
          fbEnd = now + (interval ? 1.7 : 1.0);
          if (interval) audio.playNote(it.midi, now + 0.2, 1.1, 0.6);
          api.status(ok ? 'Точно!' : 'Не засчитано', med == null ? 'Голос не расслышан' : (ok ? biasText(med) : `Вы пели ${biasText(med)}`));
        }
      } else if (phase === 'fb' && now >= fbEnd) {
        i++;
        if (i >= ex.items.length) api.finish(this.result());
        else begin(now);
      }
    },
    view() {
      const it = ex.items[Math.min(i, ex.items.length - 1)];
      const targets = [];
      if (phase === 'ref') targets.push({ midi: interval ? it.root : it.midi, start: refStart, dur: 1.1, ref: true });
      if (phase === 'sing' || phase === 'fb') {
        if (interval) targets.push({ midi: it.root, start: singStart - 1.5, dur: 1.1, ref: true });
        targets.push({ midi: it.midi, start: singStart, dur: LIMIT });
      }
      return { targets, lo: ex.range.lo - 2, hi: ex.range.hi + 2, target: phase === 'sing' ? it.midi : null };
    },
    result() {
      const ok = out.filter((o) => o.ok);
      const withCents = out.filter((o) => o.cents != null);
      return {
        score: out.length ? Math.round((ok.length / out.length) * 100) : null,
        m: {
          items: out.map((o) => ({ note: noteName(o.midi), ok: o.ok, sec: o.sec, cents: o.cents })),
          hitRate: out.length ? Math.round((ok.length / out.length) * 100) : 0,
          avgSec: ok.length ? r1(mean(ok.map((o) => o.sec))) : null,
          biasCents: withCents.length ? Math.round(mean(withCents.map((o) => o.cents))) : null,
          kind: interval ? 'интервалы' : 'ноты',
        },
        partial: out.length < ex.items.length,
      };
    },
  };
}

function echoMode(ex, api) {
  const out = [];
  let phase = 'play';
  let phaseStart = 0;
  let played = null;
  let quietSince = null;
  let fbEnd = 0;
  const playHold = new HoldDetector({ minDur: 0.35, tol: 0.45 });
  const singHold = new HoldDetector({ minDur: 0.7, tol: 0.6 });
  const fold = (m) => {
    let t = m;
    const c = (ex.range.lo + ex.range.hi) / 2;
    while (t - c > 6) t -= 12;
    while (c - t > 6) t += 12;
    return t;
  };
  const toPlay = (now) => { phase = 'play'; phaseStart = now; played = null; playHold.reset(); api.action(null); api.progress(out.length, ex.rounds); };
  const toSing = (now) => { phase = 'sing'; phaseStart = now; singHold.reset(); audio.resetTracker(); api.action(null); };
  return {
    start: toPlay,
    tick(now, f) {
      if (phase === 'play') {
        api.listen(true);
        api.status('Сыграйте одну ноту', 'На фортепиано или гитаре');
        const res = f ? playHold.push(f.t, f.midi) : null;
        if (res) {
          played = res.midi;
          phase = 'quiet';
          phaseStart = now;
          quietSince = null;
          api.action('Пою', () => toSing(audio.now()));
        } else if (now - phaseStart > 25) api.finish(this.result());
      } else if (phase === 'quiet') {
        api.listen(false);
        const quiet = !f || f.midi == null || f.rms < audio.getGate() * 1.5;
        api.status(`Сыграно: ${noteFull(Math.round(played))}`, now - phaseStart > 5 ? 'Заглушите ноту или нажмите «Пою»' : 'Дайте ноте затихнуть и спойте её');
        if (quiet) {
          quietSince = quietSince ?? now;
          if (now - quietSince > 0.35) toSing(now);
        } else quietSince = null;
      } else if (phase === 'sing') {
        api.listen(true);
        api.status('Спойте эту ноту на «а»', noteFull(Math.round(played)));
        const res = f ? singHold.push(f.t, f.midi) : null;
        if (res || now - phaseStart > 10) {
          if (res) {
            const d = foldToOctave(res.midi, played);
            out.push({ played: Math.round(played), cents: d.cents, octaves: d.octaves });
            api.status(Math.abs(d.cents) <= ex.tol ? 'Точно!' : 'Мимо', biasText(d.cents));
          } else {
            out.push({ played: Math.round(played), cents: null, octaves: 0 });
            api.status('Голос не расслышан', 'Попробуем ещё');
          }
          phase = 'fb';
          api.listen(false);
          fbEnd = now + 1.4;
        }
      } else if (phase === 'fb' && now >= fbEnd) {
        if (out.length >= ex.rounds) api.finish(this.result());
        else toPlay(now);
      }
    },
    view() {
      const targets = [];
      if (played != null && (phase === 'sing' || phase === 'fb')) targets.push({ midi: fold(played), start: phaseStart, dur: 10 });
      if (phase === 'play' || phase === 'quiet') return { targets, lo: 36, hi: 84 };
      return { targets, lo: ex.range.lo - 3, hi: ex.range.hi + 3, target: phase === 'sing' ? fold(played) : null };
    },
    result() {
      const sung = out.filter((o) => o.cents != null);
      const ok = sung.filter((o) => Math.abs(o.cents) <= ex.tol);
      return {
        score: out.length ? Math.round((ok.length / out.length) * 100) : null,
        m: {
          rounds: out.map((o) => ({ played: noteName(o.played), cents: o.cents })),
          hitRate: out.length ? Math.round((ok.length / out.length) * 100) : 0,
          avgAbsCents: sung.length ? Math.round(mean(sung.map((o) => Math.abs(o.cents)))) : null,
          biasCents: sung.length ? Math.round(mean(sung.map((o) => o.cents))) : null,
        },
        partial: out.length < ex.rounds,
      };
    },
  };
}

function exhaleMode(ex, api) {
  const out = [];
  let phase = 'ready';
  let phaseStart = 0;
  let onSince = null;
  let started = null;
  let lastOn = null;
  let pauseUntil = 0;
  let level = 0;
  const endRep = (now) => {
    const dur = r1(Math.max(0, lastOn - started));
    out.push(dur);
    api.action(null);
    api.status(`${dur.toFixed(1)} с`, out.length < ex.reps ? 'Отдохните пару вдохов' : 'Готово');
    if (out.length >= ex.reps) { api.finish(mode.result()); return; }
    phase = 'pause';
    pauseUntil = now + 3;
  };
  const mode = {
    start(now) { phase = 'ready'; phaseStart = now; api.progress(0, ex.reps); },
    tick(now, f) {
      const on = !!f && f.rms > audio.getGate() * 1.6;
      // Круг дышит вместе со звуком: видно, что приложение слышит выдох.
      level += ((f ? audio.levelOf(f.rms) : 0) - level) * 0.25;
      api.breath(0.35 + 0.65 * level);
      if (phase === 'pause') {
        if (now >= pauseUntil) { phase = 'ready'; phaseStart = now; onSince = null; api.big(''); api.progress(out.length, ex.reps); }
        return;
      }
      if (phase === 'ready') {
        api.status(`Вдохните и выдыхайте на «${ex.sound}»`, 'Отсчёт начнётся, когда я услышу звук');
        api.big('0.0 с');
        if (on) {
          onSince = onSince ?? now;
          if (now - onSince > 0.15) {
            phase = 'run';
            started = onSince;
            lastOn = now;
            api.action('Выдох окончен', () => endRep(audio.now()));
          }
        } else onSince = null;
        if (now - phaseStart > 20) { out.push(0); phase = 'pause'; pauseUntil = now + 0.5; if (out.length >= ex.reps) api.finish(this.result()); }
      } else if (phase === 'run') {
        if (on) lastOn = now;
        api.big((now - started).toFixed(1) + ' с');
        api.status('Ровно и до конца', 'Не выдавливайте остатки воздуха');
        if (now - lastOn > 0.6) endRep(now);
      }
    },
    view: () => null,
    result() {
      const ok = out.filter((d) => d > 0);
      return {
        score: null,
        m: { durations: out, bestSec: ok.length ? Math.max(...ok) : 0, avgSec: ok.length ? r1(mean(ok)) : 0 },
        partial: out.length < ex.reps,
      };
    },
  };
  return mode;
}

function breathMode(ex, api) {
  let t0 = 0;
  let lastPhase = '';
  const cycle = ex.phases.reduce((a, p) => a + p.sec, 0);
  // Сигналы смены фазы, чтобы не смотреть на экран: вверх — вдох, одна нота — задержка, вниз — выдох.
  const cue = (i) => audio.playCue(i === 0 ? [60, 67] : i === ex.phases.length - 1 ? [67, 60] : [67]);
  return {
    clock: 'perf',
    start(now) { t0 = now + 0.5; api.progress(0, ex.cycles); },
    tick(now) {
      const t = now - t0;
      if (t < 0) { api.status('Приготовьтесь', ''); return; }
      const n = Math.floor(t / cycle);
      if (n >= ex.cycles) { api.breath(0.4); audio.playCue([60, 64, 67]); api.finish(this.result(ex.cycles)); return; }
      api.progress(n, ex.cycles);
      let x = t - n * cycle;
      for (let i = 0; i < ex.phases.length; i++) {
        const p = ex.phases[i];
        if (x < p.sec) {
          const k = x / p.sec;
          if (lastPhase !== `${n}:${i}`) { lastPhase = `${n}:${i}`; cue(i); }
          api.status(p.label, `${Math.ceil(p.sec - x)}`);
          // Круг растёт на вдохе, держится на задержке, сжимается на выдохе.
          api.breath(i === 0 ? 0.4 + 0.6 * k : i === ex.phases.length - 1 ? 1 - 0.6 * k : 1);
          break;
        }
        x -= p.sec;
      }
      this.done = n;
    },
    view: () => null,
    result(cycles) {
      const c = cycles ?? (this.done || 0);
      return { score: null, m: { cycles: c }, partial: c < ex.cycles };
    },
  };
}

function rangeMode(ex, api) {
  const steps = [
    { key: 'low', main: 'Самая низкая нота', sub: 'Спойте «а», плавно опускайтесь и подержите нижнюю ноту' },
    { key: 'high', main: 'Самая высокая нота', sub: 'Плавно поднимайтесь и подержите верхнюю ноту без напряжения' },
  ];
  const got = {};
  let i = 0;
  let stepStart = 0;
  let started = null;
  let lastVoiced = null;
  let center = 55;
  let note = '';
  const begin = (now) => {
    stepStart = now;
    started = lastVoiced = null;
    api.progress(i, steps.length);
    api.action('Готово', () => endStep(audio.now()));
  };
  const endStep = (now) => {
    const st = steps[i];
    const notes = segmentNotes(api.frames().filter((f) => f.t >= stepStart), { minDur: 0.45, tol: 0.7 });
    if (!notes.length) {
      note = 'Не расслышал устойчивую ноту — попробуйте ещё раз';
      begin(now);
      return;
    }
    note = '';
    const mids = notes.map((n) => n.midi);
    got[st.key] = st.key === 'low' ? Math.min(...mids) : Math.max(...mids);
    i++;
    if (i >= steps.length) { api.action(null); api.finish(mode.result()); } else begin(now + 0.8);
  };
  const mode = {
    start: (now) => begin(now + 0.3),
    tick(now, f) {
      if (now < stepStart) { api.listen(false); return; }
      api.listen(true);
      const st = steps[i];
      api.status(st.main, note || st.sub);
      if (f && f.midi != null) {
        if (started == null) started = now;
        lastVoiced = now;
        if (f.midi > center + 9) center = f.midi - 9;
        if (f.midi < center - 9) center = f.midi + 9;
      }
      if (started != null && now - lastVoiced > 1.6 && lastVoiced - started > 1.2) endStep(now);
    },
    view: () => ({ targets: [], lo: Math.round(center) - 13, hi: Math.round(center) + 13 }),
    result() {
      const ok = got.low != null && got.high != null;
      return { score: null, m: { low: got.low ?? null, high: got.high ?? null }, partial: !ok };
    },
  };
  return mode;
}

/** Песня целиком: фразы идут подряд, каждая оценивается отдельно. */
function performMode(ex, api) {
  const line = [];
  const scores = [];
  const lagMax = Math.min(T.maxLag, Math.max(0.2, ex.gap - 0.5));
  let idx = 0;
  let scheduled = -1;
  let lead = 0;
  let firstTicks = [];
  return {
    start(now) {
      lead = now + 0.6;
      // Настройка: первая нота песни, затем пауза на вдох и два щелчка.
      audio.playNote(ex.phrases[0].notes[0].midi, lead, 1.3, 0.6);
      const beat = countBeat(median(ex.phrases[0].notes.map((n) => n.dur)));
      let t = lead + 2.0 + 2 * beat;
      firstTicks = [t - 2 * beat, t - beat];
      audio.playTick(firstTicks[0]);
      audio.playTick(firstTicks[1], true);
      for (const ph of ex.phrases) {
        line.push({ ph, start: t, end: t + ph.len, sing: ph.notes.map((n) => ({ midi: n.midi, start: t + n.start, dur: n.dur })) });
        t += ph.len + ex.gap;
      }
      api.progress(0, line.length);
    },
    tick(now) {
      const cur = line[idx];
      if (!cur) return;
      if (ex.headphones && scheduled < idx && now >= cur.start - 0.25) {
        scheduled = idx;
        for (const c of cur.ph.chords || []) audio.playChord(c.midis, cur.start + c.start, Math.min(c.dur, 4), 0.2);
      }
      const next = line[idx + 1];
      if (now < cur.start - 0.15) {
        api.listen(false);
        if (idx === 0) api.count(now < firstTicks[0] - 0.05 ? '' : now < firstTicks[1] - 0.05 ? '2' : '1');
        api.status(idx === 0 ? (now < firstTicks[0] - 0.05 ? 'Послушайте первую ноту' : 'Вдох') : cur.ph.lyrics, idx === 0 ? cur.ph.lyrics : (next ? next.ph.lyrics : ''));
      } else if (now < cur.end + lagMax + 0.1) {
        api.listen(true);
        api.count('');
        api.status(cur.ph.lyrics, next ? next.ph.lyrics : '');
      } else {
        const sc = scoreAligned(cur.sing, api.frames(), { tol: ex.tol, maxLag: lagMax });
        scores.push({ key: cur.ph.key, lyrics: cur.ph.lyrics, lag: sc.lagSec, ...sc });
        api.dot(idx, sc.hitRate >= 75 ? 'ok' : sc.hitRate >= 45 ? 'warn' : 'bad');
        idx++;
        api.progress(idx, line.length);
        if (idx >= line.length) { api.listen(false); api.finish(this.result()); }
      }
    },
    view(now) {
      const targets = [];
      for (let i = Math.max(0, idx - 1); i < Math.min(line.length, idx + 2); i++) targets.push(...line[i].sing);
      if (idx === 0) targets.push({ midi: ex.phrases[0].notes[0].midi, start: lead, dur: 1.3, ref: true });
      const cur = line[Math.min(idx, line.length - 1)];
      const active = cur.sing.find((t) => now >= t.start && now < t.start + t.dur);
      return { targets, lagOk: lagMax, target: active ? active.midi : null, lo: ex.lo - 3, hi: ex.hi + 3 };
    },
    result() {
      const all = summarizeNotes(scores.flatMap((s) => s.notes));
      const lags = trustedLags(scores);
      return {
        score: scores.length ? all.hitRate : null,
        m: {
          hitRate: all.hitRate, notes: all.total, avgAbsCents: all.avgAbsCents, biasCents: all.biasCents, missed: all.missed,
          lagSec: lags ? Math.round(median(lags) * 100) / 100 : null,
          phrases: scores.map((s) => ({ key: s.key, lyrics: s.lyrics, hitRate: s.hitRate, avgAbs: s.avgAbsCents, bias: s.biasCents })),
        },
        partial: scores.length < ex.phrases.length,
      };
    },
  };
}

const MODES = { pattern: patternMode, sustain: sustainMode, glide: glideMode, match: matchMode, echo: echoMode, exhale: exhaleMode, breath: breathMode, range: rangeMode, perform: performMode };

// ---------- Описание результата ----------

/** Строки результата для показа ученику: [{ label, value }]. */
export function resultLines(res) {
  const m = res.m || {};
  const L = [];
  const add = (label, value) => { if (value != null && value !== '') L.push({ label, value: String(value) }); };
  const dev = (c) => (c == null ? null : biasText(c));
  switch (res.type) {
    case 'pattern':
    case 'perform':
      add('Попадание в ноты', `${m.hitRate}%`);
      add('Среднее отклонение', m.avgAbsCents == null ? null : centsText(m.avgAbsCents));
      add('Склонность', m.biasCents == null ? null : (Math.abs(m.biasCents) < 8 ? 'ровно' : m.biasCents > 0 ? 'завышаете' : 'занижаете'));
      if (m.lagSec != null && m.lagSec >= 0.3) add('Вступление', `позже на ${num(Math.round(m.lagSec * 10) / 10)} с`);
      if (m.missed) add('Не спето нот', m.missed);
      if (m.beyond) add('Ноты сверх диапазона', `${m.beyond.hits} из ${m.beyond.notes}`);
      break;
    case 'sustain':
      add('Дольше всего на ноте', `${num(m.bestHeldSec)} с`);
      if (m.avgStdCents != null) add('Ровность (разброс)', centsText(m.avgStdCents));
      if (m.biasCents != null) add('Высота', dev(m.biasCents));
      break;
    case 'glide':
      if (m.reps) add('Охват', `${m.lowName} – ${m.highName}`);
      if (m.reps) add('Полутонов', m.span);
      break;
    case 'match':
      add('Засчитано', `${m.hitRate}%`);
      add('Время до попадания', m.avgSec == null ? null : `${num(m.avgSec)} с`);
      add('Склонность', m.biasCents == null ? null : dev(m.biasCents));
      break;
    case 'echo':
      add('Точных повторов', `${m.hitRate}%`);
      add('Среднее отклонение', m.avgAbsCents == null ? null : centsText(m.avgAbsCents));
      break;
    case 'exhale':
      add('Лучший выдох', `${num(m.bestSec)} с`);
      add('Средний', `${num(m.avgSec)} с`);
      break;
    case 'breath':
      add('Циклов', m.cycles);
      break;
    case 'range':
      if (m.low != null) add('Нижняя нота', noteFull(m.low));
      if (m.high != null) add('Верхняя нота', noteFull(m.high));
      break;
    default:
  }
  return L;
}

/** Одна строка для списков и журнала. */
export function resultShort(res) {
  const lines = resultLines(res);
  return lines.length ? `${lines[0].label.toLowerCase()}: ${lines[0].value}` : '';
}

// ---------- Экран упражнения ----------

/**
 * opts: { step, onDone(result), onExit(), onSkip(), onStart(), onFinish(), prev(id), keepMic, doneLabel, autoStart }
 * Возвращает { destroy() }.
 */
export function mountRunner(root, ex, opts = {}) {
  const needsMic = ex.type !== 'breath';
  const hasRoll = !['breath', 'exhale'].includes(ex.type);
  const S = { state: 'idle', frames: [], listening: false, raf: 0, mode: null, startedAt: 0, error: '', result: null };
  let roll = null;
  let statusMain = '';
  let statusSub = '';
  let bigText = '';
  let actionFn = null;

  const el = {
    status: h('h2.run-status'),
    sub: h('p.run-sub'),
    note: h('div.run-note'),
    cents: h('div.run-cents'),
    big: h('div.run-big'),
    dots: h('div.run-dots'),
    canvas: h('canvas.roll'),
    circle: h('div.breath-circle'),
    foot: h('div.run-foot'),
    body: h('div.run-body'),
    action: h('button.btn.ghost'),
    count: h('div.run-count'),
    levelBar: h('i'),
    levelHint: h('span', 'Не слышу вас: пойте громче или ближе к телефону'),
  };
  el.level = h('div.mic-level', { 'aria-hidden': 'true' }, h('b', el.levelBar), el.levelHint);
  el.levelHint.hidden = true;
  let dotCls = [];
  let countText = '';
  let quietSince = null;

  const api = {
    status(main, sub) {
      if (main !== statusMain) { statusMain = main; el.status.textContent = main; }
      if (sub !== statusSub) { statusSub = sub; el.sub.textContent = sub || ''; }
    },
    big(text) { if (text !== bigText) { bigText = text; el.big.textContent = text; } },
    progress(i, n) {
      if (el.dots.childElementCount !== n) { clear(el.dots); for (let k = 0; k < n; k++) el.dots.append(h('span')); }
      [...el.dots.children].forEach((d, k) => { d.className = k < i ? 'done ' + (dotCls[k] || '') : k === i ? 'cur' : ''; });
    },
    /** Цвет точки по итогу повтора: ok, warn или bad. */
    dot(i, cls) { dotCls[i] = cls; },
    /** Крупная цифра отсчёта поверх полотна. */
    count(text) { if (text !== countText) { countText = text; el.count.textContent = text; } },
    listen(on) { S.listening = on; },
    frames: () => S.frames,
    breath(scale) { el.circle.style.transform = `scale(${scale.toFixed(3)})`; },
    action(label, fn) {
      actionFn = fn || null;
      el.action.textContent = label || '';
      el.action.hidden = !label;
    },
    finish(result) { finish(result); },
  };
  el.action.hidden = true;
  el.action.addEventListener('click', () => { if (actionFn) actionFn(); });

  const clock = () => (S.mode && S.mode.clock === 'perf' ? performance.now() / 1000 : audio.now());

  function loop() {
    S.raf = requestAnimationFrame(loop);
    if (S.state !== 'running') return;
    let f = null;
    if (needsMic) {
      f = audio.readFrame();
      if (f && S.listening) S.frames.push(f);
    }
    const now = clock();
    if (f) {
      const heard = f.rms > audio.getGate();
      el.levelBar.style.transform = `scaleX(${audio.levelOf(f.rms).toFixed(3)})`;
      el.level.classList.toggle('on', heard);
      // Подсказка появляется, если приложение ждёт голос, а его нет.
      if (heard || !S.listening) quietSince = null;
      else if (quietSince == null) quietSince = now;
      el.levelHint.hidden = !(quietSince != null && now - quietSince > 3.5);
    }
    S.mode.tick(now, f);
    if (S.state !== 'running') return;
    const view = S.mode.view(now);
    if (roll && view) {
      roll.draw({ now, tol: ex.tol ?? 50, frames: S.frames, ...view });
      readout(f, view);
    }
  }

  function readout(f, view) {
    if (!f || f.midi == null || !S.listening) {
      el.note.textContent = '—';
      el.cents.textContent = '';
      el.cents.className = 'run-cents';
      return;
    }
    const ref = view.target != null ? view.target : Math.round(f.midi);
    const cents = Math.round((f.midi - ref) * 100);
    el.note.textContent = noteName(Math.round(f.midi));
    if (view.target != null) {
      const tol = ex.tol ?? 50;
      const dir = cents > tol ? '↓ ниже' : cents < -tol ? '↑ выше' : '✓';
      el.cents.textContent = `${dir} · ${cents > 0 ? '+' : ''}${cents} ц`;
      el.cents.className = 'run-cents ' + (Math.abs(cents) <= tol ? 'ok' : Math.abs(cents) <= tol * 2 ? 'warn' : 'bad');
    } else {
      el.cents.textContent = '';
    }
  }

  async function start() {
    S.error = '';
    try {
      await audio.unlock();
      if (needsMic) {
        await audio.startMic();
        await audio.calibrate(0.4);
        audio.resetTracker();
      }
    } catch (e) {
      S.error = e.message || String(e);
      render();
      return;
    }
    audio.keepAwake(true);
    if (opts.onStart) opts.onStart();
    S.frames = [];
    S.listening = false;
    S.mode = MODES[ex.type](ex, api);
    S.state = 'running';
    S.startedAt = Date.now();
    statusMain = statusSub = bigText = countText = '';
    el.count.textContent = '';
    dotCls = [];
    quietSince = null;
    render();
    if (hasRoll) { roll = new Roll(el.canvas); }
    S.mode.start(clock());
    cancelAnimationFrame(S.raf);
    loop();
  }

  function finish(result) {
    if (S.state !== 'running') return;
    S.state = 'done';
    cancelAnimationFrame(S.raf);
    audio.stopSound();
    audio.keepAwake(false);
    if (opts.onFinish) opts.onFinish();
    S.result = {
      id: ex.id, title: ex.title, type: ex.type, cat: ex.cat,
      sec: Math.round((Date.now() - S.startedAt) / 1000),
      ...result,
    };
    S.tips = tipFor(S.result, ex);
    if (S.tips.length) S.result.tip = S.tips.join(' ');
    S.compare = opts.prev ? compareWithPrev(S.result, opts.prev(ex.id)) : null;
    render();
  }

  function stopEarly() {
    if (S.state !== 'running') return;
    const res = S.mode.result();
    finish({ ...res, partial: true });
  }

  const onHide = () => { if (document.hidden && S.state === 'running') stopEarly(); };
  const onResize = () => { if (roll) roll.resize(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('resize', onResize);
  // Полотно меняет высоту, когда над ним появляется таймер: подстраиваем разметку.
  const watcher = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  if (watcher) watcher.observe(el.canvas);

  function render() {
    clear(root);
    const head = h('header.run-head',
      h('button.icon-btn', { onclick: exit, 'aria-label': 'Закрыть' }, icon('back')),
      h('div.run-title', h('small', ex.cat || ''), h('strong', ex.title)),
      h('span.run-step', opts.step || ''));
    clear(el.foot);
    clear(el.body);

    if (S.state === 'idle') {
      put(el.body, 
        h('div.card.how',
          h('div.card-head', h('h3', 'Как выполнять'), h('span.muted', volume())),
          h('ol', (ex.how || []).map((t) => h('li', t))),
          ex.feel ? h('p.feel', ex.feel) : null),
        hasRoll ? h('details.legend',
          h('summary', 'Что на экране'),
          h('ul.plain',
            h('li', ex.refMode === 'own' ? 'Оранжевая полоса — нота, которую нужно спеть.' : 'Бирюзовые полосы — образец, оранжевые — то, что поёте вы.'),
            h('li', 'Линия — ваш голос: зелёная — попали, жёлтая — близко, красная — мимо.'),
            ['pattern', 'perform'].includes(ex.type) ? h('li', 'Перед вступлением звучат два щелчка: на них вдох, после второго — пойте. Небольшое опоздание оценку не снижает.') : null,
            h('li', 'Отклонение показано в центах (ц): 100 ц — полутон. Стрелка говорит, куда двигаться.'),
            h('li', 'Полоска микрофона вверху слева загорается, когда приложение вас слышит.'))) : null,
        ex.stretched && ex.type === 'pattern'
          ? h('p.hint', 'Верхние повторы выходят на 1–2 полутона за ваш измеренный диапазон. Пойте их легко и тихо. Если звук давится или хрипит — этот повтор просто не пойте: диапазон растёт постепенно.')
          : null,
        needsMic && ex.refMode === 'own' && ['pattern', 'sustain', 'match'].includes(ex.type)
          ? h('p.hint', 'Опорный звук — ваш инструмент. Дайте ноте отзвучать перед тем, как петь: микрофон слышит и инструмент.')
          : null,
        needsMic && ex.headphones && ['pattern', 'perform'].includes(ex.type)
          ? h('p.hint', 'Режим наушников: приложение подыгрывает во время пения.')
          : null,
        S.error ? h('p.error', S.error) : null);
      put(el.foot, 
        h('button.btn.primary.wide', { onclick: start }, needsMic ? icon('mic') : icon('play'), ' Начать'),
        opts.onSkip ? h('button.btn.ghost', { onclick: () => opts.onSkip() }, 'Пропустить') : null);
    } else if (S.state === 'running') {
      const stage = h('div.run-stage');
      if (hasRoll) stage.append(el.canvas, el.count, el.level, h('div.run-readout', el.note, el.cents));
      else if (ex.type === 'breath') stage.append(h('div.breath-wrap', el.circle));
      else stage.append(h('div.breath-wrap', el.circle), el.level);
      put(el.body, h('div.run-top', el.status, el.sub, el.big), stage, el.dots);
      put(el.foot, el.action, h('button.btn.ghost', { onclick: stopEarly }, 'Завершить'));
    } else {
      const res = S.result;
      const lines = resultLines(res);
      const found = [resultDetails(res)].flat(3).filter(Boolean);
      const details = found.length ? found : null;
      put(el.body, 
        h('div.card.result',
          h('h3', res.partial ? 'Упражнение прервано' : 'Результат'),
          res.score != null ? h('div.score', { class: res.score >= 75 ? 'ok' : res.score >= 45 ? 'warn' : 'bad' }, `${res.score}%`) : null,
          lines.length ? h('dl', lines.map((l) => [h('dt', l.label), h('dd', l.value)])) : h('p.muted', 'Данных для оценки не набралось.'),
          S.compare ? h('p.muted.compare', S.compare) : null),
        S.tips && S.tips.length ? h('div.card.advice', h('h3', 'Совет'), S.tips.map((t) => h('p', t))) : null,
        details ? h('div.card.result', details) : null);
      put(el.foot, 
        h('button.btn.primary.wide', { onclick: () => opts.onDone && opts.onDone(res) }, opts.doneLabel || 'Дальше'),
        h('button.btn.ghost', { onclick: () => { S.state = 'idle'; render(); } }, 'Повторить'));
    }
    root.append(h('div.runner', head, el.body, el.foot));
  }

  function resultDetails(res) {
    const m = res.m || {};
    if (res.type === 'pattern') {
      const tone = (v) => (v >= 75 ? 'ok' : v >= 45 ? 'warn' : 'bad');
      return [
        m.degrees && m.degrees.length > 1 && m.notes ? [h('h4', ex.lyric ? 'По нотам фразы' : 'По нотам попевки'), degreeChart(m.degrees)] : null,
        m.reps && m.reps.length > 1 ? [
          h('h4', 'По высоте: от какой ноты'),
          h('div.bars', m.reps.map((r) => h('div.bar', { title: `от ${r.from}` },
            h('i', { style: { height: Math.max(4, r.hitRate) + '%' }, class: tone(r.hitRate) }),
            h('span', r.from)))),
        ] : null,
      ];
    }
    if (res.type === 'perform' && m.phrases) {
      return h('ul.phrase-scores', m.phrases.map((p) => h('li',
        h('span', p.lyrics), h('b', { class: p.hitRate >= 75 ? 'ok' : p.hitRate >= 45 ? 'warn' : 'bad' }, `${p.hitRate}%`))));
    }
    if (res.type === 'match' && m.items) {
      return h('div.chips', m.items.map((it) => h('span.chip', { class: it.ok ? 'ok' : 'bad' }, `${it.note} ${it.ok ? '✓' : '✕'}`)));
    }
    if (res.type === 'echo' && m.rounds) {
      return h('div.chips', m.rounds.map((it) => h('span.chip', { class: it.cents != null && Math.abs(it.cents) <= (ex.tol ?? 50) ? 'ok' : 'bad' },
        `${it.played} ${it.cents == null ? '—' : (it.cents > 0 ? '+' : '') + it.cents + ' ц'}`)));
    }
    if (res.type === 'exhale' && m.durations) {
      return h('div.chips', m.durations.map((d) => h('span.chip', `${num(d.toFixed(1))} с`)));
    }
    return null;
  }

  /** Объём упражнения до старта: «17 повторов · около 2 мин». */
  function volume() {
    const min = Math.max(1, Math.round(estimateSeconds(ex) / 60));
    if (ex.free || ex.type === 'range' || ex.type === 'perform' || ex.lyric) return '';
    const count = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;
    const what = ex.type === 'pattern' ? count(ex.reps.length, 'повтор', 'повтора', 'повторов')
      : ex.type === 'sustain' ? count(ex.notes.length, 'нота', 'ноты', 'нот')
        : ex.type === 'match' ? count(ex.items.length, 'нота', 'ноты', 'нот')
          : ex.type === 'echo' ? count(ex.rounds, 'раз', 'раза', 'раз')
            : ['glide', 'exhale'].includes(ex.type) ? count(ex.reps, 'повтор', 'повтора', 'повторов')
              : ex.type === 'breath' ? count(ex.cycles, 'цикл', 'цикла', 'циклов') : '';
    return what ? `${what} · около ${min} мин` : '';
  }

  /**
   * Рисунок попевки: точки повторяют её контур, цвет — доля попаданий,
   * подпись — среднее смещение в центах там, где оно заметно.
   */
  function degreeChart(degrees) {
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs, text) => {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      if (text != null) node.textContent = text;
      return node;
    };
    const W = 320;
    const H = 96;
    const lo = Math.min(...degrees.map((d) => d.semis));
    const hi = Math.max(...degrees.map((d) => d.semis));
    const x = (i) => 16 + (i * (W - 32)) / Math.max(1, degrees.length - 1);
    const y = (s) => 62 - ((s - lo) / Math.max(1, hi - lo)) * 46;
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'degrees', role: 'img',
      'aria-label': degrees.map((d, i) => `нота ${i + 1}: попадание ${d.hit}%${d.bias == null ? '' : `, смещение ${d.bias} центов`}`).join('; ') });
    svg.append(mk('path', { class: 'contour', d: degrees.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.semis).toFixed(1)}`).join('') }));
    const dense = degrees.length > 9;
    degrees.forEach((d, i) => {
      svg.append(mk('circle', { cx: x(i), cy: y(d.semis), r: dense ? 5 : 7, class: d.hit >= 75 ? 'ok' : d.hit >= 45 ? 'warn' : 'bad' }));
      if (d.bias != null && Math.abs(d.bias) >= 15) {
        svg.append(mk('text', { x: x(i), y: 88, 'text-anchor': 'middle', class: 'lab' }, (d.bias > 0 ? '+' : '−') + Math.abs(d.bias)));
      }
    });
    return h('div.degrees-wrap', svg, h('p.muted', 'Цвет — как часто попадали в ноту; число — на сколько центов в среднем выше (+) или ниже (−).'));
  }

  function exit() {
    if (opts.onExit) opts.onExit();
  }

  render();
  if (opts.autoStart) start();

  return {
    destroy() {
      cancelAnimationFrame(S.raf);
      S.state = 'dead';
      audio.stopSound();
      audio.keepAwake(false);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('resize', onResize);
      if (watcher) watcher.disconnect();
      if (!opts.keepMic) audio.stopMic();
    },
  };
}
