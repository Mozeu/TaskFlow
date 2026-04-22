/* ═══════════════════════════════════════════════════════════
   TASKFLOW — calendar.js  v1.0
   Módulos: CalendarState · CalendarUtils · ProjectFilter ·
            MonthView · YearView · DayView · DetailPanel
   Depende de: app.js (State, esc, formatDate, daysUntil)
               tasks.js (KanbanState, TaskManager)
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. CONSTANTES
───────────────────────────────────────────── */
const WEEKDAYS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const MONTHS_LONG    = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_SHORT   = ['Ene','Feb','Mar','Abr','May','Jun',
                        'Jul','Ago','Sep','Oct','Nov','Dic'];

const PRIORITY_CLR = {
  alta:  { bg: 'rgba(252,92,101,0.15)',  clr: '#fc5c65' },
  media: { bg: 'rgba(247,183,49,0.15)',  clr: '#f7b731' },
  baja:  { bg: 'rgba(32,191,107,0.15)',  clr: '#20bf6b' },
};
const STATUS_LABEL = {
  'pendiente':   'Pendiente',
  'en-progreso': 'En Progreso',
  'terminado':   'Terminado',
};
const STATUS_CLR = {
  'pendiente':   { bg:'rgba(247,183,49,.13)',   clr:'#f7b731' },
  'en-progreso': { bg:'rgba(69,170,242,.13)',   clr:'#45aaf2' },
  'terminado':   { bg:'rgba(32,191,107,.13)',   clr:'#20bf6b' },
};

/* ─────────────────────────────────────────────
   1. ESTADO DEL CALENDARIO
───────────────────────────────────────────── */
const CalState = {
  view:            'month',      // 'month' | 'year' | 'day'
  cursor:          new Date(),   // fecha activa (mes/año/día)
  selectedDate:    null,         // string 'YYYY-MM-DD' del día seleccionado
  filterProjectId: '',           // '' = todos
};

/* ─────────────────────────────────────────────
   2. UTILIDADES DE FECHA
───────────────────────────────────────────── */
const CalUtils = {
  /** YYYY-MM-DD → Date local sin problemas de zona horaria */
  parseISO(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  /** Date → 'YYYY-MM-DD' */
  toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  },

  /** ¿Es hoy? */
  isToday(date) {
    const t = new Date();
    return date.getFullYear() === t.getFullYear() &&
           date.getMonth()    === t.getMonth()    &&
           date.getDate()     === t.getDate();
  },

  /** Primero de la semana (lunes=0) del día */
  weekStart(date) {
    const d   = new Date(date);
    const dow = (d.getDay() + 6) % 7;   // 0=Lun … 6=Dom
    d.setDate(d.getDate() - dow);
    return d;
  },

  /** Días del mes (incluyendo celdas vacías para alinear) */
  monthCells(year, month) {
    const first = new Date(year, month, 1);
    const last  = new Date(year, month + 1, 0);
    const startDow = (first.getDay() + 6) % 7; // 0=Lun
    const cells = [];

    /* Días del mes anterior para rellenar la primera semana */
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, otherMonth: true });
    }
    /* Días del mes actual */
    for (let d = 1; d <= last.getDate(); d++) {
      cells.push({ date: new Date(year, month, d), otherMonth: false });
    }
    /* Completar hasta múltiplo de 7 */
    let extra = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ date: new Date(year, month + 1, extra++), otherMonth: true });
    }
    return cells;
  },

  /** Color de acento del proyecto por id */
  projectColor(projectId) {
    const p = State.projects.find(p => p.id === projectId);
    return p ? p.color : '#6c63ff';
  },
  projectName(projectId) {
    const p = State.projects.find(p => p.id === projectId);
    return p ? p.name : '—';
  },
};

