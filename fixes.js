/* ═══════════════════════════════════════════════════════════
   TASKFLOW — fixes.js  v3.0
   Se carga DESPUÉS de todos los demás scripts.

   Fix A  — Dashboard solo muestra datos de proyectos del usuario
   Fix B  — Modal de tarea: solo proyectos del usuario activo
   Fix C  — Tarjetas de proyecto: sección de miembros + agregar miembro
   Fix D  — Kanban: columnas personalizadas por proyecto
   Fix E  — Tareas pendientes se actualizan al cambiar de proyecto
   (previas) F-J: borrar proyecto, visibilidad, permisos, rol, edit usuario
                  editar tarea + etiqueta, asignar solo admins
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   HELPER — proyectos visibles del usuario activo
───────────────────────────────────────────── */
function _userProjects() {
  const activeId = UsersState.activeUserId;
  if (!activeId) return State.projects;
  return State.projects.filter(p =>
    p.creatorId === activeId ||
    UsersState.memberships.some(m => m.userId === activeId && m.projectId === p.id)
  );
}

/* ─────────────────────────────────────────────
   FIX A — Dashboard: datos solo de proyectos del usuario
───────────────────────────────────────────── */
(function patchDashboardData() {
  const origGet = DashData.get.bind(DashData);
  DashData.get = function() {
    const data = origGet();
    const visibleProjects = _userProjects();
    const visibleIds      = new Set(visibleProjects.map(p => p.id));

    /* Filtrar tareas a solo las de proyectos visibles */
    const myTasks   = KanbanState.tasks.filter(t => visibleIds.has(t.projectId));
    const today     = new Date(); today.setHours(0, 0, 0, 0);
    const weekEnd   = new Date(today); weekEnd.setDate(today.getDate() + 6);

    const totalPending = myTasks.filter(t => t.status === 'pendiente').length;
    const totalDone    = myTasks.filter(t => t.status === 'terminado').length;

    const overdueTasks = myTasks.filter(t => {
      if (!t.deadline || t.status === 'terminado') return false;
      const [y, m, d] = t.deadline.split('-').map(Number);
      return new Date(y, m - 1, d) < today;
    });

    const weekTasks = myTasks.filter(t => {
      if (!t.deadline) return false;
      const [y, m, d] = t.deadline.split('-').map(Number);
      const td = new Date(y, m - 1, d);
      return td >= today && td <= weekEnd;
    }).sort((a, b) => a.deadline.localeCompare(b.deadline));

    /* Proyecto activo del workspace */
    const projectId  = WorkspaceState.projectId;
    const project    = WorkspaceState.project();
    const scopeTasks = projectId
      ? myTasks.filter(t => t.projectId === projectId)
      : myTasks;
    const scopeDone  = scopeTasks.filter(t => t.status === 'terminado').length;
    const scopeTotal = scopeTasks.length;
    const scopePct   = scopeTotal === 0 ? 0 : Math.round((scopeDone / scopeTotal) * 100);

    return {
      ...data,
      allProjects:  visibleProjects,        /* ← solo proyectos del usuario */
      totalPending,
      totalDone,
      overdueTasks,
      weekTasks,
      scopeProject: project,
      scopeDone,
      scopeTotal,
      scopePct,
    };
  };
})();

/* ─────────────────────────────────────────────
   FIX B — Modal de tarea: solo proyectos del usuario
───────────────────────────────────────────── */
(function patchTaskProjectSelect() {
  const orig = ModalTask._populateProjectSelect.bind(ModalTask);
  ModalTask._populateProjectSelect = function() {
    const sel = document.getElementById('task-project');
    if (!sel) return;
    const projects = _userProjects();
    sel.innerHTML = '<option value="">— Seleccionar proyecto —</option>' +
      projects.map(p =>
        `<option value="${esc(p.id)}">${esc(p.icon || '🗂')} ${esc(p.name)}</option>`
      ).join('');
  };
})();

