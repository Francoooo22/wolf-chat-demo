// Chat de atención Wolf — vista del cliente.
// Flujo: bot de admisión (contrato → motivo → preguntas frecuentes → privacidad →
// datos → consulta), después conversación en tiempo real con el gestor asignado.
// También permite recuperar la conversación desde otro dispositivo (código por correo
// o enlace de un solo uso) y calificar la atención al cerrar la consulta.

import { CONFIG } from '../js/config.js';
import { crearApiCliente, MODO_DEMO } from '../js/api.js';
import { buscarContrato } from '../js/buscador-contratos.js';
import {
  $, escapar, textoConEnlaces, hora, etiquetaDia, claveDia, primerNombre, tamanio, normalizarTexto, ICONOS, TEXTOS_POR_DEFECTO,
} from '../js/util.js';

const api = crearApiCliente();
const parametros = new URLSearchParams(location.search);
const embebido = parametros.has('embed');
const sinAnimacion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = {
  logo: $('#logo'), estado: $('#estado'), estadoTexto: $('#estado-texto'), cerrar: $('#cerrar'),
  avisoDemo: $('#aviso-demo'), hilo: $('#hilo'), opciones: $('#opciones'), ayuda: $('#ayuda'),
  composer: $('#composer'), texto: $('#texto'), enviar: $('#enviar'), adjuntar: $('#adjuntar'),
  archivo: $('#archivo'),
};

const RELACIONES = [
  { valor: 'alumno', texto: 'Soy alumno/a' },
  { valor: 'familiar', texto: 'Soy mamá, papá o tutor' },
  { valor: 'docente', texto: 'Soy docente o coordinador' },
  { valor: 'otro', texto: 'Otro' },
];

