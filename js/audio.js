// Звук: микрофон, определение высоты в реальном времени, синтезатор опорного тона, запись.

import { midiToFreq, freqToMidi } from './music.js';
import { createDetector, PitchTracker } from './pitch.js';

const FFT = 2048;
let ctx = null;
let master = null;
let wave = null;
const live = new Set();

const mic = { stream: null, source: null, analyser: null, sink: null, buf: null, detect: null, tracker: new PitchTracker() };

function setSession(type) {
  // Safari: тип аудиосессии определяет маршрут звука и работу при беззвучном режиме.
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch { /* не поддерживается */ }
}

export function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    // Тембр, богатый гармониками: низкие ноты слышны и на динамике телефона.
    const amps = [0, 1, 0.55, 0.38, 0.24, 0.16, 0.1, 0.07, 0.04];
    wave = ctx.createPeriodicWave(new Float32Array(amps.length), new Float32Array(amps), { disableNormalization: false });
  }
  return ctx;
}

/** Вызывать из обработчика нажатия: браузер разрешает звук только после жеста. */
export async function unlock() {
  const c = getCtx();
  if (c.state !== 'running') {
    try { await c.resume(); } catch { /* повторим при следующем жесте */ }
  }
  return c;
}

export const now = () => getCtx().currentTime;
export const micActive = () => !!(mic.stream && mic.stream.active);

export async function startMic() {
  if (micActive()) { await unlock(); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Браузер не даёт доступ к микрофону. Откройте приложение по HTTPS в Safari.');
  }
  setSession('play-and-record');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  } catch (e) {
    setSession('playback');
    if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      throw new Error('Нет доступа к микрофону. Разрешите его в настройках Safari для этого сайта и попробуйте снова.');
    }
    throw new Error('Не удалось включить микрофон: ' + (e && e.message ? e.message : e));
  }
  const c = await unlock();
  mic.stream = stream;
  mic.source = c.createMediaStreamSource(stream);
  mic.analyser = c.createAnalyser();
  mic.analyser.fftSize = FFT;
  mic.source.connect(mic.analyser);
  // Беззвучный выход: без него Safari может не обрабатывать цепочку.
  mic.sink = c.createGain();
  mic.sink.gain.value = 0;
  mic.analyser.connect(mic.sink);
  mic.sink.connect(c.destination);
  mic.buf = new Float32Array(FFT);
  mic.detect = createDetector(c.sampleRate, FFT);
  mic.tracker.reset();
}

export function stopMic() {
  if (mic.stream) for (const tr of mic.stream.getTracks()) tr.stop();
  try { mic.source && mic.source.disconnect(); } catch { /* уже отключён */ }
  try { mic.sink && mic.sink.disconnect(); } catch { /* уже отключён */ }
  mic.stream = mic.source = mic.analyser = mic.sink = null;
  setSession('playback');
}

/** Порог тишины по фоновому шуму. */
export function setGate(rms) {
  mic.tracker.gate = Math.min(0.03, Math.max(0.006, rms * 2.5));
  return mic.tracker.gate;
}
export const getGate = () => mic.tracker.gate;

/** Замер фонового шума: слушает sec секунд и выставляет порог. */
export function calibrate(sec = 0.5) {
  return new Promise((resolve) => {
    const vals = [];
    const t0 = performance.now();
    const step = () => {
      const f = readFrame();
      if (f) vals.push(f.rms);
      if (performance.now() - t0 < sec * 1000) requestAnimationFrame(step);
      else {
        vals.sort((a, b) => a - b);
        resolve(setGate(vals.length ? vals[Math.floor(vals.length / 2)] : 0.004));
      }
    };
    step();
  });
}

/** Текущий кадр: { t, midi|null, rms, clarity }. Время — по часам аудиоконтекста. */
export function readFrame() {
  if (!mic.analyser) return null;
  mic.analyser.getFloatTimeDomainData(mic.buf);
  const r = mic.detect(mic.buf);
  const midi = mic.tracker.push(r.freq, r.clarity, r.rms);
  // Середина окна анализа отстоит от «сейчас» на половину буфера.
  return { t: ctx.currentTime - FFT / ctx.sampleRate / 2, midi, rms: r.rms, clarity: r.clarity, raw: r.freq ? freqToMidi(r.freq) : null };
}

export function resetTracker() {
  mic.tracker.reset();
}

// ---------- Синтезатор ----------

/** Нота с затухающей огибающей. when — время аудиоконтекста. */
export function playNote(midi, when, dur, gain = 0.5) {
  const c = getCtx();
  const t = Math.max(when, c.currentTime + 0.01);
  const osc = c.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = midiToFreq(midi);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(7000, midiToFreq(midi) * 8);
  const g = c.createGain();
  const peak = gain * 0.5;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.4), t + Math.max(0.05, dur));
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.09);
  osc.connect(lp);
  lp.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.12);
  live.add(osc);
  osc.onended = () => { live.delete(osc); try { g.disconnect(); } catch { /* уже отключён */ } };
  return t + dur;
}

/** Последовательность [{ midi, start, dur }] от момента t0. */
export function playNotes(notes, t0, gain = 0.5) {
  let end = t0;
  for (const n of notes) end = Math.max(end, playNote(n.midi, t0 + n.start, n.dur, gain));
  return end;
}

/** Аккорд с лёгким арпеджированием. */
export function playChord(midis, when, dur, gain = 0.3) {
  midis.forEach((m, i) => playNote(m, when + i * 0.018, dur, gain / Math.sqrt(Math.max(1, midis.length) / 2)));
}

export function stopSound() {
  for (const osc of live) {
    try { osc.stop(); } catch { /* уже остановлен */ }
  }
  live.clear();
}

// ---------- Запись ----------

let recorder = null;
let chunks = [];

export const canRecord = () => typeof MediaRecorder !== 'undefined';

export function startRecording() {
  if (!canRecord() || !micActive()) return false;
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
  try {
    recorder = new MediaRecorder(mic.stream, mimeType ? { mimeType } : undefined);
  } catch {
    recorder = null;
    return false;
  }
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  return true;
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!recorder || recorder.state === 'inactive') { resolve(null); return; }
    const rec = recorder;
    rec.onstop = () => {
      resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }) : null);
      chunks = [];
    };
    rec.stop();
    recorder = null;
  });
}

// ---------- Экран не гаснет во время упражнения ----------

let wakeLock = null;
export async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* не поддерживается или отказано */ }
}
