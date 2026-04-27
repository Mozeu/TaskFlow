/* ═══════════════════════════════════════════════════════════
   TASKFLOW — users.js  v1.0
   Gestión de usuarios: perfiles, roles, membresía en proyectos,
   vista de tareas propias y generales.

   Datos:
   · users[]         localStorage('taskflow_users')
   · memberships[]   localStorage('taskflow_memberships')
   · activeUserId    localStorage('taskflow_active_user')

   Roles en proyecto: 'admin' | 'member'
   - El creador del proyecto se convierte en admin automáticamente
   - Un admin puede agregar/quitar miembros y cambiar sus roles
   - Un usuario normal sólo puede ver/crear tareas de sus proyectos
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. CONSTANTES Y UTILIDADES
───────────────────────────────────────────── */
const USERS_KEY       = 'taskflow_users';
const MEMBERS_KEY     = 'taskflow_memberships';
const ACTIVE_USER_KEY = 'taskflow_active_user';

/** Paleta de colores para avatares */
const AVATAR_COLORS = [
  '#6c63ff','#20bf6b','#f7b731','#fc5c65',
  '#45aaf2','#fd9644','#a55eea','#eb3b5a',
];

/** Genera iniciales a partir de un nombre */
function initials(name) {
  return name.trim().split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('');
}

/** Color de avatar determinista por nombre */
function avatarColor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* ─────────────────────────────────────────────
   1. STORAGE
───────────────────────────────────────────── */
const UsersStorage = {
  loadUsers() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }
    catch { return []; }
  },
  saveUsers(u)  { localStorage.setItem(USERS_KEY,   JSON.stringify(u)); },

  loadMembers() {
    try { return JSON.parse(localStorage.getItem(MEMBERS_KEY) || '[]'); }
    catch { return []; }
  },
  saveMembers(m){ localStorage.setItem(MEMBERS_KEY, JSON.stringify(m)); },

  loadActiveId() { return localStorage.getItem(ACTIVE_USER_KEY) || null; },
  saveActiveId(id){ id ? localStorage.setItem(ACTIVE_USER_KEY, id)
                       : localStorage.removeItem(ACTIVE_USER_KEY); },
};

/* ─────────────────────────────────────────────
   2. ESTADO GLOBAL DE USUARIOS
───────────────────────────────────────────── */
const UsersState = {
  users:         UsersStorage.loadUsers(),
  memberships:   UsersStorage.loadMembers(),
  activeUserId:  UsersStorage.loadActiveId(),
  editingUserId: null,
  membersProjectId: null,   // proyecto que se está gestionando en modal
  activeTab:     'directory',
  searchQuery:   '',
};

