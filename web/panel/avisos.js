// Panel — Avisos por correo a un colegio, curso, etapa o etiqueta (supervisores y administradores).
import { api, st, registrarVista, intentar, dialogo, toast, fechaHora, numero, etiqueta } from './comun.js';
import { $, escapar, ETAPAS, nombreEtapa } from '../js/util.js';

const a = { colegios: [], seleccion: new Set(), cursos: [], cursosSel: new Set(), contador: 0 };

registrarVista('avisos', { mostrar: cargar });

const cont = () => $('#vista-avisos');

async function cargar() {
  if (!cont().dataset.armado) armar();
  const [colegios] = await Promise.all([intentar(() => api.valoresColegios()), historial()]);
  if (colegios) {
    a.colegios = colegios;
    pintarColegios();
  }
  pintarSelects();
  contar();
}

function armar() {
  cont().dataset.armado = '1';
  cont().innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Avisos por correo</h1>
        <p>Mandá un correo a todos los contactos de un colegio, un curso o una etapa: cambios de horario de una reunión,
        documentación pendiente, novedades del viaje. Solo llega a quienes dejaron su correo y no pidieron la baja;
        cada correo incluye el enlace para dejar de recibir avisos.</p>
      </div>
    </div>
    <div class="avisos-layout">
      <form class="tarjeta" id="form-aviso">
        <h2>Nuevo aviso</h2>
        <fieldset class="destinatarios">
          <legend>¿A quiénes?</legend>
          <div class="campo">
            <span>Colegios <small id="colegios-cuenta"></small></span>
            <input class="control" type="search" id="buscar-colegio" placeholder="Buscar colegio" aria-label="Buscar colegio">
            <div class="lista-checks" id="lista-colegios"></div>
          </div>
          <div class="campo">
            <span>Cursos <small>(si no elegís ninguno, van todos)</small></span>
            <div class="lista-checks chica" id="lista-cursos"><span class="nadie">Elegí uno o más colegios para filtrar por curso.</span></div>
          </div>
          <div class="form-grilla">
            <label class="campo"><span>Etapa</span><select name="etapa"></select></label>
            <label class="campo"><span>Tipo</span>
              <select name="tipo"><option value="">Clientes y leads</option><option value="cliente">Solo clientes con contrato</option><option value="lead">Solo leads</option></select></label>
            <label class="campo"><span>Sucursal</span><select name="sucursal_id"></select></label>
            <label class="campo"><span>Etiqueta</span><select name="etiqueta_id"></select></label>
          </div>
          <p class="cuenta-destinatarios" id="cuenta-destinatarios" aria-live="polite"></p>
        </fieldset>
        <label class="campo"><span>Asunto</span><input name="asunto" required minlength="3" maxlength="150" placeholder="Ej.: Reunión de padres del viaje a Bariloche"></label>
        <label class="campo"><span>Mensaje</span>
          <textarea name="cuerpo" required minlength="10" maxlength="5000" rows="8"
            placeholder="El correo empieza con «Hola (nombre):» y termina con el enlace al chat. Escribí solo el contenido."></textarea></label>
        <p class="ayuda-campo">El plan gratuito de Resend permite 100 correos por día y 3.000 por mes. Si un aviso supera el
          límite diario, queda a medio enviar y lo podés continuar al día siguiente desde el historial.</p>
        <div class="pie-form">
          <button class="boton" type="button" id="ver-destinatarios">Ver la lista</button>
          <button class="boton primario" type="submit" id="enviar-aviso" disabled>Enviar aviso</button>
        </div>
      </form>
      <section class="tarjeta">
        <h2>Enviados</h2>
        <div id="historial-avisos"><p class="cargando">Cargando…</p></div>
      </section>
    </div>`;

  const f = $('#form-aviso');
  $('#buscar-colegio').addEventListener('input', pintarColegios);
  $('#lista-colegios').addEventListener('change', async (e) => {
    if (!e.target.matches('input')) return;
    if (e.target.checked) a.seleccion.add(e.target.value); else a.seleccion.delete(e.target.value);
    await cargarCursos();
    contar();
  });
  $('#lista-cursos').addEventListener('change', (e) => {
    if (!e.target.matches('input')) return;
    if (e.target.checked) a.cursosSel.add(e.target.value); else a.cursosSel.delete(e.target.value);
    contar();
  });
  f.addEventListener('change', (e) => { if (e.target.matches('select')) contar(); });
  $('#ver-destinatarios').addEventListener('click', verLista);
  f.addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
  $('#historial-avisos').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-continuar]');
    if (b) await procesar(b.dataset.continuar);
  });
}

function pintarSelects() {
  const f = $('#form-aviso');
  const mantener = (sel, html) => { const v = sel.value; sel.innerHTML = html; sel.value = v; };
  mantener(f.etapa, `<option value="">Todas las etapas</option>${ETAPAS.map((e) => `<option value="${e.id}">${e.nombre}</option>`).join('')}`);
  mantener(f.sucursal_id, `<option value="">Todas</option>${st.cat.sucursalesTodas.map((s) => `<option value="${s.id}">${escapar(s.nombre)}</option>`).join('')}`);
  mantener(f.etiqueta_id, `<option value="">Todas</option>${st.cat.etiquetas.map((e) => `<option value="${e.id}">${escapar(e.nombre)}</option>`).join('')}`);
}

function pintarColegios() {
  const q = $('#buscar-colegio').value.trim().toLowerCase();
  const lista = a.colegios.filter((c) => !q || c.nombre.toLowerCase().includes(q) || a.seleccion.has(c.clave));
  $('#lista-colegios').innerHTML = lista.length
    ? lista.slice(0, 200).map((c) => `
      <label><input type="checkbox" value="${escapar(c.clave)}" ${a.seleccion.has(c.clave) ? 'checked' : ''}>
        <span>${escapar(c.nombre)} <small>${numero(c.clientes)} contacto${c.clientes === 1 ? '' : 's'}</small></span></label>`).join('')
    : '<span class="nadie">Ningún colegio coincide.</span>';
  $('#colegios-cuenta').textContent = a.seleccion.size ? `(${a.seleccion.size} elegido${a.seleccion.size === 1 ? '' : 's'})` : '(si no elegís ninguno, van todos)';
}

async function cargarCursos() {
  pintarColegios();
  const caja = $('#lista-cursos');
  if (!a.seleccion.size) {
    a.cursos = [];
    a.cursosSel.clear();
    caja.innerHTML = '<span class="nadie">Elegí uno o más colegios para filtrar por curso.</span>';
    return;
  }
  a.cursos = (await intentar(() => api.valoresCursos([...a.seleccion]))) || [];
  a.cursosSel = new Set([...a.cursosSel].filter((c) => a.cursos.some((x) => x.curso === c)));
  caja.innerHTML = a.cursos.length
    ? a.cursos.map((c) => `<label><input type="checkbox" value="${escapar(c.curso)}" ${a.cursosSel.has(c.curso) ? 'checked' : ''}>
        <span>${escapar(c.curso)} <small>${numero(c.clientes)}</small></span></label>`).join('')
    : '<span class="nadie">Los contactos de esos colegios no tienen curso cargado.</span>';
}

function filtro() {
  const f = $('#form-aviso');
  const x = {};
  if (a.seleccion.size) x.colegios = [...a.seleccion];
  if (a.cursosSel.size) x.cursos = [...a.cursosSel];
  if (f.etapa.value) x.etapa = f.etapa.value;
  if (f.tipo.value) x.tipo = f.tipo.value;
  if (f.sucursal_id.value) x.sucursal_id = Number(f.sucursal_id.value);
  if (f.etiqueta_id.value) x.etiqueta_id = Number(f.etiqueta_id.value);
  return x;
}

function resumenFiltro(x) {
  const partes = [];
  if (x.colegios?.length) {
    partes.push(x.colegios.map((k) => a.colegios.find((c) => c.clave === k)?.nombre || k).join(', '));
  }
  if (x.cursos?.length) partes.push(`cursos ${x.cursos.join(', ')}`);
  if (x.etapa) partes.push(`etapa ${nombreEtapa(x.etapa)}`);
  if (x.tipo) partes.push(x.tipo === 'cliente' ? 'solo clientes' : 'solo leads');
  if (x.sucursal_id) partes.push(`sucursal ${st.cat.sucursalesTodas.find((s) => s.id === x.sucursal_id)?.nombre || ''}`);
  if (x.etiqueta_id) partes.push(`etiqueta ${etiqueta(x.etiqueta_id)?.nombre || ''}`);
  return partes.join(' · ') || 'Todos los contactos con correo';
}

let contarTimer;
let contarVersion = 0;
function contar() {
  clearTimeout(contarTimer);
  contarTimer = setTimeout(async () => {
    const v = ++contarVersion;
    const lista = await intentar(() => api.destinatarios(filtro()));
    if (v !== contarVersion || !lista) return;
    a.contador = lista.length;
    const p = $('#cuenta-destinatarios');
    p.innerHTML = lista.length
      ? `Le llega a <b>${numero(lista.length)}</b> ${lista.length === 1 ? 'persona' : 'personas'}: ${escapar(resumenFiltro(filtro()))}.`
      : 'Con este filtro no hay nadie con correo que acepte avisos.';
    $('#enviar-aviso').disabled = !lista.length;
    $('#enviar-aviso').textContent = lista.length ? `Enviar a ${numero(lista.length)}` : 'Enviar aviso';
  }, 250);
}

async function verLista() {
  const lista = await intentar(() => api.destinatarios(filtro()));
  if (!lista) return;
  await dialogo({
    titulo: `${numero(lista.length)} destinatarios`,
    ancho: 620,
    cuerpo: lista.length
      ? `<div class="tabla-scroll alta"><table class="tabla-datos"><thead><tr><th>Nombre</th><th>Correo</th><th>Colegio</th><th>Curso</th></tr></thead>
         <tbody>${lista.map((d) => `<tr><td>${escapar(d.nombre || '')}</td><td>${escapar(d.email)}</td><td>${escapar(d.colegio || '')}</td><td>${escapar(d.curso || '')}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="dlg-texto">Nadie coincide con el filtro.</p>',
    botones: [{ valor: 'ok', texto: 'Cerrar', primario: true }],
  });
}

async function enviar() {
  const f = $('#form-aviso');
  if (!f.reportValidity()) return;
  const x = filtro();
  const { valor } = await dialogo({
    titulo: 'Confirmar envío',
    cuerpo: `<p class="dlg-texto">Se va a enviar <b>“${escapar(f.asunto.value.trim())}”</b> a <b>${numero(a.contador)}</b>
      ${a.contador === 1 ? 'persona' : 'personas'} (${escapar(resumenFiltro(x))}). Una vez enviado no se puede deshacer.</p>`,
    botones: [{ valor: 'cancelar', texto: 'Revisar' }, { valor: 'ok', texto: 'Enviar ahora', primario: true }],
  });
  if (valor !== 'ok') return;
  const boton = $('#enviar-aviso');
  boton.disabled = true;
  const creado = await intentar(() => api.crearAviso(f.asunto.value.trim(), f.cuerpo.value.trim(), x));
  if (!creado) { boton.disabled = false; return; }
  await procesar(creado.id);
  f.asunto.value = '';
  f.cuerpo.value = '';
  contar();
}

// Llama a la función de envío hasta que no queden pendientes (cada llamada envía hasta 90 segundos).
async function procesar(id) {
  const boton = $('#enviar-aviso');
  boton.textContent = 'Enviando…';
  let r;
  for (let vuelta = 0; vuelta < 20; vuelta += 1) {
    r = await intentar(() => api.enviarAviso(id));
    if (!r || !r.pendientes || r.estado === 'con_errores') break;
    toast(`Enviados ${numero(r.enviados)}, faltan ${numero(r.pendientes)}…`);
  }
  if (r) {
    if (r.pendientes) toast(`Quedaron ${numero(r.pendientes)} sin enviar. Probá continuar más tarde desde el historial.`, true);
    else if (r.fallidos) toast(`Enviado con ${numero(r.fallidos)} errores (ver historial).`, true);
    else toast(`Aviso enviado a ${numero(r.enviados)} ${r.enviados === 1 ? 'persona' : 'personas'}.`);
  }
  boton.textContent = 'Enviar aviso';
  await historial();
}

const ESTADOS = { pendiente: 'Pendiente', enviando: 'A medio enviar', enviado: 'Enviado', con_errores: 'Con errores' };

async function historial() {
  const lista = await intentar(() => api.avisos());
  const caja = $('#historial-avisos');
  if (!lista || !caja) return;
  caja.innerHTML = lista.length ? `
    <ul class="lista-avisos">
      ${lista.map((x) => `
        <li>
          <div class="av-sup"><b>${escapar(x.asunto)}</b><span class="chip ${x.estado === 'enviado' ? 'ok' : x.estado === 'con_errores' ? 'alerta-suave' : ''}">${ESTADOS[x.estado]}</span></div>
          <p>${escapar(resumenFiltro(x.filtro || {}))}</p>
          <p class="av-pie">${fechaHora(x.created_at)} · ${escapar(x.creado_nombre || '')} ·
            ${numero(x.enviados)} de ${numero(x.destinatarios)} enviados${x.fallidos ? ` · ${numero(x.fallidos)} con error` : ''}
            ${['pendiente', 'enviando'].includes(x.estado) ? `<button class="texto-boton" type="button" data-continuar="${x.id}">Continuar envío</button>` : ''}</p>
        </li>`).join('')}
    </ul>` : '<p class="nadie">Todavía no se envió ningún aviso.</p>';
}
