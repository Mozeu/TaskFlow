/* ═══════════════════════════════════════════════════════════
   TASKFLOW — app.js  v2.0
   Módulos: Storage · Proyectos (CRUD) · Validación ·
            Renderizado · Modales · Tema · Navegación
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. CONSTANTES Y UTILIDADES GLOBALES
───────────────────────────────────────────── */
const STORAGE_KEY   = 'taskflow_projects';
const ICON_LIST     = ['📱','🌐','⚙','🎨','📊','🚀','🔬','📝','🎯','💡','🗂','🏗'];
const COLOR_OPTIONS = ['#6c63ff','#f7b731','#20bf6b','#fc5c65','#45aaf2','#fd9644'];

/** Genera un id único basado en timestamp + random */
const uid = () => `p_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

/** Formatea una fecha ISO (YYYY-MM-DD) a texto legible */
function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-MX', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

/** Diferencia en días entre hoy y una fecha ISO */
function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today  = new Date(); today.setHours(0,0,0,0);
  return Math.round((target - today) / 86400000);
}

/** Escapar HTML para prevenir XSS */
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ─────────────────────────────────────────────
   1. STORAGE — LocalStorage (RF21, RF22)
───────────────────────────────────────────── */
const Storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },
  save(projects) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch {
      Toast.show('Error al guardar: almacenamiento lleno.', 'error');
    }
  }
};

/* ─────────────────────────────────────────────
   2. ESTADO GLOBAL
───────────────────────────────────────────── */
const State = {
  projects:   Storage.load(),
  currentView:'grid',
  searchQuery:'',
  editingId:  null,
};

/* ─────────────────────────────────────────────
   3. TOAST (RF29)
───────────────────────────────────────────── */
const Toast = {
  container: null,
  init() { this.container = document.getElementById('toast-container'); },

  show(msg, type = 'info', duration = 3500) {
    const ICONS = { info: 'ℹ', success: '✓', error: '✕' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<span class="toast-icon">${ICONS[type]}</span><span>${esc(msg)}</span>`;
    this.container?.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(40px)';
      el.style.transition = '0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }
};

/* ─────────────────────────────────────────────
   4. VALIDACIÓN (RF27, RF28, RF29)
───────────────────────────────────────────── */
const Validator = {

  /** Valida los campos del formulario de proyecto.
   *  Retorna { valid: bool, errors: { campo: mensaje } }
   */
  validateProject(data, editingId) {
    const errors = {};
    const name = (data.name || '').trim();

    /* ── Nombre ── */
    if (!name) {
      errors.name = 'El nombre del proyecto es obligatorio.';
    } else if (name.length < 2) {
      errors.name = 'El nombre debe tener al menos 2 caracteres.';
    } else if (name.length > 80) {
      errors.name = 'El nombre no puede superar 80 caracteres.';
    } else {
      const dup = State.projects.find(
        p => p.name.trim().toLowerCase() === name.toLowerCase() && p.id !== editingId
      );
      if (dup) errors.name = `Ya existe un proyecto con el nombre "${name}".`;
    }

    /* ── Descripción ── */
    if ((data.desc || '').length > 300) {
      errors.desc = 'La descripción no puede superar 300 caracteres.';
    }

    /* ── Fecha límite ── */
    if (data.deadline) {
      const days = daysUntil(data.deadline);
      if (days === null || isNaN(days)) {
        errors.deadline = 'La fecha ingresada no es válida.';
      } else if (days < 0) {
        // Solo advertencia, no bloquea
        errors._deadlineWarning = `La fecha límite ya pasó hace ${Math.abs(days)} día(s).`;
      }
    }

    const hasBlockingErrors = Object.keys(errors).some(k => !k.startsWith('_'));
    return { valid: !hasBlockingErrors, errors };
  },

  /** Pinta los mensajes de error en el DOM */
  showErrors(errors) {
    this.clearErrors();
    const fieldMap = {
      name:     ['error-project-name',     'project-name'],
      desc:     ['error-project-desc',     'project-desc'],
      deadline: ['error-project-deadline', 'project-deadline'],
    };
    Object.entries(fieldMap).forEach(([field, [errId, inputId]]) => {
      const errEl   = document.getElementById(errId);
      const inputEl = document.getElementById(inputId);
      if (!errEl || !inputEl) return;
      if (errors[field]) {
        errEl.textContent = errors[field];
        inputEl.classList.add('input-error');
        inputEl.classList.remove('input-ok');
      }
    });
  },

  clearErrors() {
    ['error-project-name','error-project-desc','error-project-deadline'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });
    ['project-name','project-desc','project-deadline'].forEach(id => {
      document.getElementById(id)?.classList.remove('input-error','input-ok');
    });
  },

  /** Validación en tiempo real al perder el foco */
  validateField(fieldId) {
    const inputEl = document.getElementById(`project-${fieldId}`);
    const errEl   = document.getElementById(`error-project-${fieldId}`);
    if (!inputEl || !errEl) return;

    const data = ModalProject.getFormData();
    const { errors } = this.validateProject(data, State.editingId);

    if (errors[fieldId]) {
      errEl.textContent = errors[fieldId];
      inputEl.classList.add('input-error');
      inputEl.classList.remove('input-ok');
    } else {
      errEl.textContent = '';
      if (inputEl.value.trim()) {
        inputEl.classList.remove('input-error');
        inputEl.classList.add('input-ok');
      }
    }
  }
};

