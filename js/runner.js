// Тренажёр: проводит одно упражнение любого типа и возвращает результат.

import * as audio from './audio.js';
import { Roll } from './roll.js';
import { h, clear, put, icon } from './ui.js';
import { noteName, noteFull } from './music.js';
import { HoldDetector, segmentNotes, median, percentile } from './pitch.js';
import { scoreTargets, scoreSustain, summarizeNotes, foldToOctave, biasText, voicedSeconds } from './scoring.js';

const r1 = (x) => Math.round(x * 10) / 10;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// ---------- Режимы ----------

function patternMode(ex, api) {
  const own = ex.refMode === 'own';
  const line = [];
  const scores = [];
  let idx = 0;
  let scheduled = -1;
  return {
    start(now) {
      let t = now + 1.2;
      for (const rep of ex.reps) {
        const refLen = own ? 2.6 : rep.len;
        const singStart = t + refLen + 0.45;
        line.push({
          rep, refStart: t, singStart, singEnd: singStart + rep.len,
          ref: own
            ? [{ midi: rep.notes[0].midi, start: t, dur: refLen - 0.3, ref: true, label: 'сыграйте ' + noteName(rep.notes[0].midi) }]
            : rep.notes.map((n) => ({ midi: n.midi, start: t + n.start, dur: n.dur, ref: true })),
          sing: rep.notes.map((n) => ({ midi: n.midi, start: singStart + n.start, dur: n.dur })),
        });
        t = singStart + rep.len + 0.8;
      }
      api.progress(0, line.length);
    },
    tick(now) {
      const cur = line[idx];
      if (!cur) return;
      if (scheduled < idx && now >= cur.refStart - 0.25) {
        scheduled = idx;
        if (!own) audio.playNotes(cur.rep.notes, cur.refStart, 0.6);
        if (ex.headphones) audio.playNotes(cur.rep.notes, cur.singStart, 0.22);
      }
      const from = noteName(cur.rep.notes[0].midi);
      if (now < cur.refStart) {
        api.listen(false);
        api.status('Приготовьтесь', ex.lyric || `Попевка от ${from}`);
      } else if (now < cur.singStart - 0.1) {
        api.listen(false);
        api.status(own ? `Сыграйте ${noteFull(cur.rep.notes[0].midi)}` : 'Слушайте', ex.lyric || `Попевка от ${from}`);
      } else if (now < cur.singEnd + 0.25) {
        api.listen(true);
        api.status(ex.lyric ? 'Пойте' : `Пойте: «${ex.syllable}»`, ex.lyric || `От ${from}`);
      } else {
        api.listen(false);
        const sc = scoreTargets(cur.sing, api.frames(), { tol: ex.tol, skipFrac: ex.slide ? 0.55 : undefined });
        scores.push({ root: cur.rep.root, ...sc });
        idx++;
        api.progress(idx, line.length);
        if (idx >= line.length) api.finish(this.result());
      }
    },
    view() {
      const targets = [];
      for (let i = Math.max(0, idx - 1); i < Math.min(line.length, idx + 2); i++) targets.push(...line[i].ref, ...line[i].sing);
      const cur = line[Math.min(idx, line.length - 1)];
      return { targets, lo: cur.rep.root + Math.min(...ex.reps[0].notes.map((n) => n.midi - ex.reps[0].root)) - 4,
        hi: cur.rep.root + Math.max(...ex.reps[0].notes.map((n) => n.midi - ex.reps[0].root)) + 4 };
    },
    result() {
      const all = summarizeNotes(scores.flatMap((s) => s.notes));
      return {
        score: scores.length ? all.hitRate : null,
        m: {
          hitRate: all.hitRate, notes: all.total, missed: all.missed,
          avgAbsCents: all.avgAbsCents, biasCents: all.biasCents, stdCents: all.stdCents,
          reps: scores.map((s) => ({ from: noteName(s.root), hitRate: s.hitRate, bias: s.biasCents })),
        },
        partial: scores.length < ex.reps.length,
      };
    },
  };
}

