// Оценка попадания голоса в целевые ноты. Чистые функции.

import { median, stdDev } from './pitch.js';
import { centsText } from './music.js';

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/**
 * targets: [{ midi, start, dur }], frames: [{ t, midi|null }] — время в одной шкале.
 * tol — допуск в центах. Начало каждой ноты не оценивается: это время на переход.
 */
export function scoreTargets(targets, frames, opts = {}) {
  const tol = opts.tol ?? 50;
  const latency = opts.latency ?? 0.05;
  const notes = [];
  let fi = 0;
  for (const tg of targets) {
    // skipFrac задаёт долю ноты, отведённую на переход (для скольжений она больше).
    const skip = skipOf(tg, opts);
    const from = tg.start + skip + latency;
    const to = tg.start + tg.dur + latency;
    while (fi < frames.length && frames[fi].t < from) fi++;
    const cents = [];
    let total = 0;
    for (let i = fi; i < frames.length && frames[i].t <= to; i++) {
      total++;
      if (frames[i].midi != null) cents.push((frames[i].midi - tg.midi) * 100);
    }
    const voiced = total ? cents.length / total : 0;
    const med = median(cents);
    const inTol = cents.length ? cents.filter((c) => Math.abs(c) <= tol).length / cents.length : 0;
    const sung = voiced >= 0.3 && med != null;
    notes.push({
      midi: tg.midi,
      sung,
      cents: sung ? Math.round(med) : null,
      inTol: round1(inTol * 100),
      std: sung ? Math.round(stdDev(cents)) : null,
      hit: sung && Math.abs(med) <= tol,
    });
  }
  return summarizeNotes(notes);
}

/** Доля ноты, отведённая на переход к ней. */
const skipOf = (tg, opts) => (opts.skipFrac != null ? tg.dur * opts.skipFrac : Math.min(0.14, tg.dur * 0.3));

/**
 * Насколько спетое совпадает с рисунком мелодии при данном сдвиге.
 * Сравнивается форма линии, а не точность: постоянная фальшь на результат не влияет,
 * поэтому подбор сдвига не может «подтянуть» неверную ноту к соседней цели.
 */
function contourCost(targets, frames, lag, opts) {
  const latency = opts.latency ?? 0.05;
  const devs = [];
  let total = 0;
  let fi = 0;
  for (const tg of targets) {
    const from = tg.start + lag + skipOf(tg, opts) + latency;
    const to = tg.start + lag + tg.dur + latency;
    while (fi < frames.length && frames[fi].t < from) fi++;
    for (let i = fi; i < frames.length && frames[i].t <= to; i++) {
      total++;
      if (frames[i].midi != null) devs.push((frames[i].midi - tg.midi) * 100);
    }
  }
  if (devs.length < 5 || !total) return Infinity;
  const med = median(devs);
  const spread = devs.reduce((a, d) => a + Math.min(300, Math.abs(d - med)), 0) / devs.length;
  // Тишина там, где должна быть нота, тоже признак неверного сдвига.
  return spread + 200 * (1 - devs.length / total);
}

/**
 * То же, что scoreTargets, но прощает опоздание со вступлением: сначала находит сдвиг,
 * при котором спетая линия лучше всего повторяет рисунок мелодии, затем оценивает ноты.
 * В сводке появляются lagSec — на сколько ученик вступил позже (меньше нуля — раньше) — и fit.
 */
export function scoreAligned(targets, frames, opts = {}) {
  if (!targets.length) return { ...summarizeNotes([]), lagSec: 0, fit: null };
  const maxLag = opts.maxLag ?? 0.6;
  const minLag = opts.minLag ?? -0.2;
  const step = 0.05;
  const last = targets[targets.length - 1];
  const win = frames.filter((f) => f.t >= targets[0].start + minLag - 0.1 && f.t <= last.start + last.dur + maxLag + 0.2);
  const shifts = [];
  for (let k = Math.round(minLag / step); k <= Math.round(maxLag / step); k++) {
    shifts.push({ lag: k * step, cost: contourCost(targets, win, k * step, opts) });
  }
  let best = shifts.reduce((a, b) => (b.cost < a.cost ? b : a), shifts[0]);
  if (best.cost === Infinity) return { ...scoreTargets(targets, win, opts), lagSec: 0, fit: null };
  // Окна оценки короче нот, поэтому одинаково хороших сдвигов несколько подряд: берём середину.
  const at = shifts.indexOf(best);
  let lo = at;
  let hi = at;
  while (lo > 0 && shifts[lo - 1].cost <= best.cost + 6) lo--;
  while (hi < shifts.length - 1 && shifts[hi + 1].cost <= best.cost + 6) hi++;
  const lag = shifts[Math.round((lo + hi) / 2)].lag;
  const sc = scoreTargets(targets.map((tg) => ({ ...tg, start: tg.start + lag })), win, opts);
  // Середина хороших сдвигов лежит раньше настоящего вступления на запас окна.
  const dur = targets.map((t) => t.dur).sort((x, y) => x - y)[Math.floor(targets.length / 2)];
  const real = (shifts[lo].lag + shifts[hi].lag) / 2 + (opts.latency ?? 0.05) + skipOf({ dur }, opts) / 2;
  // fit — насколько спетое повторяет рисунок мелодии (меньше — лучше); по нему видно, можно ли верить lagSec.
  return { ...sc, lagSec: Math.round(real * 100) / 100, fit: Math.round(best.cost) };
}

