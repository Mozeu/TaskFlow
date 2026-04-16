/* ═══════════════════════════════════════════════
   TASKFLOW — app.js
   Navegación de pestañas y tema (prototipo visual)
   La lógica funcional de cada módulo se añadirá
   en sprints posteriores.
═══════════════════════════════════════════════ */

// ── Navegación de pestañas ──────────────────────
const navItems    = document.querySelectorAll('.nav-item[data-tab], .btn-settings[data-tab], .btn-link[data-tab]');
const tabContents = document.querySelectorAll('.tab-content');
const pageTitle   = document.getElementById('page-title');

const TAB_TITLES = {
  dashboard: 'Dashboard',
  projects:  'Proyectos',
  kanban:    'Tablero Kanban',
  calendar:  'Calendario',
  stats:     'Estadísticas',
  users:     'Usuarios',
  settings:  'Configuración',
};

function switchTab(tabId) {
  tabContents.forEach(t => t.classList.remove('active'));
  navItems.forEach(n => n.classList.remove('active'));

  const target = document.getElementById('tab-' + tabId);
  if (target) target.classList.add('active');

  document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add('active'));
  if (pageTitle) pageTitle.textContent = TAB_TITLES[tabId] ?? tabId;
}

navItems.forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// ── Tema claro / oscuro (RF24) ──────────────────
const html          = document.documentElement;
const btnTheme      = document.getElementById('btn-theme-toggle');
const toggleDark    = document.getElementById('toggle-dark-mode');

function setTheme(dark) {
  html.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (toggleDark) toggleDark.setAttribute('aria-checked', dark ? 'true' : 'false');
}

btnTheme?.addEventListener('click', () => {
  setTheme(html.dataset.theme !== 'light');
});
toggleDark?.addEventListener('click', () => {
  setTheme(html.dataset.theme !== 'light');
});

// ── Sidebar toggle (responsive) ─────────────────
const sidebar       = document.getElementById('sidebar');
const btnMenuToggle = document.getElementById('btn-menu-toggle');
const btnSideToggle = document.getElementById('btn-sidebar-toggle');

btnMenuToggle?.addEventListener('click', () => sidebar?.classList.toggle('open'));
btnSideToggle?.addEventListener('click', () => sidebar?.classList.remove('open'));

// ── Modales (apertura/cierre) ────────────────────
const overlay = document.getElementById('modal-overlay');

function openModal(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.classList.add('active');
  overlay?.classList.add('active');
  m.removeAttribute('open'); // reset dialog nativo
}
function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (!m) return;
  m.classList.remove('active');
  // Cierra overlay si no hay otros modales abiertos
  if (!document.querySelector('.modal.active')) overlay?.classList.remove('active');
}

overlay?.addEventListener('click', () => {
  document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  overlay.classList.remove('active');
});

// Botones que abren modales
document.getElementById('btn-new-project')?.addEventListener('click', () => openModal('modal-project'));
document.getElementById('btn-add-project-card')?.addEventListener('click', () => openModal('modal-project'));
document.getElementById('btn-new-task-kanban')?.addEventListener('click', () => openModal('modal-task'));
document.getElementById('btn-quick-add')?.addEventListener('click', () => openModal('modal-task'));
document.getElementById('btn-new-user')?.addEventListener('click', () => openModal('modal-user'));
document.getElementById('btn-add-user-card')?.addEventListener('click', () => openModal('modal-user'));

// Botones de cierre
['modal-project','modal-task','modal-user','modal-confirm'].forEach(id => {
  document.getElementById(`close-${id}`)?.addEventListener('click', () => closeModal(id));
  document.getElementById(`btn-cancel-${id.replace('modal-','')}`)?.addEventListener('click', () => closeModal(id));
});

// Botones de editar / eliminar (proyectos, tareas, usuarios) — abre modales correspondientes
document.querySelectorAll('.btn-edit-project').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal-project-title').textContent = 'Editar Proyecto';
    openModal('modal-project');
  })
);
document.querySelectorAll('.btn-delete-project').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal-confirm-text').textContent =
      '¿Estás seguro de que deseas eliminar este proyecto? Se eliminarán también todas sus tareas.';
    openModal('modal-confirm');
  })
);
document.querySelectorAll('.btn-edit-task').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal-task-title').textContent = 'Editar Tarea';
    openModal('modal-task');
  })
);
document.querySelectorAll('.btn-delete-task').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal-confirm-text').textContent =
      '¿Estás seguro de que deseas eliminar esta tarea? Esta acción no se puede deshacer.';
    openModal('modal-confirm');
  })
);
document.querySelectorAll('.btn-edit-user').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal-user-title').textContent = 'Editar Usuario';
    openModal('modal-user');
  })
);
document.querySelectorAll('.btn-delete-user').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('modal-confirm-text').textContent =
      '¿Deseas eliminar este perfil de usuario?';
    openModal('modal-confirm');
  })
);

// Ver Kanban desde tarjeta de proyecto
document.querySelectorAll('.btn-view-kanban').forEach(btn =>
  btn.addEventListener('click', () => switchTab('kanban'))
);

// Selector de color en modal proyecto
document.querySelectorAll('.color-swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
  });
});

// ── Toast demo (RF29) ────────────────────────────
window.showToast = function(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
};

// ── Init ─────────────────────────────────────────
switchTab('dashboard');
