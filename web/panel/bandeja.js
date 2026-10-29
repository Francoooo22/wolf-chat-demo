// Panel — Bandeja: lista de consultas, conversación y ficha del cliente.
import {
  api, st, CONFIG, RELACION, esSupervisor, misEquipos, motivo, colorMotivo, nombreEquipo, etiqueta,
  chipEtiqueta, chipTipo, toast, intentar, registrarVista, cambiarVista, dialogo, confirmar, fechaCorta, fechaHora,
  alCargarCatalogos,
} from './comun.js';
import {
  $, escapar, textoConEnlaces, hora, etiquetaDia, claveDia, momentoCorto, hace, tamanio, primerNombre, ICONOS,
  ETAPAS, nombreEtapa, descargarTexto,
} from '../js/util.js';

const b = {
  pestana: 'mias',
  busqueda: '',
  motivo: '',
  abiertaId: null,
  abierta: null,
  desMensajes: null,
  canal: null,            // "escribiendo…" de la consulta abierta
  ultimoAviso: 0,
  timerEscribiendo: null,
  pintados: new Set(),
  ultimoDia: null,
  modoNota: false,
  conocidos: null,        // Map id → no_leidos_gestor, para detectar novedades
  fichaCliente: null,
  iniciada: false,
};

registrarVista('bandeja', {});

alCargarCatalogos(() => {
  const sel = $('#filtro-motivo');
  sel.innerHTML = `<option value="">Todos los motivos</option>${st.cat.motivosTodos
    .map((m) => `<option value="${escapar(m.codigo)}">${escapar(m.nombre)}</option>`).join('')}`;
  sel.value = b.motivo;
});

export async function iniciarBandeja() {
  if (b.iniciada) return;
  b.iniciada = true;
  if (esSupervisor()) b.pestana = 'todas';
  await recargarLista();
  api.suscribirBandeja(() => programarRecarga());
  setInterval(() => recargarLista(), 60000);   // red de seguridad por si se corta el tiempo real
}

// ---------------------------------------------------------------------
// Avisos de novedades
// ---------------------------------------------------------------------

let audio;
function sonar() {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.4);
  } catch { /* sin audio */ }
}

function notificar(titulo, cuerpo, convId) {
  sonar();
  // Con las notificaciones push activas, el aviso del sistema ya llega por esa vía.
  if (st.pushActivo || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const n = new Notification(titulo, { body: cuerpo, tag: convId, icon: CONFIG.MARCA.logo });
  n.onclick = () => { window.focus(); abrirConversacion(convId); n.close(); };
}

// ---------------------------------------------------------------------
// Lista de consultas
// ---------------------------------------------------------------------

let recargaTimer;
export function programarRecarga() {
  clearTimeout(recargaTimer);
  recargaTimer = setTimeout(recargarLista, 250);
}

async function recargarLista() {
  let convs;
  try {
    convs = await api.conversaciones();
  } catch (e) {
    console.error(e);
    return;
  }
  detectarNovedades(convs);
  st.convs = convs;
  renderPestanas();
  renderLista();
  if (b.abiertaId) {
    const c = convs.find((x) => x.id === b.abiertaId);
    const fichaCambio = c && b.abierta && ['primera_respuesta_at', 'csat'].some((k) => b.abierta[k] !== c[k]);
    if (c && cambioRelevante(b.abierta, c)) {
      b.abierta = c;
      renderCabecera();
      renderResponder();
    } else if (c) {
      b.abierta = { ...b.abierta, leido_cliente_at: c.leido_cliente_at, primera_respuesta_at: c.primera_respuesta_at, csat: c.csat };
      if (fichaCambio) renderCabecera();
    }
    if (fichaCambio) renderFicha(b.abierta);
    actualizarVistos();
  }
}

function cambioRelevante(a, c) {
  if (!a) return true;
  return ['estado', 'gestor_id', 'alerta_demora', 'equipo_id', 'motivo'].some((k) => a[k] !== c[k]);
}

function meToca(c) {
  return c.gestor_id === st.yo.id || (!c.gestor_id && (esSupervisor() || misEquipos().includes(c.equipo_id)));
}

function detectarNovedades(convs) {
  const previos = b.conocidos;
  b.conocidos = new Map(convs.map((c) => [c.id, c.no_leidos_gestor]));
  if (!previos) return;
  for (const c of convs) {
    if (c.estado !== 'abierta' || !meToca(c)) continue;
    const antes = previos.get(c.id);
    const nombre = c.cliente?.nombre || 'Cliente';
    if (antes === undefined) {
      notificar('Nueva consulta', `${nombre}: ${motivo(c.motivo)?.nombre || ''}`, c.id);
    } else if (c.no_leidos_gestor > antes && (document.hidden || c.id !== b.abiertaId)) {
      notificar(`Mensaje de ${primerNombre(nombre)}`, c.ultimo_mensaje_preview || '', c.id);
    }
  }
}

function pestanas() {
  const abiertas = st.convs.filter((c) => c.estado === 'abierta');
  const lista = [
    { id: 'mias', texto: 'Mías', convs: abiertas.filter((c) => c.gestor_id === st.yo.id) },
    { id: 'fila', texto: 'En fila', convs: abiertas.filter((c) => !c.gestor_id) },
  ];
  if (esSupervisor()) lista.push({ id: 'todas', texto: 'Todas', convs: abiertas });
  lista.push({ id: 'resueltas', texto: 'Resueltas', convs: st.convs.filter((c) => c.estado === 'resuelta'), sinContador: true });
  return lista;
}

function renderPestanas() {
  const cont = $('#pestanas');
  cont.replaceChildren(...pestanas().map((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(b.pestana === p.id));
    const urgente = p.convs.some((c) => c.alerta_demora);
    btn.innerHTML = escapar(p.texto) + (p.sinContador ? '' : `<span class="n ${urgente ? 'urgente' : ''}">${p.convs.length}</span>`);
    btn.addEventListener('click', () => { b.pestana = p.id; renderPestanas(); renderLista(); });
    return btn;
  }));
}

