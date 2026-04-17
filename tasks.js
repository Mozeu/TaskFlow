/* ═══════════════════════════════════════════════════════════
   TASKFLOW — tasks.js  v1.0
   Módulos: TaskStorage · TaskManager (CRUD) · Validación ·
            KanbanRenderer · DragDrop · ModalTask
   Depende de: app.js (State, Storage, Toast, TabManager,
                        Activity, Renderer, esc, formatDate, daysUntil, uid)
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. CONSTANTES
───────────────────────────────────────────── */
const TASK_KEY = 'taskflow_tasks';

const STATUSES = [
  { id: 'pendiente',   label: 'Pendiente',   dotClass: 'status-pending'  },
  { id: 'en-progreso', label: 'En Progreso', dotClass: 'status-progress' },
  { id: 'terminado',   label: 'Terminado',   dotClass: 'status-done'     },
];

const PRIORITY_LABELS = { alta: 'Alta', media: 'Media', baja: 'Baja' };

/* ─────────────────────────────────────────────
   1. TASK STORAGE
───────────────────────────────────────────── */
const TaskStorage = {
  load() {
    try { return JSON.parse(localStorage.getItem(TASK_KEY) || '[]'); }
    catch { return []; }
  },
  save(tasks) {
    try { localStorage.setItem(TASK_KEY, JSON.stringify(tasks)); }
    catch { Toast.show('Error al guardar tareas.', 'error'); }
  }
};

/* ─────────────────────────────────────────────
   2. ESTADO DEL KANBAN
───────────────────────────────────────────── */
const KanbanState = {
  tasks:          TaskStorage.load(),
  editingTaskId:  null,
  currentProjectId: null,   // proyecto actualmente visible en el tablero
  dragTaskId:     null,     // id de la tarea en tránsito
  dragSourceStatus: null,   // columna origen del drag
};

/* ─────────────────────────────────────────────
   3. TASK VALIDATOR (RF27, RF28, RF29)
───────────────────────────────────────────── */
const TaskValidator = {

  validate(data, editingId) {
    const errors = {};

    /* Nombre: obligatorio, 2–120 chars */
    const name = (data.name || '').trim();
    if (!name)            errors.name = 'El nombre de la tarea es obligatorio.';
    else if (name.length < 2)  errors.name = 'El nombre debe tener al menos 2 caracteres.';
    else if (name.length > 120) errors.name = 'El nombre no puede superar 120 caracteres.';

    /* Prioridad: obligatoria */
    if (!data.priority) errors.priority = 'Selecciona una prioridad.';

    /* Proyecto: obligatorio */
    if (!data.projectId) errors.project = 'Debes seleccionar un proyecto.';

    /* Fecha: si existe debe ser válida */
    if (data.deadline) {
      const d = daysUntil(data.deadline);
      if (d === null || isNaN(d)) errors.deadline = 'Fecha no válida.';
    }

    const valid = Object.keys(errors).length === 0;
    return { valid, errors };
  },

  showErrors(errors) {
    this.clearErrors();
    const map = {
      name:     ['error-task-name',     'task-name'],
      priority: ['error-task-priority', null],         // selector visual
      project:  ['error-task-project',  'task-project'],
      deadline: ['error-task-deadline', 'task-deadline'],
    };
    Object.entries(map).forEach(([field, [errId, inputId]]) => {
      const errEl = document.getElementById(errId);
      if (errEl && errors[field]) errEl.textContent = errors[field];
      if (inputId) {
        const el = document.getElementById(inputId);
        if (el && errors[field]) el.classList.add('input-error');
      }
    });
    /* Marcar priority-selector si hay error */
    if (errors.priority) {
      document.getElementById('priority-selector')?.classList.add('has-error');
    }
  },

  clearErrors() {
    ['error-task-name','error-task-priority','error-task-project','error-task-deadline']
      .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
    ['task-name','task-project','task-deadline']
      .forEach(id => document.getElementById(id)?.classList.remove('input-error','input-ok'));
    document.getElementById('priority-selector')?.classList.remove('has-error');
  }
};

