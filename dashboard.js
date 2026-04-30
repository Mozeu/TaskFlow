/* ═══════════════════════════════════════════════════════════
   TASKFLOW — dashboard.js  v2.0
   Dashboard limpio sin modo edición.
   Selector global de proyecto en la cabecera.
   Widgets: stats globales/proyecto, tareas vencidas,
            tareas de la semana, actividad, proyectos.
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. ESTADO GLOBAL DE WORKSPACE
   El proyecto seleccionado se comparte entre TODAS las pestañas.
───────────────────────────────────────────── */
const WorkspaceState = {
  projectId: localStorage.getItem('taskflow_workspace_project') || '',

  set(id) {
    this.projectId = id || '';
    if (id) localStorage.setItem('taskflow_workspace_project', id);
    else    localStorage.removeItem('taskflow_workspace_project');
    WorkspaceSelector.sync();
    Dashboard.render();
    /* Sincronizar otros módulos que usan selector propio */
    _syncExternalSelectors(id);
  },

  get() { return this.projectId; },
  project() { return State.projects.find(p => p.id === this.projectId) || null; },
};

function _syncExternalSelectors(projectId) {
  /* Kanban */
  const kanbanSel = document.getElementById('kanban-project-selector');
  if (kanbanSel && kanbanSel.value !== projectId) {
    kanbanSel.value = projectId;
    KanbanState.currentProjectId = projectId || null;
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
  }
  /* Stats */
  const statsSel = document.getElementById('stats-project-filter');
  if (statsSel && statsSel.value !== projectId) {
    statsSel.value = projectId;
    if (typeof StatsData !== 'undefined') {
      StatsData.setFilter(projectId);
    }
  }
  /* Calendario */
  const calSel = document.getElementById('cal-project-filter');
  if (calSel && calSel.value !== projectId) {
    calSel.value = projectId;
  }
  /* Rol contextual */
  if (typeof setRoleContext === 'function') setRoleContext(projectId);
}