/* ─────────────────────────────────────────────
   FIX C — Tarjetas de proyecto: sección de miembros
───────────────────────────────────────────── */
(function patchProjectCardMembers() {
  const origBuild = Renderer.buildCard.bind(Renderer);
  Renderer.buildCard = function(p) {
    const html = origBuild(p);

    /* Obtener miembros del proyecto */
    const memberIds  = [
      ...new Set([
        ...(p.creatorId ? [p.creatorId] : []),
        ...UsersState.memberships.filter(m => m.projectId === p.id).map(m => m.userId),
      ])
    ];
    const members = memberIds.map(id => {
      const u    = UserManager.getById(id);
      if (!u) return null;
      const isCreator = p.creatorId === id;
      const mem       = UsersState.memberships.find(m => m.projectId === p.id && m.userId === id);
      const role      = isCreator ? 'admin' : (mem?.role || 'member');
      return { ...u, role, isCreator };
    }).filter(Boolean);

    const isAdmin = UserManager.isActiveAdmin(p.id);

    /* HTML de avatares de miembros */
    const avatarsHtml = members.length === 0
      ? `<span style="font-size:.74rem;color:var(--text-muted)">Sin miembros</span>`
      : members.slice(0, 5).map(m => `
          <span class="proj-member-avatar"
                style="background:${esc(m.color)}"
                title="${esc(m.name)} — ${m.role === 'admin' ? 'Admin' : 'Miembro'}">
            ${esc(m.initials)}
          </span>`).join('') +
        (members.length > 5
          ? `<span class="proj-member-more">+${members.length - 5}</span>`
          : '');

    const addBtn = isAdmin
      ? `<button class="btn-link btn-proj-add-member" data-pid="${esc(p.id)}"
             style="font-size:.74rem;margin-left:4px">+ Agregar</button>`
      : '';

    const membersSection = `
      <div class="proj-members-section">
        <div class="proj-members-avatars">${avatarsHtml}</div>
        ${addBtn}
      </div>`;

    /* Insertar la sección justo antes del cierre de project-card-body */
    return html.replace(
      /(<div class="project-card-footer">)/,
      `${membersSection}$1`
    );
  };

  /* Bind del botón "Agregar miembro" en tarjetas de proyecto */
  const origBind = Renderer.bindCardEvents.bind(Renderer);
  Renderer.bindCardEvents = function(container) {
    origBind(container);
    container.querySelectorAll('.btn-proj-add-member').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof ModalMembers !== 'undefined') {
          ModalMembers.open(btn.dataset.pid);
        }
      });
    });
  };
})();