/* ─────────────────────────────────────────────
   3. USER MANAGER — CRUD
───────────────────────────────────────────── */
const UserManager = {

  getAll()       { return UsersState.users; },
  getById(id)    { return UsersState.users.find(u => u.id === id) || null; },
  getActive()    { return this.getById(UsersState.activeUserId); },

  /** RF19 — Crear usuario */
  create(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const user = {
      id:        uid(),
      name:      trimmed,
      initials:  initials(trimmed),
      color:     avatarColor(trimmed),
      createdAt: new Date().toISOString(),
    };
    UsersState.users.push(user);
    UsersStorage.saveUsers(UsersState.users);

    /* Si es el primer usuario, convertirlo en activo */
    if (UsersState.users.length === 1) this.setActive(user.id);

    UsersRenderer.renderAll();
    UsersSidebar.update();
    Toast.show(`Usuario "${user.name}" creado.`, 'success');
    Activity.add(`Usuario <strong>${esc(user.name)}</strong> creado`);
    return user;
  },

  /** RF19 — Editar nombre */
  update(id, name) {
    const idx = UsersState.users.findIndex(u => u.id === id);
    if (idx === -1) return;
    const trimmed = name.trim();
    UsersState.users[idx] = {
      ...UsersState.users[idx],
      name:     trimmed,
      initials: initials(trimmed),
      color:    avatarColor(trimmed),
    };
    UsersStorage.saveUsers(UsersState.users);
    UsersRenderer.renderAll();
    UsersSidebar.update();
    this._syncTaskAssigneeSelects();
    Toast.show(`Usuario actualizado a "${trimmed}".`, 'success');
  },

  /** RF19 — Eliminar usuario */
  confirmDelete(id) {
    const u = this.getById(id);
    if (!u) return;
    ModalConfirm.open(
      `¿Eliminar el usuario "${u.name}"? Las tareas que le estaban asignadas quedarán sin asignar.`,
      () => this.delete(id)
    );
  },

  delete(id) {
    const u = this.getById(id);
    if (!u) return;
    const name = u.name;

    /* Desasignar sus tareas */
    KanbanState.tasks = KanbanState.tasks.map(t =>
      t.assigneeId === id ? { ...t, assigneeId: null } : t
    );
    TaskStorage.save(KanbanState.tasks);

    /* Quitar de membresías */
    UsersState.memberships = UsersState.memberships.filter(m => m.userId !== id);
    UsersStorage.saveMembers(UsersState.memberships);

    /* Quitar de creators */
    State.projects = State.projects.map(p =>
      p.creatorId === id ? { ...p, creatorId: null } : p
    );
    Storage.save(State.projects);

    /* Si era el activo, limpiar */
    if (UsersState.activeUserId === id) {
      const next = UsersState.users.find(u => u.id !== id);
      UsersState.activeUserId = next?.id || null;
      UsersStorage.saveActiveId(UsersState.activeUserId);
    }

    UsersState.users = UsersState.users.filter(u => u.id !== id);
    UsersStorage.saveUsers(UsersState.users);

    UsersRenderer.renderAll();
    UsersSidebar.update();
    Toast.show(`Usuario "${name}" eliminado.`, 'info');
    Activity.add(`Usuario <strong>${esc(name)}</strong> eliminado`);
  },

  /** Cambiar el usuario activo */
  setActive(id) {
  UsersState.activeUserId = id;
  UsersStorage.saveActiveId(id);
  UsersSidebar.update();
  UsersRenderer.renderBanner();
  UsersRenderer.renderMyTasks();
  closeModal('modal-switch-user');

  // 👇 REFRESCAR TODA LA INTERFAZ SIN RECARGAR
  refreshAllAfterUserChange();
},
  /* ─── MEMBRESÍAS ─── */

  /** Obtiene los miembros de un proyecto */
  getMembersOf(projectId) {
    return UsersState.memberships.filter(m => m.projectId === projectId);
  },

  /** Obtiene el rol de un usuario en un proyecto (null si no es miembro) */
  getRoleIn(userId, projectId) {
    const m = UsersState.memberships.find(
      m => m.userId === userId && m.projectId === projectId
    );
    return m ? m.role : null;
  },

  /** Verifica si el usuario activo es admin del proyecto */
  isActiveAdmin(projectId) {
    const active = this.getActive();
    if (!active) return false;
    const project = State.projects.find(p => p.id === projectId);
    /* El creador siempre es admin */
    if (project?.creatorId === active.id) return true;
    return this.getRoleIn(active.id, projectId) === 'admin';
  },

  /** Agregar miembro a proyecto (RF20) */
  addMember(projectId, userId, role = 'member') {
    /* Evitar duplicado */
    const exists = UsersState.memberships.find(
      m => m.projectId === projectId && m.userId === userId
    );
    if (exists) {
      Toast.show('Este usuario ya es miembro del proyecto.', 'error');
      return false;
    }
    UsersState.memberships.push({ projectId, userId, role });
    UsersStorage.saveMembers(UsersState.memberships);
    return true;
  },

  /** Cambiar rol de miembro */
  
  changeRole(projectId, userId, newRole) {
    if(this.isActiveAdmin()){
      const idx = UsersState.memberships.findIndex(
        m => m.projectId === projectId && m.userId === userId
      );
      if (idx === -1) return;
      UsersState.memberships[idx].role = newRole;
      UsersStorage.saveMembers(UsersState.memberships);
    }
  },

  /** Quitar miembro de proyecto */
  removeMember(projectId, userId) {
    const project = State.projects.find(p => p.id === projectId);
    /* No puede removerse al creador */
    if (project?.creatorId === userId) {
      Toast.show('El creador del proyecto no puede ser removido.', 'error');
      return;
    }
    UsersState.memberships = UsersState.memberships.filter(
      m => !(m.projectId === projectId && m.userId === userId)
    );
    UsersStorage.saveMembers(UsersState.memberships);
    ModalMembers.refresh();
    Toast.show('Miembro removido del proyecto.', 'info');
  },

  /** Sincronizar el creator cuando se crea un proyecto */
  onProjectCreated(project) {
    const active = this.getActive();
    if (!active) return;
    /* Registrar al activo como admin del nuevo proyecto */
    this.addMember(project.id, active.id, 'admin');
  },

  /** Retorna usuarios disponibles para asignar en un proyecto */
  getMemberUsers(projectId) {
    const memberIds = this.getMembersOf(projectId).map(m => m.userId);
    /* Incluir al creador */
    const project = State.projects.find(p => p.id === projectId);
    if (project?.creatorId && !memberIds.includes(project.creatorId)) {
      memberIds.push(project.creatorId);
    }
    return memberIds.map(id => this.getById(id)).filter(Boolean);
  },

  /** Sincroniza selects de asignación en modal de tarea */
  _syncTaskAssigneeSelects() {
    const sel = document.getElementById('task-assignee');
    if (!sel) return;
    const projectId = document.getElementById('task-project')?.value;
    this._populateAssigneeSelect(sel, projectId);
  },

  _populateAssigneeSelect(selectEl, projectId) {
    if (!selectEl) return;
    const cur = selectEl.value;
    if (!projectId) {
      selectEl.innerHTML = '<option value="">— Sin asignar —</option>';
      return;
    }
    const members = this.getMemberUsers(projectId);
    selectEl.innerHTML = '<option value="">— Sin asignar —</option>' +
      members.map(u =>
        `<option value="${esc(u.id)}">${esc(u.name)}</option>`
      ).join('');
    selectEl.value = cur || '';
  },
};


// ========== REFRESCO GLOBAL TRAS CAMBIO DE USUARIO ==========
function refreshAllAfterUserChange() {
  // 1. Re-renderizar proyectos (grid/lista) y actualizar contadores
  if (typeof Renderer !== 'undefined') {
    Renderer.renderAll();
  }

  // 2. Actualizar el selector de workspace (proyecto activo en la cabecera)
  if (typeof WorkspaceSelector !== 'undefined') {
    WorkspaceSelector.populate();
    WorkspaceSelector.sync();
  }

  // 3. Actualizar Kanban
  if (typeof KanbanRenderer !== 'undefined') {
    KanbanRenderer.populateSelector();
    const kanbanTab = document.getElementById('tab-kanban');
    if (kanbanTab && kanbanTab.classList.contains('active')) {
      const currentProjectId = document.getElementById('kanban-project-selector')?.value || null;
      if (typeof KanbanState !== 'undefined') KanbanState.currentProjectId = currentProjectId;
      KanbanRenderer.renderBoard(currentProjectId);
    }
  }

  // 4. Actualizar Calendario
  if (typeof CalFilter !== 'undefined') {
    CalFilter.populate();
    const calTab = document.getElementById('tab-calendar');
    if (calTab && calTab.classList.contains('active') && typeof CalendarModule !== 'undefined') {
      CalendarModule.onEnter();
    }
  }

  // 5. Actualizar Estadísticas
  if (typeof StatsModule !== 'undefined') {
    StatsModule._populateFilter();
    const statsTab = document.getElementById('tab-stats');
    if (statsTab && statsTab.classList.contains('active')) {
      StatsModule.render();
    }
  }

  // 6. Actualizar panel de Usuarios (ya se hace en setActive, pero por seguridad)
  if (typeof UsersRenderer !== 'undefined') {
    UsersRenderer.renderAll();
  }

  // 7. Actualizar la barra lateral (avatar, nombre y rol contextual)
  if (typeof UsersSidebar !== 'undefined') {
    UsersSidebar.update();
  }

  // 8. Actualizar el rol contextual (fixes.js)
  if (typeof setRoleContext === 'function') {
    const contextProject = (typeof WorkspaceState !== 'undefined') ? WorkspaceState.projectId : null;
    setRoleContext(contextProject);
  }

  // 9. Opcional: forzar la actualización de las tarjetas de proyecto (los botones de editar/eliminar)
  //    Esto ya lo hace Renderer.renderAll() gracias al patch de fixes.js
}

