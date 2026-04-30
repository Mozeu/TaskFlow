/* ═══════════════════════════════════════════════════════════
   TASKFLOW — data-manager.js
   Gestión centralizada de:
   - Eliminación completa de datos (RF23)
   - Exportación granular: calendario, tareas de proyecto, progreso
   - Importación de tareas y proyectos desde JSON (como adjuntos)
═══════════════════════════════════════════════════════════ */

'use strict';

const DataManager = {
  /* ─────────────────────────────────────────────
     1. ELIMINAR TODOS LOS DATOS (RF23)
  ───────────────────────────────────────────── */
  clearAllData() {
    // Confirmación antes de borrar
    if (!confirm('⚠️ Esta acción ELIMINARÁ TODOS los proyectos, tareas, usuarios y configuraciones. ¿Estás seguro?')) return false;

    // Limpiar localStorage
    localStorage.removeItem('taskflow_projects');
    localStorage.removeItem('taskflow_tasks');
    localStorage.removeItem('taskflow_users');
    localStorage.removeItem('taskflow_memberships');
    localStorage.removeItem('taskflow_active_user');
    localStorage.removeItem('taskflow_workspace_project');
    localStorage.removeItem('taskflow_theme');
    localStorage.removeItem('taskflow_activity');
    localStorage.removeItem('taskflow_custom_cols');

    // Recargar la página para reiniciar el estado
    Toast.show('Todos los datos han sido eliminados. La página se recargará.', 'success', 2000);
    setTimeout(() => location.reload(), 1500);
    return true;
  },

  /* ─────────────────────────────────────────────
     2. EXPORTAR DATOS ESPECÍFICOS
  ───────────────────────────────────────────── */

  /**
   * Exporta el calendario completo (tareas con fecha límite)
   * Formato: { exportedAt, tasks: [ { id, name, deadline, projectId, projectName, status, priority } ] }
   */
  exportCalendar() {
    const tasksWithDeadline = KanbanState.tasks.filter(t => t.deadline);
    const data = {
      exportedAt: new Date().toISOString(),
      type: 'calendar',
      tasks: tasksWithDeadline.map(t => ({
        id: t.id,
        name: t.name,
        deadline: t.deadline,
        projectId: t.projectId,
        projectName: State.projects.find(p => p.id === t.projectId)?.name || 'Desconocido',
        status: t.status,
        priority: t.priority,
        desc: t.desc || ''
      }))
    };
    this._downloadJSON(data, `taskflow_calendario_${new Date().toISOString().slice(0,10)}.json`);
    Toast.show('Calendario exportado correctamente.', 'success');
  },

  /**
   * Exporta lista de tareas de un proyecto específico + su progreso
   * @param {string} projectId
   */
  exportProjectTasks(projectId) {
    const project = State.projects.find(p => p.id === projectId);
    if (!project) {
      Toast.show('Proyecto no encontrado.', 'error');
      return;
    }
    const tasks = KanbanState.tasks.filter(t => t.projectId === projectId);
    const doneCount = tasks.filter(t => t.status === 'terminado').length;
    const progress = tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100);

    const data = {
      exportedAt: new Date().toISOString(),
      type: 'project_tasks',
      project: {
        id: project.id,
        name: project.name,
        color: project.color,
        icon: project.icon,
        deadline: project.deadline,
        progress: progress,
        totalTasks: tasks.length,
        doneTasks: doneCount
      },
      tasks: tasks.map(t => ({
        id: t.id,
        name: t.name,
        desc: t.desc,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeId ? UserManager.getById(t.assigneeId)?.name : null,
        createdAt: t.createdAt
      }))
    };
    this._downloadJSON(data, `taskflow_proyecto_${project.name.replace(/\s/g, '_')}_${new Date().toISOString().slice(0,10)}.json`);
    Toast.show(`Proyecto "${project.name}" exportado.`, 'success');
  },

  /**
   * Exporta el progreso global de todos los proyectos (resumen)
   */
  exportGlobalProgress() {
    const projectsProgress = State.projects.map(p => {
      const tasks = KanbanState.tasks.filter(t => t.projectId === p.id);
      const done = tasks.filter(t => t.status === 'terminado').length;
      const total = tasks.length;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        totalTasks: total,
        doneTasks: done,
        progress: total === 0 ? 0 : Math.round((done / total) * 100)
      };
    });
    const data = {
      exportedAt: new Date().toISOString(),
      type: 'global_progress',
      projects: projectsProgress,
      summary: {
        totalProjects: State.projects.length,
        totalTasks: KanbanState.tasks.length,
        completedTasks: KanbanState.tasks.filter(t => t.status === 'terminado').length
      }
    };
    this._downloadJSON(data, `taskflow_progreso_global_${new Date().toISOString().slice(0,10)}.json`);
    Toast.show('Progreso global exportado.', 'success');
  },

  /* ─────────────────────────────────────────────
     3. IMPORTAR DATOS COMO "ADJUNTOS"
     (crea nuevos proyectos o tareas a partir de JSON)
  ───────────────────────────────────────────── */

  /**
   * Importa un proyecto desde un archivo JSON.
   * Si el proyecto ya existe (mismo ID), se actualiza; si no, se crea uno nuevo.
   * @param {File} file
   */
  importProjectFromJSON(file) {
    this._readJSONFile(file, (json) => {
      if (json.type !== 'project_tasks' && !json.project) {
        Toast.show('El archivo no es una exportación válida de proyecto.', 'error');
        return;
      }
      const projectData = json.project;
      // Verificar si ya existe un proyecto con ese ID
      let existing = State.projects.find(p => p.id === projectData.id);
      if (existing) {
        // Actualizar proyecto existente
        const idx = State.projects.findIndex(p => p.id === projectData.id);
        State.projects[idx] = {
          ...existing,
          name: projectData.name,
          color: projectData.color,
          icon: projectData.icon,
          deadline: projectData.deadline,
          updatedAt: new Date().toISOString()
        };
        Toast.show(`Proyecto "${projectData.name}" actualizado.`, 'success');
      } else {
        // Crear nuevo proyecto
        const newProject = {
          id: projectData.id || uid(),
          name: projectData.name,
          desc: projectData.desc || '',
          color: projectData.color || '#6c63ff',
          icon: projectData.icon || '🗂',
          deadline: projectData.deadline || null,
          createdAt: new Date().toISOString(),
          taskCount: 0,
          progress: 0
        };
        State.projects.unshift(newProject);
        Toast.show(`Proyecto "${newProject.name}" importado.`, 'success');
      }
      Storage.save(State.projects);
      // Opcional: también importar las tareas asociadas si el usuario lo desea
      if (json.tasks && json.tasks.length > 0 && confirm('¿Deseas importar también las tareas de este proyecto?')) {
        this._importTasksForProject(json.tasks, projectData.id);
      }
      Renderer.renderAll();
      WorkspaceSelector.populate();
    });
  },

  /**
   * Importa una tarea desde un archivo JSON (adjunto a un proyecto)
   * @param {File} file
   * @param {string} targetProjectId (opcional, si no se especifica se pide al usuario)
   */
  importTaskFromJSON(file, targetProjectId = null) {
    this._readJSONFile(file, (json) => {
      // Se espera un objeto con estructura de tarea
      if (!json.name || !json.status) {
        Toast.show('El archivo no contiene una tarea válida (nombre y estado requeridos).', 'error');
        return;
      }
      let projectId = targetProjectId;
      if (!projectId) {
        // Pedir al usuario que seleccione un proyecto
        const projectList = State.projects.map(p => `${p.id}|${p.name}`).join(',');
        const selected = prompt(`Selecciona un proyecto para esta tarea (ingresa el número):\n${State.projects.map((p, i) => `${i+1}. ${p.name}`).join('\n')}`);
        if (selected) {
          const idx = parseInt(selected) - 1;
          if (!isNaN(idx) && State.projects[idx]) projectId = State.projects[idx].id;
        }
        if (!projectId) {
          Toast.show('No se seleccionó proyecto. Importación cancelada.', 'error');
          return;
        }
      }
      // Crear la tarea con los datos del JSON (sobrescribiendo campos seguros)
      const newTask = {
        id: json.id || uid(),
        name: json.name,
        desc: json.desc || '',
        priority: json.priority || 'media',
        status: json.status,
        deadline: json.deadline || null,
        projectId: projectId,
        assigneeId: json.assigneeId || null,
        createdAt: new Date().toISOString()
      };
      KanbanState.tasks.push(newTask);
      TaskStorage.save(KanbanState.tasks);
      TaskManager._syncProject(projectId);
      Toast.show(`Tarea "${newTask.name}" importada al proyecto.`, 'success');
      Activity.add(`Tarea <strong>${esc(newTask.name)}</strong> importada desde archivo`);
      // Refrescar vistas
      KanbanRenderer.renderBoard(KanbanState.currentProjectId);
      Dashboard.render();
      if (typeof CalendarModule !== 'undefined') CalendarModule.render();
      if (typeof UsersRenderer !== 'undefined') UsersRenderer.renderAll();
    });
  },

  /* ─────────────────────────────────────────────
     MÉTODOS PRIVADOS
  ───────────────────────────────────────────── */
  _downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  },

  _readJSONFile(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target.result);
        callback(json);
      } catch (err) {
        Toast.show('Error al leer el archivo JSON. Formato inválido.', 'error');
      }
    };
    reader.readAsText(file);
  },

  _importTasksForProject(tasksArray, projectId) {
    let imported = 0;
    for (const t of tasksArray) {
      if (KanbanState.tasks.some(ex => ex.id === t.id)) continue; // evitar duplicados exactos
      const newTask = {
        id: t.id || uid(),
        name: t.name,
        desc: t.desc || '',
        priority: t.priority || 'media',
        status: t.status || 'pendiente',
        deadline: t.deadline || null,
        projectId: projectId,
        assigneeId: t.assigneeId || null,
        createdAt: new Date().toISOString()
      };
      KanbanState.tasks.push(newTask);
      imported++;
    }
    if (imported > 0) {
      TaskStorage.save(KanbanState.tasks);
      TaskManager._syncProject(projectId);
      Toast.show(`${imported} tarea(s) importadas.`, 'success');
    }
  }
};

// Exponer globalmente para uso en los botones
window.DataManager = DataManager;