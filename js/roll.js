// Полотно с целевыми нотами и линией голоса.

import { noteName } from './music.js';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export class Roll {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.pps = 85;          // пикселей в секунду
    this.headX = 0.32;      // положение «сейчас» по ширине
    this.colors = null;
    this.resize();
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(50, r.width);
    this.h = Math.max(50, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.colors = {
      line: cssVar('--line', '#333'),
      muted: cssVar('--muted', '#888'),
      target: cssVar('--accent', '#f2a65a'),
      ref: cssVar('--accent2', '#7cc6b8'),
      ok: cssVar('--ok', '#6fcf97'),
      warn: cssVar('--warn', '#f2c94c'),
      bad: cssVar('--bad', '#eb5757'),
      text: cssVar('--text', '#fff'),
      zone: cssVar('--zone', 'rgba(124,198,184,.12)'),
    };
  }

  /**
   * view: { now, lo, hi, tol, targets: [{ midi, start, dur, ref, label }],
   *         frames: [{ t, midi }], zone: { lo, hi } }
   */
  draw(view) {
    const { g, w, h, colors: c } = this;
    const lo = view.lo;
    const hi = Math.max(view.hi, lo + 8);
    const span = hi - lo + 1;
    const lane = h / span;
    const y = (m) => h - (m - lo + 0.5) * lane;
    const hx = w * this.headX;
    const x = (t) => hx + (t - view.now) * this.pps;
    const tol = view.tol ?? 50;

    g.clearRect(0, 0, w, h);

    // Зона для свободных упражнений
    if (view.zone) {
      g.fillStyle = c.zone;
      const yTop = y(view.zone.hi) - lane / 2;
      g.fillRect(0, yTop, w, y(view.zone.lo) + lane / 2 - yTop);
    }

    // Линейки нот: «до» ярче остальных
    g.lineWidth = 1;
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const isC = ((m % 12) + 12) % 12 === 0;
      g.strokeStyle = c.line;
      g.globalAlpha = isC ? 0.9 : 0.35;
      g.beginPath();
      g.moveTo(0, Math.round(y(m)) + 0.5);
      g.lineTo(w, Math.round(y(m)) + 0.5);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Целевые ноты
    const barH = Math.max(6, Math.min(lane * 0.9, 18));
    const labeled = new Set();
    for (const tg of view.targets || []) {
      const x0 = x(tg.start);
      const x1 = x(tg.start + tg.dur);
      if (x1 < -4 || x0 > w + 4) continue;
      const active = view.now >= tg.start && view.now < tg.start + tg.dur;
      g.fillStyle = tg.ref ? c.ref : c.target;
      g.globalAlpha = tg.ref ? (active ? 0.75 : 0.35) : (active ? 1 : 0.6);
      roundRect(g, x0 + 1, y(tg.midi) - barH / 2, Math.max(3, x1 - x0 - 2), barH, Math.min(6, barH / 2));
      g.fill();
      labeled.add(tg.midi);
      if (tg.label) {
        g.globalAlpha = 0.9;
        g.fillStyle = c.text;
        g.font = '600 11px -apple-system, system-ui, sans-serif';
        g.textBaseline = 'bottom';
        g.fillText(tg.label, Math.max(x0 + 2, 34), y(tg.midi) - barH / 2 - 2);
      }
    }
    g.globalAlpha = 1;

    // Подписи нот слева
    g.font = '11px -apple-system, system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = c.muted;
    // Без целей подписываем опорные ноты: чем теснее линейки, тем реже.
    const free = lane >= 16 ? [0, 2, 4, 5, 7, 9, 11] : lane >= 9 ? [0, 4, 7] : [0];
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const p = ((m % 12) + 12) % 12;
      if (labeled.size ? (labeled.has(m) || p === 0) : free.includes(p)) g.fillText(noteName(m), 4, y(m));
    }

    // Линия голоса
    const frames = view.frames || [];
    const tMin = view.now - hx / this.pps - 0.2;
    let i = Math.max(0, frames.length - 1);
    while (i > 0 && frames[i].t > tMin) i--;
    g.lineWidth = 3;
    g.lineCap = 'round';
    let prev = null;
    for (; i < frames.length; i++) {
      const f = frames[i];
      if (f.midi == null) { prev = null; continue; }
      const px = x(f.t);
      const py = y(f.midi);
      const color = this.colorFor(f, view, tol);
      if (prev && f.t - prev.t < 0.12 && Math.abs(f.midi - prev.midi) < 3) {
        g.strokeStyle = color;
        g.beginPath();
        g.moveTo(prev.px, prev.py);
        g.lineTo(px, py);
        g.stroke();
      } else {
        g.fillStyle = color;
        g.beginPath();
        g.arc(px, py, 1.5, 0, 6.3);
        g.fill();
      }
      prev = { t: f.t, midi: f.midi, px, py };
    }

    // «Сейчас»
    g.strokeStyle = c.muted;
    g.globalAlpha = 0.5;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(hx) + 0.5, 0);
    g.lineTo(Math.round(hx) + 0.5, h);
    g.stroke();
    g.globalAlpha = 1;
    const last = frames.length ? frames[frames.length - 1] : null;
    if (last && last.midi != null && view.now - last.t < 0.15) {
      g.fillStyle = this.colorFor(last, view, tol);
      g.beginPath();
      g.arc(hx, y(last.midi), 6, 0, 6.3);
      g.fill();
      g.strokeStyle = c.text;
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  colorFor(f, view, tol) {
    const c = this.colors;
    let tg = null;
    for (const t of view.targets || []) {
      if (!t.ref && f.t >= t.start && f.t <= t.start + t.dur + 0.05) { tg = t; break; }
    }
    if (!tg) return view.neutral || c.ref;
    const cents = Math.abs(f.midi - tg.midi) * 100;
    if (cents <= tol) return c.ok;
    if (cents <= tol * 2) return c.warn;
    return c.bad;
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