/* ─────────────────────────────────────────────
   4. RENDERER DE USUARIOS
───────────────────────────────────────────── */
const UsersRenderer = {

  renderAll() {
    this.renderBanner();
    this.renderDirectory();
    this.renderMyTasks();
    this.renderAllTasks();
    this._updateAllTasksFilters();
  },

  /* ── 4a. Banner de usuario activo ── */
  renderBanner() {
    const container = document.getElementById('active-user-banner');
    if (!container) return;

    const user = UserManager.getActive();
    if (!user) {
      container.innerHTML = `
        <div style="flex:1; color:var(--text-muted); font-size:.85rem">
          No hay usuario activo.
          <button class="btn-link" onclick="openModal('modal-switch-user')">Seleccionar perfil →</button>
        </div>`;
      return;
    }

    /* Métricas del usuario activo */
    const myTasks    = KanbanState.tasks.filter(t => t.assigneeId === user.id);
    const myPending  = myTasks.filter(t => t.status !== 'terminado').length;
    const myDone     = myTasks.filter(t => t.status === 'terminado').length;

    /* FIX 4: NO mostrar badge de rol aquí. La etiqueta de rol depende del proyecto
       seleccionado y se muestra solo en la barra lateral cuando hay contexto de proyecto. */

    container.innerHTML = `
      <div class="aub-avatar" style="background:${esc(user.color)}">${esc(user.initials)}</div>
      <div class="aub-info">
        <div class="aub-greeting">Usuario activo</div>
        <div class="aub-name">${esc(user.name)}</div>
      </div>
      <div class="aub-stats">
        <div class="aub-stat">
          <span class="aub-stat-val">${myPending}</span>
          <span class="aub-stat-lbl">Pendientes</span>
        </div>
        <div class="aub-stat">
          <span class="aub-stat-val">${myDone}</span>
          <span class="aub-stat-lbl">Completadas</span>
        </div>
        <div class="aub-stat">
          <span class="aub-stat-val">${myTasks.length}</span>
          <span class="aub-stat-lbl">Totales</span>
        </div>
      </div>
      <div class="aub-actions">
        <button class="btn-secondary btn-sm" onclick="openModal('modal-switch-user')">
          Cambiar perfil
        </button>
      </div>`;
  },

  /* ── 4b. Directorio de usuarios ── */
  renderDirectory() {
    const grid = document.getElementById('users-grid');
    if (!grid) return;

    const q     = (UsersState.searchQuery || '').toLowerCase();
    const users = UsersState.users.filter(u =>
      !q || u.name.toLowerCase().includes(q)
    );

    if (UsersState.users.length === 0) {
      grid.innerHTML = `
        <div class="users-empty" style="grid-column:1/-1">
          <span class="users-empty-icon">👤</span>
          <h3 class="users-empty-title">Sin usuarios</h3>
          <p class="users-empty-desc">Crea el primer perfil para poder asignar tareas y gestionar proyectos.</p>
          <button class="btn-primary" onclick="ModalUser.openCreate()">+ Crear Primer Usuario</button>
        </div>`;
      return;
    }

    if (users.length === 0) {
      grid.innerHTML = `<p class="empty-search-msg" style="grid-column:1/-1">
        Sin resultados para "<strong>${esc(UsersState.searchQuery)}</strong>".</p>`;
      return;
    }

    grid.innerHTML = users.map(u => this._buildUserCard(u)).join('') +
      `<button class="user-card user-card-new" onclick="ModalUser.openCreate()">
         <span class="new-card-icon">+</span>
         <span class="new-card-label">Agregar Usuario</span>
       </button>`;

    this._bindCardEvents(grid);
  },

  _buildUserCard(u) {
    const isActive  = u.id === UsersState.activeUserId;
    const taskCount = KanbanState.tasks.filter(t => t.assigneeId === u.id).length;
    const doneCount = KanbanState.tasks.filter(t => t.assigneeId === u.id && t.status === 'terminado').length;
    const pendCount = KanbanState.tasks.filter(t => t.assigneeId === u.id && t.status !== 'terminado').length;

    /* FIX 4: La etiqueta de rol NO se muestra en el directorio (solo en contexto de proyecto).
       Solo mostramos si el usuario es creador de algún proyecto, sin etiqueta de rol dentro del directorio. */

    const activeIndicator = isActive
      ? `<span class="active-indicator" title="Usuario activo"></span>` : '';
    const switchBtn = isActive
      ? `<span style="font-size:.72rem;color:var(--success);font-weight:700">✓ Activo</span>`
      : `<button class="btn-switch-to" data-switch-id="${esc(u.id)}">Usar este perfil</button>`;

    /* FIX 5: el botón editar solo aparece si es el usuario activo */
    const canEdit = isActive;
    const editBtn = canEdit
      ? `<button class="btn-icon btn-edit-user" data-id="${esc(u.id)}" aria-label="Editar">✎</button>`
      : '';
    /* Eliminar solo si no es el usuario activo (o si activo es admin de algún proyecto) */
    const activeUser = UserManager.getActive();
    const activeIsAdmin = activeUser && (
      State.projects.some(p => p.creatorId === activeUser.id) ||
      UsersState.memberships.some(m => m.userId === activeUser.id && m.role === 'admin')
    );
    const deleteBtn = (u.id !== UsersState.activeUserId && activeIsAdmin)
      ? `<button class="btn-icon btn-delete-user" data-id="${esc(u.id)}" aria-label="Eliminar">✕</button>`
      : u.id === UsersState.activeUserId
      ? '' /* no se puede eliminar a uno mismo */
      : '';

    return `
      <div class="user-card${isActive ? ' is-active-user' : ''}" data-user-id="${esc(u.id)}">
        ${activeIndicator}
        <div class="user-card-avatar" style="--av-clr:${esc(u.color)}">${esc(u.initials)}</div>
        <div class="user-card-info">
          <h3 class="user-card-name">${esc(u.name)}</h3>
          <span class="user-card-stat">
            📋 ${taskCount} tarea${taskCount !== 1 ? 's' : ''}
            · ✅ ${doneCount} completada${doneCount !== 1 ? 's' : ''}
            · ⏳ ${pendCount} pendiente${pendCount !== 1 ? 's' : ''}
          </span>
          <div style="margin-top:6px">${switchBtn}</div>
        </div>
        <div class="user-card-actions">
          ${editBtn}
          ${deleteBtn}
        </div>
      </div>`;
  },

  _bindCardEvents(grid) {
    grid.querySelectorAll('.btn-edit-user').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        ModalUser.openEdit(btn.dataset.id);
      })
    );
    grid.querySelectorAll('.btn-delete-user').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        UserManager.confirmDelete(btn.dataset.id);
      })
    );
    grid.querySelectorAll('.btn-switch-to').forEach(btn =>
      btn.addEventListener('click', e => {
        e.stopPropagation();
        UserManager.setActive(btn.dataset.switchId);
        UsersRenderer.renderDirectory();
      })
    );
  },

  /* ── 4c. Mis Tareas ── */
  renderMyTasks() {
    const header  = document.getElementById('my-tasks-header');
    const listEl  = document.getElementById('my-tasks-list');
    if (!header || !listEl) return;

    const user = UserManager.getActive();

    if (!user) {
      header.innerHTML = `<div style="color:var(--text-muted);font-size:.84rem">
        Selecciona un perfil para ver tus tareas.
        <button class="btn-link" onclick="openModal('modal-switch-user')">Seleccionar →</button>
      </div>`;
      listEl.innerHTML = '';
      return;
    }

    header.innerHTML = `
      <div class="mth-avatar" style="background:${esc(user.color)}">${esc(user.initials)}</div>
      <div>
        <div class="mth-name">Hola, ${esc(user.name)} 👋</div>
        <div class="mth-sub">Estas son tus tareas asignadas</div>
      </div>`;

    const statusFilter   = document.getElementById('mytasks-status-filter')?.value   || '';
    const priorityFilter = document.getElementById('mytasks-priority-filter')?.value || '';

    let tasks = KanbanState.tasks.filter(t => t.assigneeId === user.id);
    if (statusFilter)   tasks = tasks.filter(t => t.status   === statusFilter);
    if (priorityFilter) tasks = tasks.filter(t => t.priority === priorityFilter);

    /* Ordenar: primero las pendientes, luego en progreso, luego terminadas */
    const ORDER = { pendiente: 0, 'en-progreso': 1, terminado: 2 };
    tasks.sort((a, b) => (ORDER[a.status]||0) - (ORDER[b.status]||0));

    if (tasks.length === 0) {
      listEl.innerHTML = `
        <div class="users-empty">
          <span class="users-empty-icon">✓</span>
          <h3 class="users-empty-title">Sin tareas asignadas</h3>
          <p class="users-empty-desc">${statusFilter || priorityFilter
            ? 'No hay tareas con los filtros seleccionados.'
            : '¡Todo en orden! No tienes tareas pendientes.'}</p>
        </div>`;
      return;
    }

    listEl.innerHTML = tasks.map(t => this._buildTaskRow(t, false)).join('');
  },

  /* ── 4d. Todas las tareas ── */
  renderAllTasks() {
    const listEl = document.getElementById('all-tasks-list');
    if (!listEl) return;

    const projectFilter = document.getElementById('alltasks-project-filter')?.value || '';
    const statusFilter  = document.getElementById('alltasks-status-filter')?.value  || '';
    const userFilter    = document.getElementById('alltasks-user-filter')?.value    || '';

    let tasks = [...KanbanState.tasks];
    if (projectFilter) tasks = tasks.filter(t => t.projectId === projectFilter);
    if (statusFilter)  tasks = tasks.filter(t => t.status    === statusFilter);
    if (userFilter)    tasks = tasks.filter(t => t.assigneeId === userFilter);

    const ORDER = { pendiente: 0, 'en-progreso': 1, terminado: 2 };
    tasks.sort((a, b) => (ORDER[a.status]||0) - (ORDER[b.status]||0));

    if (tasks.length === 0) {
      listEl.innerHTML = `
        <div class="users-empty">
          <span class="users-empty-icon">📋</span>
          <h3 class="users-empty-title">Sin tareas</h3>
          <p class="users-empty-desc">No hay tareas que coincidan con los filtros.</p>
        </div>`;
      return;
    }

    listEl.innerHTML = tasks.map(t => this._buildTaskRow(t, true)).join('');
  },

  /** Construye una fila de tarea en la lista */
  _buildTaskRow(task, showAssignee) {
    const PRIORITY_COLORS = { alta: '#fc5c65', media: '#f7b731', baja: '#20bf6b' };
    const STATUS_LABELS   = { pendiente: 'Pendiente', 'en-progreso': 'En Progreso', terminado: 'Terminado' };
    const STATUS_CLASSES  = { pendiente: 'status-pending-chip', 'en-progreso': 'status-progress-chip', terminado: 'status-done-chip' };
    const PRIORITY_LABELS_LOCAL = { alta: 'Alta', media: 'Media', baja: 'Baja' };

    const project  = State.projects.find(p => p.id === task.projectId);
    const assignee = showAssignee ? UserManager.getById(task.assigneeId) : null;
    const isDone   = task.status === 'terminado';

    const days = task.deadline ? daysUntil(task.deadline) : null;
    let dueHtml = '';
    if (task.deadline) {
      let cls  = 'tlr-due';
      let text = `📅 ${formatDate(task.deadline)}`;
      if (days !== null && days < 0 && !isDone)       { cls += ' overdue'; text = `⚠ Venció (${Math.abs(days)}d)`; }
      else if (days !== null && days === 0 && !isDone) { cls += ' soon';    text = '⏰ Vence hoy'; }
      else if (days !== null && days <= 3 && !isDone)  { cls += ' soon';    text = `⏰ En ${days}d`; }
      dueHtml = `<span class="${cls}">${text}</span>`;
    }

    const projectChip = project
      ? `<span class="tlr-project-chip" style="background:${esc(project.color)}22;color:${esc(project.color)}">
           ${esc(project.icon||'🗂')} ${esc(project.name)}
         </span>`
      : '';

    const assigneeHtml = showAssignee && assignee
      ? `<span class="task-assignee-chip">
           <span class="task-assignee-avatar" style="background:${esc(assignee.color)}">${esc(assignee.initials)}</span>
           ${esc(assignee.name)}
         </span>`
      : showAssignee
      ? `<span class="task-assignee-chip" style="color:var(--text-muted)">Sin asignar</span>`
      : '';

    return `
      <div class="task-list-row${isDone ? ' done' : ''}">
        <div class="tlr-priority-bar"
             style="background:${PRIORITY_COLORS[task.priority] || '#aaa'}"></div>
        <div class="tlr-body">
          <div class="tlr-name">${esc(task.name)}</div>
          ${task.desc ? `<div class="tlr-desc">${esc(task.desc)}</div>` : ''}
          <div class="tlr-meta">
            ${projectChip}
            ${dueHtml}
            ${assigneeHtml}
          </div>
        </div>
        <div class="tlr-right">
          <span class="task-list-status ${STATUS_CLASSES[task.status] || ''}">
            ${STATUS_LABELS[task.status] || task.status}
          </span>
          <span class="priority-badge priority-${task.priority||'baja'}" style="font-size:.65rem">
            ${PRIORITY_LABELS_LOCAL[task.priority] || '—'}
          </span>
        </div>
      </div>`;
  },

  /** Actualiza los selects de filtros en "Todas las Tareas" */
  _updateAllTasksFilters() {
    const projectSel = document.getElementById('alltasks-project-filter');
    if (projectSel) {
      const cur = projectSel.value;
      projectSel.innerHTML = '<option value="">Todos los proyectos</option>' +
        State.projects.map(p =>
          `<option value="${esc(p.id)}">${esc(p.name)}</option>`
        ).join('');
      projectSel.value = cur;
    }
    const userSel = document.getElementById('alltasks-user-filter');
    if (userSel) {
      const cur = userSel.value;
      userSel.innerHTML = '<option value="">Todos los miembros</option>' +
        UsersState.users.map(u =>
          `<option value="${esc(u.id)}">${esc(u.name)}</option>`
        ).join('');
      userSel.value = cur;
    }
  },
};