function sustainMode(ex, api) {
  const own = ex.refMode === 'own';
  const out = [];
  let i = 0;
  let singStart = 0;
  let refStart = 0;
  let started = null;
  let lastVoiced = null;
  const begin = (now) => {
    started = lastVoiced = null;
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
      if (f && f.midi != null) {
        if (started == null) started = now;
        lastVoiced = now;
      }
      const held = started == null ? 0 : now - started;
      api.big(started == null ? '' : held.toFixed(1) + ' с');
      api.status(ex.free ? 'Тяните «а» как можно дольше' : `Тяните: «${ex.syllable}»`,
        ex.free ? 'Любая удобная нота' : `${noteFull(target)} · цель ${ex.holdSec} с`);
      const silent = started != null && now - lastVoiced > 0.7;
      const noStart = started == null && now - singStart > 12;
      const enough = !ex.free && started != null && held >= ex.holdSec + 0.3;
      if (silent || noStart || enough || now - singStart > 75) {
        const win = api.frames().filter((fr) => fr.t >= singStart);
        if (ex.free) {
          const vals = win.filter((fr) => fr.midi != null).map((fr) => fr.midi);
          out.push({ midi: vals.length ? Math.round(median(vals)) : null, heldSec: voicedSeconds(win, (fr) => fr.midi != null) });
        } else out.push(scoreSustain(target, win, ex.tol));
        api.big('');
        i++;
        if (i >= ex.notes.length) api.finish(this.result());
        else begin(now + 0.6);
      }
    },
    view() {
      const target = ex.notes[Math.min(i, ex.notes.length - 1)];
      if (ex.free) return { targets: [], lo: ex.range.lo - 3, hi: ex.range.hi + 3 };
      return { targets: [{ midi: target, start: singStart, dur: ex.holdSec }], lo: target - 6, hi: target + 6, target };
    },
    result() {
      const done = out.filter((o) => o.heldSec > 0);
      return {
        score: ex.free ? null : (done.length ? Math.round(mean(done.map((o) => o.inTol))) : 0),
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
        m: { reps: ok.length, low, high, lowName: noteName(low), highName: noteName(high), span: high - low, zone: `${noteName(z.lo)}–${noteName(z.hi)}` },
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
            api.action('Стоп', () => endRep(audio.now()));
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
  const cycle = ex.phases.reduce((a, p) => a + p.sec, 0);
  return {
    clock: 'perf',
    start(now) { t0 = now + 0.5; api.progress(0, ex.cycles); },
    tick(now) {
      const t = now - t0;
      if (t < 0) { api.status('Приготовьтесь', ''); return; }
      const n = Math.floor(t / cycle);
      if (n >= ex.cycles) { api.breath(0.4); api.finish(this.result(ex.cycles)); return; }
      api.progress(n, ex.cycles);
      let x = t - n * cycle;
      for (let i = 0; i < ex.phases.length; i++) {
        const p = ex.phases[i];
        if (x < p.sec) {
          const k = x / p.sec;
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
  let idx = 0;
  let scheduled = -1;
  let lead = 0;
  return {
    start(now) {
      lead = now + 0.6;
      // Настройка: первая нота песни, затем пауза на вдох.
      audio.playNote(ex.phrases[0].notes[0].midi, lead, 1.3, 0.6);
      let t = lead + 3.2;
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
        api.status(idx === 0 ? 'Послушайте первую ноту' : cur.ph.lyrics, idx === 0 ? cur.ph.lyrics : (next ? next.ph.lyrics : ''));
      } else if (now < cur.end + 0.25) {
        api.listen(true);
        api.status(cur.ph.lyrics, next ? next.ph.lyrics : '');
      } else {
        const sc = scoreTargets(cur.sing, api.frames(), { tol: ex.tol });
        scores.push({ key: cur.ph.key, lyrics: cur.ph.lyrics, ...sc });
        idx++;
        api.progress(idx, line.length);
        if (idx >= line.length) { api.listen(false); api.finish(this.result()); }
      }
    },
    view() {
      const targets = [];
      for (let i = Math.max(0, idx - 1); i < Math.min(line.length, idx + 2); i++) targets.push(...line[i].sing);
      if (idx === 0) targets.push({ midi: ex.phrases[0].notes[0].midi, start: lead, dur: 1.3, ref: true });
      return { targets, lo: ex.lo - 3, hi: ex.hi + 3 };
    },
    result() {
      const all = summarizeNotes(scores.flatMap((s) => s.notes));
      return {
        score: scores.length ? all.hitRate : null,
        m: {
          hitRate: all.hitRate, avgAbsCents: all.avgAbsCents, biasCents: all.biasCents, missed: all.missed,
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
      add('Среднее отклонение', m.avgAbsCents == null ? null : `${Math.round(m.avgAbsCents)} ц`);
      add('Склонность', m.biasCents == null ? null : (Math.abs(m.biasCents) < 8 ? 'ровно' : m.biasCents > 0 ? 'завышаете' : 'занижаете'));
      if (m.missed) add('Не спето нот', m.missed);
      break;
    case 'sustain':
      add('Лучшая длительность', `${m.bestHeldSec} с`);
      if (m.avgStdCents != null) add('Ровность (разброс)', `${m.avgStdCents} ц`);
      if (m.biasCents != null) add('Высота', dev(m.biasCents));
      break;
    case 'glide':
      if (m.reps) add('Охват', `${m.lowName} – ${m.highName}`);
      if (m.reps) add('Полутонов', m.span);
      break;
    case 'match':
      add('Засчитано', `${m.hitRate}%`);
      add('Время до попадания', m.avgSec == null ? null : `${m.avgSec} с`);
      add('Склонность', m.biasCents == null ? null : dev(m.biasCents));
      break;
    case 'echo':
      add('Точных повторов', `${m.hitRate}%`);
      add('Среднее отклонение', m.avgAbsCents == null ? null : `${m.avgAbsCents} ц`);
      break;
    case 'exhale':
      add('Лучший выдох', `${m.bestSec} с`);
      add('Средний', `${m.avgSec} с`);
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
 * opts: { step, onDone(result), onExit(), onSkip(), onStart(), onFinish(), keepMic, doneLabel, autoStart }
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
  };

  const api = {
    status(main, sub) {
      if (main !== statusMain) { statusMain = main; el.status.textContent = main; }
      if (sub !== statusSub) { statusSub = sub; el.sub.textContent = sub || ''; }
    },
    big(text) { if (text !== bigText) { bigText = text; el.big.textContent = text; } },
    progress(i, n) {
      if (el.dots.childElementCount !== n) { clear(el.dots); for (let k = 0; k < n; k++) el.dots.append(h('span')); }
      [...el.dots.children].forEach((d, k) => { d.className = k < i ? 'done' : k === i ? 'cur' : ''; });
    },
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
      el.cents.textContent = (cents > 0 ? '+' : '') + cents + ' ц';
      el.cents.className = 'run-cents ' + (Math.abs(cents) <= (ex.tol ?? 50) ? 'ok' : Math.abs(cents) <= (ex.tol ?? 50) * 2 ? 'warn' : 'bad');
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
    statusMain = statusSub = bigText = '';
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
          h('h3', 'Как выполнять'),
          h('ol', (ex.how || []).map((t) => h('li', t))),
          ex.feel ? h('p.feel', ex.feel) : null),
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
      if (hasRoll) stage.append(el.canvas, h('div.run-readout', el.note, el.cents));
      else if (ex.type === 'breath') stage.append(h('div.breath-wrap', el.circle));
      put(el.body, h('div.run-top', el.status, el.sub, el.big), stage, el.dots);
      put(el.foot, el.action, h('button.btn.ghost', { onclick: stopEarly }, 'Завершить'));
    } else {
      const res = S.result;
      const lines = resultLines(res);
      put(el.body, 
        h('div.card.result',
          h('h3', res.partial ? 'Упражнение прервано' : 'Результат'),
          res.score != null ? h('div.score', { class: res.score >= 75 ? 'ok' : res.score >= 45 ? 'warn' : 'bad' }, `${res.score}%`) : null,
          lines.length ? h('dl', lines.map((l) => [h('dt', l.label), h('dd', l.value)])) : h('p.muted', 'Данных для оценки не набралось.'),
          resultDetails(res)));
      put(el.foot, 
        h('button.btn.primary.wide', { onclick: () => opts.onDone && opts.onDone(res) }, opts.doneLabel || 'Дальше'),
        h('button.btn.ghost', { onclick: () => { S.state = 'idle'; render(); } }, 'Повторить'));
    }
    root.append(h('div.runner', head, el.body, el.foot));
  }

  function resultDetails(res) {
    const m = res.m || {};
    if ((res.type === 'pattern') && m.reps && m.reps.length > 1) {
      return h('div.bars', m.reps.map((r) => h('div.bar', { title: `от ${r.from}` },
        h('i', { style: { height: Math.max(4, r.hitRate) + '%' }, class: r.hitRate >= 75 ? 'ok' : r.hitRate >= 45 ? 'warn' : 'bad' }),
        h('span', r.from))));
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
      return h('div.chips', m.durations.map((d) => h('span.chip', `${d.toFixed(1)} с`)));
    }
    return null;
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
      if (!opts.keepMic) audio.stopMic();
    },
  };
}