/* ─────────────────────────────────────────────
   5. OVERLAY Y MODAL BASE
───────────────────────────────────────────── */
const overlay = document.getElementById('modal-overlay');

function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('active');
  overlay?.classList.add('active');
  setTimeout(() => {
    m.querySelector('input:not([type=hidden]),select,textarea')?.focus();
  }, 80);
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
  if (!document.querySelector('.modal.active')) overlay?.classList.remove('active');
}

overlay?.addEventListener('click', () =>
  document.querySelectorAll('.modal.active').forEach(m => closeModal(m.id))
);

/* ─────────────────────────────────────────────
   6. MODAL PROYECTO (RF1, RF2, RF27–RF29)
───────────────────────────────────────────── */
const ModalProject = {
  selectedColor: COLOR_OPTIONS[0],

  init() {
    const descEl    = document.getElementById('project-desc');
    const counterEl = document.getElementById('desc-counter');

    /* Contador de caracteres */
    descEl?.addEventListener('input', () => {
      const len = descEl.value.length;
      if (counterEl) {
        counterEl.textContent = `${len} / 300`;
        counterEl.className   = 'char-counter' +
          (len >= 300 ? ' at-limit' : len >= 240 ? ' near-limit' : '');
      }
    });

    /* Validación blur */
    document.getElementById('project-name')?.addEventListener('blur', () =>
      Validator.validateField('name'));
    document.getElementById('project-deadline')?.addEventListener('blur',   () =>
      Validator.validateField('deadline'));
    document.getElementById('project-deadline')?.addEventListener('change', () =>
      Validator.validateField('deadline'));

    /* Color swatches */
    document.querySelectorAll('#project-color-picker .color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('#project-color-picker .color-swatch')
          .forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        this.selectedColor = sw.dataset.color;
      });
    });

    /* Botones */
    document.getElementById('btn-save-project')?.addEventListener('click', () => this.save());
    document.getElementById('btn-cancel-project')?.addEventListener('click', () => this.close());
    document.getElementById('close-modal-project')?.addEventListener('click', () => this.close());
    document.getElementById('project-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.save();
    });
  },

  getFormData() {
    return {
      name:     document.getElementById('project-name')?.value ?? '',
      desc:     document.getElementById('project-desc')?.value ?? '',
      deadline: document.getElementById('project-deadline')?.value ?? '',
      color:    this.selectedColor,
    };
  },

  openCreate() {
    State.editingId = null;
    document.getElementById('modal-project-title').textContent = 'Nuevo Proyecto';
    this.reset();
    openModal('modal-project');
  },

  openEdit(project) {
    State.editingId = project.id;
    document.getElementById('modal-project-title').textContent = 'Editar Proyecto';
    this.reset();

    document.getElementById('project-name').value     = project.name;
    document.getElementById('project-desc').value     = project.desc || '';
    document.getElementById('project-deadline').value = project.deadline || '';
    this.selectedColor = project.color || COLOR_OPTIONS[0];

    /* Actualizar contador */
    const len       = (project.desc || '').length;
    const counterEl = document.getElementById('desc-counter');
    if (counterEl) counterEl.textContent = `${len} / 300`;

    /* Activar color correcto */
    document.querySelectorAll('#project-color-picker .color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === this.selectedColor);
    });

    openModal('modal-project');
  },

  save() {
    const data = this.getFormData();
    const { valid, errors } = Validator.validateProject(data, State.editingId);

    Validator.showErrors(errors);

    if (!valid) {
      /* Animación de sacudida para indicar error */
      const modal = document.getElementById('modal-project');
      modal?.classList.add('shake');
      setTimeout(() => modal?.classList.remove('shake'), 400);
      return;
    }

    if (errors._deadlineWarning) {
      Toast.show(errors._deadlineWarning, 'info', 5000);
    }

    if (State.editingId) {
      ProjectManager.update(State.editingId, data);
    } else {
      ProjectManager.create(data);
    }
    this.close();
  },

  close() {
    Validator.clearErrors();
    this.reset();
    State.editingId = null;
    closeModal('modal-project');
  },

  reset() {
    ['project-name','project-desc','project-deadline'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const counterEl = document.getElementById('desc-counter');
    if (counterEl) { counterEl.textContent = '0 / 300'; counterEl.className = 'char-counter'; }
    this.selectedColor = COLOR_OPTIONS[0];
    document.querySelectorAll('#project-color-picker .color-swatch')
      .forEach((sw, i) => sw.classList.toggle('active', i === 0));
    Validator.clearErrors();
  }
};

