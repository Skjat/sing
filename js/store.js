// Состояние приложения: localStorage для данных, IndexedDB для записей голоса.

const KEY = 'sing.state.v1';

const defaults = () => ({
  v: 1,
  settings: {
    apiKey: '',
    model: 'claude-opus-5-5',
    effort: 'medium',
    refMode: 'app',      // 'app' — тон даёт приложение, 'own' — свой инструмент
    headphones: false,   // в наушниках приложение подыгрывает во время пения
  },
  profile: null,         // { goals, experience, low, high, voiceType, level, diagnosedAt, matchRate, mpt }
  plan: { week: 1, weekStartedAt: null, override: null },
  draft: null,           // незавершённое занятие: { date, week, items, results }
  sessions: [],
  songs: [],
  activeSongId: null,
  chat: [],
  weekly: [],
  teacherNotes: '',      // память учителя: он переписывает её при недельном разборе
  rangeDismissed: null,  // отклонённое предложение расширить диапазон: { low, high }
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    const d = defaults();
    return { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) }, plan: { ...d.plan, ...(data.plan || {}) } };
  } catch {
    return defaults();
  }
}

export const state = load();

let timer = null;
let failed = false;

export function saveNow() {
  clearTimeout(timer);
  timer = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    failed = false;
  } catch {
    failed = true;
  }
  return !failed;
}

export function save() {
  if (timer) return;
  timer = setTimeout(saveNow, 200);
}

export const saveFailed = () => failed;

window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Локальная дата «ГГГГ-ММ-ДД». */
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function exportData() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.settings.apiKey = '';
  return JSON.stringify(copy, null, 1);
}

export function importData(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) throw new Error('Это не файл резервной копии приложения.');
  const key = state.settings.apiKey;
  const d = defaults();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, d, data, { settings: { ...d.settings, ...(data.settings || {}), apiKey: key }, plan: { ...d.plan, ...(data.plan || {}) } });
  saveNow();
}

export function resetAll() {
  const d = defaults();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, d);
  saveNow();
  try { indexedDB.deleteDatabase('sing'); } catch { /* нет доступа */ }
}

// ---------- Статистика ----------

/** Сколько дней подряд были занятия (сегодняшний день может быть ещё впереди). */
export function streak() {
  const days = new Set(state.sessions.map((s) => s.date.slice(0, 10)));
  let n = 0;
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export const sessionsThisWeek = () =>
  state.sessions.filter((s) => s.kind === 'session' && s.week === state.plan.week).length;

export const doneToday = () =>
  state.sessions.some((s) => s.kind === 'session' && s.date.slice(0, 10) === dayKey());

/** Прошлый результат того же упражнения — для сравнения «было → стало». */
export function lastResultOf(id) {
  for (let i = state.sessions.length - 1; i >= 0; i--) {
    const r = (state.sessions[i].results || []).find((x) => x.id === id && !x.skipped);
    if (r) return r;
  }
  return null;
}

export const activeSong = () => state.songs.find((s) => s.id === state.activeSongId) || state.songs[0] || null;

// ---------- Записи голоса (IndexedDB) ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sing', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('takes');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('takes', mode);
    const req = fn(t.objectStore('takes'));
    t.oncomplete = () => { d.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { d.close(); reject(t.error); };
    t.onabort = () => { d.close(); reject(t.error); };
  });
}

export const putTake = (id, blob) => tx('readwrite', (s) => s.put(blob, id)).catch(() => false);
export const getTake = (id) => tx('readonly', (s) => s.get(id)).catch(() => null);
export const deleteTake = (id) => tx('readwrite', (s) => s.delete(id)).catch(() => false);
