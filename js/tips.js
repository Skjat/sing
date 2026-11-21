// Мгновенный совет после упражнения: простые правила по измерениям, без сети.
// Чистые функции.

import { centsText } from './music.js';

const abs = Math.abs;
const sec = (x) => String(Math.round(x * 10) / 10).replace('.', ',');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** «на 35 центов», с пояснением масштаба при первом упоминании. */
const cents = (c, explain = true) => `на ${centsText(c)}${explain ? ' (100 центов — полутон)' : ''}`;

/**
 * Группы мест в попевке: верхняя нота, шаги вверх, шаги вниз.
 * degrees: [{ semis, hit, bias }]
 */
export function degreeGroups(degrees) {
  if (!degrees || degrees.length < 2) return null;
  const max = Math.max(...degrees.map((d) => d.semis));
  const grp = (list) => {
    const withBias = list.filter((d) => d.bias != null);
    return list.length ? { n: list.length, hit: Math.round(mean(list.map((d) => d.hit))), bias: withBias.length ? Math.round(mean(withBias.map((d) => d.bias))) : null } : null;
  };
  const top = [];
  const up = [];
  const down = [];
  degrees.forEach((d, i) => {
    if (d.semis === max) top.push(d);
    else if (i > 0 && d.semis > degrees[i - 1].semis) up.push(d);
    else if (i > 0 && d.semis < degrees[i - 1].semis) down.push(d);
  });
  return { top: grp(top), up: grp(up), down: grp(down) };
}

function patternTip(m) {
  const out = [];
  if (!m.notes) return ['Данных не набралось: упражнение прервано до первого повтора.'];
  if (m.missed / m.notes > 0.5) {
    return ['Приложение почти не слышало голос. Пойте чуть громче и держите телефон в 30–40 см от лица; индикатор микрофона на экране должен загораться.'];
  }
  if (m.lagSec != null && m.lagSec >= 0.3) {
    out.push(`Вы вступаете позже примерно на ${sec(m.lagSec)} с. Оценку это не снижает, но в песне собьёт ритм: вдыхайте на щелчки и начинайте вместе с первой нотой.`);
  }
  const g = degreeGroups(m.degrees);
  const reps = m.reps || [];
  // Мимо больше чем на полтора полутона — это уже не фальшь, а другие ноты.
  if (m.avgAbsCents != null && m.avgAbsCents >= 150) {
    return [...out, `Чаще всего вы пели другие ноты: в среднем мимо на ${String(Math.round(m.avgAbsCents / 10) / 10).replace('.', ',')} полутона. Дослушайте образец, пропойте попевку про себя и следите за линией на экране: она должна ложиться на оранжевые полосы.`];
  }
  let main = null;
  if (g && g.top && g.top.bias != null && g.top.bias <= -20 && g.top.hit < 80) {
    main = `Верхняя нота попевки низит: в среднем ${cents(g.top.bias)}. Перед ней сделайте звук легче и откройте рот шире — не усиливайте и не тянитесь горлом.`;
  } else if (g && g.top && g.top.bias != null && g.top.bias >= 20 && g.top.hit < 80) {
    main = `Верхнюю ноту вы перелетаете: в среднем ${cents(g.top.bias)} выше. Берите её тише и не толкайте воздухом.`;
  } else if (g && g.down && g.down.bias != null && g.down.bias <= -18 && (!g.up || g.up.bias == null || g.up.bias - g.down.bias >= 10)) {
    main = `На спуске ноты сползают вниз: в среднем ${cents(g.down.bias)}. Спускаясь, думайте, что шаги маленькие, и не бросайте дыхание до последней ноты.`;
  } else if (m.biasCents != null && m.biasCents <= -18) {
    main = `В целом вы занижаете ${cents(m.biasCents)}. Чаще всего причина в вялом выдохе: пойте активнее, с лёгкой улыбкой, и дослушивайте образец до конца.`;
  } else if (m.biasCents != null && m.biasCents >= 18) {
    main = `В целом вы завышаете ${cents(m.biasCents)}. Обычно это лишний нажим: пойте тише и свободнее.`;
  }
  let height = null;
  if (reps.length >= 3) {
    const third = Math.max(1, Math.floor(reps.length / 3));
    const lowPart = mean(reps.slice(0, third).map((r) => r.hitRate));
    const highPart = mean(reps.slice(-third).map((r) => r.hitRate));
    if (lowPart - highPart >= 25) {
      height = `Точность падает на верхних повторах (от ${reps[reps.length - third].from} и выше). Это граница удобной зоны: пойте их тише и легче, без нажима.`;
    } else if (highPart - lowPart >= 25) {
      height = `Нижние повторы даются хуже (до ${reps[third - 1].from}). Не давите на низкие ноты: пойте их мягко, почти говоря.`;
    }
  }
  if (!main && !height && m.stdCents != null && m.stdCents >= 30) {
    main = `Ноты «плавают»: внутри одной ноты высота гуляет ${cents(m.stdCents)}. Держите выдох ровным и не меняйте громкость внутри ноты.`;
  }
  if (!main && !height) {
    main = m.hitRate >= 85
      ? `Чисто: ${m.hitRate}% попаданий, заметного смещения нет. Следующая задача — сохранить то же при меньшей громкости.`
      : `Попадание ${m.hitRate}%, ошибки разбросаны без явной закономерности. Перед пением пропойте попевку про себя и не спешите со вступлением.`;
  }
  if (main) out.push(main);
  if (height) out.push(height);
  if (m.beyond) {
    out.push(`Ноты за пределами вашего диапазона: попали в ${m.beyond.hits} из ${m.beyond.notes}. Если звук давится или хрипит — не берите их, диапазон растёт постепенно.`);
  }
  return out.slice(0, 3);
}