/* ─────────────────────────────────────────────
   3. FUENTE DE TAREAS — filtradas por proyecto
───────────────────────────────────────────── */
const CalData = {
  /** Todas las tareas (con deadline) según filtro de proyecto activo */
  getFiltered() {
    const all = KanbanState.tasks.filter(t => t.deadline);
    if (!CalState.filterProjectId) return all;
    return all.filter(t => t.projectId === CalState.filterProjectId);
  },

  /** Tareas con deadline en una fecha específica (string ISO) */
  getForDate(isoDate) {
    return this.getFiltered().filter(t => t.deadline === isoDate);
  },

  /** Tareas con deadline en un mes (year, month 0-indexed) */
  getForMonth(year, month) {
    const prefix = `${year}-${String(month + 1).padStart(2,'0')}`;
    return this.getFiltered().filter(t => t.deadline?.startsWith(prefix));
  },

  /** Mapa { isoDate: [task, …] } para las celdas del mes */
  mapForMonth(year, month) {
    const tasks = this.getForMonth(year, month);
    const map   = {};
    tasks.forEach(t => {
      map[t.deadline] = map[t.deadline] || [];
      map[t.deadline].push(t);
    });
    return map;
  },
};

/* ─────────────────────────────────────────────
   4. FILTRO POR PROYECTO
───────────────────────────────────────────── */
const CalFilter = {
  init() {
    const sel = document.getElementById('cal-project-filter');
    sel?.addEventListener('change', () => {
      CalState.filterProjectId = sel.value;
      CalendarModule.render();
    });
  },

  populate() {
    const sel = document.getElementById('cal-project-filter');
    if (!sel) return;
    sel.innerHTML =
      '<option value="">Todos los proyectos</option>' +
      State.projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.name)}</option>`
      ).join('');
    sel.value = CalState.filterProjectId;
  },
};

/* ─────────────────────────────────────────────
   5. VISTA MENSUAL (RF17, RF18)
───────────────────────────────────────────── */
const MonthView = {
  MAX_VISIBLE: 3,   // máximo eventos visibles por celda

  render() {
    const y      = CalState.cursor.getFullYear();
    const m      = CalState.cursor.getMonth();
    const cells  = CalUtils.monthCells(y, m);
    const taskMap= CalData.mapForMonth(y, m);
    const grid   = document.getElementById('cal-month-grid');
    if (!grid) return;

    grid.innerHTML = cells.map(cell => this._buildCell(cell, taskMap)).join('');

    /* Bind clicks */
    grid.querySelectorAll('.cal-cell:not(.empty)').forEach(cell => {
      cell.addEventListener('click', () => {
        const iso = cell.dataset.date;
        if (!iso) return;
        this._selectCell(grid, cell, iso);
      });
    });
    grid.querySelectorAll('.cal-more').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const iso = el.closest('.cal-cell')?.dataset.date;
        if (iso) DetailPanel.open(iso);
      });
    });
    grid.querySelectorAll('.cal-event').forEach(ev => {
      ev.addEventListener('click', e => {
        e.stopPropagation();
        const iso = ev.closest('.cal-cell')?.dataset.date;
        if (iso) DetailPanel.open(iso);
      });
    });

    /* Restaurar selección */
    if (CalState.selectedDate) {
      const sel = grid.querySelector(`[data-date="${CalState.selectedDate}"]`);
      sel?.classList.add('selected');
    }
  },

  _buildCell({ date, otherMonth }, taskMap) {
    const iso      = CalUtils.toISO(date);
    const isToday  = CalUtils.isToday(date);
    const tasks    = taskMap[iso] || [];
    const hasEvents= tasks.length > 0;

    let cls = 'cal-cell';
    if (otherMonth) cls += ' other-month';
    if (isToday)    cls += ' today';
    if (hasEvents)  cls += ' has-events';

    /* Construir eventos visibles */
    const visible  = tasks.slice(0, this.MAX_VISIBLE);
    const overflow = tasks.length - visible.length;

    const eventsHtml = visible.map(t => {
      const pClr  = CalUtils.projectColor(t.projectId);
      const alpha = pClr + '26';   // ~15% opacidad
      return `<div class="cal-event"
                   style="--event-bg:${alpha}; --event-clr:${pClr}"
                   data-task-id="${esc(t.id)}"
                   title="${esc(t.name)}">
                <span class="cal-event-dot"></span>
                ${esc(t.name)}
              </div>`;
    }).join('');

    const moreHtml = overflow > 0
      ? `<span class="cal-more">+${overflow} más</span>` : '';

    return `
      <div class="${cls}" data-date="${iso}" aria-label="${date.getDate()} de ${MONTHS_LONG[date.getMonth()]}">
        <span class="cal-day-num">${date.getDate()}</span>
        ${eventsHtml}
        ${moreHtml}
      </div>`;
  },

  _selectCell(grid, cell, iso) {
    grid.querySelectorAll('.cal-cell').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    CalState.selectedDate = iso;
    DetailPanel.open(iso);
  },
};

/* ─────────────────────────────────────────────
   6. VISTA ANUAL
───────────────────────────────────────────── */
const YearView = {
  render() {
    const y    = CalState.cursor.getFullYear();
    const grid = document.getElementById('cal-year-grid');
    if (!grid) return;

    grid.innerHTML = Array.from({ length: 12 }, (_, i) =>
      this._buildMiniMonth(y, i)
    ).join('');

    /* Clic en mini-mes → cambiar a vista mensual */
    grid.querySelectorAll('.cal-mini-month').forEach(card => {
      card.addEventListener('click', () => {
        const m = parseInt(card.dataset.month, 10);
        CalState.cursor = new Date(y, m, 1);
        CalendarModule.switchView('month');
      });
    });

    /* Clic en mini-día → detalle */
    grid.querySelectorAll('.cal-mini-day:not(.empty)').forEach(day => {
      day.addEventListener('click', e => {
        e.stopPropagation();
        const iso = day.dataset.date;
        if (!iso) return;
        CalState.selectedDate = iso;
        CalState.cursor = CalUtils.parseISO(iso);
        CalendarModule.switchView('day');
      });
    });
  },

  _buildMiniMonth(year, month) {
    const cells     = CalUtils.monthCells(year, month);
    const taskMap   = CalData.mapForMonth(year, month);
    const now       = new Date();
    const isCurrent = now.getFullYear() === year && now.getMonth() === month;

    /* Contar por estado para el resumen */
    const tasks = CalData.getForMonth(year, month);
    const doneCnt = tasks.filter(t => t.status === 'terminado').length;
    const pendCnt = tasks.filter(t => t.status === 'pendiente').length;

    const daysHtml = cells.map(cell => {
      if (cell.otherMonth) return '<span class="cal-mini-day empty"></span>';
      const iso      = CalUtils.toISO(cell.date);
      const isToday  = CalUtils.isToday(cell.date);
      const hasTasks = (taskMap[iso] || []).length > 0;
      let cls = 'cal-mini-day';
      if (isToday)  cls += ' mini-today';
      if (hasTasks) cls += ' has-tasks';
      return `<span class="${cls}" data-date="${iso}">${cell.date.getDate()}</span>`;
    }).join('');

    const summaryHtml = tasks.length > 0 ? `
      <div class="cal-mini-summary">
        ${pendCnt > 0 ? `<span class="mini-summary-dot" style="--dot-clr:#f7b731">${pendCnt} pend.</span>` : ''}
        ${doneCnt > 0 ? `<span class="mini-summary-dot" style="--dot-clr:#20bf6b">${doneCnt} hechas</span>` : ''}
      </div>` : '';

    return `
      <div class="cal-mini-month${isCurrent ? ' current-month' : ''}"
           data-month="${month}" title="Ir a ${MONTHS_LONG[month]}">
        <div class="cal-mini-title">${MONTHS_SHORT[month]}</div>
        <div class="cal-mini-grid">
          ${WEEKDAYS_SHORT.map(w => `<span class="cal-mini-wday">${w[0]}</span>`).join('')}
          ${daysHtml}
        </div>
        ${summaryHtml}
      </div>`;
  },
};

/* ─────────────────────────────────────────────
   7. VISTA DIARIA (RF18)
───────────────────────────────────────────── */
const DayView = {
  HOURS: Array.from({ length: 24 }, (_, i) => i),   // 00:00 – 23:00

  render() {
    const iso      = CalState.selectedDate || CalUtils.toISO(CalState.cursor);
    CalState.selectedDate = iso;
    const date     = CalUtils.parseISO(iso);
    const tasks    = CalData.getForDate(iso);
    const container= document.getElementById('cal-day-view');
    if (!container) return;

    /* Título del día */
    const dayStr   = date.toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const capitalized = dayStr.charAt(0).toUpperCase() + dayStr.slice(1);

    /* Sin tareas → vista simplificada */
    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="cal-day-header">
          <div>
            <div class="cal-day-title">${esc(capitalized)}</div>
            <div class="cal-day-subtitle">Sin tareas con deadline para este día</div>
          </div>
        </div>
        <div class="cal-day-empty">
          <p>No hay tareas asignadas para este día.</p>
          <p style="margin-top:6px;font-size:.78rem">Las tareas aparecen aquí cuando tienen una fecha límite establecida.</p>
        </div>`;
      return;
    }

    /* Con tareas → grilla horaria, tareas al inicio del día sin hora distribuidas */
    const nowHour = CalUtils.isToday(date) ? new Date().getHours() : -1;
    const nowMin  = new Date().getMinutes();

    /* Distribuir tareas uniformemente entre las horas del día (sin hora real en los datos) */
    const tasksByHour = {};
    tasks.forEach((t, idx) => {
      const h = (idx % 24);
      tasksByHour[h] = tasksByHour[h] || [];
      tasksByHour[h].push(t);
    });

    const labelsHtml = this.HOURS.map(h => {
      const label = `${String(h).padStart(2,'0')}:00`;
      return `<div class="cal-hour-label">${label}</div>`;
    }).join('');

    const slotsHtml = this.HOURS.map(h => {
      const slotTasks = tasksByHour[h] || [];
      const eventsHtml = slotTasks.map(t => {
        const pClr = CalUtils.projectColor(t.projectId);
        return `<button class="cal-day-event"
                        style="--event-bg:${pClr}22; --event-clr:${pClr}"
                        data-task-id="${esc(t.id)}"
                        title="${esc(t.name)}">
                  <span class="priority-badge priority-${esc(t.priority || 'baja')}" style="font-size:.62rem;padding:1px 5px">${esc(PRIORITY_LABELS[t.priority]||'')}</span>
                  ${esc(t.name)}
                </button>`;
      }).join('');

      /* Línea "ahora" */
      const nowLineHtml = (h === nowHour)
        ? `<div class="cal-now-line" style="top:${Math.round((nowMin/60)*52)}px"></div>` : '';

      return `<div class="cal-hour-slot" data-hour="${h}">${nowLineHtml}${eventsHtml}</div>`;
    }).join('');

    container.innerHTML = `
      <div class="cal-day-header">
        <div>
          <div class="cal-day-title">${esc(capitalized)}</div>
          <div class="cal-day-subtitle">${tasks.length} tarea${tasks.length !== 1 ? 's' : ''} con deadline</div>
        </div>
      </div>
      <div class="cal-hour-labels">${labelsHtml}</div>
      <div class="cal-hour-slots">${slotsHtml}</div>`;

    /* Scroll hasta la primera tarea */
    const firstHour = Math.min(...Object.keys(tasksByHour).map(Number));
    requestAnimationFrame(() => {
      container.scrollTop = firstHour * 52;
    });

    /* Bind clic en eventos del día → abrir detalle */
    container.querySelectorAll('.cal-day-event').forEach(ev => {
      ev.addEventListener('click', () => DetailPanel.open(iso));
    });
  },
};