/* ─────────────────────────────────────────────
   5. SIDEBAR — actualiza el switcher de perfil
───────────────────────────────────────────── */
const UsersSidebar = {
  update(projectId) {
    const user = UserManager.getActive();

    const avatarEl  = document.getElementById('current-user-avatar');
    const nameEl    = document.getElementById('current-user-name');
    const roleEl    = document.getElementById('current-user-role');

    if (!user) {
      if (avatarEl)  avatarEl.textContent  = '?';
      if (nameEl)    nameEl.textContent    = 'Sin perfil';
      if (roleEl)    roleEl.textContent    = '—';
      if (avatarEl)  avatarEl.style.background = 'var(--border)';
      return;
    }

    if (avatarEl) {
      avatarEl.textContent = user.initials;
      avatarEl.style.background = user.color;
    }
    if (nameEl) nameEl.textContent = user.name;

    /* FIX 4: mostrar rol solo si hay un proyecto seleccionado en contexto
       (kanban-project-selector) o si se pasa projectId explícitamente */
    const selectedProject = projectId ||
      document.getElementById('kanban-project-selector')?.value || null;

    if (!selectedProject) {
      if (roleEl) roleEl.textContent = '';   /* sin etiqueta sin contexto de proyecto */
      return;
    }

    const project   = State.projects.find(p => p.id === selectedProject);
    const isCreator = project?.creatorId === user.id;
    const memRole   = UsersState.memberships.find(
      m => m.projectId === selectedProject && m.userId === user.id
    )?.role;
    const isAdmin   = isCreator || memRole === 'admin';

    if (roleEl) roleEl.textContent = isAdmin ? '🔑 Administrador' : '👤 Miembro';
  },
};

