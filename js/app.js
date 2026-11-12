// Запуск приложения, маршруты и нижняя панель.

import { state } from './store.js';
import { h, clear, icon } from './ui.js';
import { stopMic, stopSound } from './audio.js';
import { todayView } from './views/today.js';
import { onboardingView } from './views/onboarding.js';
import { sessionView, exerciseView } from './views/session.js';
import { planView } from './views/plan.js';
import { songsView, songView } from './views/songs.js';
import { teacherView } from './views/teacher.js';
import { progressView } from './views/progress.js';
import { settingsView } from './views/settings.js';

const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'plan', label: 'План' },
  { id: 'songs', label: 'Песни' },
  { id: 'teacher', label: 'Учитель' },
  { id: 'progress', label: 'Прогресс' },
];

const ROUTES = {
  today: todayView,
  onboarding: onboardingView,
  session: sessionView,
  exercise: exerciseView,
  plan: planView,
  songs: songsView,
  song: songView,
  teacher: teacherView,
  progress: progressView,
  settings: settingsView,
};

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
let cleanup = null;

function parse() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : ['today'];
}

function renderTabs(active) {
  clear(tabs);
  for (const t of TABS) {
    tabs.append(h('a', { href: '#/' + t.id, class: t.id === active ? 'on' : '', 'aria-current': t.id === active ? 'page' : null },
      icon(t.id), h('span', t.label)));
  }
}

function navigate() {
  let [name, ...params] = parse();
  if (!ROUTES[name]) name = 'today';
  if (!state.profile && name !== 'onboarding') {
    location.replace('#/onboarding');
    return;
  }
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (e) { console.error(e); }
  }
  cleanup = null;
  stopSound();
  const tabbed = TABS.some((t) => t.id === name) || name === 'settings';
  // Микрофон живёт только внутри занятия и песни.
  if (tabbed) stopMic();
  tabs.hidden = !TABS.some((t) => t.id === name);
  document.body.classList.toggle('full', !tabbed);
  renderTabs(name);
  clear(view);
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  cleanup = ROUTES[name](view, ...params) || null;
}

window.addEventListener('hashchange', navigate);
navigate();

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-режим недоступен */ });
}