/* ─────────────────────────────────────────────
   7. MODAL CONFIRMACIÓN (RF3, RF29)
───────────────────────────────────────────── */
const ModalConfirm = {
  onConfirm: null,

  init() {
    document.getElementById('btn-confirm-delete')?.addEventListener('click', () => {
      this.onConfirm?.();
      this.close();
    });
    document.getElementById('btn-cancel-confirm')?.addEventListener('click',  () => this.close());
    document.getElementById('close-modal-confirm')?.addEventListener('click', () => this.close());
  },

  open(message, onConfirm) {
    document.getElementById('modal-confirm-text').textContent = message;
    this.onConfirm = onConfirm;
    openModal('modal-confirm');
  },

  close() {
    this.onConfirm = null;
    closeModal('modal-confirm');
  }
};

/* ─────────────────────────────────────────────
   8. PROJECT MANAGER — lógica CRUD
───────────────────────────────────────────── */
const ProjectManager = {

  /** RF1 — Crear */
  create(data) {
    const project = {
      id:        uid(),
      name:      data.name.trim(),
      desc:      data.desc.trim(),
      deadline:  data.deadline || null,
      color:     data.color || COLOR_OPTIONS[0],
      icon:      ICON_LIST[Math.floor(Math.random() * ICON_LIST.length)],
      createdAt: new Date().toISOString(),
      taskCount: 0,
      progress:  0,
    };
    State.projects.unshift(project);
    Storage.save(State.projects);
    Renderer.renderAll();
    Toast.show(`Proyecto "${project.name}" creado correctamente.`, 'success');
    Activity.add(`Proyecto <strong>${esc(project.name)}</strong> creado`);
  },

  /** RF2 — Editar */
  update(id, data) {
    const idx = State.projects.findIndex(p => p.id === id);
    if (idx === -1) return;
    State.projects[idx] = {
      ...State.projects[idx],
      name:      data.name.trim(),
      desc:      data.desc.trim(),
      deadline:  data.deadline || null,
      color:     data.color || State.projects[idx].color,
      updatedAt: new Date().toISOString(),
    };
    Storage.save(State.projects);
    Renderer.renderAll();
    Toast.show(`Proyecto "${State.projects[idx].name}" actualizado.`, 'success');
    Activity.add(`Proyecto <strong>${esc(State.projects[idx].name)}</strong> editado`);
  },

  /** RF3 — Eliminar (abre confirmación primero) */
  confirmDelete(id) {
    const project = State.projects.find(p => p.id === id);
    if (!project) return;
    ModalConfirm.open(
      `¿Eliminar el proyecto "${project.name}"? Esta acción no se puede deshacer y se perderán todas sus tareas asociadas.`,
      () => this.delete(id)
    );
  },

  delete(id) {
    const project = State.projects.find(p => p.id === id);
    if (!project) return;
    const name = project.name;
    State.projects = State.projects.filter(p => p.id !== id);
    Storage.save(State.projects);

    /* FIX: Eliminar también todas las tareas del proyecto */
    if (typeof KanbanState !== 'undefined') {
      KanbanState.tasks = KanbanState.tasks.filter(t => t.projectId !== id);
      if (typeof TaskStorage !== 'undefined') TaskStorage.save(KanbanState.tasks);
    }
    /* FIX: Eliminar membresías del proyecto */
    if (typeof UsersState !== 'undefined') {
      UsersState.memberships = UsersState.memberships.filter(m => m.projectId !== id);
      if (typeof UsersStorage !== 'undefined') UsersStorage.saveMembers(UsersState.memberships);
    }

    Renderer.renderAll();
    Toast.show(`Proyecto "${name}" eliminado.`, 'info');
    Activity.add(`Proyecto <strong>${esc(name)}</strong> eliminado`);
  },

  /** RF4 — Filtrar por búsqueda */
  filter(query) {
    const q = query.toLowerCase().trim();
    if (!q) return State.projects;
    return State.projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.desc || '').toLowerCase().includes(q)
    );
  }
};