/* ─────────────────────────────────────────────
   6. MODAL DE USUARIO
───────────────────────────────────────────── */
const ModalUser = {
  init() {
    /* Vista previa de iniciales en tiempo real */
    document.getElementById('user-name-input')?.addEventListener('input', () => {
      const val = document.getElementById('user-name-input').value;
      const prev = document.getElementById('user-avatar-preview');
      if (prev) {
        const ini = initials(val) || '?';
        prev.textContent = ini;
        prev.style.background = val.trim() ? avatarColor(val.trim()) : 'var(--border)';
      }
    });

    document.getElementById('btn-save-user')?.addEventListener('click',   () => this.save());
    document.getElementById('btn-cancel-user')?.addEventListener('click', () => this.close());
    document.getElementById('close-modal-user')?.addEventListener('click',() => this.close());
    document.getElementById('user-name-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.save();
    });
  },

  openCreate() {
    UsersState.editingUserId = null;
    document.getElementById('modal-user-title').textContent = 'Nuevo Usuario';
    document.getElementById('btn-save-user').textContent    = 'Crear Usuario';
    this._reset();
    openModal('modal-user');
  },

  openEdit(userId) {
    const u = UserManager.getById(userId);
    if (!u) return;
    UsersState.editingUserId = userId;
    document.getElementById('modal-user-title').textContent = 'Editar Usuario';
    document.getElementById('btn-save-user').textContent    = 'Guardar Cambios';
    document.getElementById('user-name-input').value        = u.name;
    const prev = document.getElementById('user-avatar-preview');
    if (prev) { prev.textContent = u.initials; prev.style.background = u.color; }
    document.getElementById('error-user-name').textContent = '';
    openModal('modal-user');
  },

  save() {
    const nameVal = (document.getElementById('user-name-input')?.value || '').trim();
    const errEl   = document.getElementById('error-user-name');

    if (!nameVal) {
      if (errEl) errEl.textContent = 'El nombre es obligatorio.';
      return;
    }
    if (nameVal.length < 2) {
      if (errEl) errEl.textContent = 'El nombre debe tener al menos 2 caracteres.';
      return;
    }
    /* Verificar duplicado */
    const dup = UsersState.users.find(
      u => u.name.toLowerCase() === nameVal.toLowerCase() && u.id !== UsersState.editingUserId
    );
    if (dup) {
      if (errEl) errEl.textContent = `Ya existe un usuario llamado "${nameVal}".`;
      return;
    }
    if (errEl) errEl.textContent = '';

    if (UsersState.editingUserId) {
      UserManager.update(UsersState.editingUserId, nameVal);
    } else {
      UserManager.create(nameVal);
    }
    this.close();
  },

  close() {
    UsersState.editingUserId = null;
    this._reset();
    closeModal('modal-user');
  },

  _reset() {
    const inp = document.getElementById('user-name-input');
    if (inp) inp.value = '';
    const prev = document.getElementById('user-avatar-preview');
    if (prev) { prev.textContent = '?'; prev.style.background = 'var(--border)'; }
    const err = document.getElementById('error-user-name');
    if (err) err.textContent = '';
  },
};

