// Оценка попадания голоса в целевые ноты. Чистые функции.

import { median, stdDev } from './pitch.js';

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
    const skip = opts.skipFrac != null ? tg.dur * opts.skipFrac : Math.min(0.14, tg.dur * 0.3);
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
 * heldSec — сколько секунд голос был в пределах ±100 центов от цели.
 */
export function scoreSustain(target, frames, tol = 50) {
  const cents = [];
  let held = 0;
  let prevT = null;
  for (const f of frames) {
    const dt = prevT == null ? 0 : Math.min(0.1, f.t - prevT);
    prevT = f.t;
    if (f.midi == null) continue;
    const c = (f.midi - target) * 100;
    if (Math.abs(c) <= 100) {
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
  return cents > 0 ? `выше на ${Math.abs(Math.round(cents))} ц` : `ниже на ${Math.abs(Math.round(cents))} ц`;
}
