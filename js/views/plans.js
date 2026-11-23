// «Дела»: задачи по дням (с повторами для рутины), заметки/планы/идеи, финансовые цели.
import { h, clear, money, dayKey, addDays, weekStart, dayTitle, parseDay, WEEKDAYS_SHORT, shortDate, fullDay } from '../util.js';
import * as store from '../store.js';
import * as P from '../planner.js';
import { segmented } from './editor.js';
import { taskRow } from './calendar.js';
import { openTaskEditor, openNoteEditor, NOTE_KINDS, openGoalEditor, goalSheet, goalRing } from './planner-sheets.js';
import { toast } from '../sheet.js';
import { renderFocus } from './focus.js';

const ui = { seg: 'tasks', date: dayKey(), kind: 'all', q: '' };

export function renderPlans(root) {
  clear(root);
  root.append(h('h1', { class: 'page-title' }, 'Дела'));
  root.append(segmented([['tasks', 'Задачи'], ['focus', 'Фокус'], ['notes', 'Заметки'], ['goals', 'Цели']], ui.seg, (v) => { ui.seg = v; renderPlans(root); }));
  const body = h('div', { class: 'plans-body' });
  root.append(body);
  if (ui.seg === 'tasks') renderTasks(body, root);
  else if (ui.seg === 'focus') renderFocus(body);
  else if (ui.seg === 'notes') renderNotes(body);
  else renderGoals(body);
}

// ---------- задачи ----------
function renderTasks(body, root) {
  const st = store.state();
  const today = dayKey();
  const ws = weekStart(ui.date);

  const strip = h('div', { class: 'week-strip' },
    h('button', { class: 'icon-btn', 'aria-label': 'Прошлая неделя', onclick: () => { ui.date = addDays(ui.date, -7); renderPlans(root); } }, '‹'),
    h('div', { class: 'week-days' }, Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i);
      const ts = P.tasksFor(st, d);
      const done = ts.filter((t) => P.isDone(t, d)).length;
      return h('button', { class: ['wday', d === ui.date && 'sel', d === today && 'today'], onclick: () => { ui.date = d; renderPlans(root); } },
        h('span', { class: 'micro' }, WEEKDAYS_SHORT[i]),
        h('span', { class: 'wday-n mono' }, parseDay(d).getDate()),
        h('span', { class: ['wday-bar', ts.length && done === ts.length && 'full'] }, ts.length ? h('i', { style: { '--w': `${Math.round((done / ts.length) * 100)}%` } }) : null));
    })),
    h('button', { class: 'icon-btn', 'aria-label': 'Следующая неделя', onclick: () => { ui.date = addDays(ui.date, 7); renderPlans(root); } }, '›'));
  body.append(strip);

  const tasks = P.tasksFor(st, ui.date);
  const done = tasks.filter((t) => P.isDone(t, ui.date)).length;
  body.append(h('div', { class: 'tasks-head' },
    h('div', {}, h('div', { class: 'micro' }, ui.date === today ? 'сегодня' : ui.date > today ? 'впереди' : 'было'), h('h2', { class: 'day-panel-title' }, fullDay(ui.date))),
    tasks.length ? h('div', { class: 'tasks-progress mono' }, `${done}/${tasks.length}`) : null));

  // быстрое добавление
  let title = '';
  const quick = h('input', {
    class: 'field quick-add', placeholder: '+ Новая задача и Enter', maxlength: '120', enterkeyhint: 'done',
    oninput: (e) => { title = e.target.value; },
    onkeydown: (e) => {
      if (e.key !== 'Enter' || !title.trim()) return;
      e.preventDefault();
      store.upsert('tasks', { title: title.trim(), date: ui.date, repeat: 'none', done: false, doneDates: [] });
      title = '';
      requestAnimationFrame(() => document.querySelector('.quick-add')?.focus());
    },
  });
  body.append(h('div', { class: 'quick-row' }, quick, h('button', { class: 'icon-btn', 'aria-label': 'Подробная задача', onclick: () => openTaskEditor({ date: ui.date }) }, '⋯')));

  // просроченные (только на «сегодня»)
  if (ui.date === today) {
    const over = P.overdueTasks(st, today);
    if (over.length) {
      body.append(h('div', { class: 'micro list-label neg' }, `Просрочено · ${over.length}`),
        h('div', { class: 'card list' }, over.map((t) => h('div', { class: 'row task', role: 'button', tabindex: '0', onclick: () => openTaskEditor({ item: t }) },
          h('button', { class: 'check', 'aria-label': 'Выполнено', onclick: (ev) => { ev.stopPropagation(); store.toggleTask(t, t.date); } }),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t.title), h('span', { class: 'row-sub neg' }, shortDate(t.date))),
          h('button', { class: 'pay-chip', onclick: (ev) => { ev.stopPropagation(); store.upsert('tasks', { ...t, date: today }); toast('Перенесено на сегодня'); } }, 'На сегодня')))));
    }
  }

  if (tasks.length) body.append(h('div', { class: 'card list' }, tasks.map((t) => taskRow(t, ui.date))));
  else body.append(h('div', { class: 'empty small' }, 'Задач нет. Впишите первую выше — повторяющиеся (зарядка, чтение) настраиваются через «⋯».'));

  // рутина
  const routine = (st.tasks || []).filter((t) => t.repeat && t.repeat !== 'none');
  if (routine.length) {
    const weeks = routine.map((t) => P.habitWeek(t, today));
    const due = weeks.reduce((a, w) => a + w.due, 0), done = weeks.reduce((a, w) => a + w.done, 0);
    body.append(h('div', { class: 'micro list-label section-head' }, h('span', {}, 'Привычки · 7 дней'), h('span', { class: 'mono' }, due ? `${Math.round((done / due) * 100)}%` : '')),
      h('div', { class: 'card list' }, routine.map((t, i) => {
        const streak = streakOf(t, today);
        const w = weeks[i];
        return h('button', { class: 'row habit', onclick: () => openTaskEditor({ item: t }) },
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, t.title),
            h('span', { class: 'habit-dots' }, w.days.map((d) => h('i', { class: ['hd', d.done && 'done', d.due && !d.done && d.date < today && 'miss', !d.due && 'off', d.date === today && 'today'], title: d.date })))),
          h('span', { class: 'row-end' }, h('span', { class: 'streak mono' }, streak ? `🔥 ${streak}` : '—'), h('span', { class: 'row-sub mono' }, `${Math.round(w.rate * 100)}%`)));
      })));
  }
}