function coincide(c) {
  if (b.motivo && c.motivo !== b.motivo) return false;
  if (!b.busqueda) return true;
  const q = b.busqueda.toLowerCase();
  return [c.cliente?.nombre, c.cliente?.colegio, c.cliente?.curso, c.cliente?.nro_contrato, String(c.numero)]
    .some((v) => (v || '').toLowerCase().includes(q));
}

function renderLista() {
  const p = pestanas().find((x) => x.id === b.pestana) || pestanas()[0];
  const convs = p.convs.filter(coincide).sort((x, y) => {
    if (p.id !== 'resueltas' && x.alerta_demora !== y.alerta_demora) return x.alerta_demora ? -1 : 1;
    return y.ultimo_mensaje_at.localeCompare(x.ultimo_mensaje_at);
  });
  const ul = $('#lista');
  if (!convs.length) {
    const vacios = {
      mias: 'No tenés consultas abiertas. Las nuevas aparecen acá apenas llegan.',
      fila: 'No hay consultas esperando asignación.',
      todas: 'No hay consultas abiertas.',
      resueltas: 'Todavía no hay consultas resueltas.',
    };
    ul.innerHTML = `<li class="lista-vacia">${b.busqueda || b.motivo ? 'Ninguna consulta coincide con la búsqueda.' : vacios[p.id]}</li>`;
    return;
  }
  ul.innerHTML = convs.map((c) => {
    const m = motivo(c.motivo);
    const sinLeer = c.no_leidos_gestor > 0 && c.estado === 'abierta';
    const asignacion = p.id === 'todas' || p.id === 'resueltas'
      ? `<span class="chip">${c.gestor_nombre ? escapar(c.gestor_nombre) : 'En fila'}</span>` : '';
    return `
      <li class="item ${c.alerta_demora ? 'alerta' : ''} ${sinLeer ? 'sin-leer' : ''}" data-id="${c.id}"
          style="--c:${colorMotivo(c.motivo)}" aria-current="${c.id === b.abiertaId}" tabindex="0">
        <div class="item-sup"><b>${escapar(c.cliente?.nombre || 'Cliente')}</b><time datetime="${c.ultimo_mensaje_at}">${momentoCorto(c.ultimo_mensaje_at)}</time></div>
        <div class="item-etiquetas">
          <span class="chip motivo" style="--c:${colorMotivo(c.motivo)}">${escapar(m?.nombre || c.motivo)}</span>
          ${chipTipo(c.cliente?.tipo)}
          ${asignacion}
          ${c.alerta_demora ? `<span class="chip alerta" title="Sin respuesta">${ICONOS.reloj}Demora</span>` : ''}
          ${c.fuera_de_horario && c.pendiente_respuesta ? `<span class="chip noche" title="Llegó fuera de horario">${ICONOS.luna}</span>` : ''}
        </div>
        <p class="preview">${escapar(c.ultimo_mensaje_preview || '')}</p>
        ${sinLeer ? `<span class="contador">${c.no_leidos_gestor}</span>` : ''}
      </li>`;
  }).join('');
}

$('#lista').addEventListener('click', (e) => {
  const li = e.target.closest('.item');
  if (li) abrirConversacion(li.dataset.id);
});
$('#lista').addEventListener('keydown', (e) => {
  const li = e.target.closest('.item');
  if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirConversacion(li.dataset.id); }
});
$('#buscar').addEventListener('input', (e) => { b.busqueda = e.target.value.trim(); renderLista(); });
$('#filtro-motivo').addEventListener('change', (e) => { b.motivo = e.target.value; renderLista(); });

// ---------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------

export async function abrirConversacion(id) {
  if (st.vista !== 'bandeja') cambiarVista('bandeja');
  b.desMensajes?.();
  b.canal?.cerrar();
  b.abiertaId = id;
  b.pintados = new Set();
  b.ultimoDia = null;
  b.modoNota = false;
  $('#vista-bandeja').classList.add('con-conversacion');
  renderLista();

  let c;
  try {
    c = await api.conversacion(id);
  } catch (e) {
    toast(e.message, true);
    return;
  }
  b.abierta = c;
  const main = $('#conversacion');
  main.innerHTML = `
    <header class="conv-cabecera" id="conv-cabecera"></header>
    <div class="mensajes" id="mensajes" aria-live="polite"></div>
    <div id="zona-respuesta"></div>`;
  renderCabecera();
  renderResponder();

  const mensajes = await intentar(() => api.mensajes(id));
  if (b.abiertaId !== id) return;
  (mensajes || []).forEach(pintarMensaje);
  await pintarCharlaConBot(id);
  if (b.abiertaId !== id) return;
  actualizarVistos();
  bajar();

  b.desMensajes = api.suscribirMensajes(id, (m) => {
    if (b.abiertaId !== id) return;
    pintarMensaje(m);
    bajar();
    if (m.autor_tipo === 'cliente' && !document.hidden) api.marcarLeida(id).catch(() => {});
  });
  b.canal = api.escribiendo(id, (p) => {
    if (b.abiertaId === id && p?.quien === 'cliente') mostrarEscribiendo();
  });

  api.marcarLeida(id).then(programarRecarga).catch(() => {});
  renderFicha(c);
}

