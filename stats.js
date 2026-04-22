/* ═══════════════════════════════════════════════════════════
   TASKFLOW — stats.js  v2.0
   Correcciones: render chain limpio (sin doble patch de
   TabManager), filtro sincronizado con WorkspaceState,
   nuevo panel "Avance por Miembro" para administradores.
═══════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   0. PALETAS
───────────────────────────────────────────── */
const STATUS_CFG = [
  { key: 'pendiente',   label: 'Pendiente',   color: '#f7b731' },
  { key: 'en-progreso', label: 'En Progreso', color: '#45aaf2' },
  { key: 'terminado',   label: 'Terminado',   color: '#20bf6b' },
];
const PRIORITY_CFG = [
  { key: 'alta',  label: 'Alta',  color: '#fc5c65' },
  { key: 'media', label: 'Media', color: '#f7b731' },
  { key: 'baja',  label: 'Baja',  color: '#20bf6b' },
];

/* ─────────────────────────────────────────────
   1. FUENTE DE DATOS
   Lee el filtro directamente de WorkspaceState
   para mantenerse siempre sincronizado.
───────────────────────────────────────────── */
const StatsData = {
  /** Proyecto activo en el selector global */
  _filterId() {
    return (typeof WorkspaceState !== 'undefined')
      ? WorkspaceState.projectId
      : (document.getElementById('stats-project-filter')?.value || '');
  },

  tasks() {
    const all = KanbanState.tasks;
    const fid = this._filterId();
    return fid ? all.filter(t => t.projectId === fid) : all;
  },

  setFilter(id) {
    /* Compatibilidad: si algo externo llama setFilter, actualizamos el select */
    const sel = document.getElementById('stats-project-filter');
    if (sel) sel.value = id || '';
  },

  projects() { return State.projects; },

  byStatus() {
    const tasks = this.tasks();
    return STATUS_CFG.map(s => ({ ...s, count: tasks.filter(t => t.status === s.key).length }));
  },

  byPriority() {
    const tasks = this.tasks();
    return PRIORITY_CFG.map(p => ({ ...p, count: tasks.filter(t => t.priority === p.key).length }));
  },

  byProject() {
    return this.projects().map(p => {
      const pt    = KanbanState.tasks.filter(t => t.projectId === p.id);
      const done  = pt.filter(t => t.status === 'terminado').length;
      const pend  = pt.filter(t => t.status === 'pendiente').length;
      const inpg  = pt.filter(t => t.status === 'en-progreso').length;
      const total = pt.length;
      const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
      return { ...p, total, done, pending: pend, inprog: inpg, pct };
    });
  },

  summary() {
    const tasks   = this.tasks();
    const total   = tasks.length;
    const done    = tasks.filter(t => t.status === 'terminado').length;
    const prog    = tasks.filter(t => t.status === 'en-progreso').length;
    const pend    = tasks.filter(t => t.status === 'pendiente').length;
    const rate    = total === 0 ? 0 : Math.round((done / total) * 100);
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = tasks.filter(t => {
      if (!t.deadline || t.status === 'terminado') return false;
      const [y, m, d] = t.deadline.split('-').map(Number);
      return new Date(y, m - 1, d) < today;
    }).length;
    const avgProg = this.projects().length === 0 ? 0
      : Math.round(this.projects().reduce((s, p) => s + (p.progress || 0), 0) / this.projects().length);
    return { total, done, prog, pend, completionRate: rate, overdue, avgProgress: avgProg };
  },

  /** Datos de avance por miembro en el proyecto activo (o todos los proyectos) */
  byMember() {
    const fid      = this._filterId();
    const users    = (typeof UsersState !== 'undefined') ? UsersState.users : [];
    const tasks    = fid
      ? KanbanState.tasks.filter(t => t.projectId === fid)
      : KanbanState.tasks;

    return users.map(u => {
      const ut    = tasks.filter(t => t.assigneeId === u.id);
      const done  = ut.filter(t => t.status === 'terminado').length;
      const pend  = ut.filter(t => t.status === 'pendiente').length;
      const inpg  = ut.filter(t => t.status === 'en-progreso').length;
      const total = ut.length;
      const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
      return { ...u, total, done, pending: pend, inprog: inpg, pct };
    }).filter(u => u.total > 0)   /* solo miembros con tareas asignadas */
      .sort((a, b) => b.pct - a.pct);
  },

  /** ¿El usuario activo es admin en el contexto actual? */
  activeIsAdmin() {
    if (typeof UsersState === 'undefined' || typeof UserManager === 'undefined') return false;
    const active = UserManager.getActive();
    if (!active) return false;
    const fid    = this._filterId();
    /* Sin proyecto → admin si es admin en algún proyecto */
    if (!fid) {
      return State.projects.some(p => p.creatorId === active.id) ||
        UsersState.memberships.some(m => m.userId === active.id && m.role === 'admin');
    }
    const p = State.projects.find(pr => pr.id === fid);
    return p?.creatorId === active.id ||
      UsersState.memberships.some(m => m.projectId === fid && m.userId === active.id && m.role === 'admin');
  },
};