/* ─────────────────────────────────────────────
   4. MODAL TAREA (RF5, RF6, RF8, RF9, RF27–RF29)
───────────────────────────────────────────── */
const ModalTask = {
  selectedPriority: null,

  init() {
    /* Descripción — contador de caracteres */
    document.getElementById('task-desc')?.addEventListener('input', () => {
      const len = document.getElementById('task-desc').value.length;
      const el  = document.getElementById('task-desc-counter');
      if (!el) return;
      el.textContent = `${len} / 500`;
      el.className   = 'char-counter' + (len >= 500 ? ' at-limit' : len >= 400 ? ' near-limit' : '');
    });

    /* Priority selector — botones */
    document.querySelectorAll('#priority-selector .priority-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#priority-selector .priority-btn')
          .forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed','true');
        this.selectedPriority = btn.dataset.priority;
        document.getElementById('priority-selector')?.classList.remove('has-error');
        document.getElementById('error-task-priority').textContent = '';
      });
    });

    /* Botones del modal */
    document.getElementById('btn-save-task')?.addEventListener('click',   () => this.save());
    document.getElementById('btn-cancel-task')?.addEventListener('click', () => this.close());
    document.getElementById('close-modal-task')?.addEventListener('click',() => this.close());
    document.getElementById('task-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.save();
    });

    /* Validación blur en nombre */
    document.getElementById('task-name')?.addEventListener('blur', () => {
      const name  = (document.getElementById('task-name').value || '').trim();
      const errEl = document.getElementById('error-task-name');
      if (!name) { errEl.textContent = 'El nombre de la tarea es obligatorio.'; }
      else        { errEl.textContent = ''; }
    });
  },

  getFormData() {
    return {
      name:      document.getElementById('task-name')?.value   ?? '',
      desc:      document.getElementById('task-desc')?.value   ?? '',
      priority:  this.selectedPriority,
      status:    document.getElementById('task-status')?.value ?? 'pendiente',
      deadline:  document.getElementById('task-deadline')?.value ?? '',
      projectId: document.getElementById('task-project')?.value ?? '',
    };
  },

  /** Abre en modo CREAR, con estado y proyecto preseleccionados */
  openCreate(status = 'pendiente', projectId = null) {
    KanbanState.editingTaskId = null;
    document.getElementById('modal-task-title').textContent = 'Nueva Tarea';
    this.reset();

    /* Preseleccionar estado */
    const sel = document.getElementById('task-status');
    if (sel) sel.value = status;

    /* Preseleccionar proyecto */
    this._populateProjectSelect();
    const pSel = document.getElementById('task-project');
    if (pSel && projectId) pSel.value = projectId;

    openModal('modal-task');
  },

  /** Abre en modo EDITAR con los datos de la tarea */
  openEdit(task) {
    KanbanState.editingTaskId = task.id;
    document.getElementById('modal-task-title').textContent = 'Editar Tarea';
    this.reset();

    document.getElementById('task-name').value     = task.name;
    document.getElementById('task-desc').value     = task.desc || '';
    document.getElementById('task-status').value   = task.status;
    document.getElementById('task-deadline').value = task.deadline || '';

    /* Contador desc */
    const len   = (task.desc || '').length;
    const ctrEl = document.getElementById('task-desc-counter');
    if (ctrEl) ctrEl.textContent = `${len} / 500`;

    /* Prioridad */
    this.selectedPriority = task.priority || null;
    document.querySelectorAll('#priority-selector .priority-btn').forEach(btn => {
      const active = btn.dataset.priority === task.priority;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    /* Proyecto */
    this._populateProjectSelect();
    const pSel = document.getElementById('task-project');
    if (pSel) pSel.value = task.projectId || '';

    openModal('modal-task');
  },

  save() {
    const data = this.getFormData();
    const { valid, errors } = TaskValidator.validate(data, KanbanState.editingTaskId);
    TaskValidator.showErrors(errors);

    if (!valid) {
      const modal = document.getElementById('modal-task');
      modal?.classList.add('shake');
      setTimeout(() => modal?.classList.remove('shake'), 400);
      return;
    }

    if (KanbanState.editingTaskId) {
      TaskManager.update(KanbanState.editingTaskId, data);
    } else {
      TaskManager.create(data);
    }
    this.close();
  },

  close() {
    TaskValidator.clearErrors();
    this.reset();
    KanbanState.editingTaskId = null;
    closeModal('modal-task');
  },

  reset() {
    ['task-name','task-desc','task-deadline'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const ctr = document.getElementById('task-desc-counter');
    if (ctr) { ctr.textContent = '0 / 500'; ctr.className = 'char-counter'; }

    this.selectedPriority = null;
    document.querySelectorAll('#priority-selector .priority-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed','false');
    });

    const sel = document.getElementById('task-status');
    if (sel) sel.value = 'pendiente';

    TaskValidator.clearErrors();
  },

  /** Llena el select de proyecto con los proyectos actuales */
  _populateProjectSelect() {
    const sel = document.getElementById('task-project');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccionar proyecto —</option>' +
      State.projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.name)}</option>`
      ).join('');
  }
};

/* ─────────────────────────────────────────────
   5. TASK MANAGER — CRUD (RF5, RF6, RF7, RF9, RF12)
───────────────────────────────────────────── */
const TaskManager = {

  getAll()                   { return KanbanState.tasks; },
  getForProject(projectId)   { return KanbanState.tasks.filter(t => t.projectId === projectId); },
  getById(id)                { return KanbanState.tasks.find(t => t.id === id); },

  /** RF5 — Crear tarea */
  create(data) {
    const task = {
      id:        uid(),
      name:      data.name.trim(),
      desc:      (data.desc || '').trim(),
      priority:  data.priority,
      status:    data.status || 'pendiente',
      deadline:  data.deadline || null,
      projectId: data.projectId,
      createdAt: new Date().toISOString(),
    };
    KanbanState.tasks.unshift(task);
    TaskStorage.save(KanbanState.tasks);
    this._syncProject(data.projectId);
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
    Toast.show(`Tarea "${task.name}" creada.`, 'success');
    Activity.add(`Tarea <strong>${esc(task.name)}</strong> creada`);
  },

  /** RF6 — Editar tarea */
  update(id, data) {
    const idx = KanbanState.tasks.findIndex(t => t.id === id);
    if (idx === -1) return;
    const prev = KanbanState.tasks[idx];
    KanbanState.tasks[idx] = {
      ...prev,
      name:      data.name.trim(),
      desc:      (data.desc || '').trim(),
      priority:  data.priority,
      status:    data.status,
      deadline:  data.deadline || null,
      projectId: data.projectId,
      updatedAt: new Date().toISOString(),
    };
    TaskStorage.save(KanbanState.tasks);

    /* Si cambió de proyecto, sincronizar ambos */
    if (prev.projectId !== data.projectId) this._syncProject(prev.projectId);
    this._syncProject(data.projectId);

    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
    Toast.show(`Tarea "${KanbanState.tasks[idx].name}" actualizada.`, 'success');
    Activity.add(`Tarea <strong>${esc(KanbanState.tasks[idx].name)}</strong> editada`);
  },

  /** RF7 — Eliminar tarea */
  confirmDelete(id) {
    const task = this.getById(id);
    if (!task) return;
    ModalConfirm.open(
      `¿Eliminar la tarea "${task.name}"? Esta acción no se puede deshacer.`,
      () => this.delete(id)
    );
  },

  delete(id) {
    const task = this.getById(id);
    if (!task) return;
    const { name, projectId } = task;
    KanbanState.tasks = KanbanState.tasks.filter(t => t.id !== id);
    TaskStorage.save(KanbanState.tasks);
    this._syncProject(projectId);
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
    Toast.show(`Tarea "${name}" eliminada.`, 'info');
    Activity.add(`Tarea <strong>${esc(name)}</strong> eliminada`);
  },

  /** RF12 — Mover tarea (cambia su status) */
  move(taskId, newStatus) {
    const idx = KanbanState.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    const prev = KanbanState.tasks[idx];
    if (prev.status === newStatus) return;   // sin cambio

    KanbanState.tasks[idx] = { ...prev, status: newStatus, updatedAt: new Date().toISOString() };
    TaskStorage.save(KanbanState.tasks);
    this._syncProject(prev.projectId);
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);

    const labels = { pendiente:'Pendiente', 'en-progreso':'En Progreso', terminado:'Terminado' };
    Toast.show(`"${prev.name}" → ${labels[newStatus]}`, 'info', 2500);
    Activity.add(`Tarea <strong>${esc(prev.name)}</strong> movida a <em>${labels[newStatus]}</em>`);
  },

  /**
   * Sincroniza taskCount y progress del proyecto padre
   * progress = tareas terminadas / total * 100
   */
  _syncProject(projectId) {
    if (!projectId) return;
    const idx = State.projects.findIndex(p => p.id === projectId);
    if (idx === -1) return;

    const all       = this.getForProject(projectId);
    const done      = all.filter(t => t.status === 'terminado').length;
    const total     = all.length;
    const progress  = total === 0 ? 0 : Math.round((done / total) * 100);

    State.projects[idx] = { ...State.projects[idx], taskCount: total, progress };
    Storage.save(State.projects);
    Renderer.renderAll();   // actualiza dashboard + lista de proyectos
  }
};

/* ─────────────────────────────────────────────
   6. KANBAN RENDERER (RF10)
───────────────────────────────────────────── */
const KanbanRenderer = {

  /** Llena el selector de proyecto en el toolbar del kanban */
  populateSelector() {
    const sel = document.getElementById('kanban-project-selector');
    if (!sel) return;

    const currentVal = sel.value;
    sel.innerHTML = '<option value="">— Selecciona un proyecto —</option>' +
      State.projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.name)}</option>`
      ).join('');

    /* Restaurar selección previa si todavía existe */
    if (currentVal && State.projects.find(p => p.id === currentVal)) {
      sel.value = currentVal;
    }
  },

  /** Renderiza el tablero completo para un proyecto dado */
  renderBoard(projectId) {
    const board       = document.getElementById('kanban-board');
    const noProjects  = document.getElementById('kanban-no-projects');
    const noTasks     = document.getElementById('kanban-no-tasks');
    const btnNew      = document.getElementById('btn-new-task-kanban');

    /* Sin proyectos en absoluto */
    if (State.projects.length === 0) {
      if (board)      board.style.display      = 'none';
      if (noTasks)    noTasks.style.display    = 'none';
      if (noProjects) noProjects.style.display = 'flex';
      if (btnNew)     btnNew.disabled          = true;
      return;
    }

    if (noProjects) noProjects.style.display = 'none';

    /* Sin proyecto seleccionado */
    if (!projectId) {
      if (board)   board.style.display   = 'none';
      if (noTasks) noTasks.style.display = 'none';
      if (btnNew)  btnNew.disabled       = true;
      return;
    }

    if (btnNew) btnNew.disabled = false;

    const tasks = TaskManager.getForProject(projectId);

    /* Sin tareas */
    if (tasks.length === 0) {
      if (board)   board.style.display   = 'none';
      if (noTasks) noTasks.style.display = 'flex';
      return;
    }

    if (noTasks) noTasks.style.display = 'none';
    if (board)   board.style.display   = 'flex';

    /* Renderizar cada columna */
    STATUSES.forEach(col => {
      const colTasks = tasks.filter(t => t.status === col.id);
      this._renderColumn(col.id, colTasks);
    });

    /* Activar drag & drop */
    DragDrop.bindZones();
  },

  /** Renderiza las tarjetas de una columna */
  _renderColumn(status, tasks) {
    const zone    = document.getElementById(`cards-${status}`);
    const countEl = document.getElementById(`count-${status}`);
    if (!zone) return;

    if (countEl) countEl.textContent = tasks.length;

    if (tasks.length === 0) {
      zone.innerHTML = `
        <div class="kanban-col-empty">
          <span class="kanban-col-empty-icon">◌</span>
          <span>Sin tareas aquí</span>
        </div>`;
      return;
    }

    zone.innerHTML = tasks.map(t => this._buildCard(t)).join('');
    this._bindCardEvents(zone);
  },

  /** Genera el HTML de una tarjeta de tarea */
  _buildCard(task) {
    const priorityLabel = PRIORITY_LABELS[task.priority] || task.priority || '—';
    const pClass        = `priority-${task.priority || 'baja'}`;
    const doneClass     = task.status === 'terminado' ? ' task-done' : '';
    const deadlineHtml  = this._deadlineChip(task.deadline);
    const descHtml      = task.desc
      ? `<p class="task-card-desc">${esc(task.desc)}</p>`
      : '';

    return `
      <div class="task-card${doneClass}"
           draggable="true"
           data-task-id="${esc(task.id)}"
           data-priority="${esc(task.priority || 'baja')}"
           data-status="${esc(task.status)}">
        <div class="task-card-top">
          <span class="priority-badge ${pClass}">${esc(priorityLabel)}</span>
          <div class="task-card-actions">
            <button class="btn-icon btn-edit-task"
                    data-id="${esc(task.id)}" aria-label="Editar tarea">✎</button>
            <button class="btn-icon btn-delete-task"
                    data-id="${esc(task.id)}" aria-label="Eliminar tarea">✕</button>
          </div>
        </div>
        <p class="task-card-name">${esc(task.name)}</p>
        ${descHtml}
        ${deadlineHtml ? `<div class="task-card-footer">${deadlineHtml}</div>` : ''}
      </div>`;
  },

  /** Chip de fecha límite con urgencia */
  _deadlineChip(deadline) {
    if (!deadline) return '';
    const days = daysUntil(deadline);
    if (days === null) return '';
    let cls  = 'task-due';
    let text = `📅 ${formatDate(deadline)}`;
    if (days < 0)        { cls += ' due-overdue'; text = `⚠ Venció (${Math.abs(days)}d)`; }
    else if (days === 0) { cls += ' due-soon';    text = '⏰ Vence hoy'; }
    else if (days <= 3)  { cls += ' due-soon';    text = `⏰ En ${days}d`; }
    return `<span class="${cls}">${text}</span>`;
  },

  /** Bind eventos en tarjetas recién renderizadas */
  _bindCardEvents(zone) {
    zone.querySelectorAll('.btn-edit-task').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const task = TaskManager.getById(btn.dataset.id);
        if (task) ModalTask.openEdit(task);
      });
    });
    zone.querySelectorAll('.btn-delete-task').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        TaskManager.confirmDelete(btn.dataset.id);
      });
    });
    /* Drag start en tarjetas (RF11) */
    zone.querySelectorAll('.task-card[draggable]').forEach(card => {
      card.addEventListener('dragstart', e => DragDrop.onDragStart(e, card));
      card.addEventListener('dragend',   e => DragDrop.onDragEnd(e, card));
    });
  }
};