function cerrarConversacion() {
  $('#vista-bandeja').classList.remove('con-conversacion');
  b.desMensajes?.();
  b.canal?.cerrar();
  b.abiertaId = null;
  renderLista();
}

function bajar() {
  const box = $('#mensajes');
  if (box) requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

const puedeGestionar = (c) => esSupervisor() || c.gestor_id === st.yo.id;
const puedeTomar = (c) => c.estado === 'abierta' && !c.gestor_id && (esSupervisor() || misEquipos().includes(c.equipo_id));
const puedeEscribir = (c) => c.estado === 'abierta' && (puedeGestionar(c) || puedeTomar(c));

function renderCabecera() {
  const c = b.abierta;
  const cab = $('#conv-cabecera');
  if (!cab || !c) return;
  const m = motivo(c.motivo);
  const asignada = c.gestor_id
    ? (c.gestor_id === st.yo.id ? 'Asignada a vos' : `La atiende ${escapar(c.gestor_nombre || '')}`)
    : `En fila de ${escapar(nombreEquipo(c.equipo_id))}`;

  const acciones = [];
  if (puedeTomar(c)) acciones.push('<button class="boton primario" data-accion="tomar">Tomar consulta</button>');
  if (c.estado === 'abierta' && puedeGestionar(c)) {
    acciones.push('<button class="boton" data-accion="transferir">Transferir</button>');
    acciones.push('<button class="boton" data-accion="resolver">Marcar resuelta</button>');
  }
  if (c.estado === 'resuelta' && puedeGestionar(c)) acciones.push('<button class="boton" data-accion="reabrir">Reabrir</button>');
  acciones.push(`<button class="boton icono" data-accion="descargar" title="Descargar la conversación" aria-label="Descargar la conversación">${ICONO_DESCARGA}</button>`);
  acciones.push('<button class="boton ver-ficha" data-accion="ficha">Datos del cliente</button>');

  cab.innerHTML = `
    <button class="boton volver" data-accion="volver" aria-label="Volver a la lista">${ICONOS.volver}</button>
    <div class="titulo">
      <h2>${escapar(c.cliente?.nombre || 'Cliente')}</h2>
      <div class="datos">
        <span>N° ${c.numero}</span>
        <span class="chip motivo" style="--c:${colorMotivo(c.motivo)}">${escapar(m?.nombre || c.motivo)}</span>
        ${chipTipo(c.cliente?.tipo)}
        ${c.estado === 'resuelta' ? '<span class="chip resuelta">Resuelta</span>' : ''}
        ${c.csat ? `<span class="chip csat" title="Calificación del cliente">★ ${c.csat}</span>` : ''}
        ${c.alerta_demora ? `<span class="chip alerta">${ICONOS.reloj}Sin respuesta ${c.esperando_desde ? hace(c.esperando_desde) : ''}</span>` : ''}
        <span>${asignada}</span>
      </div>
    </div>
    <div class="acciones">${acciones.join('')}</div>`;
}

const ICONO_DESCARGA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

$('#conversacion').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-accion]');
  if (!btn || !b.abierta) return;
  const c = b.abierta;
  const accion = btn.dataset.accion;
  if (accion === 'volver') cerrarConversacion();
  else if (accion === 'ficha') $('#ficha').classList.add('visible');
  else if (accion === 'tomar') {
    await intentar(() => api.tomar(c.id), 'Tomaste la consulta');
    await refrescarAbierta();
  } else if (accion === 'resolver') {
    await intentar(() => api.cambiarEstado(c.id, 'resuelta'), 'Consulta marcada como resuelta');
    await refrescarAbierta();
  } else if (accion === 'reabrir') {
    await intentar(() => api.cambiarEstado(c.id, 'abierta'), 'Consulta reabierta');
    await refrescarAbierta();
  } else if (accion === 'transferir') {
    abrirTransferir(c);
  } else if (accion === 'descargar') {
    descargarConversacion(c);
  }
});

async function refrescarAbierta() {
  if (!b.abiertaId) return;
  b.abierta = await api.conversacion(b.abiertaId);
  renderCabecera();
  renderResponder();
  programarRecarga();
}

// Lo que el cliente habló con el bot antes de llegar al equipo: queda oculto hasta tocar "Ver todo el chat".
async function pintarCharlaConBot(id) {
  const lineas = await intentar(() => api.charlaConBot(id));
  const box = $('#mensajes');
  if (!lineas?.length || !box || b.abiertaId !== id) return;
  box.insertAdjacentHTML('afterbegin', `
    <div class="charla-bot" id="charla-bot">
      <button type="button" class="boton chico" id="ver-charla-bot" aria-expanded="false" aria-controls="charla-bot-lineas">Ver todo el chat</button>
      <div class="charla-bot-lineas" id="charla-bot-lineas" hidden>
        <p class="m-sistema interno">Registro enviado por el chat del cliente: no está verificado. Para confirmar un dato, usá la ficha del cliente.</p>
        ${lineas.map((l) => l.de === 'bot'
    ? `<div class="m bot"><span class="quien">Asistente</span><div class="globo">${escapar(l.texto)}</div></div>`
    : `<div class="m cliente"><div class="globo">${escapar(l.texto)}</div></div>`).join('')}
        <p class="m-sistema">Hasta acá, la charla con el asistente</p>
      </div>
    </div>`);
  const boton = $('#ver-charla-bot');
  const cuerpo = $('#charla-bot-lineas');
  boton.addEventListener('click', () => {
    const abrir = cuerpo.hidden;
    cuerpo.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    boton.textContent = abrir ? 'Ocultar chat con el asistente' : 'Ver todo el chat';
  });
}