/* ─────────────────────────────────────────────
   7. MODAL SWITCH USER (selector de perfil activo)
───────────────────────────────────────────── */
const ModalSwitchUser = {
  open() {
    this.render();
    openModal('modal-switch-user');
  },

  render() {
    const list = document.getElementById('switch-user-list');
    if (!list) return;
    const users = UsersState.users;
    if (users.length === 0) {
      list.innerHTML = `<div class="users-empty">
        <p>No hay usuarios creados aún.</p>
        <button class="btn-primary btn-sm" onclick="closeModal('modal-switch-user');ModalUser.openCreate()">
          Crear usuario →
        </button>
      </div>`;
      return;
    }
    list.innerHTML = users.map(u => {
      const isActive = u.id === UsersState.activeUserId;
      return `
        <div class="switch-user-item${isActive ? ' active-profile' : ''}"
             data-uid="${esc(u.id)}">
          <div class="member-row-avatar" style="background:${esc(u.color)};width:34px;height:34px;font-size:.7rem">
            ${esc(u.initials)}
          </div>
          <span class="switch-user-item-name">${esc(u.name)}</span>
          ${isActive ? `<span class="switch-user-item-check">✓</span>` : ''}
        </div>`;
    }).join('');

    list.querySelectorAll('.switch-user-item').forEach(item => {
      item.addEventListener('click', () => {
        UserManager.setActive(item.dataset.uid);
        this.render();
        UsersRenderer.renderAll();
      });
    });
  },
};