/* ─────────────────────────────────────────────
   7. DRAG & DROP (RF11, RF12)
───────────────────────────────────────────── */
const DragDrop = {

  /** Llama a este método cada vez que se re-renderiza el board */
  bindZones() {
    document.querySelectorAll('.kanban-cards[data-status]').forEach(zone => {
      /* Limpiar listeners previos clonando el nodo */
      const fresh = zone.cloneNode(true);
      zone.parentNode.replaceChild(fresh, zone);
      /* Re-attach cards events (los clonados no tienen listeners) */
      KanbanRenderer._bindCardEvents(fresh);

      fresh.addEventListener('dragover',  e => this.onDragOver(e, fresh));
      fresh.addEventListener('dragleave', e => this.onDragLeave(e, fresh));
      fresh.addEventListener('drop',      e => this.onDrop(e, fresh));
    });
  },

  onDragStart(e, card) {
    KanbanState.dragTaskId      = card.dataset.taskId;
    KanbanState.dragSourceStatus = card.dataset.status;
    card.classList.add('is-dragging');

    /* Imagen fantasma personalizada */
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = card.querySelector('.task-card-name')?.textContent || '';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', KanbanState.dragTaskId);

    /* Limpiar ghost después del frame de drag */
    requestAnimationFrame(() => {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    });
  },

  onDragEnd(e, card) {
    card.classList.remove('is-dragging');
    KanbanState.dragTaskId      = null;
    KanbanState.dragSourceStatus = null;
    /* Limpiar estilos de drop en todas las zonas */
    document.querySelectorAll('.kanban-cards').forEach(z => {
      z.classList.remove('drag-over');
      z.querySelector('.drop-indicator')?.remove();
    });
  },

  onDragOver(e, zone) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');

    /* Indicador de posición de inserción */
    zone.querySelector('.drop-indicator')?.remove();
    const indicator = document.createElement('div');
    indicator.className = 'drop-indicator';

    /* Buscar posición vertical correcta */
    const cards = [...zone.querySelectorAll('.task-card[data-task-id]')];
    let inserted = false;
    for (const card of cards) {
      const rect   = card.getBoundingClientRect();
      const midY   = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        zone.insertBefore(indicator, card);
        inserted = true;
        break;
      }
    }
    if (!inserted) zone.appendChild(indicator);
  },

  onDragLeave(e, zone) {
    /* Solo quitar si el cursor realmente salió de la zona */
    if (!zone.contains(e.relatedTarget)) {
      zone.classList.remove('drag-over');
      zone.querySelector('.drop-indicator')?.remove();
    }
  },

  onDrop(e, zone) {
    e.preventDefault();
    zone.classList.remove('drag-over');
    zone.querySelector('.drop-indicator')?.remove();

    const taskId    = e.dataTransfer.getData('text/plain') || KanbanState.dragTaskId;
    const newStatus = zone.dataset.status;
    if (taskId && newStatus) {
      TaskManager.move(taskId, newStatus);
    }
  }
};