function pintarMensaje(m) {
  if (b.pintados.has(m.id)) return;
  b.pintados.add(m.id);
  const box = $('#mensajes');
  if (!box) return;
  quitarEscribiendo();

  const k = claveDia(m.created_at);
  if (k !== b.ultimoDia) {
    b.ultimoDia = k;
    box.insertAdjacentHTML('beforeend', `<div class="m-dia">${etiquetaDia(m.created_at)}</div>`);
  }

  if (m.autor_tipo === 'sistema') {
    box.insertAdjacentHTML('beforeend',
      `<p class="m-sistema ${m.interno ? 'interno' : ''}">${m.interno ? 'Solo para el equipo: ' : ''}${escapar(m.texto)} <span class="hora">${hora(m.created_at)}</span></p>`);
    return;
  }

  const clase = m.autor_tipo === 'gestor' ? (m.interno ? 'nota' : 'gestor') : m.autor_tipo;
  const quien = m.autor_tipo === 'cliente' ? '' : m.autor_tipo === 'bot' ? 'Asistente'
    : m.interno ? `Nota interna de ${escapar(m.autor_nombre || '')}` : escapar(m.autor_nombre || 'Wolf');
  const contenido = m.adjunto_path
    ? (m.adjunto_mime?.startsWith('image/')
      ? `<img alt="${escapar(m.adjunto_nombre || 'Imagen')}" data-path="${escapar(m.adjunto_path)}">`
      : `<a class="archivo" target="_blank" rel="noopener" data-path="${escapar(m.adjunto_path)}">${ICONOS.pdf}<span>${escapar(m.adjunto_nombre || 'Archivo')}<small>${tamanio(m.adjunto_bytes)}</small></span></a>`)
    : textoConEnlaces(m.texto);
  const visto = clase === 'gestor' ? '<span class="visto" title="Enviado" aria-label="Enviado">✓</span>' : '';

  const div = document.createElement('div');
  div.className = `m ${clase}`;
  if (visto) div.dataset.creado = m.created_at;
  div.innerHTML = `${quien ? `<span class="quien">${quien}</span>` : ''}<div class="globo">${contenido}<span class="hora">${hora(m.created_at)}${visto}</span></div>`;
  box.append(div);

  if (m.adjunto_path) {
    api.urlArchivo(m.adjunto_path).then((url) => {
      const img = div.querySelector('img');
      if (img) {
        img.src = url;
        img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
        img.addEventListener('load', bajar, { once: true });
      }
      const a = div.querySelector('a.archivo');
      if (a) a.href = url;
    }).catch(console.error);
  }
  if (visto) actualizarVistos();
}

// ✓ enviado · ✓✓ visto por el cliente
function actualizarVistos() {
  const leido = b.abierta?.leido_cliente_at ? Date.parse(b.abierta.leido_cliente_at) : 0;
  document.querySelectorAll('#mensajes .m.gestor[data-creado]').forEach((d) => {
    const visto = Boolean(leido && Date.parse(d.dataset.creado) <= leido);
    const t = d.querySelector('.visto');
    if (!t || t.classList.contains('leido') === visto) return;
    t.classList.toggle('leido', visto);
    t.textContent = visto ? '✓✓' : '✓';
    t.title = visto ? 'Visto por el cliente' : 'Enviado';
    t.setAttribute('aria-label', t.title);
  });
}

function mostrarEscribiendo() {
  const box = $('#mensajes');
  if (!box) return;
  let d = box.querySelector('.escribiendo-cliente');
  if (!d) {
    d = document.createElement('div');
    d.className = 'm cliente escribiendo-cliente';
    d.innerHTML = '<span class="quien">El cliente está escribiendo…</span><div class="globo puntos"><i></i><i></i><i></i></div>';
    box.append(d);
    bajar();
  }
  clearTimeout(b.timerEscribiendo);
  b.timerEscribiendo = setTimeout(quitarEscribiendo, 5000);
}

function quitarEscribiendo() {
  clearTimeout(b.timerEscribiendo);
  document.querySelector('#mensajes .escribiendo-cliente')?.remove();
}

async function descargarConversacion(c) {
  const mensajes = await intentar(() => api.mensajes(c.id));
  if (!mensajes) return;
  const cl = c.cliente || {};
  const linea = (m) => {
    const quien = m.autor_tipo === 'cliente' ? (cl.nombre || 'Cliente')
      : m.autor_tipo === 'bot' ? 'Asistente Wolf'
        : m.autor_tipo === 'sistema' ? 'Sistema' : `${m.autor_nombre || 'Wolf'} (Wolf)`;
    const texto = m.adjunto_path ? `[Archivo: ${m.adjunto_nombre || 'adjunto'}]` : m.texto;
    return `[${fechaHora(m.created_at)}] ${quien}${m.interno ? ' — solo para el equipo' : ''}: ${texto}`;
  };
  const texto = [
    `Wolf Travel — Consulta N° ${c.numero}`,
    `Cliente: ${cl.nombre || ''}${cl.colegio ? ` · ${cl.colegio}` : ''}${cl.curso ? ` · ${cl.curso}` : ''}`,
    `Motivo: ${motivo(c.motivo)?.nombre || c.motivo} · Estado: ${c.estado}`,
    `Descargada por ${st.yo.nombre} el ${fechaHora(new Date().toISOString())}`,
    '',
    ...mensajes.map(linea),
    '',
    'Contiene datos personales: guardala solo mientras la necesites (Ley 25.326).',
  ].join('\r\n');
  descargarTexto(`consulta-${c.numero}.txt`, texto);
}

// ---------------------------------------------------------------------
// Responder: respuestas rápidas, sugerencia con IA y "escribiendo…"
// ---------------------------------------------------------------------