const CALIFICACIONES = ['Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];

let ctx = null;            // catálogos, cliente y última consulta
let conv = null;           // consulta activa
let desuscribir = null;
let canalEscribiendo = null;
let transcripcion = null;  // charla con el bot de esta admisión (se guarda con la consulta); null = no registrar
let modo = 'bot';          // bot | chat | cerrada
let preguntaTexto = null;  // pregunta de texto del bot en curso
let ultimoDia = null;
let ultimoGrupo = null;
let noLeidos = 0;
let abiertoEnPadre = !embebido;
let ultimoAvisoEscribiendo = 0;
let temporizadorEscribiendo = null;
const pintados = new Set();
const tituloBase = document.title;

// Mensaje del error si es una regla del sistema (límite de mensajes, consulta cerrada…);
// si es un problema de conexión, el texto genérico.
const legible = (e, generico) => (e?.legible || (MODO_DEMO && !e?.original) ? e.message : generico);

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

el.logo.src = CONFIG.MARCA.logo;
el.cerrar.innerHTML = ICONOS.cerrar;
el.enviar.innerHTML = ICONOS.enviar;
el.adjuntar.insertAdjacentHTML('beforeend', ICONOS.clip);
if (embebido) {
  document.body.classList.add('embebido');
  el.cerrar.hidden = false;
}
if (MODO_DEMO) el.avisoDemo.hidden = false;

arrancar();

async function arrancar() {
  bloquearEscritura('Un momento…');

  // Enlace de acceso recibido por correo: ?acceso=TOKEN (un solo uso).
  const acceso = parametros.get('acceso');
  let errorAcceso = null;
  if (acceso) {
    parametros.delete('acceso');
    history.replaceState(null, '', location.pathname + (parametros.size ? `?${parametros}` : ''));
    try {
      await api.canjearEnlace(acceso);
    } catch (e) {
      errorAcceso = e;
    }
  }

  try {
    await api.iniciar();
    ctx = await api.contexto();
  } catch (e) {
    console.error(e);
    el.estadoTexto.textContent = 'Sin conexión';
    agregarSistema('No pudimos conectarnos con Wolf. Revisá tu conexión y volvé a cargar la página.');
    return;
  }
  actualizarEstado();

  // Si el enlace ya se usó pero este dispositivo ya tiene la conversación, no hace falta avisar.
  if (errorAcceso && !ctx.ultima) {
    agregarSistema(`${errorAcceso.message} Podés recuperar tu conversación con un código que te mandamos por correo.`);
  }

  if (ctx.ultima) {
    await abrirConversacion(ctx.ultima);
  } else {
    await admision();
  }
}

// ---------------------------------------------------------------------
// Cabecera
// ---------------------------------------------------------------------

function actualizarEstado() {
  const atendiendo = ctx?.enHorario;
  el.estado.classList.toggle('atendiendo', Boolean(atendiendo));
  if (conv?.estado === 'abierta' && conv.gestor_nombre) {
    el.estadoTexto.textContent = `Te atiende ${conv.gestor_nombre}`;
  } else if (atendiendo) {
    el.estadoTexto.textContent = 'Estamos atendiendo ahora';
  } else {
    el.estadoTexto.textContent = `Te respondemos ${ctx?.config.texto_horario ?? ''}`;
  }
}

// ---------------------------------------------------------------------
// Pintado de mensajes
// ---------------------------------------------------------------------

function alFinal() {
  requestAnimationFrame(() => { el.hilo.scrollTop = el.hilo.scrollHeight; });
}

function separadorDia(iso) {
  const k = claveDia(iso);
  if (k === ultimoDia) return;
  ultimoDia = k;
  ultimoGrupo = null;
  const d = document.createElement('div');
  d.className = 'dia';
  d.textContent = etiquetaDia(iso);
  agregarAlHilo(d);
}

// Todo lo nuevo va antes del "escribiendo…" del gestor, que queda siempre al final.
function agregarAlHilo(nodo) {
  const escr = el.hilo.querySelector('.fila.escribe-gestor');
  if (escr) escr.before(nodo); else el.hilo.append(nodo);
}

function agregarSistema(texto) {
  const p = document.createElement('p');
  p.className = 'sistema aparece';
  p.textContent = texto;
  agregarAlHilo(p);
  ultimoGrupo = null;
  alFinal();
  return p;
}

// lado: 'yo' (cliente) o 'wolf'; grupo: identifica quién habla para agrupar burbujas
function agregarBurbuja({ lado, grupo, nombre, html, iso, clases = '', visto = false }) {
  const fila = document.createElement('div');
  const nuevoGrupo = grupo !== ultimoGrupo;
  fila.className = `fila ${lado} ${clases} ${nuevoGrupo ? 'nuevo-grupo' : ''} ${sinAnimacion ? '' : 'aparece'}`;
  if (nombre && nuevoGrupo) {
    const a = document.createElement('span');
    a.className = 'autor';
    a.textContent = nombre;
    fila.append(a);
  }
  const b = document.createElement('div');
  b.className = 'burbuja';
  const tilde = visto ? '<span class="visto" aria-label="Enviado" title="Enviado">✓</span>' : '';
  b.innerHTML = html + (iso ? `<span class="meta">${hora(iso)}${tilde}</span>` : '');
  if (visto) fila.dataset.creado = iso;
  fila.append(b);
  agregarAlHilo(fila);
  ultimoGrupo = grupo;
  alFinal();
  return fila;
}

function pintarMensaje(m) {
  if (pintados.has(m.id)) return;
  pintados.add(m.id);
  separadorDia(m.created_at);
  quitarEscribiendo();

  if (m.autor_tipo === 'sistema') {
    agregarSistema(m.texto);
    return;
  }

  const lado = m.autor_tipo === 'cliente' ? 'yo' : 'wolf';
  const nombre = m.autor_tipo === 'gestor' ? `${m.autor_nombre || 'Wolf'}, de Wolf`
    : m.autor_tipo === 'bot' ? 'Asistente Wolf' : null;
  const grupo = m.autor_tipo === 'gestor' ? `g:${m.autor_nombre}` : m.autor_tipo;
  const fila = agregarBurbuja({
    lado, grupo, nombre, iso: m.created_at, visto: m.autor_tipo === 'cliente',
    clases: m.autor_tipo === 'bot' ? 'bot' : '',
    html: m.adjunto_path ? htmlAdjunto(m) : textoConEnlaces(m.texto),
  });
  if (m.adjunto_path) cargarAdjunto(fila, m);
  actualizarVistos();
}

// ✓ enviado · ✓✓ visto por quien atiende la consulta
function actualizarVistos() {
  const leido = conv?.leido_gestor_at ? Date.parse(conv.leido_gestor_at) : 0;
  el.hilo.querySelectorAll('.fila.yo[data-creado]').forEach((f) => {
    const visto = leido && Date.parse(f.dataset.creado) <= leido;
    const t = f.querySelector('.visto');
    if (!t || t.classList.contains('leido') === Boolean(visto)) return;
    t.classList.toggle('leido', Boolean(visto));
    t.textContent = visto ? '✓✓' : '✓';
    t.title = visto ? 'Visto' : 'Enviado';
    t.setAttribute('aria-label', t.title);
  });
}

function htmlAdjunto(m) {
  if (m.adjunto_mime?.startsWith('image/')) {
    return `<img class="adjunto-img" alt="${escapar(m.adjunto_nombre || 'Imagen adjunta')}">`;
  }
  return `<a class="adjunto-archivo" target="_blank" rel="noopener">${ICONOS.pdf}
            <span>${escapar(m.adjunto_nombre || 'Archivo')}<small>${tamanio(m.adjunto_bytes)}</small></span></a>`;
}

async function cargarAdjunto(fila, m) {
  try {
    const url = await api.urlArchivo(m.adjunto_path);
    const img = fila.querySelector('img');
    if (img) {
      img.src = url;
      img.addEventListener('click', () => window.open(url, '_blank', 'noopener'));
      img.style.cursor = 'zoom-in';
      img.addEventListener('load', alFinal, { once: true });
    }
    const a = fila.querySelector('a.adjunto-archivo');
    if (a) a.href = url;
  } catch (e) {
    console.error(e);
  }
}

// ---------------------------------------------------------------------
// "Escribiendo…" (aviso efímero, no se guarda)
// ---------------------------------------------------------------------

function mostrarEscribiendo(nombre) {
  let fila = el.hilo.querySelector('.fila.escribe-gestor');
  if (!fila) {
    fila = document.createElement('div');
    fila.className = 'fila wolf escribiendo escribe-gestor nuevo-grupo';
    fila.innerHTML = '<span class="autor"></span><div class="burbuja"><i></i><i></i><i></i></div>';
    el.hilo.append(fila);
    alFinal();
  }
  fila.querySelector('.autor').textContent = `${nombre || 'Wolf'} está escribiendo…`;
  clearTimeout(temporizadorEscribiendo);
  temporizadorEscribiendo = setTimeout(quitarEscribiendo, 5000);
}

function quitarEscribiendo() {
  clearTimeout(temporizadorEscribiendo);
  el.hilo.querySelector('.fila.escribe-gestor')?.remove();
}

function avisarQueEscribo() {
  if (modo !== 'chat' || !canalEscribiendo) return;
  const ahora = Date.now();
  if (ahora - ultimoAvisoEscribiendo < 2500) return;
  ultimoAvisoEscribiendo = ahora;
  canalEscribiendo.avisar({ quien: 'cliente' });
}

// ---------------------------------------------------------------------
// Herramientas del bot
// ---------------------------------------------------------------------

const pausa = (ms) => new Promise((r) => setTimeout(r, sinAnimacion ? 0 : ms));

async function botDice(html, { espera = 550 } = {}) {
  const escribiendo = agregarBurbuja({
    lado: 'wolf', grupo: 'bot', nombre: 'Asistente Wolf', clases: 'bot escribiendo',
    html: '<i></i><i></i><i></i>',
  });
  await pausa(espera);
  escribiendo.remove();
  ultimoGrupo = null;
  // Si ya había un grupo de bot justo antes, no repetir el nombre.
  const previo = el.hilo.lastElementChild;
  if (previo?.classList.contains('bot') && !previo.classList.contains('escribiendo')) ultimoGrupo = 'bot';
  registrar('bot', html);
  return agregarBurbuja({ lado: 'wolf', grupo: 'bot', nombre: 'Asistente Wolf', clases: 'bot', html });
}

// Guarda la línea de la charla con el bot (texto plano) para mostrarla después al equipo.
function registrar(de, html) {
  if (!transcripcion) return;
  const caja = document.createElement('div');
  caja.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n');
  const texto = caja.textContent.trim();
  if (texto) transcripcion.push({ de, texto });
}

function respuestaLocal(texto) {
  registrar('cliente', escapar(texto));
  agregarBurbuja({ lado: 'yo', grupo: 'yo', html: escapar(texto) });
}

function preguntarOpciones(lista) {
  bloquearEscritura('Elegí una opción');
  return new Promise((resolve) => {
    el.opciones.replaceChildren(...lista.map((op) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `opcion ${op.secundaria ? 'secundaria' : ''}`;
      b.textContent = op.texto;
      b.addEventListener('click', () => {
        el.opciones.replaceChildren();
        respuestaLocal(op.texto);
        resolve(op.valor);
      });
      return b;
    }));
  });
}