function streakOf(t, today) {
  let n = 0;
  let d = P.isDone(t, today) ? today : addDays(today, -1);
  for (let i = 0; i < 400; i++) {
    if (!P.taskOn(t, d)) { d = addDays(d, -1); if (d < t.date) break; continue; }
    if (!P.isDone(t, d)) break;
    n++;
    d = addDays(d, -1);
  }
  return n;
}

// ---------- заметки ----------
function renderNotes(body) {
  const st = store.state();
  const chips = h('div', { class: 'kind-row' },
    [['all', 'Все'], ...Object.entries(NOTE_KINDS).map(([k, v]) => [k, v.label])].map(([k, l]) =>
      h('button', { class: ['chip', ui.kind === k && 'active'], onclick: () => { ui.kind = k; rerender(); } }, l)));
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Поиск по заметкам', value: ui.q, oninput: (e) => { ui.q = e.target.value; drawList(); } });
  const grid = h('div', { class: 'notes-grid' });
  const add = h('button', { class: 'btn btn-primary', onclick: () => openNoteEditor({ kind: ui.kind === 'all' ? 'note' : ui.kind }) },
    ui.kind === 'all' ? '+ Новая запись' : `+ ${NOTE_KINDS[ui.kind].label}`);
  body.append(chips, search, grid, add);

  function rerender() { clear(body); renderNotes(body); }
  function drawList() {
    clear(grid);
    const q = ui.q.trim().toLowerCase();
    const notes = (st.notes || [])
      .filter((n) => ui.kind === 'all' || n.kind === ui.kind)
      .filter((n) => !q || (n.title + ' ' + n.body).toLowerCase().includes(q))
      .sort((a, b) => (b.pinned - a.pinned) || b.updatedAt - a.updatedAt);
    if (!notes.length) { grid.append(h('div', { class: 'empty small span2' }, q ? 'Ничего не найдено' : 'Здесь будут заметки, планы и идеи. Создайте первую.')); return; }
    notes.forEach((n) => {
      const k = NOTE_KINDS[n.kind] || NOTE_KINDS.note;
      const lines = (n.body || '').split('\n').filter((l) => l.trim()).slice(0, 5);
      grid.append(h('button', { class: ['note-card', `k-${n.kind}`], onclick: () => openNoteEditor({ item: n }) },
        h('span', { class: 'note-kind micro' }, `${k.icon} ${k.label}${n.pinned ? ' · 📌' : ''}`),
        n.title && h('span', { class: 'note-card-title' }, n.title),
        h('span', { class: 'note-card-body' }, lines.map((l) => h('span', { class: l.trim().startsWith('- ') ? 'li' : '' }, l.trim().replace(/^- /, '')))),
        h('span', { class: 'note-date micro' }, new Date(n.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }))));
    });
  }
  drawList();
}

// ---------- цели ----------
function renderGoals(body) {
  const st = store.state();
  const goals = st.goals || [];
  if (!goals.length) {
    body.append(h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, '◎'), 'Поставьте финансовую цель',
      h('div', { class: 'muted small' }, 'Подушка безопасности, отпуск, новая техника — приложение посчитает, сколько откладывать в месяц.')));
  }
  const grid = h('div', { class: 'goals-grid' });
  goals.forEach((g) => {
    const s = P.goalStats(g);
    grid.append(h('button', { class: 'goal-card', onclick: () => goalSheet(g) },
      goalRing(g, 72),
      h('span', { class: 'goal-info' },
        h('span', { class: 'row-title' }, g.name),
        h('span', { class: 'mono goal-sum' }, `${money(s.saved, g.currency)} / ${money(g.target, g.currency)}`),
        h('span', { class: 'row-sub' }, s.left === 0 ? 'достигнута ✓' : s.perMonth ? `${money(s.perMonth, g.currency)} в месяц${s.daysLeft != null ? ` · ${Math.max(0, s.daysLeft)} дн.` : ''}` : `${Math.round(s.progress * 100)}%`))));
  });
  body.append(grid, h('button', { class: 'btn btn-primary', onclick: () => openGoalEditor({}) }, '+ Новая цель'));
}