function respuestasDe(c) {
  return (st.cat.respuestas || []).filter((r) => r.activo && (!r.equipo_id || r.equipo_id === c.equipo_id));
}

function aplicarVariables(texto, c) {
  const cl = c.cliente || {};
  const valores = {
    nombre: primerNombre(cl.nombre), gestor: primerNombre(st.yo.nombre), contrato: cl.nro_contrato,
    colegio: cl.colegio, curso: cl.curso,
  };
  return texto.replace(/\{(nombre|gestor|contrato|colegio|curso)\}/g, (_, k) => valores[k] || `[completar: ${k}]`);
}

function renderResponder() {
  const zona = $('#zona-respuesta');
  const c = b.abierta;
  if (!zona || !c) return;

  if (c.estado === 'resuelta') {
    zona.innerHTML = `<div class="cerrada">La consulta está resuelta.${puedeGestionar(c) ? ' Si el cliente necesita seguimiento, reabrila.' : ''}</div>`;
    return;
  }
  if (!puedeEscribir(c)) {
    zona.innerHTML = `<div class="cerrada">La atiende ${escapar(c.gestor_nombre || 'otra persona')}. Podés ver el historial, pero no responder.</div>`;
    return;
  }

  const borrador = zona.querySelector('textarea')?.value || '';
  const ia = CONFIG.IA_DISPONIBLE && st.cat.config.ia_habilitada;   // desactivada: ver config.js
  zona.innerHTML = `
    <form class="responder" id="form-responder">
      <div class="modos">
        <button type="button" data-modo="respuesta" aria-pressed="true">Respuesta al cliente</button>
        <button type="button" class="nota" data-modo="nota" aria-pressed="false">Nota interna</button>
        <span class="herramientas">
          <button type="button" class="texto-boton" data-rapidas aria-haspopup="listbox">Respuestas rápidas</button>
          ${ia ? '<button type="button" class="texto-boton ia" data-ia>Sugerir con IA</button>' : ''}
        </span>
      </div>
      <div class="rapidas" id="rapidas" role="listbox" aria-label="Respuestas rápidas" hidden></div>
      <div class="fila">
        <label class="adjunto-btn" title="Adjuntar foto o PDF">${ICONOS.clip}<input type="file" accept="image/*,application/pdf"><span class="sr">Adjuntar</span></label>
        <textarea rows="1" maxlength="4000" placeholder="Escribí tu respuesta. Con / buscás respuestas rápidas" aria-label="Respuesta"></textarea>
        <button class="boton primario" type="submit">Enviar</button>
      </div>
      <p class="pista">Enter envía · Shift+Enter hace un salto de línea</p>
    </form>`;
  const form = $('#form-responder');
  const ta = form.querySelector('textarea');
  ta.value = borrador;
  aplicarModo();

  form.querySelectorAll('[data-modo]').forEach((btn) => btn.addEventListener('click', () => {
    b.modoNota = btn.dataset.modo === 'nota';
    aplicarModo();
    ta.focus();
  }));

  const ajustar = () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  };
  ta.addEventListener('input', () => {
    ajustar();
    const m = /^\/(.*)$/s.exec(ta.value);
    if (m) mostrarRapidas(m[1]); else ocultarRapidas();
    if (!b.modoNota && ta.value.trim() && Date.now() - b.ultimoAviso > 2500) {
      b.ultimoAviso = Date.now();
      b.canal?.avisar({ quien: 'gestor', nombre: primerNombre(st.yo.nombre) });
    }
  });
  ta.addEventListener('keydown', (e) => {
    const lista = $('#rapidas');
    if (!lista.hidden && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) {
      e.preventDefault();
      moverRapidas(e.key);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.querySelector('[data-rapidas]').addEventListener('click', () => {
    if ($('#rapidas').hidden) mostrarRapidas(''); else ocultarRapidas();
  });
  $('#rapidas').addEventListener('mousedown', (e) => {
    const op = e.target.closest('[data-rapida]');
    if (!op) return;
    e.preventDefault();
    elegirRapida(op.dataset.rapida);
  });
  form.querySelector('[data-ia]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Pensando…';
    const texto = await intentar(() => api.sugerir(c.id));
    btn.disabled = false;
    btn.textContent = 'Sugerir con IA';
    if (typeof texto !== 'string') return;
    b.modoNota = false;
    aplicarModo();
    ta.value = ta.value.trim() ? `${ta.value.trim()}\n\n${texto}` : texto;
    ajustar();
    ta.focus();
    toast('Borrador listo: revisalo y completá lo que esté entre corchetes antes de enviar.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = ta.value.trim();
    if (!texto) return;
    if (/\[completar[^\]]*\]/i.test(texto) && !b.modoNota) {
      toast('Completá los datos marcados [completar: …] antes de enviar', true);
      return;
    }
    const boton = form.querySelector('button[type=submit]');
    boton.disabled = true;
    const m = await intentar(() => api.enviarTexto(c.id, texto, b.modoNota));
    boton.disabled = false;
    if (m) {
      ta.value = '';
      ta.style.height = 'auto';
      pintarMensaje(m);
      bajar();
      if (!c.gestor_id && !b.modoNota) refrescarAbierta();
    }
    ta.focus();
  });
  form.querySelector('input[type=file]').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    if (archivo.size > CONFIG.ADJUNTO_MAX_MB * 1024 * 1024) {
      toast(`El archivo supera los ${CONFIG.ADJUNTO_MAX_MB} MB`, true);
      return;
    }
    const m = await intentar(() => api.enviarArchivo(c.id, archivo), 'Archivo enviado');
    if (m) { pintarMensaje(m); bajar(); }
  });
}