// opciones: { placeholder, inputmode, autocomplete, validar(v) → mensaje de error | null, saltear }
function preguntarTexto(opciones) {
  return new Promise((resolve) => {
    preguntaTexto = { ...opciones, resolve };
    el.texto.disabled = false;
    el.enviar.disabled = false;
    el.texto.value = '';
    el.texto.placeholder = opciones.placeholder || 'Escribí tu respuesta';
    el.texto.inputMode = opciones.inputmode || 'text';
    el.texto.autocomplete = opciones.autocomplete || 'on';
    if (opciones.saltear) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opcion secundaria';
      b.textContent = opciones.saltear;
      b.addEventListener('click', () => {
        el.opciones.replaceChildren();
        respuestaLocal(opciones.saltear);
        terminarPregunta(null);
      });
      el.opciones.replaceChildren(b);
    }
    el.texto.focus({ preventScroll: true });
  });
}

function terminarPregunta(valor) {
  const p = preguntaTexto;
  preguntaTexto = null;
  el.ayuda.textContent = '';
  el.opciones.replaceChildren();
  bloquearEscritura('');
  p.resolve(valor);
}

function bloquearEscritura(placeholder) {
  el.texto.value = '';
  el.texto.disabled = true;
  el.enviar.disabled = true;
  el.texto.placeholder = placeholder;
  autoAltura();
}

function habilitarChat() {
  el.texto.disabled = false;
  el.enviar.disabled = false;
  el.texto.placeholder = 'Escribí tu mensaje';
  el.texto.inputMode = 'text';
  el.adjuntar.hidden = false;
}

// ---------------------------------------------------------------------
// Verificación anti-robots (Cloudflare Turnstile)
// ---------------------------------------------------------------------

let turnstileListo = null;
function cargarTurnstile() {
  turnstileListo = turnstileListo || new Promise((resolve, reject) => {
    window.wolfTurnstileListo = () => resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=wolfTurnstileListo';
    s.onerror = () => {
      turnstileListo = null;
      reject(new Error('No se pudo cargar la verificación. Revisá tu conexión.'));
    };
    document.head.append(s);
  });
  return turnstileListo;
}

// Devuelve un token de un solo uso (vale 5 minutos) o null si la verificación no está configurada.
async function obtenerCaptcha() {
  if (MODO_DEMO || !CONFIG.TURNSTILE_SITE_KEY) return null;
  const turnstile = await cargarTurnstile();
  const fila = await botDice('Un segundo: verificamos que no seas un robot…', { espera: 300 });
  const caja = document.createElement('div');
  caja.className = 'captcha';
  fila.querySelector('.burbuja').append(caja);
  alFinal();
  return new Promise((resolve) => {
    const id = turnstile.render(caja, {
      sitekey: CONFIG.TURNSTILE_SITE_KEY,
      language: 'es',
      appearance: 'interaction-only',
      callback: (token) => {
        el.ayuda.textContent = '';
        setTimeout(() => { turnstile.remove(id); fila.remove(); ultimoGrupo = null; }, 300);
        resolve(token);
      },
      'error-callback': () => {
        el.ayuda.textContent = 'No pudimos completar la verificación. Si sigue fallando, recargá la página.';
      },
    });
  });
}

// ---------------------------------------------------------------------
// Bot de admisión
// ---------------------------------------------------------------------

const soloDigitos = (v) => (v || '').replace(/\D/g, '');