/* ─────────────────────────────────────────────
   9. RENDERER — genera el HTML dinámico
───────────────────────────────────────────── */
const Renderer = {

  renderAll() {
    const filtered = ProjectManager.filter(State.searchQuery);
    this.renderProjects(filtered);
    this.renderQuickList();
    this.updateBadge();
    this.updateDashboardStats();
  },

  /* ── 9a. Grid / Lista (RF4) ── */
  renderProjects(projects) {
    const container  = document.getElementById('projects-container');
    const emptyState = document.getElementById('empty-projects');
    const countEl    = document.getElementById('projects-count');
    if (!container) return;

    /* Sin proyectos en absoluto */
    if (State.projects.length === 0) {
      container.innerHTML = '';
      if (emptyState) emptyState.style.display = 'flex';
      if (countEl) countEl.textContent = '';
      return;
    }

    /* Hay proyectos pero la búsqueda no coincide */
    if (emptyState) emptyState.style.display = 'none';

    if (projects.length === 0) {
      container.innerHTML = `<p class="empty-search-msg">
        Sin resultados para "<strong>${esc(State.searchQuery)}</strong>".
        <br><small>Intenta con otro término.</small></p>`;
      if (countEl) countEl.textContent = '';
      return;
    }

    /* Contador de resultados */
    if (countEl) {
      countEl.textContent = projects.length === State.projects.length
        ? `${projects.length} proyecto${projects.length !== 1 ? 's' : ''}`
        : `${projects.length} de ${State.projects.length} proyectos`;
    }

    /* Renderizar tarjetas + botón crear */
    container.innerHTML =
      projects.map(p => this.buildCard(p)).join('') +
      `<button class="project-card project-card-new" id="btn-inline-new">
         <span class="new-card-icon">+</span>
         <span class="new-card-label">Crear Proyecto</span>
       </button>`;

    this.bindCardEvents(container);
  },

  /* Construye el HTML de una tarjeta */
  buildCard(p) {
    const deadlineChip = this.deadlineChip(p.deadline);
    const taskChip     = `<span class="meta-chip">🗂 ${p.taskCount || 0} tarea${(p.taskCount||0) !== 1 ? 's' : ''}</span>`;
    const pct          = p.progress || 0;

    /* FIX: solo mostrar edit/delete si el usuario activo es admin del proyecto */
    let canAdmin = true;
    if (typeof UsersState !== 'undefined' && typeof UserManager !== 'undefined') {
      canAdmin = UserManager.isActiveAdmin(p.id);
    }
    const adminActions = canAdmin ? `
      <button class="btn-icon btn-edit-project"   data-id="${esc(p.id)}" aria-label="Editar proyecto">✎</button>
      <button class="btn-icon btn-delete-project" data-id="${esc(p.id)}" aria-label="Eliminar proyecto">✕</button>` : '';

    return `
      <article class="project-card" data-project-id="${esc(p.id)}">
        <div class="project-card-header" style="--accent:${esc(p.color)}">
          <span class="project-card-icon">${p.icon || '🗂'}</span>
          <div class="project-card-actions">${adminActions}</div>
        </div>
        <div class="project-card-body">
          <h3 class="project-card-name">${esc(p.name)}</h3>
          <p class="project-card-desc">${esc(p.desc || 'Sin descripción.')}</p>
          <div class="project-meta">
            ${deadlineChip}
            ${taskChip}
          </div>
          <!-- Progreso inline (visible en vista lista) -->
          <div class="list-progress-inline">
            <div class="list-progress-bar-wrap">
              <div class="list-progress-bar" style="--pct:${pct}%; --bar-clr:${esc(p.color)}"></div>
            </div>
            <span class="list-progress-pct">${pct}%</span>
          </div>
          <!-- Progreso normal (visible en vista grid) -->
          <div class="project-progress-row">
            <span class="progress-label">Avance</span>
            <span class="progress-pct">${pct}%</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="--pct:${pct}%; --bar-clr:${esc(p.color)}"></div>
          </div>
        </div>
        <div class="project-card-footer">
          <button class="btn-secondary btn-sm btn-view-kanban" data-id="${esc(p.id)}">Ver Kanban</button>
          <button class="btn-secondary btn-sm btn-view-tasks"  data-id="${esc(p.id)}">Ver Tareas</button>
        </div>
      </article>`;
  },

  /* Chip de fecha con color según urgencia */
  deadlineChip(deadline) {
    if (!deadline) return '';
    const days = daysUntil(deadline);
    if (days === null) return '';
    let cls  = 'meta-chip';
    let text = `📅 ${formatDate(deadline)}`;
    if (days < 0)        { cls += ' chip-overdue'; text = `⚠ Venció hace ${Math.abs(days)}d`; }
    else if (days === 0) { cls += ' chip-soon';    text = '⏰ Vence hoy'; }
    else if (days <= 7)  { cls += ' chip-soon';    text = `⏰ En ${days}d`; }
    else                   cls += ' chip-ok';
    return `<span class="${cls}">${text}</span>`;
  },

  /* Bind eventos en tarjetas del DOM */
  bindCardEvents(container) {
    container.querySelectorAll('.btn-edit-project').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const p = State.projects.find(p => p.id === btn.dataset.id);
        if (p) ModalProject.openEdit(p);
      });
    });
    container.querySelectorAll('.btn-delete-project').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        ProjectManager.confirmDelete(btn.dataset.id);
      });
    });
    container.querySelectorAll('.btn-view-kanban,.btn-view-tasks').forEach(btn => {
      btn.addEventListener('click', () => TabManager.switchTo('kanban'));
    });
    container.querySelector('#btn-inline-new')?.addEventListener('click', () =>
      ModalProject.openCreate());
  },

  /* ── 9b. Lista rápida en Dashboard ── */
  renderQuickList() {
    const list = document.getElementById('quick-project-list');
    if (!list) return;
    const top = State.projects.slice(0, 5);
    if (top.length === 0) {
      list.innerHTML = `<li style="padding:16px 20px;color:var(--text-muted);font-size:.84rem">
        Sin proyectos aún. <button class="btn-link" style="font-size:.84rem" onclick="ModalProject.openCreate()">Crear uno →</button></li>`;
      return;
    }
    list.innerHTML = top.map(p => `
      <li class="project-quick-item">
        <div class="project-color" style="--clr:${esc(p.color)}"></div>
        <span class="project-quick-name">${esc(p.name)}</span>
        <div class="mini-progress">
          <div class="mini-bar" style="--pct:${p.progress||0}%; background:${esc(p.color)}"></div>
        </div>
        <span class="mini-pct">${p.progress||0}%</span>
      </li>`).join('');
  },

  /* ── 9c. Badge sidebar ── */
  updateBadge() {
    const el = document.getElementById('badge-projects');
    if (el) el.textContent = State.projects.length;
  },

  /* ── 9d. Stat card dashboard ── */
  updateDashboardStats() {
    const el = document.getElementById('val-total-projects');
    if (el) el.textContent = State.projects.length;
  }
};