function performTip(m) {
  const out = [];
  const ph = (m.phrases || []).slice().sort((a, b) => a.hitRate - b.hitRate);
  if (!ph.length) return ['Данных не набралось: исполнение прервано до конца первой фразы.'];
  if (m.notes && m.missed / m.notes > 0.5) {
    return ['Приложение почти не слышало голос. Пойте без инструмента, чуть громче и ближе к телефону; индикатор микрофона на экране должен загораться.'];
  }
  if (m.lagSec != null && m.lagSec >= 0.3) out.push(`Вы вступаете позже примерно на ${sec(m.lagSec)} с — берите дыхание раньше, в паузе между фразами.`);
  if (ph[0].hitRate < 70) {
    out.push(`Труднее всего далась фраза «${ph[0].lyrics}» (${ph[0].hitRate}%). Откройте её в разучивании и пропойте в темпе 80%, сначала на слог «ма».`);
  } else out.push(`Все фразы от ${ph[0].hitRate}% и выше — песня держится. Теперь следите за дыханием: вдох только между фразами.`);
  if (m.biasCents != null && abs(m.biasCents) >= 18) {
    out.push(m.biasCents < 0 ? `В целом вы занижаете ${cents(m.biasCents)}. Проверьте тональность: возможно, песня высоковата.` : `В целом вы завышаете ${cents(m.biasCents)} — пойте свободнее, без нажима.`);
  }
  return out;
}

function sustainTip(m, ex) {
  if (ex && ex.free) return [`Самая долгая нота — ${sec(m.bestHeldSec)} с. Этот показатель растёт вместе с опорой: следите, чтобы живот подбирался медленно.`];
  const notes = m.notes || [];
  const off = notes.filter((n) => !n.heldSec).length;
  if (notes.length && off >= notes.length / 2) {
    return ['Чаще всего вы пели не ту ноту: линия шла мимо цели. Дослушайте образец, пропойте его про себя и только потом пойте; стрелка на экране показывает, куда двигаться.'];
  }
  const out = [];
  const goal = ex ? ex.holdSec : 5;
  if (m.bestHeldSec < goal * 0.6) out.push(`Звук обрывается раньше цели (${sec(m.bestHeldSec)} с из ${goal}). Вдохните животом и расходуйте воздух тонкой ровной струйкой.`);
  if (m.avgStdCents != null && m.avgStdCents > 25) out.push(`Нота дрожит: высота гуляет ${cents(m.avgStdCents)}. Выдох должен быть ровным, как на упражнении «ссс».`);
  else if (m.biasCents != null && m.biasCents <= -15) out.push(`Вы держите ноту ниже цели ${cents(m.biasCents)}. Начинайте звук чуть активнее и слушайте образец.`);
  else if (m.biasCents != null && m.biasCents >= 15) out.push(`Вы держите ноту выше цели ${cents(m.biasCents)}. Отпустите нажим, пойте тише.`);
  if (!out.length) out.push(`Ровно: нота на месте, высота гуляет всего ${cents(m.avgStdCents ?? 0, false)}. Попробуйте то же тише.`);
  return out;
}

function matchTip(m) {
  const items = m.items || [];
  if (!items.length) return ['Данных не набралось: упражнение прервано до первой ноты.'];
  const hits = items.filter((i) => i.ok).length;
  const where = m.biasCents == null || abs(m.biasCents) < 25 ? '' : (m.biasCents < 0 ? ' Чаще вы оказываетесь ниже цели.' : ' Чаще вы оказываетесь выше цели.');
  if (m.kind === 'интервалы') {
    if (m.hitRate < 50) return [`Засчитано ${hits} из ${items.length}. Пропойте про себя гамму от первого звука до нужной ступени — так вторая нота находится надёжнее.${where}`];
    return [`Засчитано ${hits} из ${items.length}. Интервалы, которые не дались, сыграйте на инструменте и спойте вслед.${where}`];
  }
  if (m.hitRate < 50) return [`Засчитано ${hits} из ${items.length}. Не подбирайте ноту голосом на ощупь: дослушайте образец, пропойте про себя и только потом пойте.${where}`];
  if (m.avgSec != null && m.avgSec > 2.5) return [`Ноту вы находите, но не сразу — в среднем за ${sec(m.avgSec)} с. Сначала услышьте её внутри, потом пойте сразу на высоте, без подъезда.${where}`];
  return [m.hitRate >= 85 ? `Точно: ${hits} из ${items.length}, в среднем за ${sec(m.avgSec ?? 0)} с.` : `Засчитано ${hits} из ${items.length}.${where || ' Ошибки разбросаны: не спешите, дослушивайте образец.'}`];
}