/**
 * Сводка по местам в попевке. noteLists — оценённые ноты каждого повтора по порядку,
 * semis — ступени попевки в полутонах от первой ноты.
 * Возвращает [{ semis, n, hit (%), bias (центы) }].
 */
export function positionStats(noteLists, semis) {
  return semis.map((s, i) => {
    const notes = noteLists.map((list) => list[i]).filter(Boolean);
    const sung = notes.filter((n) => n.sung);
    return {
      semis: s,
      n: notes.length,
      hit: notes.length ? Math.round((notes.filter((n) => n.hit).length / notes.length) * 100) : 0,
      bias: sung.length ? Math.round(sung.reduce((a, n) => a + n.cents, 0) / sung.length) : null,
    };
  });
}

/** Сводка по высоте: повторы от одной и той же ноты объединяются. scores: [{ root, notes }]. */
export function rootStats(scores) {
  const map = new Map();
  for (const sc of scores) {
    if (!map.has(sc.root)) map.set(sc.root, []);
    map.get(sc.root).push(...sc.notes);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([root, notes]) => {
    const sung = notes.filter((n) => n.sung);
    return {
      root,
      hitRate: Math.round((notes.filter((n) => n.hit).length / notes.length) * 100),
      bias: sung.length ? Math.round(sung.reduce((a, n) => a + n.cents, 0) / sung.length) : null,
    };
  });
}

/** Сводка по набору оценённых нот. */
export function summarizeNotes(notes) {
  const sung = notes.filter((n) => n.sung);
  const hits = notes.filter((n) => n.hit).length;
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    notes,
    total: notes.length,
    hits,
    missed: notes.length - sung.length,
    hitRate: notes.length ? Math.round((hits / notes.length) * 100) : 0,
    avgAbsCents: round1(mean(sung.map((n) => Math.abs(n.cents)))),
    biasCents: round1(mean(sung.map((n) => n.cents))),
    stdCents: round1(mean(sung.map((n) => n.std))),
  };
}

/**
 * Оценка тянущейся ноты. frames — кадры за время попытки.
 * heldSec — сколько секунд голос был рядом с целью (в пределах band центов).
 */
export function scoreSustain(target, frames, tol = 50, band = 100) {
  const cents = [];
  let held = 0;
  let prevT = null;
  for (const f of frames) {
    const dt = prevT == null ? 0 : Math.min(0.1, f.t - prevT);
    prevT = f.t;
    if (f.midi == null) continue;
    const c = (f.midi - target) * 100;
    if (Math.abs(c) <= band) {
      held += dt;
      cents.push(c);
    }
  }
  const med = median(cents);
  return {
    midi: target,
    heldSec: round1(held),
    cents: med == null ? null : Math.round(med),
    std: cents.length ? Math.round(stdDev(cents)) : null,
    inTol: cents.length ? Math.round((cents.filter((c) => Math.abs(c) <= tol).length / cents.length) * 100) : 0,
  };
}

/** Длительность звучания без привязки к высоте (для свободной ноты и выдоха). */
export function voicedSeconds(frames, isOn) {
  let total = 0;
  let prevT = null;
  for (const f of frames) {
    const dt = prevT == null ? 0 : Math.min(0.1, f.t - prevT);
    prevT = f.t;
    if (isOn(f)) total += dt;
  }
  return round1(total);
}

/**
 * Отклонение спетой ноты от сыгранной без учёта октавы.
 * Возвращает { cents, octaves }.
 */
export function foldToOctave(sung, played) {
  const diff = sung - played;
  const octaves = Math.round(diff / 12) || 0;
  return { cents: Math.round((diff - 12 * octaves) * 100), octaves };
}

/** Словесное описание смещения для интерфейса. */
export function biasText(cents) {
  if (cents == null) return '';
  if (Math.abs(cents) < 8) return 'точно';
  return cents > 0 ? `выше на ${centsText(cents)}` : `ниже на ${centsText(cents)}`;
}