const validar = {
  nombre: (v) => (v.trim().split(/\s+/).filter((p) => p.length > 1).length >= 2 ? null : 'Escribí tu nombre y apellido.'),
  noVacio: (v) => (v.trim().length >= 2 ? null : 'Completá este dato para seguir.'),
  celular: (v) => (/^\d{8,15}$/.test(soloDigitos(v)) ? null : 'Escribí el celular con característica, solo números. Ej.: 261 555 1234'),
  email: (v) => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? null : 'Ese correo no parece válido. Revisalo.'),
  dni: (v) => (/^\d{7,9}$/.test(soloDigitos(v)) ? null : 'El DNI tiene 7 u 8 números, sin puntos.'),
  codigo: (v) => (/^\d{6}$/.test(soloDigitos(v)) ? null : 'El código tiene 6 números.'),
  consulta: (v) => (v.trim().length >= 3 ? null : 'Contanos un poco más sobre tu consulta.'),
};

function urlPolitica() {
  const propia = ctx.config.politica_privacidad_url;
  if (propia && /^https:\/\//i.test(propia)) return propia;
  return CONFIG.POLITICA_PRIVACIDAD ? new URL(CONFIG.POLITICA_PRIVACIDAD, location.href).href : null;
}

async function admision() {
  modo = 'bot';
  transcripcion = [];
  el.adjuntar.hidden = true;
  const conocido = ctx.cliente;
  const d = {};
  separadorDia(new Date().toISOString());

  // Saludo, aviso y enlace se editan desde el panel (Administración → Textos del chat).
  const cfg = ctx.config;
  await botDice(conocido
    ? `¡Hola de nuevo, ${escapar(primerNombre(conocido.nombre))}! 👋`
    : escapar(cfg.texto_bienvenida || TEXTOS_POR_DEFECTO.texto_bienvenida));
  await botDice('Te hago unas preguntas cortas y te paso con la persona indicada.', { espera: 700 });

  // Contrato (quien escribe por primera vez en este dispositivo puede recuperar lo anterior)
  if (conocido?.tiene_contrato) {
    d.tiene_contrato = true;
  } else {
    await botDice('¿Ya firmaron el contrato del viaje con Wolf?');
    const r = await preguntarOpciones([
      { valor: true, texto: 'Sí, ya tenemos contrato' },
      { valor: false, texto: 'Todavía no' },
      ...(conocido ? [] : [{ valor: 'recuperar', texto: 'Ya escribí antes desde otro dispositivo', secundaria: true }]),
    ]);
    if (r === 'recuperar') return recuperar();
    d.tiene_contrato = r;
  }

  // Motivo y preguntas frecuentes de ese motivo
  let pregunta = '¿Sobre qué es tu consulta?';
  for (;;) {
    await botDice(pregunta);
    const motivos = ctx.motivos.filter((m) => m.disponible_para === 'todos'
      || (m.disponible_para === 'cliente' && d.tiene_contrato)
      || (m.disponible_para === 'lead' && !d.tiene_contrato));
    d.motivo = await preguntarOpciones(motivos.map((m) => ({ valor: m.codigo, texto: m.nombre })));
    if (await preguntasFrecuentes(d.motivo) === 'seguir') break;
    pregunta = '¿Sobre qué es tu otra consulta?';
  }

  // Privacidad: se informa antes de pedir cualquier dato personal (Ley 25.326, art. 6).
  if (!conocido?.acepto_privacidad_at) {
    const url = urlPolitica();
    const enlace = url
      ? `<br><a class="enlace-privacidad" href="${escapar(url)}" target="_blank" rel="noopener">Ver la política de privacidad</a>`
      : '';
    await botDice(escapar(cfg.texto_privacidad || TEXTOS_POR_DEFECTO.texto_privacidad) + enlace, { espera: 800 });
    await preguntarOpciones([{ valor: true, texto: 'Acepto y sigo' }]);
    d.acepta_privacidad = true;
  }

  // Datos personales: si ya los tenemos, solo confirmar.
  let pedirDatos = true;
  if (conocido) {
    const partes = [conocido.nombre, conocido.colegio, conocido.curso].filter(Boolean).join(', ');
    await botDice(`Tengo estos datos tuyos: <b>${escapar(partes)}</b>. ¿Siguen bien?`);
    pedirDatos = !(await preguntarOpciones([
      { valor: true, texto: 'Sí, siguen bien' },
      { valor: false, texto: 'Quiero cambiarlos', secundaria: true },
    ]));
  }

  // Contrato: primero el número o código; si no lo tiene, abajo se piden colegio, curso y división.
  const contratoAnterior = Boolean(conocido?.nro_contrato) && !pedirDatos;
  if (d.tiene_contrato && !contratoAnterior) {
    const c = await elegirContrato();
    if (c) {
      d.nro_contrato = c.nro_contrato;
      d.colegio = c.colegio;   // ya sabemos el colegio: no se vuelve a preguntar
    }
  }

  if (pedirDatos) {
    await botDice('¿Cómo te llamás? Nombre y apellido.');
    d.nombre = await preguntarTexto({ placeholder: 'Nombre y apellido', autocomplete: 'name', validar: validar.nombre });

    await botDice(`Gracias, ${escapar(primerNombre(d.nombre))}. ¿Quién sos en el viaje?`);
    d.relacion = await preguntarOpciones(RELACIONES);

    if (!d.colegio) {
      await botDice('¿De qué colegio?');
      d.colegio = await preguntarTexto({ placeholder: 'Nombre del colegio', validar: validar.noVacio });
    }

    await botDice('¿Curso y división?');
    d.curso = await preguntarTexto({ placeholder: 'Ej.: 5° B', validar: validar.noVacio });

    if (ctx.sucursales.length > 1) {
      await botDice('¿Con qué sucursal de Wolf están en contacto?');
      d.sucursal_id = await preguntarOpciones([
        ...ctx.sucursales.map((s) => ({ valor: s.id, texto: s.nombre })),
        { valor: null, texto: 'No sé', secundaria: true },
      ]);
    } else if (ctx.sucursales.length === 1) {
      d.sucursal_id = ctx.sucursales[0].id;
    }

    await botDice('¿A qué celular te podemos escribir o llamar si hace falta?');
    d.celular = soloDigitos(await preguntarTexto({
      placeholder: 'Ej.: 261 555 1234', inputmode: 'tel', autocomplete: 'tel', validar: validar.celular,
    }));

    await botDice('¿Y un correo? Te avisamos ahí cuando te respondamos y te sirve para seguir la charla desde otro dispositivo.');
    d.email = await preguntarTexto({
      placeholder: 'tu@correo.com', inputmode: 'email', autocomplete: 'email',
      validar: validar.email, saltear: 'Prefiero no dejarlo',
    });
  }

  if (d.nro_contrato) {
    await botDice('¿Y el DNI del pasajero? Solo números.');
    d.dni_pasajero = soloDigitos(await preguntarTexto({
      placeholder: 'DNI del pasajero', inputmode: 'numeric', validar: validar.dni,
    }));
  }

  await botDice('Último paso: contanos tu consulta.');
  d.mensaje = await preguntarTexto({ placeholder: 'Escribí tu consulta', validar: validar.consulta });

  await enviarConsulta(d);
}

// Pide el número o código de contrato. Devuelve { nro_contrato, colegio } o null si no lo tiene
// (entonces el bot pregunta colegio, curso y división). También acepta el nombre o la sigla del
// colegio (parcial, con errores de tipeo); si hay muchos resultados se acota por año y destino.
async function elegirContrato() {
  const OTRO = Symbol('otro');
  const NO_ES = { valor: OTRO, texto: 'Ninguno es el mío', secundaria: true };
  const MAXIMO = 8;       // contratos que se muestran como botones
  const DEMASIADOS = 40;  // más que esto: pedir más datos antes de acotar
  const etiqueta = (c) => `${c.nro_contrato} · ${c.colegio}`;
  const elegido = (c) => ({ nro_contrato: c.nro_contrato, colegio: c.colegio });
  // Parece un número o código (2464, 2.464, WT26CBU004) y no el nombre de un colegio.
  const pareceNumero = (t) => /^[A-Za-z]{0,4}[\d.\s]*[A-Za-z]{0,4}\d[\w.\s-]*$/.test(t.trim()) && !/\s.*\s.*\s/.test(t.trim());

  let catalogo = [];
  try {
    catalogo = await api.catalogoContratos();
  } catch (e) {
    console.error(e);
  }

  await botDice('¿Tenés el <b>número o código de contrato</b>? Escribilo (por ejemplo 2464 o WT26CBU004). Si no lo tenés, seguimos con el colegio y el curso.');
  for (let intento = 0; intento < 4; intento++) {
    if (intento) await botDice('Probemos de nuevo: número o código de contrato.');
    const texto = await preguntarTexto({
      placeholder: 'Número o código de contrato', validar: validar.noVacio, saltear: 'No lo tengo',
    });
    if (texto === null) return null;

    const r = buscarContrato(texto, catalogo, Infinity);
    if (r.tipo === 'exacto') {
      const c = r.contratos[0];
      await botDice(`Encontré tu contrato <b>${escapar(c.nro_contrato)}</b>:<br>`
        + `🏫 <b>Escuela:</b> ${escapar(c.colegio)}<br>`
        + `✈️ <b>Destino:</b> ${escapar(c.destino)} ${c.anio}<br>`
        + '¿Son correctos estos datos?');
      if (await preguntarOpciones([{ valor: true, texto: 'Sí, son correctos' }, { valor: false, texto: 'No, buscar de nuevo', secundaria: true }])) {
        return elegido(c);
      }
      continue;
    }
    if (r.tipo === 'ninguno') {
      if (pareceNumero(texto)) {
        await botDice(`No encuentro el contrato <b>${escapar(texto.trim())}</b> en la lista. ¿Lo dejamos así igual?`);
        if (await preguntarOpciones([{ valor: true, texto: 'Sí, usar ese número' }, { valor: false, texto: 'No, escribirlo otra vez', secundaria: true }])) {
          return { nro_contrato: texto.trim(), colegio: null };
        }
      } else {
        await botDice('No encontré ese colegio.');
      }
      continue;
    }
    if (r.total > DEMASIADOS) {
      await botDice(`Hay ${r.total} resultados. Escribí algo más del nombre del colegio para encontrarlo.`);
      continue;
    }

    // Colegios que viajan en distintos años o destinos: se acota antes de mostrar los contratos.
    let filas = r.contratos;
    let volver = false;
    for (const [campo, pregunta] of [['anio', '¿De qué año es el viaje?'], ['destino', '¿A qué destino?']]) {
      const valores = [...new Set(filas.map((c) => c[campo]))];
      if (filas.length <= MAXIMO || valores.length === 1) continue;
      await botDice(pregunta);
      const v = await preguntarOpciones([...valores.map((x) => ({ valor: x, texto: String(x) })), NO_ES]);
      if (v === OTRO) { volver = true; break; }
      filas = filas.filter((c) => c[campo] === v);
    }
    if (volver) continue;
    if (filas.length > MAXIMO) {
      await botDice('Todavía hay varios. Escribí también el curso o el turno para encontrarlo.');
      continue;
    }

    await botDice(filas.length === 1 ? 'Encontré este contrato. ¿Es el tuyo?' : '¿Cuál es tu contrato?');
    const c = await preguntarOpciones([
      ...filas.map((x) => ({ valor: x, texto: `${etiqueta(x)} · ${x.destino} ${x.anio}` })),
      NO_ES,
    ]);
    if (c !== OTRO) return elegido(c);
  }

  await botDice('No pude encontrarlo, seguimos con el colegio y el curso.');
  return null;
}

// Muestra las preguntas frecuentes del motivo. Devuelve 'seguir' (hacer la consulta)
// u 'otra' (la respuesta le sirvió y quiere consultar por otro tema).
async function preguntasFrecuentes(motivo) {
  let lista = [];
  try {
    lista = await api.preguntasFrecuentes(motivo);
  } catch (e) {
    console.error(e);
  }
  if (!lista.length) return 'seguir';

  await botDice('Antes de seguir: capaz alguna de estas preguntas frecuentes te resuelve la duda.');
  for (;;) {
    const id = await preguntarOpciones([
      ...lista.map((f) => ({ valor: f.id, texto: f.pregunta })),
      { valor: null, texto: 'No, quiero hacer mi consulta', secundaria: true },
    ]);
    if (!id) return 'seguir';

    const f = lista.find((x) => x.id === id);
    api.registrarFaq(f.id).catch(() => {});
    await botDice(textoConEnlaces(f.respuesta), { espera: 700 });
    await botDice('¿Te sirvió?', { espera: 400 });
    const r = await preguntarOpciones([
      { valor: 'si', texto: 'Sí, era eso' },
      { valor: 'no', texto: 'No, quiero consultar' },
      { valor: 'otra', texto: 'Ver otra pregunta', secundaria: true },
    ]);
    if (r === 'no') {
      api.registrarFaq(f.id, false).catch(() => {});
      return 'seguir';
    }
    if (r === 'si') {
      api.registrarFaq(f.id, true).catch(() => {});
      await botDice('¡Qué bueno! Si necesitás algo más, escribime acá cuando quieras.');
      await preguntarOpciones([{ valor: true, texto: 'Tengo otra consulta' }]);
      return 'otra';
    }
    await botDice('Elegí otra pregunta:', { espera: 300 });
  }
}

async function enviarConsulta(d) {
  let r;
  d.admision = transcripcion || [];
  transcripcion = null;   // lo que sigue ya es la conversación con el equipo
  try {
    // La primera vez en este dispositivo se crea la sesión: ahí se pide la verificación anti-robots.
    const { usuarioId } = await api.iniciar();
    const captcha = usuarioId ? null : await obtenerCaptcha();
    const escribiendo = agregarBurbuja({
      lado: 'wolf', grupo: 'bot', nombre: 'Asistente Wolf', clases: 'bot escribiendo', html: '<i></i><i></i><i></i>',
    });
    try {
      r = await api.iniciarConversacion(d, captcha);
    } finally {
      escribiendo.remove();
      ultimoGrupo = null;
    }
  } catch (e) {
    console.error(e);
    await botDice(`No pudimos enviar tu consulta. ${escapar(legible(e, 'Revisá tu conexión.'))}`);
    await preguntarOpciones([{ valor: true, texto: 'Volver a intentar' }]);
    return enviarConsulta(d);
  }

  // Lo que el cliente ya vio en la charla con el bot no se repite.
  const c = await api.conversacion(r.conversacion_id);
  const mensajes = await api.mensajes(r.conversacion_id);
  for (const m of mensajes) {
    if (m.autor_tipo === 'sistema' || (m.autor_tipo === 'cliente' && !r.existente)) pintados.add(m.id);
  }
  // La burbuja local de la consulta pasa a ser el mensaje guardado: hora y ✓ / ✓✓.
  const enviado = [...mensajes].reverse().find((m) => m.autor_tipo === 'cliente');
  const local = [...el.hilo.querySelectorAll('.fila.yo:not([data-creado])')].pop();
  if (enviado && local && !r.existente) {
    local.dataset.creado = enviado.created_at;
    local.querySelector('.burbuja').insertAdjacentHTML('beforeend',
      `<span class="meta">${hora(enviado.created_at)}<span class="visto" aria-label="Enviado" title="Enviado">✓</span></span>`);
  }
  ctx.cliente = {
    ...(ctx.cliente || {}), nombre: d.nombre || ctx.cliente?.nombre, email: d.email || ctx.cliente?.email,
    acepto_privacidad_at: ctx.cliente?.acepto_privacidad_at || new Date().toISOString(),
  };
  await abrirConversacion(c, mensajes);
}

// ---------------------------------------------------------------------
// Recuperar la conversación desde otro dispositivo
// ---------------------------------------------------------------------

async function recuperar() {
  transcripcion = null;   // el correo y el código no se guardan
  await botDice('Escribí el correo que dejaste cuando hiciste la consulta. Te mandamos un código para entrar.');
  const email = await preguntarTexto({
    placeholder: 'tu@correo.com', inputmode: 'email', autocomplete: 'email',
    validar: validar.email, saltear: 'No dejé correo',
  });
  if (!email) {
    await botDice('Sin correo no podemos recuperar la conversación anterior, pero te atendemos igual. Empecemos de nuevo.');
    return admision();
  }

  let enviado = false;
  while (!enviado) {
    try {
      const captcha = await obtenerCaptcha();
      const r = await api.enviarCodigo(email.trim(), captcha);
      await botDice(escapar(r.mensaje));
      if (r.demo) await botDice(`<i>${escapar(r.demo)}</i>`, { espera: 200 });
      enviado = true;
    } catch (e) {
      console.error(e);
      await botDice(`No pudimos enviar el código. ${escapar(legible(e, 'Revisá tu conexión.'))}`);
      const otra = await preguntarOpciones([
        { valor: true, texto: 'Volver a intentar' },
        { valor: false, texto: 'Empezar una consulta nueva', secundaria: true },
      ]);
      if (!otra) return admision();
    }
  }

  for (;;) {
    await botDice('Escribí el código de 6 números que te llegó.');
    const codigo = await preguntarTexto({
      placeholder: 'Código de 6 números', inputmode: 'numeric', autocomplete: 'one-time-code',
      validar: validar.codigo, saltear: 'No me llegó',
    });
    if (!codigo) {
      const r = await preguntarOpciones([
        { valor: 'otro', texto: 'Mandarme otro código' },
        { valor: 'nueva', texto: 'Empezar una consulta nueva', secundaria: true },
      ]);
      if (r === 'otro') return recuperarReenviar(email);
      return admision();
    }
    try {
      await api.verificarCodigo(email.trim(), soloDigitos(codigo));
      return recuperado();
    } catch (e) {
      await botDice(escapar(legible(e, 'No pudimos verificar el código. Revisá tu conexión.')));
    }
  }
}

async function recuperarReenviar(email) {
  try {
    const captcha = await obtenerCaptcha();
    const r = await api.enviarCodigo(email.trim(), captcha);
    await botDice(escapar(r.mensaje));
  } catch (e) {
    await botDice(`No pudimos enviar el código. ${escapar(legible(e, 'Revisá tu conexión.'))}`);
  }
  for (;;) {
    await botDice('Escribí el nuevo código.');
    const codigo = await preguntarTexto({
      placeholder: 'Código de 6 números', inputmode: 'numeric', autocomplete: 'one-time-code',
      validar: validar.codigo, saltear: 'Empezar una consulta nueva',
    });
    if (!codigo) return admision();
    try {
      await api.verificarCodigo(email.trim(), soloDigitos(codigo));
      return recuperado();
    } catch (e) {
      await botDice(escapar(legible(e, 'No pudimos verificar el código. Revisá tu conexión.')));
    }
  }
}

async function recuperado() {
  ctx = await api.contexto();
  el.hilo.replaceChildren();
  pintados.clear();
  ultimoDia = null;
  ultimoGrupo = null;
  agregarSistema('Listo: recuperamos tu conversación en este dispositivo.');
  actualizarEstado();
  if (ctx.ultima) await abrirConversacion(ctx.ultima);
  else await admision();
}

// ---------------------------------------------------------------------
// Conversación con el gestor
// ---------------------------------------------------------------------

async function abrirConversacion(c, mensajesPrevios) {
  conv = c;
  desuscribir?.();
  canalEscribiendo?.cerrar();
  avisarPadre({ type: 'wolf-chat:estado', conversacion: true });
  const mensajes = mensajesPrevios || await api.mensajes(c.id);
  mensajes.forEach(pintarMensaje);
  actualizarEstado();
  actualizarVistos();

  desuscribir = api.suscribir(c.id, {
    onMensaje: (m) => {
      const nuevo = !pintados.has(m.id);
      pintarMensaje(m);
      if (nuevo && m.autor_tipo !== 'cliente') avisarNuevo();
    },
    onConversacion: (c2) => {
      const antes = conv?.estado;
      conv = { ...conv, ...c2 };
      actualizarEstado();
      actualizarVistos();
      if (antes === 'abierta' && conv.estado === 'resuelta') mostrarCierre();
    },
  });
  canalEscribiendo = api.escribiendo(c.id, (p) => {
    if (p?.quien === 'gestor' && conv?.estado === 'abierta') mostrarEscribiendo(p.nombre);
  });

  if (c.estado === 'abierta') {
    modo = 'chat';
    habilitarChat();
    marcarLeida();
  } else {
    mostrarCierre();
  }
}

function mostrarCierre() {
  modo = 'cerrada';
  quitarEscribiendo();
  bloquearEscritura('Esta consulta está resuelta');
  el.adjuntar.hidden = true;
  el.hilo.querySelector('.cierre')?.remove();
  const caja = document.createElement('div');
  caja.className = 'cierre aparece';

  if (conv.csat) {
    caja.insertAdjacentHTML('beforeend',
      `<p class="cierre-nota">Calificaste esta atención: ${'★'.repeat(conv.csat)}${'☆'.repeat(5 - conv.csat)}</p>`);
  } else {
    caja.append(encuesta());
  }

  const p = document.createElement('p');
  p.textContent = 'Esta consulta está resuelta. ¿Necesitás algo más?';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'boton';
  b.textContent = 'Iniciar una nueva consulta';
  b.addEventListener('click', async () => {
    caja.remove();
    desuscribir?.();
    canalEscribiendo?.cerrar();
    conv = null;
    ultimoGrupo = null;
    ctx = await api.contexto();
    actualizarEstado();
    admision();
  });
  caja.append(p, b);
  agregarAlHilo(caja);
  alFinal();
}

// Encuesta de satisfacción: 1 a 5 estrellas y un comentario opcional.
function encuesta() {
  const f = document.createElement('form');
  f.className = 'encuesta';
  f.innerHTML = `
    <p class="encuesta-titulo" id="encuesta-titulo">¿Cómo te atendimos?</p>
    <div class="estrellas" role="radiogroup" aria-labelledby="encuesta-titulo">
      ${CALIFICACIONES.map((t, i) => `
        <button type="button" class="estrella" role="radio" aria-checked="false" data-valor="${i + 1}"
          aria-label="${i + 1} de 5: ${t}" title="${t}">★</button>`).join('')}
    </div>
    <p class="estrellas-texto" aria-live="polite"></p>
    <div class="encuesta-comentario" hidden>
      <textarea maxlength="500" rows="2" placeholder="¿Querés contarnos algo más? (opcional)" aria-label="Comentario"></textarea>
      <button class="boton chico" type="submit">Enviar calificación</button>
    </div>`;
  let puntaje = 0;
  const botones = [...f.querySelectorAll('.estrella')];
  const marcar = (n) => botones.forEach((b, i) => {
    b.classList.toggle('activa', i < n);
    b.setAttribute('aria-checked', String(i + 1 === n));
  });
  botones.forEach((b) => {
    b.addEventListener('click', () => {
      puntaje = Number(b.dataset.valor);
      marcar(puntaje);
      f.querySelector('.estrellas-texto').textContent = CALIFICACIONES[puntaje - 1];
      f.querySelector('.encuesta-comentario').hidden = false;
      f.querySelector('textarea').focus({ preventScroll: true });
      alFinal();
    });
    b.addEventListener('mouseenter', () => marcar(Number(b.dataset.valor)));
    b.addEventListener('mouseleave', () => marcar(puntaje));
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!puntaje) return;
    const enviar = f.querySelector('button[type=submit]');
    enviar.disabled = true;
    try {
      await api.calificar(conv.id, puntaje, f.querySelector('textarea').value.trim());
      conv.csat = puntaje;
      f.replaceWith(Object.assign(document.createElement('p'), {
        className: 'cierre-nota', textContent: '¡Gracias por contarnos! Nos ayuda a atenderte mejor.',
      }));
    } catch (err) {
      console.error(err);
      enviar.disabled = false;
      el.ayuda.textContent = legible(err, 'No pudimos guardar tu calificación. Probá de nuevo.');
    }
  });
  return f;
}