function echoTip(m) {
  const rounds = m.rounds || [];
  if (!rounds.length) return ['Приложение не услышало ноту инструмента. Сыграйте громче и ближе к телефону, по одной ноте.'];
  if (m.hitRate >= 80) return [`Вы точно снимаете ноту с инструмента (среднее отклонение ${centsText(m.avgAbsCents ?? 0)}). Так и находите первый звук песни.`];
  const where = m.biasCents == null || abs(m.biasCents) < 15 ? '' : (m.biasCents < 0 ? ' Обычно вы поёте ниже инструмента.' : ' Обычно вы поёте выше инструмента.');
  return [`Точных повторов ${m.hitRate}%. Дайте ноте отзвучать, пропойте её про себя и только потом вслух.${where}`];
}

function glideTip(m) {
  if (!m.reps) return ['Звук не расслышан. Скользите чуть громче и ближе к телефону.'];
  const out = [];
  if (m.zoneHi != null && m.high < m.zoneHi - 2) out.push(`Вверху вы не дошли до края зоны на ${m.zoneHi - m.high} полутона. Не тянитесь силой: чем выше, тем тише и легче звук.`);
  if (m.zoneLo != null && m.low > m.zoneLo + 2) out.push(`Внизу остался запас в ${m.low - m.zoneLo} полутона. Опускайтесь расслабленно, как на вздохе.`);
  if (!out.length) out.push(`Охват полный: ${m.lowName} – ${m.highName}. Следите, чтобы переход между нижним и верхним звучанием шёл плавно, без щелчка.`);
  return out;
}

function exhaleTip(m) {
  const d = (m.durations || []).filter((x) => x > 0);
  if (!d.length) return ['Звук выдоха не расслышан. Держите телефон ближе и выдыхайте на отчётливое «ссс».'];
  const out = [];
  if (m.bestSec < 10) out.push(`Выдох пока короткий — ${sec(m.bestSec)} с. Вдыхайте животом и выпускайте воздух тонкой струйкой. Ориентир на первые недели — 15–20 с.`);
  else if (m.bestSec >= 20) out.push(`Отличный выдох — ${sec(m.bestSec)} с. Теперь следите за ровностью: звук одинаковый от начала до конца.`);
  else out.push(`Лучший выдох — ${sec(m.bestSec)} с, это рабочий уровень. Следите, чтобы звук не слабел к концу.`);
  if (d.length >= 3 && d[d.length - 1] < d[0] * 0.7) out.push('К последнему повтору выдох заметно короче — отдыхайте между попытками на два-три спокойных вдоха.');
  return out;
}

/** Совет по результату упражнения: массив из одной-трёх фраз. */
export function tipFor(res, ex) {
  if (!res || res.skipped) return [];
  const m = res.m || {};
  switch (res.type) {
    case 'pattern': return patternTip(m);
    case 'perform': return performTip(m);
    case 'sustain': return sustainTip(m, ex);
    case 'match': return matchTip(m);
    case 'echo': return echoTip(m);
    case 'glide': return glideTip(m);
    case 'exhale': return exhaleTip(m);
    case 'breath': return ['На вдохе плечи остаются на месте, расходятся живот и нижние рёбра. Если кружится голова — дышите обычно.'];
    default: return [];
  }
}

/** Сравнение с прошлой попыткой того же упражнения: «В прошлый раз 62% → сейчас 71%». */
export function compareWithPrev(res, prev) {
  if (!res || !prev || prev.skipped || res.partial || prev.partial) return null;
  const a = prev.m || {};
  const b = res.m || {};
  const line = (was, now, unit, betterWhenLower = false) => {
    if (was == null || now == null) return null;
    const diff = now - was;
    const same = abs(diff) < (unit === '%' ? 3 : 0.5);
    const better = betterWhenLower ? diff < 0 : diff > 0;
    return `В прошлый раз ${sec(was)}${unit} → сейчас ${sec(now)}${unit}${!same && better ? ' — лучше' : ''}`;
  };
  switch (res.type) {
    case 'pattern':
    case 'perform':
    case 'match':
    case 'echo':
      return line(prev.score, res.score, '%');
    case 'exhale': return line(a.bestSec, b.bestSec, ' с');
    case 'sustain': return sustainCompare(a, b, line);
    case 'glide': return a.span != null && b.span != null ? `В прошлый раз охват ${a.span} полутонов → сейчас ${b.span}` : null;
    default: return null;
  }
}

function sustainCompare(a, b, line) {
  if (a.avgStdCents != null && b.avgStdCents != null) return line(a.avgStdCents, b.avgStdCents, ' центов разброса', true);
  return line(a.bestHeldSec, b.bestHeldSec, ' с');
}
