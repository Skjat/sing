// Расписание упражнений во времени. Один источник и для тренажёра,
// и для расчёта длительности занятия — чтобы обещанные минуты были настоящими.

export const T = {
  prep: 1.2,     // от «Начать» до первого образца
  ownRef: 2.6,   // окно «сыграйте ноту» при своём инструменте
  breath: 0.3,   // пауза после образца перед отсчётом
  tail: 0.9,     // от конца пения до следующего образца
  maxLag: 0.6,   // на столько можно опоздать со вступлением без потери оценки
  between: 20,   // чтение инструкции, нажатия и просмотр результата между упражнениями
};

/** Доля отсчёта: в темпе попевки, но в удобных пределах. */
export function countBeat(noteDur) {
  let b = noteDur || 0.5;
  while (b < 0.42) b *= 2;
  while (b > 0.85) b /= 2;
  return b;
}

/** Длительность одного повтора попевки: образец, отсчёт, пение, пауза. */
export function repSeconds(len, noteDur, own = false) {
  return (own ? T.ownRef : len) + T.breath + 2 * countBeat(noteDur) + len + T.tail;
}

/**
 * Расписание попевки от момента t0.
 * reps: [{ root, notes: [{ midi, start, dur }], len }]
 * Возвращает [{ rep, refStart, refLen, ticks: [t1, t2], singStart, singEnd }].
 */
export function patternTimeline(reps, noteDur, t0, own = false) {
  const beat = countBeat(noteDur);
  const line = [];
  let t = t0 + T.prep;
  for (const rep of reps) {
    const refLen = own ? T.ownRef : rep.len;
    const tick1 = t + refLen + T.breath;
    const singStart = tick1 + 2 * beat;
    line.push({ rep, refStart: t, refLen, ticks: [tick1, tick1 + beat], singStart, singEnd: singStart + rep.len });
    t = singStart + rep.len + T.tail;
  }
  return line;
}

// Типичные длительности там, где темп задаёт сам ученик.
const TYPICAL = { exhale: 15, glide: 6, match: 3, echoRound: 7.5 };

/** Сколько секунд занимает упражнение без чтения инструкции. */
export function estimateSeconds(ex) {
  const own = ex.refMode === 'own';
  switch (ex.type) {
    case 'breath':
      return 0.5 + ex.cycles * ex.phases.reduce((a, p) => a + p.sec, 0);
    case 'exhale':
      return ex.reps * TYPICAL.exhale + (ex.reps - 1) * 3;
    case 'glide':
      return 0.5 + ex.reps * (TYPICAL.glide + 0.8) + (ex.reps - 1) * 1.8;
    case 'sustain':
      if (ex.free) return 20;
      return ex.notes.length * (0.8 + (own ? 2.6 : 1.6) + ex.holdSec * 1.15 + 0.6);
    case 'pattern':
      return T.prep + ex.reps.reduce((a, r) => a + repSeconds(r.len, ex.noteDur, own), 0);
    case 'match':
      return ex.items.length * ((own ? 5 : 2.05) + TYPICAL.match + (ex.mode === 'interval' ? 1.7 : 1.0));
    case 'echo':
      return ex.rounds * TYPICAL.echoRound;
    case 'perform':
      return 3.8 + ex.phrases.reduce((a, p) => a + p.len + ex.gap, 0);
    case 'song':
      return 360;
    case 'range':
      return 25;
    default:
      return 0;
  }
}
