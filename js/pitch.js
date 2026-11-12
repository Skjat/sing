// Определение высоты звука (алгоритм YIN) и разбор звукового потока на ноты.
// Чистые функции: работают и в браузере, и в тестах под Node.

import { freqToMidi } from './music.js';

/**
 * Создаёт детектор для буферов длиной size.
 * detect(buf) → { freq, clarity, rms }; freq = 0, если тон не найден.
 */
export function createDetector(sampleRate, size, opts = {}) {
  const fMin = opts.fMin ?? 60;
  const fMax = opts.fMax ?? 1400;
  const threshold = opts.threshold ?? 0.15;
  const tauMin = Math.max(2, Math.floor(sampleRate / fMax));
  const tauMax = Math.min(Math.floor(size / 2), Math.ceil(sampleRate / fMin));
  const W = size - tauMax;
  const d = new Float32Array(tauMax + 1);

  return function detect(buf) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += buf[i] * buf[i];
    const rms = Math.sqrt(energy / size);
    if (rms < 1e-4) return { freq: 0, clarity: 0, rms };

    // Разностная функция
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    // Кумулятивная нормализация
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    // Первый провал ниже порога
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 < tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let best = tauMin;
      for (let t = tauMin + 1; t < tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.4) return { freq: 0, clarity: 1 - d[best], rms };
      tau = best;
    }
    // Параболическое уточнение
    let refined = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const denom = a + c - 2 * b;
      if (denom !== 0) refined = tau + (a - c) / (2 * denom);
    }
    return { freq: sampleRate / refined, clarity: 1 - d[tau], rms };
  };
}

/**
 * Сглаживание потока: отсекает тихие и нечёткие кадры, гасит одиночные
 * скачки (ошибки на октаву) и усредняет медианой по трём кадрам.
 */
export class PitchTracker {
  constructor(opts = {}) {
    this.minClarity = opts.minClarity ?? 0.8;
    this.gate = opts.gate ?? 0.008;
    this.recent = [];
    this.pending = [];
    this.last = null;
  }

  reset() {
    this.recent = [];
    this.pending = [];
    this.last = null;
  }

  /** Возвращает сглаженную высоту в MIDI (дробную) или null. */
  push(freq, clarity, rms) {
    if (!freq || clarity < this.minClarity || rms < this.gate) {
      this.silent = (this.silent || 0) + 1;
      if (this.silent > 4) this.reset();
      return null;
    }
    this.silent = 0;
    const midi = freqToMidi(freq);
    if (this.last != null && Math.abs(midi - this.last) > 7) {
      // Большой скачок принимаем, только если он держится несколько кадров.
      const p = this.pending;
      if (p.length && Math.abs(p[p.length - 1] - midi) > 1) p.length = 0;
      p.push(midi);
      if (p.length < 3) return null;
      this.recent = p.slice();
      this.pending = [];
    } else {
      this.pending.length = 0;
      this.recent.push(midi);
      if (this.recent.length > 3) this.recent.shift();
    }
    const s = this.recent.slice().sort((a, b) => a - b);
    this.last = s[Math.floor(s.length / 2)];
    return this.last;
  }
}

export function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(v);
}

export function percentile(values, p) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

/**
 * Разбивает кадры [{t, midi|null, rms}] на ноты.
 * Новая нота начинается при смене высоты, после паузы или при новой атаке
 * (резкий рост громкости — повтор той же клавиши или струны).
 * Возвращает [{ midi, cents, start, dur }].
 */