/* ─────────────────────────────────────────────
   FIX D — Kanban: columnas personalizadas por proyecto
   Las columnas custom tienen status que empieza con "custom_"
   y NO cuentan en estadísticas.
───────────────────────────────────────────── */
(function patchKanbanCustomColumns() {

  const CUSTOM_COLS_KEY = 'taskflow_custom_cols';

  function _loadCustomCols() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_COLS_KEY) || '{}'); }
    catch { return {}; }
  }
  function _saveCustomCols(cols) {
    localStorage.setItem(CUSTOM_COLS_KEY, JSON.stringify(cols));
  }
  function _getProjectCols(projectId) {
    return _loadCustomCols()[projectId] || [];
  }

  /* ── Inyectar botón "+ Columna" en el toolbar del Kanban ── */
  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.querySelector('#tab-kanban .toolbar-right');
    if (!toolbar) return;
    const btn = document.createElement('button');
    btn.className   = 'btn-secondary btn-sm';
    btn.id          = 'btn-add-kanban-col';
    btn.textContent = '+ Columna';
    btn.disabled    = true;
    toolbar.insertBefore(btn, toolbar.firstChild);

    btn.addEventListener('click', () => {
      const pid = KanbanState.currentProjectId;
      if (!pid) return;
      const name = prompt('Nombre de la nueva columna:');
      if (!name?.trim()) return;

      const cols = _loadCustomCols();
      if (!cols[pid]) cols[pid] = [];
      const statusId = `custom_${Date.now()}`;
      cols[pid].push({ id: statusId, label: name.trim() });
      _saveCustomCols(cols);
      KanbanRenderer.renderBoard(pid);
    });

    /* Habilitar cuando hay proyecto */
    document.getElementById('kanban-project-selector')
      ?.addEventListener('change', () => {
        btn.disabled = !KanbanState.currentProjectId;
      });
  });

  /* ── Patch renderBoard: añadir columnas custom al final ── */
  const origRenderBoard = KanbanRenderer.renderBoard.bind(KanbanRenderer);
  KanbanRenderer.renderBoard = function(projectId) {
    origRenderBoard(projectId);
    if (!projectId) return;

    const board = document.getElementById('kanban-board');
    if (!board || board.style.display === 'none') return;

    /* Quitar columnas custom previas del DOM */
    board.querySelectorAll('.kanban-col[data-custom="true"]').forEach(c => c.remove());

    const customCols = _getProjectCols(projectId);
    if (customCols.length === 0) return;

    const tasks = TaskManager.getForProject(projectId);
    customCols.forEach(col => {
      const colTasks = tasks.filter(t => t.status === col.id);

      const colEl = document.createElement('div');
      colEl.className = 'kanban-col';
      colEl.dataset.status = col.id;
      colEl.dataset.custom = 'true';
      colEl.innerHTML = `
        <div class="kanban-col-header">
          <span class="col-dot" style="background:var(--text-muted)"></span>
          <h3 class="col-title">${esc(col.label)}</h3>
          <span class="col-count">${colTasks.length}</span>
          <button class="btn-icon btn-remove-custom-col"
                  data-pid="${esc(projectId)}" data-cid="${esc(col.id)}"
                  title="Eliminar columna" style="color:var(--text-muted);margin-left:auto">✕</button>
        </div>
        <div class="kanban-cards" id="cards-${esc(col.id)}"
             data-status="${esc(col.id)}"
             aria-label="Columna ${esc(col.label)}">
          ${colTasks.length === 0
            ? `<div class="kanban-col-empty"><span class="kanban-col-empty-icon">◌</span><span>Sin tareas aquí</span></div>`
            : colTasks.map(t => KanbanRenderer._buildCard(t)).join('')
          }
        </div>
        <button class="btn-add-task-col" data-status="${esc(col.id)}">+ Agregar tarea</button>`;

      /* Botón eliminar columna */
      colEl.querySelector('.btn-remove-custom-col')?.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar la columna "${col.label}"? Las tareas en ella quedarán como "Pendiente".`)) return;
        /* Mover sus tareas a pendiente */
        KanbanState.tasks = KanbanState.tasks.map(t =>
          t.status === col.id ? { ...t, status: 'pendiente' } : t
        );
        TaskStorage.save(KanbanState.tasks);
        /* Quitar columna */
        const c2 = _loadCustomCols();
        if (c2[projectId]) {
          c2[projectId] = c2[projectId].filter(c => c.id !== col.id);
          _saveCustomCols(c2);
        }
        KanbanRenderer.renderBoard(projectId);
      });

      /* Botón agregar tarea en columna custom */
      colEl.querySelector('.btn-add-task-col')?.addEventListener('click', () => {
        ModalTask.openCreate(col.id, projectId);
      });

      /* Bind eventos de tarjetas */
      const zone = colEl.querySelector('.kanban-cards');
      if (zone) KanbanRenderer._bindCardEvents(zone);

      board.appendChild(colEl);
    });

    /* Reactivar drag & drop en todas las zonas, incluidas las nuevas */
    DragDrop.bindZones();
  };

  /* ── Patch TaskManager.create: soporte para status custom ── */
  const origCreate = TaskManager.create.bind(TaskManager);
  TaskManager.create = function(data) {
    /* Si el status es custom, aceptarlo directamente */
    origCreate(data);
  };

  /* ── Patch TaskManager.move: aceptar status custom ── */
  const origMove = TaskManager.move.bind(TaskManager);
  TaskManager.move = function(taskId, newStatus) {
    const idx = KanbanState.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    const prev = KanbanState.tasks[idx];
    if (prev.status === newStatus) return;
    KanbanState.tasks[idx] = { ...prev, status: newStatus, updatedAt: new Date().toISOString() };
    TaskStorage.save(KanbanState.tasks);
    TaskManager._syncProject(prev.projectId);
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
    const label = newStatus.startsWith('custom_') ? 'columna personalizada' : newStatus;
    Toast.show(`"${prev.name}" → ${label}`, 'info', 2000);
    Activity.add(`Tarea <strong>${esc(prev.name)}</strong> movida`);
  };

  /* ── Patch ModalTask: añadir columnas custom al selector de estado ── */
  const origOpenCreate = ModalTask.openCreate.bind(ModalTask);
  ModalTask.openCreate = function(status, projectId) {
    origOpenCreate(status, projectId);
    _injectCustomStatuses(projectId || KanbanState.currentProjectId, status);
  };

  const origOpenEdit = ModalTask.openEdit.bind(ModalTask);
  ModalTask.openEdit = function(task) {
    origOpenEdit(task);
    _injectCustomStatuses(task.projectId, task.status);
  };

  function _injectCustomStatuses(projectId, currentStatus) {
    const sel = document.getElementById('task-status');
    if (!sel || !projectId) return;
    const customCols = _getProjectCols(projectId);
    /* Quitar opciones custom previas */
    [...sel.options].filter(o => o.dataset.custom === 'true').forEach(o => o.remove());
    customCols.forEach(col => {
      const opt = document.createElement('option');
      opt.value        = col.id;
      opt.textContent  = `📌 ${col.label}`;
      opt.dataset.custom = 'true';
      sel.appendChild(opt);
    });
    if (currentStatus) sel.value = currentStatus;
  }

  /* ── Patch StatsData: excluir columnas custom de estadísticas ── */
  if (typeof StatsData !== 'undefined') {
    const origTasks = StatsData.tasks.bind(StatsData);
    StatsData.tasks = function() {
      return origTasks().filter(t => !t.status?.startsWith('custom_'));
    };
  }
})();

/* ─────────────────────────────────────────────
   FIX E — Tareas pendientes se actualizan al
            cambiar de proyecto en la cabecera
───────────────────────────────────────────── */
(function patchPendingOnProjectChange() {
  const origSet = WorkspaceState.set.bind(WorkspaceState);
  WorkspaceState.set = function(id) {
    origSet(id);
    /* Forzar re-render del dashboard inmediatamente */
    Dashboard.render();
  };
})();

/* ─────────────────────────────────────────────
   FIX F — Borrar proyecto: tareas + workspace siguiente
───────────────────────────────────────────── */
(function patchProjectDelete() {
  const orig = ProjectManager.delete.bind(ProjectManager);
  ProjectManager.delete = function(id) {
    KanbanState.tasks = KanbanState.tasks.filter(t => t.projectId !== id);
    TaskStorage.save(KanbanState.tasks);
    if (KanbanState.currentProjectId === id) {
      KanbanState.currentProjectId = null;
      const kSel = document.getElementById('kanban-project-selector');
      if (kSel) kSel.value = '';
      KanbanRenderer.renderBoard(null);
    }
    UsersState.memberships = UsersState.memberships.filter(m => m.projectId !== id);
    UsersStorage.saveMembers(UsersState.memberships);
    if (WorkspaceState.projectId === id) {
      const remaining = _userProjects().filter(p => p.id !== id);
      WorkspaceState.set(remaining[0]?.id || '');
    }
    orig(id);
    UsersRenderer.renderMyTasks();
    UsersRenderer.renderAllTasks();
  };
})();

/* ─────────────────────────────────────────────
   FIX G — Visibilidad: solo proyectos del usuario
───────────────────────────────────────────── */
(function patchProjectVisibility() {
  const origRenderProjects = Renderer.renderProjects.bind(Renderer);
  Renderer.renderProjects = function(projects) {
    const visible  = _userProjects();
    const filtered = projects.filter(p => visible.some(v => v.id === p.id));
    origRenderProjects(filtered);
  };

  const origQuick = Renderer.renderQuickList.bind(Renderer);
  Renderer.renderQuickList = function() {
    const list = document.getElementById('quick-project-list');
    if (!list) return;
    const top = _userProjects().slice(0, 5);
    if (top.length === 0) {
      list.innerHTML = `<li style="padding:16px 20px;color:var(--text-muted);font-size:.84rem">Sin proyectos accesibles.</li>`;
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
  };

  const origWSPop = WorkspaceSelector.populate.bind(WorkspaceSelector);
  WorkspaceSelector.populate = function() {
    const sel = document.getElementById('global-project-selector');
    if (!sel) return;
    const visible = _userProjects();
    sel.innerHTML = '<option value="">— Sin proyecto —</option>' +
      visible.map(p => `<option value="${esc(p.id)}">${esc(p.icon || '🗂')} ${esc(p.name)}</option>`).join('');
    if (WorkspaceState.projectId && visible.find(p => p.id === WorkspaceState.projectId)) {
      sel.value = WorkspaceState.projectId;
    } else if (WorkspaceState.projectId) {
      WorkspaceState.set('');
    }
  };

  const origKanbanPop = KanbanRenderer.populateSelector.bind(KanbanRenderer);
  KanbanRenderer.populateSelector = function() {
    const sel = document.getElementById('kanban-project-selector');
    if (!sel) return;
    const visible = _userProjects();
    const cur     = sel.value;
    sel.innerHTML = '<option value="">— Selecciona un proyecto —</option>' +
      visible.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    if (cur && visible.find(p => p.id === cur)) sel.value = cur;
  };
})();

/* ─────────────────────────────────────────────
   FIX H — Etiqueta de rol: desde selector cabecera
───────────────────────────────────────────── */
(function patchRoleLabel() {
  let _ctxPid = WorkspaceState.projectId || null;

  window.setRoleContext = function(projectId) {
    _ctxPid = projectId || null;
    _updateRole();
  };

  function _updateRole() {
    const roleEl   = document.getElementById('current-user-role');
    if (!roleEl) return;
    const activeId = UsersState.activeUserId;
    if (!activeId || !_ctxPid) { roleEl.textContent = ''; return; }
    const project  = State.projects.find(p => p.id === _ctxPid);
    const isAdmin  = project?.creatorId === activeId ||
      UsersState.memberships.some(m => m.projectId === _ctxPid && m.userId === activeId && m.role === 'admin');
    const isMember = project?.creatorId === activeId ||
      UsersState.memberships.some(m => m.projectId === _ctxPid && m.userId === activeId);
    roleEl.textContent = !isMember ? '' : isAdmin ? '🔑 Admin' : '👤 Miembro';
  }

  const origUpdate = UsersSidebar.update.bind(UsersSidebar);
  UsersSidebar.update = function() {
    origUpdate();
    _ctxPid = WorkspaceState.projectId || null;
    _updateRole();
  };

  document.addEventListener('DOMContentLoaded', () => {
    ['global-project-selector','kanban-project-selector','stats-project-filter','cal-project-filter']
      .forEach(id => document.getElementById(id)?.addEventListener('change', e => setRoleContext(e.target.value)));
  });

  setRoleContext(WorkspaceState.projectId || null);
})();

/* ─────────────────────────────────────────────
   FIX I — Editar usuario: solo en tarjeta propia
───────────────────────────────────────────── */
(function patchUserEditButton() {
  const origBuild = UsersRenderer._buildUserCard.bind(UsersRenderer);
  UsersRenderer._buildUserCard = function(u) {
    let html = origBuild(u);
    if (u.id !== UsersState.activeUserId) {
      html = html.replace(/<button class="btn-icon btn-edit-user"[^>]*>✎<\/button>/, '');
    }
    return html;
  };
})();

/* ─────────────────────────────────────────────
   FIX J — Miembros editan tareas + etiqueta "Editado por"
───────────────────────────────────────────── */
(function patchMemberEditTask() {
  function _canEdit(task) {
    const active = UserManager.getActive();
    if (!active) return false;
    const pid     = task?.projectId || KanbanState.currentProjectId;
    if (UserManager.isActiveAdmin(pid)) return true;
    const project = State.projects.find(p => p.id === pid);
    return project?.creatorId === active.id ||
      UsersState.memberships.some(m => m.projectId === pid && m.userId === active.id);
  }

  const origUpdate = TaskManager.update.bind(TaskManager);
  TaskManager.update = function(id, data) {
    const active = UserManager.getActive();
    origUpdate(id, data);
    if (active) {
      const idx = KanbanState.tasks.findIndex(t => t.id === id);
      if (idx !== -1) {
        KanbanState.tasks[idx].editedBy     = active.id;
        KanbanState.tasks[idx].editedByName = active.name;
        TaskStorage.save(KanbanState.tasks);
      }
    }
    KanbanRenderer.renderBoard(KanbanState.currentProjectId);
  };

  const origBuildCard = KanbanRenderer._buildCard.bind(KanbanRenderer);
  KanbanRenderer._buildCard = function(task) {
    let html = origBuildCard(task);
    if (task.editedByName) {
      const badge = `<span class="task-edited-badge">✎ ${esc(task.editedByName)}</span>`;
      html = html.replace(/(<\/div>)(\s*<p class="task-card-name">)/, `$1${badge}$2`);
    }
    if (!_canEdit(task)) {
      html = html
        .replace(/<button class="btn-icon btn-edit-task"[^>]*>✎<\/button>/, '')
        .replace(/<button class="btn-icon btn-delete-task"[^>]*>✕<\/button>/, '');
    }
    return html;
  };
})();

/* ─────────────────────────────────────────────
   FIX K — Asignar tarea: exclusivo de admins
───────────────────────────────────────────── */
(function patchAssigneePermission() {
  function _isAdmin(projectId) {
    const pid     = projectId || KanbanState.currentProjectId || WorkspaceState.projectId;
    const project = State.projects.find(p => p.id === pid);
    const active  = UserManager.getActive();
    if (!active) return false;
    return project?.creatorId === active.id ||
      UsersState.memberships.some(m => m.projectId === pid && m.userId === active.id && m.role === 'admin');
  }

  function _applyAssignee(projectId) {
    const row = document.getElementById('task-assignee')?.closest('.form-group');
    if (!row) return;
    const admin = _isAdmin(projectId);
    row.style.display = admin ? '' : 'none';
    const sel = document.getElementById('task-assignee');
    if (sel) sel.disabled = !admin;
  }

  const origCreate = ModalTask.openCreate.bind(ModalTask);
  ModalTask.openCreate = function(status, projectId) {
    origCreate(status, projectId);
    _applyAssignee(projectId);
  };

  const origEdit = ModalTask.openEdit.bind(ModalTask);
  ModalTask.openEdit = function(task) {
    origEdit(task);
    _applyAssignee(task.projectId);
  };
})();

/* ─────────────────────────────────────────────
   ESTILOS INYECTADOS
───────────────────────────────────────────── */
(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Sección de miembros en tarjeta de proyecto */
    .proj-members-section {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 0 4px;
      border-top: 1px solid var(--border-subtle);
      flex-wrap: wrap;
    }
    .proj-members-avatars { display: flex; align-items: center; gap: -4px; flex-wrap: wrap; gap: 3px; }
    .proj-member-avatar {
      margin-left: 10px;
      width: 26px; height: 26px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-family: 'Sora', sans-serif; font-size: .58rem; font-weight: 800;
      color: #fff; border: 2px solid var(--bg-surface);
      cursor: default; transition: transform .15s;
    }
    .proj-member-avatar:hover { transform: scale(1.15); z-index: 1; }
    .proj-member-more {
      font-size: .7rem; color: var(--text-muted);
      background: var(--bg-raised); border: 1px solid var(--border);
      padding: 1px 6px; border-radius: 20px;
    }

    /* Etiqueta "Editado por" */
    .task-edited-badge {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: .66rem; font-weight: 600; color: var(--accent);
      background: var(--accent-glow);
      border: 1px solid rgba(108,99,255,.2);
      padding: 1px 7px; border-radius: 20px;
      margin-bottom: 3px; max-width: 100%;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }

    /* Shake modal */
    @keyframes shake {
      0%,100%{transform:translate(-50%,-50%)}
      20%{transform:translate(-52%,-50%)}
      40%{transform:translate(-48%,-50%)}
      60%{transform:translate(-52%,-50%)}
      80%{transform:translate(-48%,-50%)}
    }
    .modal.shake { animation: shake .35s ease; }
    .toast-icon  { font-size:.85rem; flex-shrink:0; }
    .project-card-actions:empty { display: none; }
  `;
  document.head.appendChild(style);
})();

console.log('[TaskFlow] fixes.js v3.0 — 11 correcciones activas');