function aplicarModo() {
  const form = $('#form-responder');
  if (!form) return;
  form.classList.toggle('modo-nota', b.modoNota);
  form.querySelectorAll('[data-modo]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String((btn.dataset.modo === 'nota') === b.modoNota));
  });
  form.querySelector('textarea').placeholder = b.modoNota
    ? 'Nota para el equipo: el cliente no la ve'
    : 'Escribí tu respuesta. Con / buscás respuestas rápidas';
  form.querySelector('.adjunto-btn').hidden = b.modoNota;
}

let rapidasVisibles = [];
let rapidaActiva = 0;

function mostrarRapidas(filtro) {
  const lista = $('#rapidas');
  if (!lista || !b.abierta) return;
  const q = filtro.trim().toLowerCase();
  rapidasVisibles = respuestasDe(b.abierta)
    .filter((r) => !q || r.titulo.toLowerCase().includes(q) || r.texto.toLowerCase().includes(q)).slice(0, 8);
  rapidaActiva = 0;
  if (!rapidasVisibles.length) {
    lista.innerHTML = `<p class="rapidas-vacio">${(st.cat.respuestas || []).length
      ? 'Ninguna respuesta coincide.' : 'Todavía no hay respuestas rápidas. Un administrador las carga en Administración.'}</p>`;
  } else {
    lista.innerHTML = rapidasVisibles.map((r, i) => `
      <div class="rapida" role="option" id="rapida-${i}" data-rapida="${r.id}" aria-selected="${i === 0}">
        <b>${escapar(r.titulo)}</b><span>${escapar(aplicarVariables(r.texto, b.abierta))}</span>
      </div>`).join('');
  }
  lista.hidden = false;
}

function ocultarRapidas() {
  const lista = $('#rapidas');
  if (lista) lista.hidden = true;
}

function moverRapidas(tecla) {
  if (tecla === 'Escape') { ocultarRapidas(); return; }
  if (!rapidasVisibles.length) { ocultarRapidas(); return; }
  if (tecla === 'Enter' || tecla === 'Tab') { elegirRapida(rapidasVisibles[rapidaActiva].id); return; }
  rapidaActiva = (rapidaActiva + (tecla === 'ArrowDown' ? 1 : -1) + rapidasVisibles.length) % rapidasVisibles.length;
  document.querySelectorAll('#rapidas .rapida').forEach((d, i) => d.setAttribute('aria-selected', String(i === rapidaActiva)));
  document.querySelector(`#rapida-${rapidaActiva}`)?.scrollIntoView({ block: 'nearest' });
}

function elegirRapida(id) {
  const r = (st.cat.respuestas || []).find((x) => x.id === id);
  const ta = $('#form-responder textarea');
  if (!r || !ta) return;
  const texto = aplicarVariables(r.texto, b.abierta);
  ta.value = /^\//.test(ta.value) || !ta.value.trim() ? texto : `${ta.value.trimEnd()} ${texto}`;
  ta.dispatchEvent(new Event('input'));
  ocultarRapidas();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

// ---------------------------------------------------------------------
// Transferir
// ---------------------------------------------------------------------

function abrirTransferir(c) {
  const dlg = $('#dlg-transferir');
  const form = $('#form-transferir');
  const activos = st.cat.gestores.filter((g) => g.activo && g.id !== c.gestor_id);
  form.gestor.innerHTML = activos.map((g) => {
    const equipos = g.equipos.map(nombreEquipo).join(', ');
    return `<option value="${g.id}">${escapar(g.nombre)}${equipos ? ` (${escapar(equipos)})` : ''}${g.disponible ? '' : ', ausente'}</option>`;
  }).join('');
  form.equipo.innerHTML = st.cat.equipos.map((e) => `<option value="${e.id}">${escapar(e.nombre)}</option>`).join('');
  form.nota.value = '';
  form.destino.value = 'gestor';
  actualizarDestino();
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const aPersona = form.destino.value === 'gestor';
    await intentar(() => api.transferir(c.id, {
      gestorId: aPersona ? form.gestor.value : null,
      equipoId: aPersona ? null : Number(form.equipo.value),
      nota: form.nota.value,
    }), 'Consulta transferida');
    await refrescarAbierta();
  };
}

function actualizarDestino() {
  const form = $('#form-transferir');
  const aPersona = form.destino.value === 'gestor';
  $('#campo-gestor').hidden = !aPersona;
  $('#campo-equipo').hidden = aPersona;
}
$('#form-transferir').addEventListener('change', (e) => { if (e.target.name === 'destino') actualizarDestino(); });

// ---------------------------------------------------------------------
// Ficha del cliente
// ---------------------------------------------------------------------