/* ─────────────────────────────────────────────
   8. PANEL DE DETALLE DE DÍA (slide-in)
───────────────────────────────────────────── */
/* PRIORITY_LABELS ya definido en tasks.js — se reutiliza aquí */

const DetailPanel = {
  /** Siempre visible. Muestra las tareas del día seleccionado. */
  open(iso) {
    CalState.selectedDate = iso;
    const panel = document.getElementById('cal-detail-panel');
    const title = document.getElementById('cal-detail-title');
    const body  = document.getElementById('cal-detail-body');
    if (!panel || !title || !body) return;

    const date = CalUtils.parseISO(iso);
    const dateStr = date.toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    title.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

    const tasks = CalData.getForDate(iso);

    if (tasks.length === 0) {
      body.innerHTML = `<div class="cal-detail-empty">
        <span style="font-size:1.6rem;opacity:.35">📭</span>
        <p>Sin tareas para este día.</p>
      </div>`;
    } else {
      body.innerHTML = tasks.map(t => this._buildItem(t)).join('');
    }

    panel.classList.add('open');
  },

  /** Muestra un estado inicial cuando no hay día seleccionado */
  showPlaceholder() {
    const title = document.getElementById('cal-detail-title');
    const body  = document.getElementById('cal-detail-body');
    if (title) title.textContent = 'Tareas del día';
    if (body) body.innerHTML = `<div class="cal-detail-empty">
      <span style="font-size:1.6rem;opacity:.35">📅</span>
      <p>Selecciona un día para ver sus tareas.</p>
    </div>`;
  },

  close() {
    /* FIX 6: el panel ya no se cierra, solo limpia la selección */
    CalState.selectedDate = null;
    this.showPlaceholder();
    document.getElementById('cal-detail-panel')?.classList.remove('open');
    /* Pero dejamos el panel visible */
    document.getElementById('cal-detail-panel')?.classList.add('open');
  },

  _buildItem(task) {
    const pClr      = CalUtils.projectColor(task.projectId);
    const pName     = CalUtils.projectName(task.projectId);
    const prioLabel = PRIORITY_LABELS[task.priority] || '—';
    const prioClrs  = PRIORITY_CLR[task.priority] || PRIORITY_CLR.baja;
    const stClrs    = STATUS_CLR[task.status]     || STATUS_CLR.pendiente;
    const stLabel   = STATUS_LABEL[task.status]   || task.status;
    const descHtml  = task.desc
      ? `<p class="cal-task-item-desc">${esc(task.desc)}</p>` : '';

    const chipBg = pClr + '22';

    return `
      <div class="cal-task-item" style="--item-clr:${pClr}">
        <div class="cal-task-item-header">
          <span class="cal-task-item-name">${esc(task.name)}</span>
          <span class="priority-badge priority-${esc(task.priority||'baja')}" style="font-size:.67rem">${esc(prioLabel)}</span>
        </div>
        ${descHtml}
        <div class="cal-task-item-meta">
          <span class="cal-task-project-chip"
                style="--chip-bg:${chipBg}; --chip-clr:${pClr}">
            ${esc(pName)}
          </span>
          <span class="task-list-status"
                style="font-size:.67rem;padding:2px 6px;border-radius:20px;
                       background:${stClrs.bg};color:${stClrs.clr}">
            ${esc(stLabel)}
          </span>
        </div>
      </div>`;
  },
};