/* ─────────────────────────────────────────────
   8. MODAL GESTIONAR MIEMBROS (RF20)
───────────────────────────────────────────── */
const ModalMembers = {
  open(projectId) {
    UsersState.membersProjectId = projectId;
    const project = State.projects.find(p => p.id === projectId);
    const lbl = document.getElementById('modal-members-title');
    if (lbl && project) lbl.textContent = `Miembros — ${project.name}`;
    this.refresh();
    openModal('modal-members');
  },

  refresh() {
    const projectId = UsersState.membersProjectId;
    if (!projectId) return;

    const project     = State.projects.find(p => p.id === projectId);
    const membersSel  = document.getElementById('member-select');
    const currentEl   = document.getElementById('members-current');
    const projectLbl  = document.getElementById('members-project-label');

    if (projectLbl && project)
      projectLbl.textContent = `Gestiona quién tiene acceso al proyecto "${project.name}".`;

    /* Miembros actuales */
    const members = UsersState.memberships.filter(m => m.projectId === projectId);
    /* Incluir creador si no está en membresías */
    const allMemberIds = [...new Set([
      ...(project?.creatorId ? [project.creatorId] : []),
      ...members.map(m => m.userId)
    ])];

    if (currentEl) {
      if (allMemberIds.length === 0) {
        currentEl.innerHTML = `<p style="color:var(--text-muted);font-size:.82rem">Sin miembros aún.</p>`;
      } else {
        currentEl.innerHTML = allMemberIds.map(uid => {
          const u    = UserManager.getById(uid);
          if (!u) return '';
          const isCreator = project?.creatorId === uid;
          const memEntry  = members.find(m => m.userId === uid);
          const role      = isCreator ? 'admin' : (memEntry?.role || 'member');
          const roleLabel = role === 'admin' ? '🔑 Admin' : '👤 Miembro';
          const cls       = role === 'admin' ? 'admin' : 'member';
          const canRemove = !isCreator;
          const canToggle = !isCreator;

          return `
            <div class="member-row">
              <div class="member-row-avatar" style="background:${esc(u.color)}">${esc(u.initials)}</div>
              <span class="member-row-name">${esc(u.name)}${isCreator ? ' <em style="font-size:.68rem;color:var(--text-muted)">(creador)</em>' : ''}</span>
              <span class="member-row-role ${cls}">${roleLabel}</span>
              <div class="member-row-actions">
                ${canToggle ? `<button class="btn-icon btn-toggle-role" data-uid="${esc(uid)}"
                  title="${role === 'admin' ? 'Cambiar a miembro' : 'Promover a admin'}"
                  style="color:var(--text-muted)">⇅</button>` : ''}
                ${canRemove ? `<button class="btn-icon btn-remove-member" data-uid="${esc(uid)}"
                  aria-label="Quitar del proyecto" style="color:var(--danger)">✕</button>` : ''}
              </div>
            </div>`;
        }).join('');

        /* Bind toggle/remove */
        currentEl.querySelectorAll('.btn-toggle-role').forEach(btn => {
          btn.addEventListener('click', () => {
            const memEntry = UsersState.memberships.find(
              m => m.projectId === projectId && m.userId === btn.dataset.uid
            );
            const newRole = memEntry?.role === 'admin' ? 'member' : 'admin';
            UserManager.changeRole(projectId, btn.dataset.uid, newRole);
            this.refresh();
            UsersSidebar.update();
          });
        });
        currentEl.querySelectorAll('.btn-remove-member').forEach(btn => {
          btn.addEventListener('click', () => UserManager.removeMember(projectId, btn.dataset.uid));
        });
      }
    }

    /* Populate select de nuevos miembros (excluir ya miembros) */
    if (membersSel) {
      const nonMembers = UsersState.users.filter(u => !allMemberIds.includes(u.id));
      membersSel.innerHTML = '<option value="">— Seleccionar —</option>' +
        nonMembers.map(u => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    }
  },
};

/* ─────────────────────────────────────────────
   9. PATCH — tasks.js: assignee en tarjetas Kanban
───────────────────────────────────────────── */
function _patchKanbanCards() {
  /* Inyectar assignee chip en las tarjetas del tablero al renderizar */
  const origBuildCard = KanbanRenderer._buildCard.bind(KanbanRenderer);
  KanbanRenderer._buildCard = function(task) {
    let html = origBuildCard(task);
    /* Agregar chip de assignee antes del cierre de task-card-footer */
    if (task.assigneeId) {
      const user = UserManager.getById(task.assigneeId);
      if (user) {
        const chip = `<span class="task-assignee-chip">
          <span class="task-assignee-avatar" style="background:${esc(user.color)}">${esc(user.initials)}</span>
          ${esc(user.name)}
        </span>`;
        /* Insertar dentro del footer si existe, o crear uno */
        if (html.includes('class="task-card-footer"')) {
          html = html.replace('</div>\n      </div>', `${chip}</div>\n      </div>`);
        } else {
          html = html.replace('</div>', `<div class="task-card-footer">${chip}</div></div>`);
        }
      }
    }
    return html;
  };
}

/* ─────────────────────────────────────────────
   10. PATCH — app.js: al crear proyecto, registrar creator
───────────────────────────────────────────── */
function _patchProjectCreate() {
  const origCreate = ProjectManager.create.bind(ProjectManager);
  ProjectManager.create = function(data) {
    // Llamar a la función original (crea el proyecto sin creatorId)
    origCreate(data);
    
    // Obtener el proyecto recién creado (normalmente el primero)
    const newProject = State.projects[0];
    if (newProject && UsersState.activeUserId) {
      // Añadir creatorId y membresía
      newProject.creatorId = UsersState.activeUserId;
      Storage.save(State.projects);
      UserManager.addMember(newProject.id, UsersState.activeUserId, 'admin');
      
      // 🔥 Forzar re-render para que el proyecto aparezca inmediatamente
      Renderer.renderAll();
      
      // Actualizar la barra lateral (por si cambia el rol)
      UsersSidebar.update();
    }
  };
}

/* ─────────────────────────────────────────────
   11. PATCH — tasks.js: getFormData incluye assigneeId
───────────────────────────────────────────── */
function _patchTaskModal() {
  /* Al cambiar proyecto en modal de tarea, recargar select de asignados */
  document.getElementById('task-project')?.addEventListener('change', () => {
    const projectId = document.getElementById('task-project')?.value;
    UserManager._populateAssigneeSelect(
      document.getElementById('task-assignee'), projectId
    );
  });

  /* Patch de getFormData */
  const origGet = ModalTask.getFormData.bind(ModalTask);
  ModalTask.getFormData = function() {
    const data = origGet();
    data.assigneeId = document.getElementById('task-assignee')?.value || null;
    return data;
  };

  /* Patch de openEdit para cargar el assignee */
  const origEdit = ModalTask.openEdit.bind(ModalTask);
  ModalTask.openEdit = function(task) {
    origEdit(task);
    /* Populate assignees para el proyecto de la tarea */
    const assigneeSel = document.getElementById('task-assignee');
    UserManager._populateAssigneeSelect(assigneeSel, task.projectId);
    if (assigneeSel) assigneeSel.value = task.assigneeId || '';
  };

  /* Patch de openCreate para cargar el assignee */
  const origCreate = ModalTask.openCreate.bind(ModalTask);
  ModalTask.openCreate = function(status, projectId) {
    origCreate(status, projectId);
    const assigneeSel = document.getElementById('task-assignee');
    UserManager._populateAssigneeSelect(assigneeSel, projectId);
    /* Preseleccionar al usuario activo */
    if (assigneeSel && UsersState.activeUserId) {
      if ([...assigneeSel.options].some(o => o.value === UsersState.activeUserId)) {
        assigneeSel.value = UsersState.activeUserId;
      }
    }
  };

  /* Patch de save en TaskManager para guardar assigneeId */
  const origTCreate = TaskManager.create.bind(TaskManager);
  TaskManager.create = function(data) {
    origTCreate(data);
    /* Agregar assigneeId al último task creado */
    if (data.assigneeId && KanbanState.tasks.length > 0) {
      KanbanState.tasks[0].assigneeId = data.assigneeId || null;
      TaskStorage.save(KanbanState.tasks);
    }
    UsersRenderer.renderMyTasks();
    UsersRenderer.renderAllTasks();
  };

  const origTUpdate = TaskManager.update.bind(TaskManager);
  TaskManager.update = function(id, data) {
    origTUpdate(id, data);
    const idx = KanbanState.tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      KanbanState.tasks[idx].assigneeId = data.assigneeId || null;
      TaskStorage.save(KanbanState.tasks);
    }
    UsersRenderer.renderMyTasks();
    UsersRenderer.renderAllTasks();
  };
}