async function enviarTexto(texto) {
  el.enviar.disabled = true;
  try {
    const m = await api.enviarTexto(conv.id, texto);
    pintarMensaje(m);
    el.texto.value = '';
    autoAltura();
  } catch (e) {
    console.error(e);
    el.ayuda.textContent = legible(e, 'No se pudo enviar el mensaje. Revisá tu conexión y probá de nuevo.');
  } finally {
    el.enviar.disabled = modo !== 'chat';
    el.texto.focus({ preventScroll: true });
  }
}

async function enviarArchivo(archivo) {
  el.ayuda.textContent = '';
  const tipoOk = archivo.type.startsWith('image/') || archivo.type === 'application/pdf';
  if (!tipoOk) {
    el.ayuda.textContent = 'Solo se pueden enviar fotos o archivos PDF.';
    return;
  }
  if (archivo.size > CONFIG.ADJUNTO_MAX_MB * 1024 * 1024) {
    el.ayuda.textContent = `El archivo supera los ${CONFIG.ADJUNTO_MAX_MB} MB.`;
    return;
  }
  const enviando = agregarSistema(`Enviando ${archivo.name}…`);
  try {
    const m = await api.enviarArchivo(conv.id, archivo);
    enviando.remove();
    pintarMensaje(m);
  } catch (e) {
    console.error(e);
    enviando.remove();
    el.ayuda.textContent = legible(e, 'No se pudo enviar el archivo. Revisá tu conexión y probá de nuevo.');
  }
}