/* ─────────────────────────────────────────────
   10. ACTIVIDAD RECIENTE (RF14)
───────────────────────────────────────────── */
const Activity = {
  KEY: 'taskflow_activity',
  MAX: 10,

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
  },
  save(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); },

  add(htmlMsg) {
    const items = this.load();
    items.unshift({ msg: htmlMsg, ts: Date.now() });
    this.save(items.slice(0, this.MAX));
    this.render();
  },

  timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)    return 'Hace un momento';
    if (s < 3600)  return `Hace ${Math.floor(s/60)}min`;
    if (s < 86400) return `Hace ${Math.floor(s/3600)}h`;
    return `Hace ${Math.floor(s/86400)}d`;
  },

  render() {
    const list = document.getElementById('activity-list');
    if (!list) return;
    const items = this.load();
    if (items.length === 0) {
      list.innerHTML = `<li class="activity-item">
        <span class="activity-text" style="color:var(--text-muted)">Sin actividad reciente.</span></li>`;
      return;
    }
    list.innerHTML = items.map(item => `
      <li class="activity-item">
        <span class="activity-dot status-progress"></span>
        <span class="activity-text">${item.msg}</span>
        <span class="activity-time">${this.timeAgo(item.ts)}</span>
      </li>`).join('');
  }
};