/* ─────────────────────────────────────────────
   9. MÓDULO PRINCIPAL DEL CALENDARIO
───────────────────────────────────────────── */
const CalendarModule = {

  init() {
    /* Botones de navegación */
    document.getElementById('btn-cal-prev')?.addEventListener('click',  () => this.navigate(-1));
    document.getElementById('btn-cal-next')?.addEventListener('click',  () => this.navigate(+1));
    document.getElementById('btn-cal-today')?.addEventListener('click', () => {
      CalState.cursor = new Date();
      CalState.selectedDate = null;
      DetailPanel.showPlaceholder();
      this.render();
    });

    /* Cierre del panel de detalle — FIX: solo limpia selección, no oculta panel */
    document.getElementById('btn-cal-detail-close')?.addEventListener('click', () => {
      DetailPanel.close();
    });

    /* View toggle buttons */
    document.querySelectorAll('[data-cal-view]').forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.calView));
    });

    /* Filtro de proyecto */
    CalFilter.init();

    /* Patch de TabManager: al entrar al calendario, actualizar */
    const origSwitch = TabManager.switchTo.bind(TabManager);
    TabManager.switchTo = function(tabId) {
      origSwitch(tabId);
      if (tabId === 'calendar') CalendarModule.onEnter();
    };

    /* Patch de Renderer: al guardar tareas/proyectos, re-renderizar si estamos en calendario */
    const origRender = Renderer.renderAll.bind(Renderer);
    Renderer.renderAll = function() {
      origRender();
      CalFilter.populate();
      const calTab = document.getElementById('tab-calendar');
      if (calTab?.classList.contains('active')) CalendarModule.render();
    };
  },

  /** Llamado al entrar a la pestaña */
  onEnter() {
    CalFilter.populate();
    this.render();
    /* FIX 6: panel siempre visible — mostrar placeholder o día seleccionado */
    const panel = document.getElementById('cal-detail-panel');
    if (panel) panel.classList.add('open');
    if (CalState.selectedDate) {
      DetailPanel.open(CalState.selectedDate);
    } else {
      DetailPanel.showPlaceholder();
    }
  },

  /** Actualiza el label del período */
  updateLabel() {
    const el = document.getElementById('cal-period-label');
    if (!el) return;
    const y = CalState.cursor.getFullYear();
    const m = CalState.cursor.getMonth();

    if (CalState.view === 'month') {
      el.textContent = `${MONTHS_LONG[m]} ${y}`;
    } else if (CalState.view === 'year') {
      el.textContent = String(y);
    } else {
      const iso = CalState.selectedDate || CalUtils.toISO(CalState.cursor);
      const d   = CalUtils.parseISO(iso);
      el.textContent = d.toLocaleDateString('es-MX', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    }
  },

  /** Navega hacia adelante (+1) o atrás (-1) según la vista activa */
  navigate(dir) {
    const c = CalState.cursor;
    if (CalState.view === 'month') {
      CalState.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
    } else if (CalState.view === 'year') {
      CalState.cursor = new Date(c.getFullYear() + dir, c.getMonth(), 1);
    } else {
      /* Día: avanzar/retroceder 1 día */
      const iso  = CalState.selectedDate || CalUtils.toISO(c);
      const d    = CalUtils.parseISO(iso);
      d.setDate(d.getDate() + dir);
      CalState.selectedDate = CalUtils.toISO(d);
      CalState.cursor = d;
    }
    this.render();
  },

  /** Cambia la vista activa y re-renderiza */
  switchView(view) {
    CalState.view = view;

    /* Toggle botones */
    document.querySelectorAll('[data-cal-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.calView === view);
    });

    /* Toggle paneles */
    document.querySelectorAll('.cal-view-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`cal-view-${view}`)?.classList.add('active');

    /* Si cambiamos a día sin fecha seleccionada, usar hoy */
    if (view === 'day' && !CalState.selectedDate) {
      CalState.selectedDate = CalUtils.toISO(new Date());
    }

    this.render();
  },

  /** Renderiza la vista activa */
  render() {
    this.updateLabel();

    if (CalState.view === 'month') {
      MonthView.render();
    } else if (CalState.view === 'year') {
      YearView.render();
    } else {
      DayView.render();
    }
  },
};

/* ─────────────────────────────────────────────
   10. INICIALIZACIÓN
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  CalendarModule.init();
  /* Render inicial silencioso (sin estar en la pestaña aún) */
  CalFilter.populate();
});