// ---------------------------------------------------------------------
// No leídos, aviso al sitio y "latido"
// ---------------------------------------------------------------------

function estaMirando() {
  return document.visibilityState === 'visible' && abiertoEnPadre;
}

function avisarNuevo() {
  if (estaMirando()) {
    marcarLeida();
    return;
  }
  noLeidos += 1;
  document.title = `(${noLeidos}) ${tituloBase}`;
  avisarPadre({ type: 'wolf-chat:no-leidos', cantidad: noLeidos });
}

function marcarLeida() {
  noLeidos = 0;
  document.title = tituloBase;
  avisarPadre({ type: 'wolf-chat:no-leidos', cantidad: 0 });
  if (conv) api.marcarLeida(conv.id).catch(() => {});
}

function avisarPadre(datos) {
  if (embebido && window.parent !== window) window.parent.postMessage(datos, '*');
}

document.addEventListener('visibilitychange', () => {
  if (estaMirando() && noLeidos) marcarLeida();
});

window.addEventListener('message', (e) => {
  if (e.source !== window.parent || e.data?.type !== 'wolf-chat:visibilidad') return;
  abiertoEnPadre = Boolean(e.data.abierto);
  if (abiertoEnPadre) {
    if (noLeidos) marcarLeida();
    alFinal();
    if (!el.texto.disabled) el.texto.focus({ preventScroll: true });
  }
});

