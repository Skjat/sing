// Мелкие помощники интерфейса: создание элементов, всплывающие сообщения, листы.

/** h('div.card', { onclick }, 'текст', child) */
export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' || (k in el && k !== 'list' && typeof v !== 'string')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Переход на экран: go('song/abc') */
export const go = (path) => { location.hash = '#/' + path; };

/** Добавляет детей в элемент, пропуская null и false. */
export function put(el, ...children) {
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let toastTimer = null;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

/**
 * Лист снизу. content — узел или функция (close) → узел.
 * Возвращает функцию закрытия.
 */
export function sheet(title, content) {
  const back = h('div.sheet-back');
  const close = () => {
    back.classList.remove('open');
    setTimeout(() => back.remove(), 200);
  };
  const body = typeof content === 'function' ? content(close) : content;
  const box = h('div.sheet', { role: 'dialog', 'aria-label': title },
    h('div.sheet-head', h('h2', title), h('button.icon-btn', { onclick: close, 'aria-label': 'Закрыть' }, '✕')),
    h('div.sheet-body', body));
  back.append(box);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('open'));
  return close;
}

export function confirmSheet(title, text, okLabel = 'Да', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v, close) => { if (!done) { done = true; resolve(v); close(); } };
    sheet(title, (close) => h('div',
      h('p.muted', text),
      h('div.row',
        h('button.btn.ghost', { onclick: () => finish(false, close) }, 'Отмена'),
        h('button.btn' + (danger ? '.danger' : ''), { onclick: () => finish(true, close) }, okLabel))));
  });
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtDur(sec) {
  const m = Math.round(sec / 60);
  return m < 1 ? 'меньше минуты' : `${m} мин`;
}

/** Склонение: plural(3, 'день', 'дня', 'дней') */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** Простой и безопасный вывод ответа учителя: абзацы, списки, жирный. */
export function renderText(text) {
  const root = h('div.prose');
  const inline = (s, parent) => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    for (const p of parts) {
      if (/^\*\*[^*]+\*\*$/.test(p)) parent.append(h('strong', p.slice(2, -2)));
      else if (p) parent.append(p.replace(/(^|\s)\*([^*\s][^*]*)\*(?=\s|$|[.,;:!?])/g, '$1$2'));
    }
  };
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const bullet = /^([-•*]|\d+[.)])\s+(.*)$/.exec(line);
    const head = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) { list = h('ul'); root.append(list); }
      const li = h('li');
      inline(bullet[2], li);
      list.append(li);
    } else {
      list = null;
      const p = head ? h('p.prose-head') : h('p');
      inline(head ? head[1] : line, p);
      root.append(p);
    }
  }
  return root;
}

export const icon = (name) => h('span.ic', { 'aria-hidden': 'true', html: ICONS[name] || '' });

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = {
  today: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  plan: svg('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>'),
  songs: svg('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  teacher: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  progress: svg('<path d="M4 19V5M4 19h16"/><path d="M8 15l3.5-4 3 2.5L19 8"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.1z"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  check: svg('<path d="M4 12l5 5L20 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
};