function linkWhatsApp(celular) {
  let d = (celular || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `549${d}`;
  return `https://wa.me/${d}`;
}

const sinDato = '<span class="sin-dato">Sin dato</span>';
const dato = (titulo, valor) => `<div><dt>${titulo}</dt><dd>${valor || sinDato}</dd></div>`;

export async function renderFicha(conv) {
  const ficha = $('#ficha');
  ficha.innerHTML = '<p class="vacio">Cargando datos…</p>';
  let cl;
  let hist;
  let padron = [];
  try {
    [cl, hist] = await Promise.all([api.cliente(conv.cliente_id), api.historial(conv.cliente_id)]);
    if (cl.tiene_contrato && cl.nro_contrato && !cl.contrato_verificado) padron = await api.contratoEnPadron(cl.nro_contrato);
  } catch (e) {
    ficha.innerHTML = `<p class="vacio">No se pudieron cargar los datos: ${escapar(e.message)}</p>`;
    return;
  }
  if (b.abiertaId !== conv.id) return;

  const wa = linkWhatsApp(cl.celular);
  const minutosRespuesta = conv.primera_respuesta_at
    ? Math.round((new Date(conv.primera_respuesta_at) - new Date(conv.created_at)) / 60000) : null;
  const disponibles = st.cat.etiquetas.filter((e) => !cl.etiquetas.includes(e.id));

  ficha.innerHTML = `
    <div class="encabezado">
      <h3>${escapar(cl.nombre || 'Cliente')}</h3>
      <div>
        <button class="texto-boton" data-ficha="editar">Editar</button>
        <button class="texto-boton cerrar-ficha" data-ficha="cerrar" aria-label="Cerrar">${ICONOS.cerrar.replace('<svg', '<svg width="16" height="16"')}</button>
      </div>
    </div>

    <div class="ficha-bloque">
      <label class="campo-linea"><span>Etapa</span>
        <select class="control" data-ficha-etapa aria-label="Etapa del cliente">
          ${ETAPAS.map((e) => `<option value="${e.id}" ${e.id === cl.etapa ? 'selected' : ''}>${e.nombre}</option>`).join('')}
        </select></label>
      ${cl.etapa === 'perdido' && cl.motivo_perdida ? `<p class="ficha-nota">Motivo: ${escapar(cl.motivo_perdida)}</p>` : ''}
      <div class="etiquetas-ficha">
        ${cl.etiquetas.map((id) => chipEtiqueta(etiqueta(id), true)).join('')}
        ${disponibles.length ? `<select class="agregar-etiqueta" data-agregar-etiqueta aria-label="Agregar etiqueta">
          <option value="">+ Etiqueta</option>
          ${disponibles.map((e) => `<option value="${e.id}">${escapar(e.nombre)}</option>`).join('')}
        </select>` : ''}
      </div>
    </div>

    ${cl.tiene_contrato ? bloqueContrato(cl, padron) : ''}

    <dl>
      ${dato('Tipo', cl.tipo === 'cliente' ? 'Cliente con contrato' : 'Lead, todavía sin contrato')}
      ${dato('Relación con el viaje', escapar(RELACION[cl.relacion] || ''))}
      ${dato('Colegio', escapar(cl.colegio || ''))}
      ${dato('Curso', escapar(cl.curso || ''))}
      ${dato('Sucursal', escapar(cl.sucursal?.nombre || ''))}
      ${dato('Celular', cl.celular ? `<span class="contacto"><a href="tel:${escapar(cl.celular)}">${escapar(cl.celular)}</a>${wa ? `<a href="${wa}" target="_blank" rel="noopener">${ICONOS.whatsapp}WhatsApp</a>` : ''}</span>` : '')}
      ${dato('Correo', cl.email ? `<a href="mailto:${escapar(cl.email)}">${escapar(cl.email)}</a>` : '')}
      ${cl.email ? dato('Avisos por correo', cl.acepta_avisos === false ? 'No quiere recibirlos' : 'Sí') : ''}
    </dl>
    <div class="seccion">
      <h3>Esta consulta</h3>
      <dl style="margin-top:10px">
        ${dato('Inició', `${etiquetaDia(conv.created_at)}, ${hora(conv.created_at)}${conv.fuera_de_horario ? ' (fuera de horario)' : ''}`)}
        ${dato('Primera respuesta', minutosRespuesta == null ? 'Todavía sin respuesta' : `${minutosRespuesta} min después`)}
        ${conv.csat ? dato('Calificación', `${'★'.repeat(conv.csat)}${'☆'.repeat(5 - conv.csat)}${conv.csat_comentario ? `<br><small>“${escapar(conv.csat_comentario)}”</small>` : ''}`) : ''}
      </dl>
    </div>
    <div class="seccion">
      <h3>Consultas de este cliente</h3>
      <ul class="historial">
        ${hist.map((h) => `<li><button data-ficha="abrir" data-id="${h.id}" ${h.id === conv.id ? 'disabled' : ''}>N° ${h.numero} ${escapar(motivo(h.motivo)?.nombre || '')}</button>
          <span>${momentoCorto(h.created_at)}${h.estado === 'resuelta' ? ', resuelta' : ''}${h.csat ? ` · ★${h.csat}` : ''}</span></li>`).join('')}
      </ul>
    </div>`;
  ficha.dataset.cliente = cl.id;
  b.fichaCliente = cl;
}

function bloqueContrato(cl, padron) {
  let estado;
  let acciones = '';
  if (cl.contrato_verificado) {
    estado = cl.verificacion === 'automatica'
      ? `<p class="verificado">✓ Verificado: coincide con el padrón de contratos${cl.verificado_at ? ` (${fechaCorta(cl.verificado_at)})` : ''}.</p>`
      : `<p class="verificado">✓ Verificado por ${escapar(cl.verificador?.nombre || 'un gestor')}${cl.verificado_at ? ` el ${fechaCorta(cl.verificado_at)}` : ''}.</p>`;
    if (cl.verificacion === 'manual') acciones = '<button class="texto-boton peligro" data-ficha="quitar-verificacion">Quitar verificación</button>';
  } else {
    const dni = cl.dni_pasajero;
    const filas = padron.map((k) => `<li>${escapar(k.pasajero || 'Pasajero sin nombre')} · DNI ${escapar(k.dni_pasajero)}${k.dni_pasajero === dni ? '' : ' <b>(otro DNI)</b>'}${k.colegio ? ` · ${escapar(k.colegio)}` : ''}${k.curso ? ` ${escapar(k.curso)}` : ''}</li>`).join('');
    estado = `
      <p class="sin-verificar">Sin verificar. ${cl.nro_contrato
        ? (padron.length
          ? 'El número figura en el padrón, pero con otros datos:'
          : 'El número no figura en el padrón importado.')
        : 'El cliente no informó el número de contrato.'}</p>
      ${filas ? `<ul class="padron">${filas}</ul>` : ''}
      <p class="ficha-nota">Antes de dar información del viaje o de pagos, confirmá los datos en PAX Manager.</p>`;
    acciones = '<button class="boton chico" data-ficha="verificar">Marcar como verificado</button>';
  }
  return `
    <div class="ficha-bloque contrato ${cl.contrato_verificado ? 'ok' : 'pendiente'}">
      <div class="contrato-cab"><b>Contrato ${escapar(cl.nro_contrato || 's/n')}</b><span>DNI pasajero ${escapar(cl.dni_pasajero || '—')}</span></div>
      ${estado}
      ${acciones}
    </div>`;
}

async function recargarFicha() {
  if (b.abierta) await renderFicha(b.abierta);
  programarRecarga();
}

$('#ficha').addEventListener('click', async (e) => {
  const quitar = e.target.closest('[data-quitar-etiqueta]');
  const cl = b.fichaCliente;
  if (quitar && cl) {
    if (await intentar(() => api.quitarEtiqueta(cl.id, Number(quitar.dataset.quitarEtiqueta)))) recargarFicha();
    return;
  }
  const btn = e.target.closest('[data-ficha]');
  if (!btn) return;
  const accion = btn.dataset.ficha;
  if (accion === 'cerrar') $('#ficha').classList.remove('visible');
  if (accion === 'abrir') abrirConversacion(btn.dataset.id);
  if (accion === 'editar') editarCliente(cl);
  if (accion === 'verificar') {
    const { valor, form } = await dialogo({
      titulo: 'Verificar contrato',
      cuerpo: `<p class="dlg-texto">Confirmá que el contrato <b>${escapar(cl.nro_contrato || 's/n')}</b> y el DNI <b>${escapar(cl.dni_pasajero || '—')}</b>
        corresponden a este cliente según PAX Manager.</p>
        <label class="campo"><span>Nota (opcional)</span><input name="nota" maxlength="200" placeholder="Ej.: verificado en PAX, contrato a nombre de la madre"></label>`,
      botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: 'Marcar como verificado', primario: true }],
    });
    if (valor === 'ok' && await intentar(() => api.verificarContrato(cl.id, true, form.nota.value.trim()), 'Contrato verificado')) recargarFicha();
  }
  if (accion === 'quitar-verificacion') {
    if (await confirmar('Quitar verificación', 'El contrato vuelve a quedar sin verificar.', { aceptar: 'Quitar', peligro: true })
      && await intentar(() => api.verificarContrato(cl.id, false, null), 'Verificación quitada')) recargarFicha();
  }
});

