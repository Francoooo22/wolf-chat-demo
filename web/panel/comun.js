// Panel de gestores — estado compartido y utilidades de todas las vistas.
import { CONFIG } from '../js/config.js';
import { crearApiPanel, MODO_DEMO } from '../js/api.js';
import { $, escapar, nombreEtapa } from '../js/util.js';

export { CONFIG, MODO_DEMO };
export const api = crearApiPanel();

export const RELACION = { alumno: 'Alumno/a', familiar: 'Madre, padre o tutor', docente: 'Docente o coordinador', otro: 'Otro' };
export const ROL = { admin: 'Administrador', supervisor: 'Supervisor', gestor: 'Gestor' };
export const PALETA = [
  ['#0b34dc', 'Azul'], ['#1f8a5b', 'Verde'], ['#13809a', 'Turquesa'], ['#c8402a', 'Rojo'],
  ['#5b45c4', 'Violeta'], ['#b5600b', 'Naranja'], ['#77757f', 'Gris'],
];

// Estado compartido entre las vistas.
export const st = {
  yo: null,       // gestor que ingresó
  cat: null,      // catálogos: motivos, equipos, gestores, configuración…
  convs: [],      // consultas visibles (bandeja)
  vista: 'bandeja',
};

export const esSupervisor = () => ['admin', 'supervisor'].includes(st.yo?.rol);
export const esAdmin = () => st.yo?.rol === 'admin';
export const misEquipos = () => st.yo?.equipos || [];
export const motivo = (codigo) => st.cat?.motivosTodos.find((m) => m.codigo === codigo);
export const colorMotivo = (codigo) => motivo(codigo)?.color || '#77757f';
export const nombreEquipo = (id) => st.cat?.equipos.find((e) => e.id === id)?.nombre || 'Sin equipo';
export const etiqueta = (id) => st.cat?.etiquetas.find((e) => e.id === id);

export const chipMotivo = (m) => `<span class="chip motivo" style="--c:${escapar(m?.color || '#77757f')}">${escapar(m?.nombre || '')}</span>`;
export const chipEtiqueta = (e, quitar = false) => (e
  ? `<span class="chip etiqueta" style="--c:${escapar(e.color)}">${escapar(e.nombre)}${quitar
    ? `<button type="button" data-quitar-etiqueta="${e.id}" aria-label="Quitar etiqueta ${escapar(e.nombre)}">×</button>` : ''}</span>`
  : '');
export const chipEtapa = (id) => `<span class="chip etapa etapa-${escapar(id)}">${escapar(nombreEtapa(id))}</span>`;
export const chipTipo = (tipo) => `<span class="chip ${tipo === 'cliente' ? 'cliente' : 'lead'}">${tipo === 'cliente' ? 'Cliente' : 'Lead'}</span>`;

export const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Mendoza' }).format(new Date());
export const sumarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const fechaCorta = (iso) => (iso ? new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Argentina/Mendoza',
}).format(new Date(iso)) : '');
export const fechaHora = (iso) => (iso ? new Intl.DateTimeFormat('es-AR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  timeZone: 'America/Argentina/Mendoza',
}).format(new Date(iso)) : '');
export const numero = (n, dec = 0) => (n == null ? '—' : new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: dec, maximumFractionDigits: dec,
}).format(n));

// ---------------------------------------------------------------------
// Avisos en pantalla
// ---------------------------------------------------------------------