/* ─────────────────────────────────────────────
   8. INICIALIZACIÓN DEL MÓDULO DE TAREAS
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* Modal de tareas */
  ModalTask.init();

  /* Selector de proyecto en el kanban */
  const selector = document.getElementById('kanban-project-selector');
  selector?.addEventListener('change', () => {
    KanbanState.currentProjectId = selector.value || null;
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
  });

  /* Botón "+ Nueva Tarea" del toolbar */
  document.getElementById('btn-new-task-kanban')?.addEventListener('click', () => {
    ModalTask.openCreate('pendiente', KanbanState.currentProjectId);
  });

  /* Botones "+ Agregar tarea" en cada columna */
  document.querySelectorAll('.btn-add-task-col').forEach(btn => {
    btn.addEventListener('click', () => {
      ModalTask.openCreate(btn.dataset.status, KanbanState.currentProjectId);
    });
  });

  /* Botón "Crear Primera Tarea" en estado vacío */
  document.getElementById('btn-kanban-first-task')?.addEventListener('click', () => {
    ModalTask.openCreate('pendiente', KanbanState.currentProjectId);
  });

  /* Botón "Ir a Proyectos" en estado sin proyectos */
  document.getElementById('btn-kanban-go-projects')?.addEventListener('click', () => {
    TabManager.switchTo('projects');
  });

  /* Botón "+ Nueva Tarea" del topbar */
  document.getElementById('btn-quick-add')?.addEventListener('click', () => {
    ModalTask.openCreate('pendiente', KanbanState.currentProjectId);
  });

  /* ── Patch de TabManager: al entrar al kanban, actualizar selector ── */
  const origSwitch = TabManager.switchTo.bind(TabManager);
  TabManager.switchTo = function(tabId) {
    origSwitch(tabId);
    if (tabId === 'kanban') {
      KanbanRenderer.populateSelector();
      KanbanRenderer.renderBoard(KanbanState.currentProjectId);
    }
  };

  /* ── Patch de Renderer: después de renderizar proyectos, sincronizar kanban selector ── */
  const origRenderAll = Renderer.renderAll.bind(Renderer);
  Renderer.renderAll = function() {
    origRenderAll();
    KanbanRenderer.populateSelector();
  };

  /* Render inicial */
  KanbanRenderer.populateSelector();
  KanbanRenderer.renderBoard(KanbanState.currentProjectId);
});
