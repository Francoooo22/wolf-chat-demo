// Panel — Leads: tablero por etapa (embudo de ventas).
import {
  api, st, registrarVista, intentar, dialogo, motivo, chipEtiqueta, etiqueta, toast,
} from './comun.js';
import { abrirConversacion } from './bandeja.js';
import { $, escapar, ETAPAS, nombreEtapa, hace } from '../js/util.js';

const MAX_TARJETAS = 80;
const l = { dias: 90, busqueda: '', sucursal: '', etiqueta: '', mios: false, datos: [], cargando: false };

registrarVista('leads', { mostrar: cargar });

const cont = () => $('#vista-leads');

async function cargar() {
  if (!cont().dataset.armado) armar();
  l.cargando = true;
  pintar();
  const datos = await intentar(() => api.tablero(l.dias));
  l.cargando = false;
  if (datos) l.datos = datos;
  pintar();
}

function armar() {
  cont().dataset.armado = '1';
  cont().innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Leads y clientes</h1>
        <p>Arrastrá cada tarjeta a la etapa en la que está. Las consultas nuevas entran como <b>Nuevo</b>, pasan solas a
        <b>Contactado</b> con la primera respuesta y a <b>Contratado</b> cuando el cliente tiene contrato.</p>
      </div>
    </div>
    <div class="filtros-vista">
      <input class="control" type="search" id="leads-buscar" placeholder="Buscar nombre, colegio o curso" aria-label="Buscar">
      <select class="control" id="leads-dias" aria-label="Período">
        <option value="30">Activos en los últimos 30 días</option>
        <option value="90" selected>Activos en los últimos 90 días</option>
        <option value="180">Activos en los últimos 6 meses</option>
        <option value="365">Activos en el último año</option>
      </select>
      <select class="control" id="leads-sucursal" aria-label="Sucursal"></select>
      <select class="control" id="leads-etiqueta" aria-label="Etiqueta"></select>
      <label class="check-linea"><input type="checkbox" id="leads-mios"> Solo los que atiendo yo</label>
    </div>
    <div class="tablero" id="tablero"></div>`;

  $('#leads-buscar').addEventListener('input', (e) => { l.busqueda = e.target.value.trim().toLowerCase(); pintar(); });
  $('#leads-dias').addEventListener('change', (e) => { l.dias = Number(e.target.value); cargar(); });
  $('#leads-sucursal').addEventListener('change', (e) => { l.sucursal = e.target.value; pintar(); });
  $('#leads-etiqueta').addEventListener('change', (e) => { l.etiqueta = e.target.value; pintar(); });
  $('#leads-mios').addEventListener('change', (e) => { l.mios = e.target.checked; pintar(); });

  const t = $('#tablero');
  t.addEventListener('click', (e) => {
    if (e.target.closest('select')) return;
    const tarjeta = e.target.closest('.tarjeta-lead');
    if (tarjeta?.dataset.conv) abrirConversacion(tarjeta.dataset.conv);
  });
  t.addEventListener('keydown', (e) => {
    const tarjeta = e.target.closest('.tarjeta-lead');
    if (tarjeta && e.target === tarjeta && e.key === 'Enter' && tarjeta.dataset.conv) abrirConversacion(tarjeta.dataset.conv);
  });
  t.addEventListener('change', (e) => {
    if (e.target.matches('[data-mover]')) mover(e.target.dataset.mover, e.target.value);
  });
  t.addEventListener('dragstart', (e) => {
    const tarjeta = e.target.closest('.tarjeta-lead');
    if (!tarjeta) return;
    e.dataTransfer.setData('text/plain', tarjeta.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    tarjeta.classList.add('arrastrando');
  });
  t.addEventListener('dragend', (e) => e.target.closest('.tarjeta-lead')?.classList.remove('arrastrando'));
  t.addEventListener('dragover', (e) => {
    const col = e.target.closest('.columna');
    if (!col) return;
    e.preventDefault();
    t.querySelectorAll('.columna.destino').forEach((c) => c !== col && c.classList.remove('destino'));
    col.classList.add('destino');
  });
  t.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.columna');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('destino');
  });
  t.addEventListener('drop', (e) => {
    const col = e.target.closest('.columna');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('destino');
    mover(e.dataTransfer.getData('text/plain'), col.dataset.etapa);
  });
}

function pintarFiltros() {
  const suc = $('#leads-sucursal');
  const et = $('#leads-etiqueta');
  suc.innerHTML = `<option value="">Todas las sucursales</option>${st.cat.sucursalesTodas
    .map((s) => `<option value="${s.id}">${escapar(s.nombre)}</option>`).join('')}`;
  suc.value = l.sucursal;
  et.innerHTML = `<option value="">Todas las etiquetas</option>${st.cat.etiquetas
    .map((e) => `<option value="${e.id}">${escapar(e.nombre)}</option>`).join('')}`;
  et.value = l.etiqueta;
}

function filtrados() {
  return l.datos.filter((x) => (!l.busqueda || [x.nombre, x.colegio, x.curso].some((v) => (v || '').toLowerCase().includes(l.busqueda)))
    && (!l.sucursal || String(x.sucursal_id) === l.sucursal)
    && (!l.etiqueta || (x.etiquetas || []).includes(Number(l.etiqueta)))
    && (!l.mios || x.gestor_id === st.yo.id));
}

function pintar() {
  if (!cont().dataset.armado) return;
  pintarFiltros();
  const t = $('#tablero');
  if (l.cargando && !l.datos.length) {
    t.innerHTML = '<p class="cargando">Cargando…</p>';
    return;
  }
  const lista = filtrados();
  t.innerHTML = ETAPAS.map((e) => {
    const items = lista.filter((x) => x.etapa === e.id);
    return `
      <section class="columna etapa-${e.id}" data-etapa="${e.id}" aria-label="${e.nombre}">
        <header><h2>${e.nombre}</h2><span class="n">${items.length}</span></header>
        <div class="tarjetas">
          ${items.slice(0, MAX_TARJETAS).map(tarjeta).join('') || '<p class="columna-vacia">Sin tarjetas</p>'}
          ${items.length > MAX_TARJETAS ? `<p class="columna-vacia">Y ${items.length - MAX_TARJETAS} más: usá la búsqueda o los filtros.</p>` : ''}
        </div>
      </section>`;
  }).join('');
}

function tarjeta(x) {
  const m = motivo(x.motivo);
  return `
    <article class="tarjeta-lead" draggable="true" tabindex="0" data-id="${x.id}" ${x.conversacion_id ? `data-conv="${x.conversacion_id}"` : ''}
      style="--c:${escapar(m?.color || '#77757f')}">
      <div class="tl-sup">
        <b>${escapar(x.nombre || 'Sin nombre')}</b>
        ${x.contrato_verificado ? '<span class="tl-ok" title="Contrato verificado">✓</span>' : ''}
      </div>
      <p class="tl-colegio">${escapar([x.colegio, x.curso].filter(Boolean).join(' · ') || 'Sin colegio')}</p>
      <div class="tl-chips">
        ${m ? `<span class="chip motivo" style="--c:${escapar(m.color)}">${escapar(m.nombre)}</span>` : ''}
        ${(x.etiquetas || []).map((id) => chipEtiqueta(etiqueta(id))).join('')}
      </div>
      ${x.etapa === 'perdido' && x.motivo_perdida ? `<p class="tl-perdida">${escapar(x.motivo_perdida)}</p>` : ''}
      <div class="tl-pie">
        <span>${escapar(x.gestor_nombre || 'Sin asignar')} · ${hace(x.ultima_actividad_at)}</span>
        <select data-mover="${x.id}" aria-label="Mover a otra etapa">
          ${ETAPAS.map((e) => `<option value="${e.id}" ${e.id === x.etapa ? 'selected' : ''}>${e.nombre}</option>`).join('')}
        </select>
      </div>
    </article>`;
}

async function mover(id, etapa) {
  const x = l.datos.find((d) => d.id === id);
  if (!x || x.etapa === etapa) return;
  let motivoPerdida = null;
  if (etapa === 'perdido') {
    const { valor, form } = await dialogo({
      titulo: `Marcar a ${x.nombre || 'este lead'} como perdido`,
      cuerpo: `<label class="campo"><span>¿Por qué no avanzó?</span>
        <select name="motivo">
          <option>Eligió otra empresa</option><option>Precio</option><option>El curso no viaja</option>
          <option>No respondió más</option><option>Otro</option>
        </select></label>
        <label class="campo"><span>Detalle (opcional)</span><input name="detalle" maxlength="150"></label>`,
      botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: 'Guardar', primario: true }],
    });
    if (valor !== 'ok') { pintar(); return; }
    motivoPerdida = [form.motivo.value, form.detalle.value.trim()].filter(Boolean).join(': ');
  }
  const antes = { etapa: x.etapa, motivo_perdida: x.motivo_perdida };
  Object.assign(x, { etapa, motivo_perdida: motivoPerdida });
  pintar();
  const ok = await intentar(() => api.cambiarEtapa(id, etapa, motivoPerdida));
  if (!ok) {
    Object.assign(x, antes);
    pintar();
  } else {
    toast(`${x.nombre || 'Lead'}: ${nombreEtapa(etapa)}`);
  }
}