/* ─────────────────────────────────────────────
   1. WORKSPACE SELECTOR — barra de cabecera
───────────────────────────────────────────── */
const WorkspaceSelector = {
  init() {
    const sel = document.getElementById('global-project-selector');
    if (!sel) return;

    sel.addEventListener('change', () => WorkspaceState.set(sel.value));
    this.populate();
  },

  populate() {
    const sel = document.getElementById('global-project-selector');
    if (!sel) return;

    const activeId = typeof UsersState !== 'undefined' ? UsersState.activeUserId : null;
    /* Mostrar solo proyectos a los que pertenece el usuario activo */
    const projects = activeId
      ? State.projects.filter(p =>
          p.creatorId === activeId ||
          (typeof UsersState !== 'undefined' &&
           UsersState.memberships.some(m => m.userId === activeId && m.projectId === p.id))
        )
      : State.projects;

    sel.innerHTML = '<option value="">— Sin proyecto —</option>' +
      projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.icon || '🗂')} ${esc(p.name)}</option>`
      ).join('');

    /* Restaurar selección si todavía existe */
    if (WorkspaceState.projectId && projects.find(p => p.id === WorkspaceState.projectId)) {
      sel.value = WorkspaceState.projectId;
    } else if (WorkspaceState.projectId) {
      /* El proyecto ya no existe o el usuario no tiene acceso */
      WorkspaceState.set('');
    }
  },

  sync() {
    const sel = document.getElementById('global-project-selector');
    if (sel) sel.value = WorkspaceState.projectId;
  },
};

/* ─────────────────────────────────────────────
   2. DATOS DEL DASHBOARD
───────────────────────────────────────────── */
const DashData = {
  get() {
    const allTasks    = KanbanState.tasks;
    const allProjects = State.projects;
    const projectId   = WorkspaceState.projectId;
    const project     = WorkspaceState.project();

    /* Tareas del proyecto activo (o todas si no hay selección) */
    const scopeTasks  = projectId
      ? allTasks.filter(t => t.projectId === projectId)
      : allTasks;

    const today = new Date(); today.setHours(0, 0, 0, 0);

    /* Stats generales (siempre sobre TODOS los proyectos/tareas) */
    const totalPending  = allTasks.filter(t => t.status === 'pendiente').length;
    const totalDone     = allTasks.filter(t => t.status === 'terminado').length;
    const totalTasks    = allTasks.length;

    /* Stats del proyecto activo (o global) */
    const scopePending  = scopeTasks.filter(t => t.status === 'pendiente').length;
    const scopeInProg   = scopeTasks.filter(t => t.status === 'en-progreso').length;
    const scopeDone     = scopeTasks.filter(t => t.status === 'terminado').length;
    const scopeTotal    = scopeTasks.length;
    const scopePct      = scopeTotal === 0 ? 0 : Math.round((scopeDone / scopeTotal) * 100);

    /* Tareas vencidas (TODAS, todos los proyectos) */
    const overdueTasks = allTasks.filter(t => {
      if (!t.deadline || t.status === 'terminado') return false;
      const [y, m, d] = t.deadline.split('-').map(Number);
      return new Date(y, m - 1, d) < today;
    });

    /* Tareas de esta semana (TODAS, todos los proyectos) */
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 6);
    const weekTasks = allTasks.filter(t => {
      if (!t.deadline) return false;
      const [y, m, d] = t.deadline.split('-').map(Number);
      const td = new Date(y, m - 1, d);
      return td >= today && td <= weekEnd;
    }).sort((a, b) => a.deadline.localeCompare(b.deadline));

    return {
      allProjects, totalPending, totalDone, totalTasks,
      scopeProject: project, scopePending, scopeInProg, scopeDone, scopeTotal, scopePct,
      overdueTasks, weekTasks,
    };
  },
};

/* ─────────────────────────────────────────────
   3. DASHBOARD — RENDER PRINCIPAL
───────────────────────────────────────────── */
const Dashboard = {

  render() {
    this._updateGreeting();
    this._renderProjectContext();
    const data = DashData.get();
    this._renderStats(data);
    this._renderOverdue(data);
    this._renderWeek(data);
    this._renderActivity();
    this._renderQuickProjects();
  },

  /* ── Saludo y fecha ── */
  _updateGreeting() {
    const hour = new Date().getHours();
    const txt  = hour < 12 ? 'Buenos días 🌅' : hour < 19 ? 'Buenas tardes 🌤' : 'Buenas noches 🌙';
    const grEl = document.getElementById('db-greeting');
    if (grEl) grEl.textContent = txt;
    const dtEl = document.getElementById('db-date');
    if (dtEl) dtEl.textContent = new Date().toLocaleDateString('es-MX', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).replace(/^\w/, c => c.toUpperCase());
  },

  /* ── Contexto de proyecto activo ── */
  _renderProjectContext() {
    const el = document.getElementById('db-project-context');
    if (!el) return;
    const p = WorkspaceState.project();
    if (!p) {
      el.innerHTML = `<span class="db-context-hint">Selecciona un proyecto en la cabecera para ver su detalle.</span>`;
      return;
    }
    el.innerHTML = `
      <span class="db-context-badge" style="border-color:${esc(p.color)}; color:${esc(p.color)}">
        ${p.icon || '🗂'} ${esc(p.name)}
      </span>`;
  },

  /* ── 4 stat cards ── */
  _renderStats(data) {
    const container = document.getElementById('db-stats-row');
    if (!container) return;
    const p = data.scopeProject;

    const cards = [
      {
        icon: '📋', label: 'Tareas Pendientes', sub: 'Total de todos los proyectos',
        value: data.totalPending, accent: '#f7b731',
        subClass: data.totalPending > 0 ? 'warn' : 'up',
      },
      {
        icon: '✅', label: 'Tareas Completadas', sub: 'Total de todos los proyectos',
        value: data.totalDone, accent: '#20bf6b',
        subClass: data.totalDone > 0 ? 'up' : '',
      },
      {
        icon: p ? (p.icon || '🗂') : '◈',
        label: p ? `Progreso — ${p.name}` : 'Progreso del Proyecto',
        sub: p ? `${data.scopeDone} de ${data.scopeTotal} tareas` : 'Selecciona un proyecto',
        value: p ? `${data.scopePct}%` : '—',
        accent: p ? p.color : '#45aaf2',
        bar: p ? data.scopePct : null,
        subClass: data.scopePct >= 75 ? 'up' : data.scopePct >= 30 ? '' : 'warn',
      },
      {
        icon: '◫', label: 'Proyectos Activos', sub: `${data.allProjects.length} en total`,
        value: data.allProjects.length, accent: '#6c63ff',
        subClass: data.allProjects.length > 0 ? 'up' : '',
      },
    ];

    container.innerHTML = cards.map(c => `
      <div class="db-stat-widget" style="--widget-accent:${c.accent}">
        <span class="db-stat-icon">${c.icon}</span>
        <span class="db-stat-label">${esc(c.label)}</span>
        <span class="db-stat-value">${c.value}</span>
        <span class="db-stat-sub ${c.subClass || ''}">${esc(c.sub)}</span>
        ${c.bar != null
          ? `<div class="db-stat-bar"><div class="db-stat-bar-fill" style="--fill:${c.bar}%; --widget-accent:${c.accent}"></div></div>`
          : ''}
      </div>`).join('');
  },

  /* ── Tareas vencidas ── */
  _renderOverdue(data) {
    const body    = document.getElementById('db-overdue-body');
    const countEl = document.getElementById('db-overdue-count');
    if (!body) return;
    const tasks = data.overdueTasks;
    if (countEl) countEl.textContent = tasks.length;

    if (tasks.length === 0) {
      body.innerHTML = `<div class="db-widget-empty">✓ Sin tareas vencidas</div>`;
      return;
    }
    body.innerHTML = tasks.map(t => this._taskRow(t)).join('');
  },

  /* ── Tareas de la semana ── */
  _renderWeek(data) {
    const body    = document.getElementById('db-week-body');
    const rangeEl = document.getElementById('db-week-range');
    if (!body) return;

    /* Rango de fechas */
    const today  = new Date(); today.setHours(0,0,0,0);
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 6);
    if (rangeEl) {
      const fmt = d => d.toLocaleDateString('es-MX', { day:'numeric', month:'short' });
      rangeEl.textContent = `${fmt(today)} – ${fmt(weekEnd)}`;
    }

    const tasks = data.weekTasks;
    if (tasks.length === 0) {
      body.innerHTML = `<div class="db-widget-empty">Sin tareas para esta semana 🎉</div>`;
      return;
    }
    body.innerHTML = tasks.map(t => this._taskRow(t, true)).join('');
  },

  /** Construye una fila de tarea para los paneles del dashboard */
  _taskRow(task, showDate = false) {
    const project = State.projects.find(p => p.id === task.projectId);
    const color   = project?.color || '#6c63ff';
    const pName   = project ? `${project.icon || '🗂'} ${project.name}` : '—';
    const PRIORITY_COLORS = { alta:'#fc5c65', media:'#f7b731', baja:'#20bf6b' };
    const pColor  = PRIORITY_COLORS[task.priority] || '#aaa';

    const days = task.deadline ? daysUntil(task.deadline) : null;
    let dueText = '';
    if (days !== null) {
      if (days < 0)       dueText = `Venció hace ${Math.abs(days)}d`;
      else if (days === 0) dueText = 'Vence hoy';
      else                dueText = `En ${days}d`;
    }

    return `
      <div class="db-task-row" style="--proj-clr:${color}">
        <span class="db-task-proj-bar"></span>
        <div class="db-task-body">
          <span class="db-task-name">${esc(task.name)}</span>
          <div class="db-task-meta">
            <span class="db-task-proj-name" style="color:${esc(color)}">${pName}</span>
            ${dueText ? `<span class="db-task-due">${dueText}</span>` : ''}
          </div>
        </div>
        <span class="priority-badge priority-${task.priority||'baja'}" style="font-size:.65rem;flex-shrink:0">
          ${task.priority === 'alta' ? 'Alta' : task.priority === 'media' ? 'Media' : 'Baja'}
        </span>
      </div>`;
  },

  /* ── Actividad reciente ── */
  _renderActivity() {
    const body = document.getElementById('db-body-activity');
    if (!body) return;
    const items = Activity.load();
    body.innerHTML = items.length === 0
      ? `<div class="db-widget-empty">Sin actividad reciente.</div>`
      : items.map(item => `
          <div class="db-activity-item">
            <span class="db-activity-dot"></span>
            <span class="db-activity-text">${item.msg}</span>
            <span class="db-activity-time">${Activity.timeAgo(item.ts)}</span>
          </div>`).join('');
  },

  /* ── Proyectos rápidos ── */
  _renderQuickProjects() {
    const body = document.getElementById('db-body-quick_projects');
    if (!body) return;
    const projects = State.projects;
    body.innerHTML = projects.length === 0
      ? `<div class="db-widget-empty">Sin proyectos aún.</div>`
      : projects.slice(0, 6).map(p => `
          <div class="db-proj-item" onclick="TabManager.switchTo('projects')">
            <span class="db-proj-dot" style="--dot-clr:${esc(p.color)}"></span>
            <span class="db-proj-name">${esc(p.icon || '🗂')} ${esc(p.name)}</span>
            <div class="db-proj-bar-wrap">
              <div class="db-proj-bar-fill" style="--fill:${p.progress||0}%; background:${esc(p.color)}"></div>
            </div>
            <span class="db-proj-pct">${p.progress||0}%</span>
          </div>`).join('');
  },

  refresh() { this.render(); },
};






/* ─────────────────────────────────────────────
   CAMBIAR ACENTO SEGÚN PROYECTO SELECCIONADO
───────────────────────────────────────────── */

/** Convierte un color hex a RGB */
function hexToRgb(hex) {
  if (!hex) return null;
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  if (isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** Aclara un color (porcentaje 0-100) */
function lightenColor(color, percent) {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  const lighten = (c) => Math.min(255, Math.floor(c + (255 - c) * (percent / 100)));
  return `rgb(${lighten(rgb.r)}, ${lighten(rgb.g)}, ${lighten(rgb.b)})`;
}

/** Aplica el color de acento al tema */
function setProjectAccent(color) {
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-hover', lightenColor(color, 15));
  const rgb = hexToRgb(color);
  if (rgb) {
    root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`);
  } else {
    root.style.setProperty('--accent-glow', 'rgba(108, 99, 255, 0.25)');
  }
  console.log('[Theme] Acento cambiado a:', color);
}