/* ─────────────────────────────────────────────
   11. VISTA TOGGLE (grid / list)
───────────────────────────────────────────── */
const ViewToggle = {
  init() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        State.currentView = view;
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const c = document.getElementById('projects-container');
        if (c) {
          c.classList.toggle('projects-grid', view === 'grid');
          c.classList.toggle('projects-list', view === 'list');
        }
      });
    });
  }
};

/* ─────────────────────────────────────────────
   12. BÚSQUEDA EN TIEMPO REAL (RF4)
───────────────────────────────────────────── */
const Search = {
  init() {
    const input = document.getElementById('search-projects');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        State.searchQuery = input.value;
        Renderer.renderAll();
      }, 250);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        input.value = '';
        State.searchQuery = '';
        Renderer.renderAll();
      }
    });
  }
};

/* ─────────────────────────────────────────────
   13. NAVEGACIÓN DE PESTAÑAS
───────────────────────────────────────────── */
const TAB_TITLES = {
  dashboard:'Dashboard', projects:'Proyectos', kanban:'Tablero Kanban',
  calendar:'Calendario', stats:'Estadísticas', users:'Usuarios', settings:'Configuración',
};

const TabManager = {
  init() {
    document.querySelectorAll('[data-tab]').forEach(el => {
      el.addEventListener('click', () => this.switchTo(el.dataset.tab));
    });
  },
  switchTo(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('[data-tab]').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
    document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add('active'));
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = TAB_TITLES[tabId] ?? tabId;
    if (window.innerWidth < 768) document.getElementById('sidebar')?.classList.remove('open');
  }
};

/* ─────────────────────────────────────────────
   14. TEMA (RF24)
───────────────────────────────────────────── */
const Theme = {
  init() {
    const saved = localStorage.getItem('taskflow_theme') || 'dark';
    this.apply(saved);
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => this.toggle());
    document.getElementById('toggle-dark-mode')?.addEventListener('click', () => this.toggle());
  },
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('toggle-dark-mode')?.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    localStorage.setItem('taskflow_theme', theme);
  },
  toggle() {
    this.apply(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }
};

/* ─────────────────────────────────────────────
   15. SIDEBAR RESPONSIVE
───────────────────────────────────────────── */
function initSidebar() {
  const sb = document.getElementById('sidebar');
  document.getElementById('btn-menu-toggle')?.addEventListener('click',   () => sb?.classList.toggle('open'));
  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => sb?.classList.remove('open'));
}

/* ─────────────────────────────────────────────
   16. ESTILOS INYECTADOS (shake + toast-icon)
───────────────────────────────────────────── */
function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes shake {
      0%,100%{transform:translate(-50%,-50%)}
      20%{transform:translate(-52%,-50%)}
      40%{transform:translate(-48%,-50%)}
      60%{transform:translate(-52%,-50%)}
      80%{transform:translate(-48%,-50%)}
    }
    .modal.shake{animation:shake .35s ease;}
    .toast-icon{font-size:.85rem;flex-shrink:0;}
    /* list-progress oculto en grid, visible en lista */
    .projects-grid .list-progress-inline{display:none;}
    .projects-list .project-progress-row,
    .projects-list .progress-bar-wrap{display:none;}
    .projects-list .list-progress-inline{display:flex;}
  `;
  document.head.appendChild(s);
}

/* ─────────────────────────────────────────────
   17. INICIALIZACIÓN PRINCIPAL
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  injectStyles();

  Toast.init();
  Theme.init();
  TabManager.init();
  initSidebar();
  ViewToggle.init();
  Search.init();
  ModalProject.init();
  ModalConfirm.init();

  /* Botones de nuevo proyecto */
  document.getElementById('btn-new-project')?.addEventListener('click',       () => ModalProject.openCreate());
  document.getElementById('btn-empty-new-project')?.addEventListener('click', () => ModalProject.openCreate());

  /* RF22 — Carga automática de datos y render inicial */
  Renderer.renderAll();
  Activity.render();

  /* Tab inicial */
  TabManager.switchTo('dashboard');
});