/* ─────────────────────────────────────────────
   2. SVG HELPER
───────────────────────────────────────────── */
function _svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}
function _emptyChart(msg) {
  return `<div class="stats-empty"><span class="stats-empty-icon">◌</span><span>${msg}</span></div>`;
}

/* ─────────────────────────────────────────────
   3. GRÁFICO DE BARRAS — Estado
───────────────────────────────────────────── */
const ChartStatus = {
  render() {
    const el = document.getElementById('chart-status-body');
    const te = document.getElementById('chart-status-total');
    if (!el) return;

    const data  = StatsData.byStatus();
    const total = data.reduce((s, d) => s + d.count, 0);
    if (te) te.textContent = `${total} tarea${total !== 1 ? 's' : ''}`;

    if (total === 0) { el.innerHTML = _emptyChart('Sin tareas registradas'); return; }

    const max = Math.max(...data.map(d => d.count), 1);
    const W = 300, H = 160, bW = 70, gap = (W - data.length * bW) / (data.length + 1);

    const svg = _svgEl('svg', { viewBox: `0 0 ${W} ${H + 36}`, class: 'svg-bar-chart', role: 'img' });

    /* Líneas guía */
    [0.25, 0.5, 0.75, 1].forEach(f => {
      const y = H - H * f;
      svg.appendChild(_svgEl('line', { x1: 0, y1: y, x2: W, y2: y, stroke: 'var(--border)', 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: '.5' }));
      const t = _svgEl('text', { x: W - 2, y: y - 3, 'text-anchor': 'end', 'font-size': 8, fill: 'var(--text-muted)' });
      t.textContent = Math.round(max * f);
      svg.appendChild(t);
    });

    data.forEach((d, i) => {
      const x  = gap + i * (bW + gap);
      const bH = Math.round((d.count / max) * H);
      const y  = H - bH;

      const rect = _svgEl('rect', { x, y, width: bW, height: bH, fill: d.color, rx: 6, ry: 6, opacity: .9 });
      const aH   = _svgEl('animate', { attributeName: 'height', from: 0, to: bH, dur: '.55s', begin: `${i * 0.1}s`, fill: 'freeze', calcMode: 'spline', keySplines: '.34 1.56 .64 1' });
      const aY   = _svgEl('animate', { attributeName: 'y',      from: H, to: y,  dur: '.55s', begin: `${i * 0.1}s`, fill: 'freeze', calcMode: 'spline', keySplines: '.34 1.56 .64 1' });
      rect.appendChild(aH); rect.appendChild(aY); svg.appendChild(rect);

      if (d.count > 0) {
        const v = _svgEl('text', { x: x + bW / 2, y: y - 5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: d.color });
        v.textContent = d.count; svg.appendChild(v);
      }
      const l = _svgEl('text', { x: x + bW / 2, y: H + 16, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--text-secondary)' });
      l.textContent = d.label; svg.appendChild(l);
    });

    el.innerHTML = ''; el.appendChild(svg);
  },
};

/* ─────────────────────────────────────────────
   4. DONA — Prioridad
───────────────────────────────────────────── */
const ChartPriority = {
  render() {
    const el = document.getElementById('chart-priority-body');
    if (!el) return;

    const data  = StatsData.byPriority();
    const total = data.reduce((s, d) => s + d.count, 0);
    if (total === 0) { el.innerHTML = _emptyChart('Sin tareas con prioridad'); return; }

    const CX = 85, CY = 85, R = 68, SW = 20, CIRC = 2 * Math.PI * R;
    const svg = _svgEl('svg', { viewBox: `0 0 170 170`, width: 170, class: 'svg-donut', role: 'img' });

    svg.appendChild(_svgEl('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: 'var(--border)', 'stroke-width': SW }));

    let offset = 0;
    data.forEach(d => {
      if (!d.count) return;
      const frac = d.count / total;
      const dash = frac * CIRC;
      const c = _svgEl('circle', {
        cx: CX, cy: CY, r: R, fill: 'none',
        stroke: d.color, 'stroke-width': SW,
        'stroke-dasharray': `${dash} ${CIRC - dash}`,
        'stroke-dashoffset': -(offset * CIRC - CIRC / 4),
        'stroke-linecap': 'butt',
      });
      svg.appendChild(c);
      offset += frac;
    });

    const tv = _svgEl('text', { x: CX, y: CY + 6, 'text-anchor': 'middle', 'font-family': 'Sora,sans-serif', 'font-size': 20, 'font-weight': 800, fill: 'var(--text-primary)' });
    tv.textContent = total; svg.appendChild(tv);
    const tl = _svgEl('text', { x: CX, y: CY + 18, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--text-muted)' });
    tl.textContent = 'tareas'; svg.appendChild(tl);

    const legend = data.map(d => `
      <div class="chart-legend-item">
        <span class="chart-legend-dot" style="background:${d.color}"></span>
        <span>${d.label}</span>
        <span class="chart-legend-val">${d.count}</span>
      </div>`).join('');

    el.innerHTML = `<div class="donut-layout"><div class="donut-svg-wrap"></div><div class="chart-legend">${legend}</div></div>`;
    el.querySelector('.donut-svg-wrap').appendChild(svg);
  },
};

/* ─────────────────────────────────────────────
   5. GAUGE RADIAL — Progreso global
───────────────────────────────────────────── */
const ChartGauge = {
  render() {
    const el = document.getElementById('chart-gauge-body');
    if (!el) return;

    const { completionRate, total } = StatsData.summary();
    const pct = completionRate;
    const CX = 80, CY = 80, R = 60, SW = 14;
    const START = -210, SWEEP = 240;
    const pathLen = (SWEEP / 360) * 2 * Math.PI * R;

    function arc(cx, cy, r, s, e) {
      const toR = a => a * Math.PI / 180;
      const x1 = cx + r * Math.cos(toR(s)), y1 = cy + r * Math.sin(toR(s));
      const x2 = cx + r * Math.cos(toR(e)), y2 = cy + r * Math.sin(toR(e));
      const lg = Math.abs(e - s) > 180 ? 1 : 0;
      return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    }
    const clr = pct >= 75 ? '#20bf6b' : pct >= 40 ? '#45aaf2' : pct >= 15 ? '#f7b731' : '#fc5c65';

    const svg = _svgEl('svg', { viewBox: '0 0 160 140', width: 160, role: 'img' });
    svg.appendChild(Object.assign(_svgEl('path', { d: arc(CX, CY, R, START, START + SWEEP), fill: 'none', stroke: 'var(--border)', 'stroke-width': SW, 'stroke-linecap': 'round' })));

    const fillPath = _svgEl('path', { d: arc(CX, CY, R, START, START + SWEEP * (pct / 100)), fill: 'none', stroke: clr, 'stroke-width': SW, 'stroke-linecap': 'round' });
    fillPath.style.strokeDasharray  = pathLen;
    fillPath.style.strokeDashoffset = pathLen;
    svg.appendChild(fillPath);

    const vt = _svgEl('text', { x: CX, y: CY + 8, 'text-anchor': 'middle', 'font-family': 'Sora,sans-serif', 'font-size': 28, 'font-weight': 800, fill: clr });
    vt.textContent = `${pct}%`; svg.appendChild(vt);
    const st = _svgEl('text', { x: CX, y: CY + 22, 'text-anchor': 'middle', 'font-size': 8, fill: 'var(--text-muted)' });
    st.textContent = `de ${total} tarea${total !== 1 ? 's' : ''}`; svg.appendChild(st);

    el.innerHTML = ''; el.appendChild(svg);

    requestAnimationFrame(() => {
      fillPath.style.transition = 'stroke-dashoffset 1s cubic-bezier(.34,1.2,.64,1)';
      fillPath.style.strokeDashoffset = pathLen * (1 - pct / 100);
    });
  },
};

/* ─────────────────────────────────────────────
   6. BARRAS HORIZONTALES — Avance por Proyecto
───────────────────────────────────────────── */
const ChartProjects = {
  render() {
    const el = document.getElementById('chart-projects-body');
    const te = document.getElementById('chart-projects-total');
    if (!el) return;

    const data = StatsData.byProject();
    if (te) te.textContent = `${data.length} proyecto${data.length !== 1 ? 's' : ''}`;

    if (data.length === 0) { el.innerHTML = _emptyChart('Sin proyectos creados'); return; }

    el.innerHTML = data.map(p => `
      <div class="stats-proj-row">
        <span class="stats-proj-name" title="${esc(p.name)}">${esc(p.icon || '🗂')} ${esc(p.name)}</span>
        <div class="stats-proj-bar-wrap">
          <div class="stats-proj-bar" style="--fill:${p.pct}%; background:${esc(p.color)}"></div>
        </div>
        <span class="stats-proj-counts">${p.done}/${p.total}</span>
        <span class="stats-proj-pct" style="color:${esc(p.color)}">${p.pct}%</span>
      </div>`).join('');

    requestAnimationFrame(() => {
      el.querySelectorAll('.stats-proj-bar').forEach(bar => {
        const fill = getComputedStyle(bar).getPropertyValue('--fill') || bar.style.getPropertyValue('--fill');
        bar.style.setProperty('--fill', '0%');
        requestAnimationFrame(() => bar.style.setProperty('--fill', fill));
      });
    });
  },
};

/* ─────────────────────────────────────────────
   7. BARRAS SEGMENTADAS — Tareas por Proyecto
───────────────────────────────────────────── */
const ChartTasksByProject = {
  render() {
    const el = document.getElementById('chart-tasks-project-body');
    if (!el) return;

    const data    = StatsData.byProject();
    const maxTask = Math.max(...data.map(p => p.total), 1);

    if (data.length === 0 || data.every(p => p.total === 0)) {
      el.innerHTML = _emptyChart('Sin tareas en ningún proyecto'); return;
    }

    el.innerHTML = data.filter(p => p.total > 0).map(p => {
      const pW = (p.pending / maxTask * 100).toFixed(1);
      const gW = (p.inprog  / maxTask * 100).toFixed(1);
      const dW = (p.done    / maxTask * 100).toFixed(1);
      return `
        <div class="stats-proj-row">
          <span class="stats-proj-name" title="${esc(p.name)}">${esc(p.icon || '🗂')} ${esc(p.name)}</span>
          <div class="stats-proj-bar-wrap" style="height:12px;position:relative;overflow:visible">
            <div style="position:absolute;left:0;top:0;height:100%;width:${pW}%;background:#f7b731;border-radius:6px 0 0 6px;transition:width .8s"></div>
            <div style="position:absolute;left:${pW}%;top:0;height:100%;width:${gW}%;background:#45aaf2"></div>
            <div style="position:absolute;left:calc(${pW}% + ${gW}%);top:0;height:100%;width:${dW}%;background:#20bf6b;border-radius:0 6px 6px 0"></div>
          </div>
          <span class="stats-proj-counts">${p.total} tarea${p.total !== 1 ? 's' : ''}</span>
        </div>`;
    }).join('') + `
      <div style="display:flex;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)">
        ${[['#f7b731','Pendiente'],['#45aaf2','En Progreso'],['#20bf6b','Terminado']].map(([c,l]) =>
          `<span style="display:flex;align-items:center;gap:5px;font-size:.73rem;color:var(--text-muted)">
            <span style="width:10px;height:10px;border-radius:50%;background:${c};display:inline-block"></span>${l}
          </span>`).join('')}
      </div>`;
  },
};

/* ─────────────────────────────────────────────
   8. AVANCE POR MIEMBRO — solo para admins
───────────────────────────────────────────── */
const ChartMembers = {
  render() {
    const panel    = document.getElementById('chart-members');
    const el       = document.getElementById('chart-members-body');
    const labelEl  = document.getElementById('chart-members-label');
    if (!panel || !el) return;

    const isAdmin = StatsData.activeIsAdmin();
    panel.style.display = isAdmin ? 'block' : 'none';
    if (!isAdmin) return;

    const fid    = StatsData._filterId();
    const proj   = fid ? State.projects.find(p => p.id === fid) : null;
    if (labelEl) labelEl.textContent = proj ? `en "${proj.name}"` : '(todos los proyectos)';

    const data = StatsData.byMember();

    if (data.length === 0) {
      el.innerHTML = _emptyChart('Ningún miembro tiene tareas asignadas en este proyecto');
      return;
    }

    el.innerHTML = data.map(u => {
      const pW = u.total === 0 ? 0 : (u.pending / u.total * 100).toFixed(1);
      const gW = u.total === 0 ? 0 : (u.inprog  / u.total * 100).toFixed(1);
      const dW = u.total === 0 ? 0 : (u.done    / u.total * 100).toFixed(1);

      return `
        <div class="member-stats-row">
          <!-- Avatar + nombre -->
          <div class="member-stats-id">
            <span class="member-stats-avatar" style="background:${esc(u.color)}">${esc(u.initials)}</span>
            <span class="member-stats-name">${esc(u.name)}</span>
          </div>
          <!-- Barra segmentada -->
          <div class="member-stats-bar-wrap">
            <div class="msb-seg" style="width:${dW}%;background:#20bf6b" title="${u.done} terminadas"></div>
            <div class="msb-seg" style="width:${gW}%;background:#45aaf2" title="${u.inprog} en progreso"></div>
            <div class="msb-seg" style="width:${pW}%;background:#f7b731;border-radius:0 4px 4px 0" title="${u.pending} pendientes"></div>
          </div>
          <!-- Métricas -->
          <span class="member-stats-counts">${u.done}/${u.total}</span>
          <span class="member-stats-pct" style="color:${u.pct>=75?'#20bf6b':u.pct>=40?'#45aaf2':'#f7b731'}">${u.pct}%</span>
        </div>`;
    }).join('') + `
      <div style="display:flex;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle)">
        ${[['#20bf6b','Terminado'],['#45aaf2','En Progreso'],['#f7b731','Pendiente']].map(([c,l]) =>
          `<span style="display:flex;align-items:center;gap:5px;font-size:.73rem;color:var(--text-muted)">
            <span style="width:10px;height:10px;border-radius:50%;background:${c};display:inline-block"></span>${l}
          </span>`).join('')}
      </div>`;
  },
};

/* ─────────────────────────────────────────────
   9. RESUMEN CHIPS
───────────────────────────────────────────── */
const StatsSummary = {
  render() {
    const el = document.getElementById('stats-summary-row');
    if (!el) return;
    const s = StatsData.summary();
    const chips = [
      { icon: '📋', val: s.total,                lbl: 'Total Tareas'        },
      { icon: '✅', val: `${s.completionRate}%`, lbl: 'Tasa de Completitud' },
      { icon: '⚠',  val: s.overdue,              lbl: 'Tareas Vencidas'     },
      { icon: '📊', val: `${s.avgProgress}%`,    lbl: 'Progreso Promedio'   },
    ];
    el.innerHTML = chips.map(c => `
      <div class="stats-chip">
        <span class="stats-chip-icon">${c.icon}</span>
        <div class="stats-chip-info">
          <span class="stats-chip-val">${c.val}</span>
          <span class="stats-chip-lbl">${c.lbl}</span>
        </div>
      </div>`).join('');
  },
};

/* ─────────────────────────────────────────────
   10. MÓDULO PRINCIPAL
───────────────────────────────────────────── */
const StatsModule = {
  render() {
    try {
      this._populateFilter();
      StatsSummary.render();
      ChartStatus.render();
      ChartPriority.render();
      ChartGauge.render();
      ChartProjects.render();
      ChartTasksByProject.render();
      ChartMembers.render();
    } catch (e) {
      console.error('[StatsModule] Error al renderizar:', e);
    }
  },

  _populateFilter() {
    const sel = document.getElementById('stats-project-filter');
    if (!sel) return;
    const cur = (typeof WorkspaceState !== 'undefined') ? WorkspaceState.projectId : sel.value;
    sel.innerHTML = '<option value="">Todos los proyectos</option>' +
      State.projects.map(p => `<option value="${esc(p.id)}">${esc(p.icon || '🗂')} ${esc(p.name)}</option>`).join('');
    sel.value = cur;
  },
};

/* ─────────────────────────────────────────────
   11. INICIALIZACIÓN — sin patch de TabManager
       (dashboard.js ya lo maneja)
───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* Cambio manual del filtro en la pestaña de stats */
  document.getElementById('stats-project-filter')?.addEventListener('change', e => {
    /* Propagar al workspace global para mantener sincrónía */
    if (typeof WorkspaceState !== 'undefined') {
      WorkspaceState.set(e.target.value);
    }
    StatsModule.render();
  });

  /* Botón de actualizar */
  document.getElementById('btn-stats-refresh')?.addEventListener('click', () => {
    StatsModule.render();
    Toast.show('Estadísticas actualizadas.', 'info', 1800);
  });

  /* Renderizar al entrar a la pestaña mediante MutationObserver
     (evita conflicto con la cadena de patches de TabManager) */
  const statsTab = document.getElementById('tab-stats');
  if (statsTab) {
    const obs = new MutationObserver(mutations => {
      mutations.forEach(m => {
        if (m.target === statsTab && m.attributeName === 'class') {
          if (statsTab.classList.contains('active')) {
            StatsModule.render();
          }
        }
      });
    });
    obs.observe(statsTab, { attributes: true, attributeFilter: ['class'] });
  }

  /* También renderizar si ya está activa al cargar */
  if (statsTab?.classList.contains('active')) {
    StatsModule.render();
  }
});