/** Restaura el acento por defecto */
function resetProjectAccent() {
  const root = document.documentElement;
  root.style.setProperty('--accent', '#6c63ff');
  root.style.setProperty('--accent-hover', '#7b74ff');
  root.style.setProperty('--accent-glow', 'rgba(108, 99, 255, 0.25)');
  console.log('[Theme] Acento restaurado a #6c63ff');
}

/* Modificar WorkspaceState.set para que aplique el acento */
const originalSet = WorkspaceState.set;
WorkspaceState.set = function(id) {
  originalSet.call(this, id);
  // Aplicar acento según el nuevo proyecto seleccionado
  if (!id) {
    resetProjectAccent();
    return;
  }
  const project = State.projects.find(p => p.id === id);
  if (project && project.color) {
    setProjectAccent(project.color);
  } else {
    resetProjectAccent();
  }
};

/* Aplicar acento inicial según el proyecto actual */
const initialProjectId = WorkspaceState.projectId;
if (initialProjectId) {
  const project = State.projects.find(p => p.id === initialProjectId);
  if (project && project.color) setProjectAccent(project.color);
} else {
  resetProjectAccent();
}
/* ─────────────────────────────────────────────
   4. PATCH — sincronizar selectores externos
      con el workspace cuando cambia de pestaña
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* Init workspace selector */
  WorkspaceSelector.init();
    /* ─── NUEVO: Botón para exportar progreso global en el dashboard ─── */
  const exportProgressBtn = document.createElement('button');
  exportProgressBtn.className = 'btn-secondary btn-sm';
  exportProgressBtn.textContent = '📊 Exportar progreso';
  exportProgressBtn.addEventListener('click', () => DataManager.exportGlobalProgress());
  // Buscar el contenedor donde insertarlo: justo después del contexto del proyecto
  const contextDiv = document.querySelector('.db-topbar .db-project-context');
  if (contextDiv && contextDiv.parentNode) {
    // Inserta después del elemento .db-project-context
    contextDiv.parentNode.insertBefore(exportProgressBtn, contextDiv.nextSibling);
  } else {
    // Fallback: al final del .db-topbar
    document.querySelector('.db-topbar')?.appendChild(exportProgressBtn);
  }

  /* Patch TabManager: al cambiar de pestaña, sincronizar workspace */
  const _origSwitch = TabManager.switchTo.bind(TabManager);
  TabManager.switchTo = function(tabId) {
    _origSwitch(tabId);
    const pid = WorkspaceState.projectId;
    if (tabId === 'dashboard') {
      Dashboard.render();
    }
    if (tabId === 'kanban') {
      WorkspaceSelector.populate();
      const sel = document.getElementById('kanban-project-selector');
      if (sel && pid) { sel.value = pid; }
      KanbanState.currentProjectId = pid || null;
      KanbanRenderer.populateSelector();
      KanbanRenderer.renderBoard(KanbanState.currentProjectId);
      const btnNew = document.getElementById('btn-new-task-kanban');
      if (btnNew) btnNew.disabled = !pid;
      const btnMem = document.getElementById('btn-manage-members');
      if (btnMem) btnMem.disabled = !pid;
    }
    if (tabId === 'stats') {
      const statsSel = document.getElementById('stats-project-filter');
      if (statsSel) statsSel.value = pid;
      if (typeof StatsData !== 'undefined') {
        StatsData.setFilter(pid);
        if (typeof StatsModule !== 'undefined') StatsModule.render();
      }
    }
    if (tabId === 'calendar') {
      const calSel = document.getElementById('cal-project-filter');
      if (calSel) calSel.value = pid;
    }
    if (typeof setRoleContext === 'function') setRoleContext(pid);
  };

  /* Patch Renderer.renderAll: repoblar workspace y refrescar dashboard */
  const _origRender = Renderer.renderAll.bind(Renderer);
  Renderer.renderAll = function() {
    _origRender();
    WorkspaceSelector.populate();
    const dbTab = document.getElementById('tab-dashboard');
    if (dbTab?.classList.contains('active')) Dashboard.render();
  };

  /* Sincronizar cuando Kanban/Stats/Cal cambian su propio selector */
  document.getElementById('kanban-project-selector')
    ?.addEventListener('change', e => WorkspaceState.set(e.target.value));
  document.getElementById('stats-project-filter')
    ?.addEventListener('change', e => WorkspaceState.set(e.target.value));
  document.getElementById('cal-project-filter')
    ?.addEventListener('change', e => WorkspaceState.set(e.target.value));

  /* Render inicial */
  Dashboard.render();
});