$('#ficha').addEventListener('change', async (e) => {
  const cl = b.fichaCliente;
  if (!cl) return;
  if (e.target.matches('[data-agregar-etiqueta]') && e.target.value) {
    if (await intentar(() => api.agregarEtiqueta(cl.id, Number(e.target.value), st.yo.id))) recargarFicha();
  }
  if (e.target.matches('[data-ficha-etapa]')) {
    const etapa = e.target.value;
    let motivoPerdida = null;
    if (etapa === 'perdido') {
      const { valor, form } = await dialogo({
        titulo: 'Marcar como perdido',
        cuerpo: `<label class="campo"><span>¿Por qué no avanzó? Sirve para los reportes.</span>
          <select name="motivo">
            <option>Eligió otra empresa</option><option>Precio</option><option>El curso no viaja</option>
            <option>No respondió más</option><option>Otro</option>
          </select></label>
          <label class="campo"><span>Detalle (opcional)</span><input name="detalle" maxlength="150"></label>`,
        botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: 'Guardar', primario: true }],
      });
      if (valor !== 'ok') { e.target.value = cl.etapa; return; }
      motivoPerdida = [form.motivo.value, form.detalle.value.trim()].filter(Boolean).join(': ');
    }
    if (await intentar(() => api.cambiarEtapa(cl.id, etapa, motivoPerdida), `Etapa: ${nombreEtapa(etapa)}`)) recargarFicha();
    else e.target.value = cl.etapa;
  }
});

function editarCliente(cl) {
  const dlg = $('#dlg-cliente');
  const f = $('#form-cliente');
  f.sucursal_id.innerHTML = `<option value="">Sin dato</option>${st.cat.sucursalesTodas
    .map((s) => `<option value="${s.id}">${escapar(s.nombre)}</option>`).join('')}`;
  for (const k of ['nombre', 'relacion', 'colegio', 'curso', 'celular', 'email', 'nro_contrato', 'dni_pasajero', 'sucursal_id']) {
    f[k].value = cl[k] ?? '';
  }
  f.tiene_contrato.checked = Boolean(cl.tiene_contrato);
  f.acepta_avisos.checked = cl.acepta_avisos !== false;
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const datos = {};
    for (const k of ['nombre', 'relacion', 'colegio', 'curso', 'celular', 'email', 'nro_contrato', 'dni_pasajero']) datos[k] = f[k].value;
    datos.sucursal_id = f.sucursal_id.value ? Number(f.sucursal_id.value) : null;
    datos.tiene_contrato = f.tiene_contrato.checked;
    datos.acepta_avisos = f.acepta_avisos.checked;
    await intentar(() => api.actualizarCliente(cl.id, datos), 'Datos guardados');
    recargarFicha();
  };
}