let toastTimer;
export function toast(texto, error = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast ${error ? 'error' : ''}`;
  t.setAttribute('role', error ? 'alert' : 'status');
  t.textContent = texto;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), error ? 6000 : 3200);
}

// Ejecuta una acción y muestra el resultado. Devuelve el resultado (o true si la
// acción no devuelve nada) cuando sale bien, y undefined cuando falla.
export async function intentar(fn, ok) {
  try {
    const r = await fn();
    if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
    return r ?? true;
  } catch (e) {
    console.error(e);
    toast(e.message || 'Algo salió mal', true);
    return undefined;
  }
}

// ---------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------

const alCargar = new Set();
export const alCargarCatalogos = (fn) => alCargar.add(fn);

export async function cargarCatalogos() {
  st.cat = await api.catalogos();
  // Mantiene al día los datos propios (por si un administrador se editó a sí mismo).
  const yo = st.cat.gestores.find((g) => g.id === st.yo?.id);
  if (yo) st.yo = { ...st.yo, nombre: yo.nombre, rol: yo.rol, equipos: yo.equipos, disponible: yo.disponible };
  alCargar.forEach((fn) => fn());
  return st.cat;
}

// ---------------------------------------------------------------------
// Vistas (Bandeja, Leads, Reportes, Avisos, Administración)
// ---------------------------------------------------------------------

const vistas = new Map();
export function registrarVista(id, { mostrar, ocultar } = {}) {
  vistas.set(id, { mostrar, ocultar });
}

export function cambiarVista(id) {
  const anterior = st.vista;
  if (anterior !== id) vistas.get(anterior)?.ocultar?.();
  st.vista = id;
  document.querySelectorAll('.barra nav button').forEach((b) => {
    if (b.dataset.vista === id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-vista-contenedor]').forEach((s) => { s.hidden = s.dataset.vistaContenedor !== id; });
  vistas.get(id)?.mostrar?.();
}

// ---------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------

// Botón "Eliminar" de los diálogos: pide un segundo clic para confirmar.
export function prepararEliminar(dlg, visible, etiquetaBoton = 'Eliminar') {
  const b = dlg.querySelector('[data-eliminar]');
  if (!b) return;
  b.hidden = !visible;
  b.textContent = etiquetaBoton;
  b.classList.remove('confirmar');
  b.onclick = () => {
    if (!b.classList.contains('confirmar')) {
      b.classList.add('confirmar');
      b.textContent = `Confirmar: ${etiquetaBoton.toLowerCase()}`;
      return;
    }
    dlg.close('eliminar');
  };
}

// Diálogo armado en el momento. Devuelve { valor, form } cuando se cierra.
//   titulo, cuerpo (HTML), botones: [{ valor, texto, primario, peligro, izquierda }]
//   eliminar: texto del botón de eliminar (pide confirmación) o null
//   alAbrir(form): para completar valores o enganchar eventos
export function dialogo({ titulo, cuerpo = '', botones = [], eliminar = null, alAbrir, ancho = null }) {
  const dlg = $('#dlg-generico');
  dlg.style.width = ancho ? `min(${ancho}px, calc(100vw - 32px))` : '';
  // "Cancelar" no es un botón de envío: así Enter en un campo confirma en lugar de cancelar.
  const botonesHtml = botones.map((b) => (b.valor === 'cancelar'
    ? `<button class="boton" type="button" data-cancelar>${escapar(b.texto)}</button>`
    : `<button class="boton ${b.primario ? 'primario' : ''} ${b.peligro ? 'peligro confirmar' : ''}" value="${escapar(b.valor)}">${escapar(b.texto)}</button>`)).join('');
  dlg.innerHTML = `
    <form method="dialog">
      <h2>${escapar(titulo)}</h2>
      ${cuerpo}
      <div class="pie">
        ${eliminar ? '<button class="boton peligro izquierda" type="button" data-eliminar>Eliminar</button>' : ''}
        ${botonesHtml}
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  if (eliminar) prepararEliminar(dlg, true, eliminar);
  alAbrir?.(form);
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve({ valor: dlg.returnValue, form }), { once: true });
  });
}

// Los botones "Cancelar" de todos los diálogos cierran sin validar.
document.addEventListener('click', (e) => {
  const b = e.target.closest('dialog [data-cancelar]');
  if (b) b.closest('dialog').close('cancelar');
});

// Confirmación simple. Devuelve true si se eligió el botón principal.
export async function confirmar(titulo, texto, { aceptar = 'Aceptar', peligro = false } = {}) {
  const { valor } = await dialogo({
    titulo,
    cuerpo: `<p class="dlg-texto">${texto}</p>`,
    botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: aceptar, primario: !peligro, peligro }],
  });
  return valor === 'ok';
}