export function segmentNotes(frames, opts = {}) {
  const minDur = opts.minDur ?? 0.12;
  const tol = opts.tol ?? 0.6;
  const maxGap = opts.maxGap ?? 0.09;
  const onsetRatio = opts.onsetRatio ?? 2.2;
  const raw = [];
  let cur = null;

  const open = (f, onset) => {
    cur = { vals: [f.midi], sum: f.midi, start: f.t, lastT: f.t, rms: [[f.t, f.rms || 0]], onset };
  };
  const close = () => {
    if (!cur) return;
    // Конец ноты — последний звучащий кадр плюс один шаг кадра.
    const step = cur.vals.length > 1 ? (cur.lastT - cur.start) / (cur.vals.length - 1) : 0;
    const end = cur.lastT + step;
    if (end - cur.start >= minDur) {
      const med = median(cur.vals);
      const midi = Math.round(med);
      raw.push({ midi, cents: Math.round((med - midi) * 100), start: cur.start, dur: end - cur.start, onset: cur.onset });
    }
    cur = null;
  };

  for (const f of frames) {
    if (f.midi == null) {
      if (cur && f.t - cur.lastT > maxGap) close();
      continue;
    }
    if (!cur) { open(f, true); continue; }
    if (f.t - cur.lastT > maxGap) { close(); open(f, true); continue; }
    const mean = cur.sum / cur.vals.length;
    let attack = false;
    if (f.rms && f.t - cur.start > 0.15) {
      let minRecent = Infinity;
      for (let i = cur.rms.length - 1; i >= 0 && f.t - cur.rms[i][0] <= 0.1; i--) {
        if (cur.rms[i][1] < minRecent) minRecent = cur.rms[i][1];
      }
      attack = minRecent > 0 && f.rms > onsetRatio * minRecent;
    }
    if (Math.abs(f.midi - mean) > tol || attack) {
      close();
      open(f, attack);
    } else {
      cur.vals.push(f.midi);
      cur.sum += f.midi;
      cur.lastT = f.t;
      cur.rms.push([f.t, f.rms || 0]);
    }
  }
  close();

  // Склеиваем куски одной ноты, разорванные дрожанием высоты.
  const notes = [];
  for (const n of raw) {
    const prev = notes[notes.length - 1];
    if (prev && prev.midi === n.midi && !n.onset && n.start - (prev.start + prev.dur) < 0.06) {
      prev.dur = n.start + n.dur - prev.start;
    } else {
      notes.push({ midi: n.midi, cents: n.cents, start: n.start, dur: n.dur });
    }
  }
  return notes;
}

/**
 * Приводит записанные ноты к мелодии: начало в нуле, короткие зазоры
 * между нотами закрываются (легато).
 */
export function normalizeMelody(notes, legatoGap = 0.25) {
  if (!notes.length) return [];
  const t0 = notes[0].start;
  return notes.map((n, i) => {
    const next = notes[i + 1];
    let dur = n.dur;
    if (next && next.start - (n.start + n.dur) < legatoGap) dur = next.start - n.start;
    const r = (x) => Math.round(x * 1000) / 1000;
    return { midi: n.midi, start: r(n.start - t0), dur: r(dur) };
  });
}

/** Ловит устойчиво удерживаемую высоту. */
export class HoldDetector {
  constructor(opts = {}) {
    this.tol = opts.tol ?? 0.5;
    this.minDur = opts.minDur ?? 0.5;
    this.maxGap = opts.maxGap ?? 0.12;
    this.reset();
  }

  reset() {
    this.vals = [];
    this.start = null;
    this.lastT = null;
  }

  /** Возвращает { midi, dur }, когда высота держится не меньше minDur, иначе null. */
  push(t, midi) {
    if (midi == null) {
      if (this.lastT != null && t - this.lastT > this.maxGap) this.reset();
      return null;
    }
    if (this.start != null) {
      const mean = this.vals.reduce((a, b) => a + b, 0) / this.vals.length;
      if (Math.abs(midi - mean) > this.tol || t - this.lastT > this.maxGap) this.reset();
    }
    if (this.start == null) this.start = t;
    this.vals.push(midi);
    this.lastT = t;
    const dur = t - this.start;
    if (dur >= this.minDur) return { midi: median(this.vals), dur };
    return null;
  }
}