/* ─────────────────────────────────────────────
   12. PATCH — Kanban: botón "Gestionar Miembros" en toolbar
───────────────────────────────────────────── */
function _injectMembersButton() {
  /* Agregar botón junto al selector de proyecto en el kanban */
  const kanbanRight = document.querySelector('#tab-kanban .toolbar-right');
  if (!kanbanRight) return;
  const btn = document.createElement('button');
  btn.className   = 'btn-secondary btn-sm';
  btn.id          = 'btn-manage-members';
  btn.textContent = '👥 Miembros';
  btn.disabled    = true;
  kanbanRight.insertBefore(btn, kanbanRight.firstChild);

  btn.addEventListener('click', () => {
    const projectId = document.getElementById('kanban-project-selector')?.value;
    if (projectId) ModalMembers.open(projectId);
  });

  /* Habilitar cuando hay proyecto seleccionado */
  document.getElementById('kanban-project-selector')?.addEventListener('change', () => {
    const projectId = document.getElementById('kanban-project-selector')?.value;
    btn.disabled    = !projectId;
    /* También update assignees en task modal */
    const assigneeSel = document.getElementById('task-assignee');
    UserManager._populateAssigneeSelect(assigneeSel, projectId);
  });
}

/* ─────────────────────────────────────────────
   13. PESTAÑAS INTERNAS DE USUARIOS
───────────────────────────────────────────── */
function _initUsersTabs() {
  document.querySelectorAll('.users-tab-btn[data-utab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.utab;
      UsersState.activeTab = tab;

      document.querySelectorAll('.users-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.users-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`upanel-${tab}`)?.classList.add('active');

      if (tab === 'my-tasks')   UsersRenderer.renderMyTasks();
      if (tab === 'all-tasks')  { UsersRenderer._updateAllTasksFilters(); UsersRenderer.renderAllTasks(); }
    });
  });

  /* Filtros */
  ['mytasks-status-filter','mytasks-priority-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => UsersRenderer.renderMyTasks());
  });
  ['alltasks-project-filter','alltasks-status-filter','alltasks-user-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => UsersRenderer.renderAllTasks());
  });

  /* Búsqueda en directorio */
  const search = document.getElementById('search-users');
  let timer;
  search?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      UsersState.searchQuery = search.value;
      UsersRenderer.renderDirectory();
    }, 250);
  });
}

/* ─────────────────────────────────────────────
   14. PATCH — TabManager: refrescar al entrar
───────────────────────────────────────────── */
function _patchTabManager() {
  const orig = TabManager.switchTo.bind(TabManager);
  TabManager.switchTo = function(tabId) {
    orig(tabId);
    if (tabId === 'users') {
      UsersRenderer.renderAll();
    }
  };
}

/* ─────────────────────────────────────────────
   15. INICIALIZACIÓN
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* Aplicar patches */
  _patchKanbanCards();
  _patchProjectCreate();
  _patchTaskModal();
  _injectMembersButton();
  _patchTabManager();
  _initUsersTabs();

  /* Modal de usuario */
  ModalUser.init();

  /* Botón "+ Nuevo Usuario" */
  document.getElementById('btn-new-user')?.addEventListener('click', () => ModalUser.openCreate());

  /* Switcher de usuario en sidebar */
  document.getElementById('user-switcher')?.addEventListener('click', () => ModalSwitchUser.open());
  document.getElementById('btn-switch-user')?.addEventListener('click', e => {
    e.stopPropagation();
    ModalSwitchUser.open();
  });

  /* Modal switch: cerrar */
  document.getElementById('close-modal-switch')?.addEventListener('click', () => closeModal('modal-switch-user'));

  /* Modal members: botón agregar */
  document.getElementById('btn-add-member')?.addEventListener('click', () => {
    const userId    = document.getElementById('member-select')?.value;
    const role      = document.getElementById('member-role-select')?.value || 'member';
    const errEl     = document.getElementById('error-add-member');
    const projectId = UsersState.membersProjectId;

    if (!userId) {
      if (errEl) errEl.textContent = 'Selecciona un usuario.';
      return;
    }
    if (errEl) errEl.textContent = '';

    const ok = UserManager.addMember(projectId, userId, role);
    if (ok) {
      ModalMembers.refresh();
      const u = UserManager.getById(userId);
      Toast.show(`${u?.name} agregado al proyecto.`, 'success');
    }
  });
  document.getElementById('btn-close-members')?.addEventListener('click', () => closeModal('modal-members'));
  document.getElementById('close-modal-members')?.addEventListener('click', () => closeModal('modal-members'));

  /* Patch de Renderer.renderAll para refrescar vista de tareas */
  const _orig = Renderer.renderAll.bind(Renderer);
  Renderer.renderAll = function() {
    _orig();
    UsersSidebar.update();
    const usersTab = document.getElementById('tab-users');
    if (usersTab?.classList.contains('active')) UsersRenderer.renderAll();
  };

  /* Render inicial */
  UsersRenderer.renderAll();
  UsersSidebar.update();
});
