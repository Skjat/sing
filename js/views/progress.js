// Прогресс: показатели, графики и журнал занятий.

import { state, streak } from '../store.js';
import { h, sheet, fmtDate, plural, renderText } from '../ui.js';
import { resultLines, resultShort } from '../runner.js';
import { noteName } from '../music.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

/** «Красивые» деления оси: 3–5 круглых значений. */
function ticks(min, max) {
  if (max - min < 1e-6) { min -= 1; max += 1; }
  const raw = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const out = [];
  for (let v = lo; v <= max + step * 0.999; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * Линейный график одного показателя.
 * points: [{ date, value, value2? }]; при value2 рисуется полоса между значениями.
 */
function lineChart({ title, sub, points, fmt, yFmt, fixed }) {
  const W = 340;
  const H = 170;
  const pad = { l: 38, r: 34, t: 10, b: 22 };
  const card = h('div.card.chart');
  card.append(h('div.card-head', h('h3', title), h('span.muted', sub || '')));
  if (points.length < 2) {
    card.append(h('p.muted', points.length ? `Пока одна точка: ${fmt(points[0])}. График появится после следующего занятия.` : 'Данные появятся после первых занятий.'));
    return card;
  }
  const band = points[0].value2 != null;
  const vals = points.flatMap((p) => (band ? [p.value, p.value2] : [p.value]));
  const tk = fixed || ticks(Math.min(...vals), Math.max(...vals));
  const y0 = tk[0];
  const y1 = tk[tk.length - 1];
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${title}: ${points.map(fmt).join(', ')}` });

  for (const t of tk) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'grid' }));
    const label = s('text', { x: pad.l - 6, y: y(t) + 3.5, class: 'tick', 'text-anchor': 'end' });
    label.textContent = yFmt ? yFmt(t) : t;
    svg.append(label);
  }
  const first = s('text', { x: pad.l, y: H - 5, class: 'tick' });
  first.textContent = fmtDate(points[0].date);
  const lastLabel = s('text', { x: W - pad.r, y: H - 5, class: 'tick', 'text-anchor': 'end' });
  lastLabel.textContent = fmtDate(points[points.length - 1].date);
  svg.append(first, lastLabel);

  const path = (get) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join('');
  if (band) {
    const area = path((p) => p.value2) + points.map((p, i) => `L${x(points.length - 1 - i).toFixed(1)},${y(points[points.length - 1 - i].value).toFixed(1)}`).join('') + 'Z';
    svg.append(s('path', { d: area, class: 'wash' }), s('path', { d: path((p) => p.value), class: 'ln' }), s('path', { d: path((p) => p.value2), class: 'ln' }));
  } else {
    const area = `${path((p) => p.value)}L${x(points.length - 1).toFixed(1)},${y(y0).toFixed(1)}L${x(0).toFixed(1)},${y(y0).toFixed(1)}Z`;
    svg.append(s('path', { d: area, class: 'wash' }), s('path', { d: path((p) => p.value), class: 'ln' }));
  }
  // Точка и подпись только у последнего значения
  const last = points[points.length - 1];
  for (const v of band ? [last.value, last.value2] : [last.value]) {
    svg.append(s('circle', { cx: x(points.length - 1), cy: y(v), r: 4, class: 'dot' }));
    const lab = s('text', { x: x(points.length - 1) + 7, y: y(v) + 4, class: 'end' });
    lab.textContent = yFmt ? yFmt(v) : v;
    svg.append(lab);
  }

  // Перекрестие и подсказка по касанию или наведению
  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  const marks = (band ? [0, 1] : [0]).map(() => s('circle', { r: 4, class: 'dot', visibility: 'hidden' }));
  svg.append(cross, ...marks);
  const tip = h('div.tip', { hidden: true });
  const wrap = h('div.chart-wrap', svg, tip);
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (points.length - 1))));
    const p = points[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    marks.forEach((m, k) => {
      m.setAttribute('cx', x(i));
      m.setAttribute('cy', y(k ? p.value2 : p.value));
      m.setAttribute('visibility', 'visible');
    });
    tip.hidden = false;
    tip.textContent = `${fmtDate(p.date)} · ${fmt(p)}`;
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.max(4, Math.min(r.width - tip.offsetWidth - 4, left - tip.offsetWidth / 2)) + 'px';
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); marks.forEach((m) => m.setAttribute('visibility', 'hidden')); tip.hidden = true; };
  svg.addEventListener('pointermove', (e) => show(e.clientX));
  svg.addEventListener('pointerdown', (e) => show(e.clientX));
  svg.addEventListener('pointerleave', hide);

  card.append(wrap,
    h('details.table', h('summary', 'Таблица'),
      h('table', h('tbody', points.slice().reverse().map((p) => h('tr', h('td', fmtDate(p.date)), h('td', fmt(p))))))));
  return card;
}

function collect() {
  const acc = [];
  const exhale = [];
  const range = [];
  const hold = [];
  if (state.profile && state.profile.diagnosedAt) {
    range.push({ date: state.profile.diagnosedAt, value: state.profile.low, value2: state.profile.high, diag: true });
  }
  for (const ses of state.sessions) {
    const scored = (ses.results || []).filter((r) => ['pattern', 'match', 'echo', 'perform'].includes(r.type) && r.score != null && !r.skipped);
    if (scored.length) acc.push({ date: ses.date, value: Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) });
    for (const r of ses.results || []) {
      if (r.skipped || !r.m) continue;
      if (r.type === 'exhale' && r.m.bestSec > 0) exhale.push({ date: ses.date, value: r.m.bestSec });
      if (r.type === 'sustain' && r.m.bestHeldSec > 0 && r.m.avgStdCents != null) hold.push({ date: ses.date, value: r.m.avgStdCents });
    }
    const glides = (ses.results || []).filter((r) => r.type === 'glide' && r.m && r.m.reps);
    if (glides.length) {
      range.push({ date: ses.date, value: Math.min(...glides.map((g) => g.m.low)), value2: Math.max(...glides.map((g) => g.m.high)) });
    }
  }
  // Один день — одна точка: берём лучший результат дня.
  const byDay = (arr, better) => {
    const map = new Map();
    for (const p of arr) {
      const k = p.date.slice(0, 10);
      const cur = map.get(k);
      if (!cur || better(p, cur)) map.set(k, p);
    }
    return [...map.values()].slice(-30);
  };
  return {
    acc: byDay(acc, (a, b) => a.value > b.value),
    exhale: byDay(exhale, (a, b) => a.value > b.value),
    hold: byDay(hold, (a, b) => a.value < b.value),
    range: byDay(range, (a, b) => a.value2 - a.value > b.value2 - b.value),
  };
}

function sessionSheet(ses) {
  const kind = ses.kind === 'session' ? `Занятие, неделя ${ses.week}` : ses.kind === 'song' ? 'Песня' : 'Отдельное упражнение';
  sheet(`${fmtDate(ses.date)} · ${kind}`, () => h('div',
    ses.report ? h('p.muted', `Ощущения: ${ses.report.feel.toLowerCase()}, голос: ${ses.report.voice.toLowerCase()}${ses.report.strain ? ', был дискомфорт' : ''}.${ses.report.note ? ' «' + ses.report.note + '»' : ''}`) : null,
    (ses.results || []).map((r) => h('div.res-block',
      h('div.card-head', h('strong', r.title), r.score != null ? h('b', { class: r.score >= 75 ? 'ok' : r.score >= 45 ? 'warn' : 'bad' }, `${r.score}%`) : null),
      r.skipped ? h('p.muted', 'Пропущено') : h('dl', resultLines(r).map((l) => [h('dt', l.label), h('dd', l.value)])))),
    ses.review ? [h('h4', 'Разбор учителя'), renderText(ses.review)] : null));
}

export function progressView(root) {
  const data = collect();
  const sessions = state.sessions.filter((x) => x.kind === 'session');
  const minutes = Math.round(state.sessions.reduce((a, x) => a + (x.sec || 0), 0) / 60);
  const days = streak();
  const lastAcc = data.acc.length ? data.acc[data.acc.length - 1].value : null;

  const tile = (value, label) => h('div.tile', h('b', value), h('span', label));

  root.append(h('div.page',
    h('header.top', h('div', h('small.muted', 'Динамика'), h('h1', 'Прогресс'))),
    h('div.tiles',
      tile(String(days), `${plural(days, 'день', 'дня', 'дней')} подряд`),
      tile(String(sessions.length), plural(sessions.length, 'занятие', 'занятия', 'занятий')),
      tile(String(minutes), `${plural(minutes, 'минута', 'минуты', 'минут')} пения`),
      tile(lastAcc == null ? '—' : lastAcc + '%', 'попадание')),
    lineChart({
      title: 'Попадание в ноты', sub: 'среднее за день, %', points: data.acc,
      fmt: (p) => `${p.value}%`, yFmt: (v) => `${v}%`, fixed: [0, 25, 50, 75, 100],
    }),
    lineChart({
      title: 'Охват голоса', sub: 'нижняя и верхняя ноты', points: data.range,
      fmt: (p) => `${noteName(p.value)} – ${noteName(p.value2)}`, yFmt: (v) => noteName(Math.round(v)),
      fixed: data.range.length ? (() => {
        const lo = Math.floor(Math.min(...data.range.map((p) => p.value)) / 12) * 12;
        const hi = Math.ceil(Math.max(...data.range.map((p) => p.value2)) / 12) * 12;
        const out = [];
        for (let v = lo; v <= hi; v += 12) out.push(v);
        return out;
      })() : null,
    }),
    lineChart({
      title: 'Выдох на «ссс»', sub: 'лучший за день, секунды', points: data.exhale,
      fmt: (p) => `${p.value} с`, yFmt: (v) => `${v}`,
    }),
    lineChart({
      title: 'Ровность тянущейся ноты', sub: 'разброс в центах, меньше — лучше', points: data.hold,
      fmt: (p) => `${p.value} ц`, yFmt: (v) => `${v}`,
    }),
    h('section.stage',
      h('h3.stage-title', 'Журнал'),
      state.sessions.length
        ? h('div.list', [...state.sessions].reverse().slice(0, 60).map((ses) => {
          const first = (ses.results || []).find((r) => !r.skipped);
          const title = ses.kind === 'session' ? `Занятие · неделя ${ses.week}` : (first ? first.title : 'Упражнение');
          const scored = (ses.results || []).filter((r) => r.score != null);
          const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
          return h('button.row-btn', { onclick: () => sessionSheet(ses) },
            h('span.grow', h('strong', title), h('span.muted', `${fmtDate(ses.date)}${ses.kind !== 'session' && first ? ' · ' + resultShort(first) : ''}${ses.review ? ' · есть разбор' : ''}`)),
            avg != null ? h('b', { class: avg >= 75 ? 'ok' : avg >= 45 ? 'warn' : 'bad' }, `${avg}%`) : null);
        }))
        : h('p.muted', 'Здесь появятся ваши занятия.'))));
}