setInterval(() => {
  if (estaMirando() && ctx?.cliente) api.latido().catch(() => {});
}, 60000);

// ---------------------------------------------------------------------
// Eventos de la interfaz
// ---------------------------------------------------------------------

function autoAltura() {
  el.texto.style.height = 'auto';
  el.texto.style.height = `${Math.min(el.texto.scrollHeight, 140)}px`;
}

el.texto.addEventListener('input', () => {
  autoAltura();
  if (el.ayuda.textContent && !preguntaTexto) el.ayuda.textContent = '';
  if (el.texto.value.trim()) avisarQueEscribo();
});

el.texto.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.composer.requestSubmit();
  }
});

el.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const texto = el.texto.value.trim();

  if (preguntaTexto) {
    const error = preguntaTexto.validar?.(texto) ?? null;
    if (error) {
      el.ayuda.textContent = error;
      el.texto.focus();
      alFinal();
      return;
    }
    respuestaLocal(texto);
    terminarPregunta(texto);
    return;
  }

  if (modo === 'chat' && texto) enviarTexto(texto);
});

el.archivo.addEventListener('change', () => {
  const archivo = el.archivo.files?.[0];
  el.archivo.value = '';
  if (archivo && modo === 'chat') enviarArchivo(archivo);
});

el.cerrar.addEventListener('click', () => avisarPadre({ type: 'wolf-chat:cerrar' }));
