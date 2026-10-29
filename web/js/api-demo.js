// Modo demostración: misma interfaz que api-supabase.js, con los datos guardados
// en el navegador (localStorage). Sirve para probar el chat y el panel sin
// configurar Supabase. Abrí el chat y el panel en dos pestañas del mismo
// navegador y se comunican entre sí. Reproduce las reglas de la base de datos
// en forma simplificada; la referencia es siempre el SQL de supabase/migrations.

import { textoHorario, TEXTOS_POR_DEFECTO, normalizarContrato, normalizarTexto, primerNombre } from './util.js';

const CLAVE = 'wolf-demo-v3';
const CLAVE_CLIENTE = 'wolf-demo-cliente';
const CLAVE_PANEL = 'wolf-demo-panel';
const CODIGO_DEMO = '123456';
const ZONA_MS = 3 * 3600 * 1000; // Mendoza, UTC-3 sin horario de verano

const canal = 'BroadcastChannel' in window ? new BroadcastChannel('wolf-demo') : null;
const oyentes = new Set();
if (canal) canal.onmessage = (e) => oyentes.forEach((f) => f(e.data));

const uuid = () => crypto.randomUUID();
const ahoraISO = () => new Date().toISOString();
const haceMin = (min) => new Date(Date.now() - min * 60000).toISOString();
const haceDias = (d, min = 0) => new Date(Date.now() - d * 86400000 - min * 60000).toISOString();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };
const limpio = (v) => (v == null ? null : String(v).trim() || null);
const soloDigitos = (v) => (v == null ? null : String(v).replace(/\D/g, '') || null);

// ---------------------------------------------------------------------
// Datos iniciales
// ---------------------------------------------------------------------

function semilla() {
  const equipos = [
    { id: 1, nombre: 'Ventas' }, { id: 2, nombre: 'Cobranzas' },
    { id: 3, nombre: 'Operaciones' }, { id: 4, nombre: 'Atención al cliente' },
  ];
  const motivos = [
    { codigo: 'cotizacion', nombre: 'Nuevo viaje / cotización', orden: 1, disponible_para: 'todos', equipo_id: 1, activo: true, color: '#0b34dc' },
    { codigo: 'pagos', nombre: 'Pagos y cuotas', orden: 2, disponible_para: 'cliente', equipo_id: 2, activo: true, color: '#1f8a5b' },
    { codigo: 'viaje_contratado', nombre: 'Mi viaje contratado / documentación', orden: 3, disponible_para: 'cliente', equipo_id: 3, activo: true, color: '#13809a' },
    { codigo: 'reclamos', nombre: 'Reclamos', orden: 4, disponible_para: 'todos', equipo_id: 4, activo: true, color: '#c8402a' },
    { codigo: 'otro', nombre: 'Otra consulta', orden: 5, disponible_para: 'todos', equipo_id: 4, activo: true, color: '#77757f' },
  ];
  const g = (id, nombre, email, rol, eqs, min) => ({
    id, nombre, email, rol, equipos: eqs, activo: true, disponible: true, user_id: id,
    ultima_asignacion_at: min == null ? null : haceMin(min), created_at: haceDias(30),
  });
  const gestores = [
    g('g-franco', 'Franco Bocchi', 'franco@demo.wolf', 'admin', [], null),
    g('g-sofia', 'Sofía Ruiz', 'sofia@demo.wolf', 'supervisor', [], null),
    g('g-ana', 'Ana López', 'ana@demo.wolf', 'gestor', [1, 4], 40),
    g('g-bruno', 'Bruno Díaz', 'bruno@demo.wolf', 'gestor', [1], 30),
    g('g-carla', 'Carla Sosa', 'carla@demo.wolf', 'gestor', [2], 20),
    g('g-diego', 'Diego Mora', 'diego@demo.wolf', 'gestor', [3, 4], 10),
  ];
  const config = {
    id: 1, zona_horaria: 'America/Argentina/Mendoza', hora_inicio: '09:00', hora_fin: '16:00',
    dias_habiles: [1, 2, 3, 4, 5], minutos_alerta: 30, dias_mismo_gestor: 30, dias_conservacion: 730,
    max_abiertas_por_gestor: 15, minutos_reasignar: 60, ia_habilitada: false,
    ...TEXTOS_POR_DEFECTO, politica_privacidad_url: null,
  };
  const db = {
    equipos, motivos, gestores, config,
    sucursales: [{ id: 1, nombre: 'Mendoza', orden: 1, activo: true }, { id: 2, nombre: 'San Juan', orden: 2, activo: true }],
    feriados: [{ fecha: '2026-12-08', descripcion: 'Inmaculada Concepción de María' }, { fecha: '2026-12-25', descripcion: 'Navidad' }],
    etiquetas: [{ id: 1, nombre: 'Bariloche 2027', color: '#13809a' }, { id: 2, nombre: 'Camboriú 2027', color: '#0b34dc' }, { id: 3, nombre: 'Seguimiento urgente', color: '#c8402a' }],
    cliente_etiquetas: [],
    respuestas: [
      { id: uuid(), titulo: 'Saludo', texto: '¡Hola {nombre}! Soy {gestor}, de Wolf. ¿En qué te puedo ayudar?', equipo_id: null, orden: 1, activo: true },
      { id: uuid(), titulo: 'Pedir comprobante', texto: 'Para registrar tu pago, mandanos por acá la foto o el PDF del comprobante, con el número de contrato {contrato}.', equipo_id: 2, orden: 2, activo: true },
      { id: uuid(), titulo: 'Cierre', texto: 'Gracias por escribirnos, {nombre}. Si necesitás algo más, acá estamos.', equipo_id: null, orden: 3, activo: true },
    ],
    faq: [
      { id: uuid(), pregunta: '¿Cómo pago una cuota?', respuesta: 'Respuesta de ejemplo: cargá la real desde Administración → Preguntas frecuentes.', motivo: 'pagos', orden: 1, activo: true, vistas: 14, utiles: 9, no_utiles: 3 },
      { id: uuid(), pregunta: '¿Qué incluye el viaje?', respuesta: 'Respuesta de ejemplo: cargá la real desde Administración → Preguntas frecuentes.', motivo: 'cotizacion', orden: 2, activo: true, vistas: 22, utiles: 12, no_utiles: 6 },
    ],
    catalogo: [
      { nro_contrato: '2419', codigo: 'WT26CBU001', anio: 2026, destino: 'Camboriu', producto: 'Camboriu 14/9', colegio: 'MARTIN ZAPATA 3ro Tarde' },
      { nro_contrato: '2437', codigo: 'WT26CBU002', anio: 2026, destino: 'Camboriu', producto: 'Camboriu 14/9', colegio: 'LAE - LICEO AGRICOLA Y ENOLOGICO DOMINGO F. SARMIENTO 3ro Mañana' },
      { nro_contrato: '3499', codigo: 'WT26CBU008', anio: 2026, destino: 'Camboriu', producto: 'Camboriu 10/6', colegio: 'MARTIN ZAPATA 3ro Mañana' },
    ],
    contratos: [
      { nro_contrato: 'W-2026-0412', dni_pasajero: '46210987', pasajero: 'Lucía Funes', colegio: 'Colegio Nacional Agustín Álvarez', curso: '5° A', viaje: 'Camboriú 2026', actualizado_at: haceDias(2) },
      { nro_contrato: 'W-2026-0501', dni_pasajero: '45123456', pasajero: 'Mateo Pérez', colegio: 'Colegio San Martín', curso: '5° B', viaje: 'Bariloche 2026', actualizado_at: haceDias(2) },
    ],
    clientes: {}, conversaciones: [], mensajes: [], avisos: [], aviso_destinatarios: [], auditoria: [],
    numero: 1040,
  };

  // Historial de ejemplo para que el panel, los leads y los reportes no arranquen vacíos.
  const ejemplo = (cli, conv, mensajes) => {
    db.clientes[cli.id] = {
      relacion: 'familiar', sucursal_id: 1, acepto_privacidad_at: haceDias(1), ultima_actividad_at: haceMin(5),
      created_at: mensajes[0][2], email: null, acepta_avisos: true, contrato_verificado: false, verificacion: null,
      etapa: cli.tiene_contrato ? 'contratado' : 'nuevo', etapa_at: mensajes[0][2], ...cli,
    };
    db.clientes[cli.id].tipo = db.clientes[cli.id].tiene_contrato ? 'cliente' : 'lead';
    const c = {
      id: uuid(), numero: ++db.numero, cliente_id: cli.id, estado: 'abierta', fuera_de_horario: false,
      pendiente_respuesta: true, alerta_demora: false, no_leidos_gestor: 0, no_leidos_cliente: 0,
      primera_respuesta_at: null, resuelta_at: null, created_at: mensajes[0][2], asignada_at: mensajes[0][2],
      leido_cliente_at: null, leido_gestor_at: null, csat: null, csat_comentario: null, ...conv,
    };
    db.conversaciones.push(c);
    for (const [autor_tipo, texto, created_at, extra] of mensajes) {
      aplicarMensaje(db, { id: uuid(), conversacion_id: c.id, autor_tipo, texto, interno: false, created_at, ...extra });
    }
    return c;
  };

  ejemplo(
    { id: 'demo-c1', nombre: 'Marcela Funes', celular: '2615123456', email: 'marcela@correo.com',
      colegio: 'Colegio Nacional Agustín Álvarez', curso: '5° A', tiene_contrato: true, nro_contrato: 'W-2026-0412',
      dni_pasajero: '46210987', contrato_verificado: true, verificacion: 'automatica' },
    { motivo: 'pagos', equipo_id: 2, gestor_id: 'g-carla', gestor_nombre: 'Carla' },
    [['sistema', 'Consulta iniciada: Pagos y cuotas (contrato W-2026-0412)', haceMin(48)],
     ['cliente', 'Hola, quería saber si ya les figura el pago de la cuota 6. Lo hice por transferencia el lunes.', haceMin(48)],
     ['bot', '¡Listo! Carla tiene tu consulta y te responde por acá en breve.', haceMin(48), { autor_nombre: 'Asistente Wolf' }]],
  );
  ejemplo(
    { id: 'demo-c2', nombre: 'Tomás Herrera', relacion: 'alumno', celular: '2614987654',
      colegio: 'Escuela Técnica 4-112', curso: '6° 2°', tiene_contrato: false, etapa: 'cotizado' },
    { motivo: 'cotizacion', equipo_id: 1, gestor_id: 'g-ana', gestor_nombre: 'Ana' },
    [['sistema', 'Consulta iniciada: Nuevo viaje / cotización (lead)', haceMin(15)],
     ['cliente', 'Buenas! Somos 34 del curso y queremos saber precios para Camboriú 2027', haceMin(15)],
     ['bot', '¡Listo! Ana tiene tu consulta y te responde por acá en breve.', haceMin(15), { autor_nombre: 'Asistente Wolf' }],
     ['gestor', '¡Hola Tomás! Soy Ana, de Wolf. ¿Para qué mes están pensando el viaje?', haceMin(12), { autor_nombre: 'Ana', gestor_id: 'g-ana' }],
     ['cliente', 'Para septiembre. Algunos quieren Bariloche también, se puede cotizar los dos?', haceMin(3)]],
  );
  db.clientes['demo-c2'].etapa = 'cotizado';
  db.cliente_etiquetas.push({ cliente_id: 'demo-c2', etiqueta_id: 2 });
  ejemplo(
    { id: 'demo-c3', nombre: 'Gabriela Ortiz', celular: '2645012345', email: 'gortiz@correo.com', sucursal_id: 2,
      colegio: 'Colegio Santa Rosa', curso: '5° B', tiene_contrato: true, nro_contrato: 'W-2026-0388', dni_pasajero: '45998123' },
    { motivo: 'viaje_contratado', equipo_id: 3, gestor_id: null, gestor_nombre: null, asignada_at: null },
    [['sistema', 'Consulta iniciada: Mi viaje contratado / documentación (contrato W-2026-0388)', haceMin(70)],
     ['cliente', '¿Qué documentación necesita mi hija para viajar? Tiene DNI pero no pasaporte.', haceMin(70)],
     ['bot', 'Tu consulta quedó en fila. Te responde la primera persona disponible del equipo.', haceMin(70), { autor_nombre: 'Asistente Wolf' }]],
  ).alerta_demora = true;

  // Consultas resueltas de días anteriores (para reportes y tablero).
  const pasadas = [
    ['Sergio Molina', 'Colegio San Martín', '5° B', 'cotizacion', 'g-bruno', 1, 'contactado', 5, 12],
    ['Laura Benítez', 'Colegio San Martín', '5° A', 'cotizacion', 'g-ana', 2, 'negociando', 4, 25],
    ['Paula Ríos', 'Colegio Santa Rosa', '5° B', 'pagos', 'g-carla', 2, 'contratado', 5, 8],
    ['Jorge Castro', 'Escuela Técnica 4-112', '6° 1°', 'cotizacion', 'g-bruno', 3, 'perdido', 3, 40],
    ['Natalia Vera', 'Colegio Nacional Agustín Álvarez', '5° C', 'reclamos', 'g-diego', 4, 'contratado', 4, 55],
    ['Rocío Domínguez', 'Colegio San Martín', '5° B', 'cotizacion', 'g-ana', 6, 'contratado', 5, 18],
    ['Martín Suárez', 'Colegio Santa Rosa', '5° A', 'viaje_contratado', 'g-diego', 7, 'contratado', 4, 33],
    ['Andrea Gil', 'Escuela Técnica 4-112', '6° 2°', 'cotizacion', 'g-ana', 9, 'cotizado', null, 21],
  ];
  pasadas.forEach(([nombre, colegio, curso, motivo, gestor, dias, etapa, csat, minResp], i) => {
    const t0 = haceDias(dias, -(9 * 60 + i * 37) % 300);
    const id = `demo-p${i}`;
    const c = ejemplo(
      { id, nombre, colegio, curso, tiene_contrato: etapa === 'contratado', email: `cliente${i}@correo.com`,
        celular: `26150000${10 + i}`, etapa, motivo_perdida: etapa === 'perdido' ? 'Eligió otra empresa' : null },
      { motivo, equipo_id: db.motivos.find((m) => m.codigo === motivo).equipo_id, gestor_id: gestor,
        gestor_nombre: primerNombre(db.gestores.find((x) => x.id === gestor).nombre) },
      [['sistema', `Consulta iniciada: ${db.motivos.find((m) => m.codigo === motivo).nombre}`, t0],
       ['cliente', 'Consulta de ejemplo', t0],
       ['gestor', 'Respuesta de ejemplo', new Date(Date.parse(t0) + minResp * 60000).toISOString(),
        { autor_nombre: primerNombre(db.gestores.find((x) => x.id === gestor).nombre), gestor_id: gestor }]],
    );
    db.clientes[id].etapa = etapa;
    Object.assign(c, { estado: 'resuelta', resuelta_at: new Date(Date.parse(t0) + 3 * 3600000).toISOString(),
      pendiente_respuesta: false, csat, csat_comentario: csat === 5 ? 'Muy buena atención' : null });
  });
  if (db.clientes['demo-p2']) db.cliente_etiquetas.push({ cliente_id: 'demo-p2', etiqueta_id: 1 });
  return db;
}

function leer() {
  try {
    const s = localStorage.getItem(CLAVE);
    if (s) return JSON.parse(s);
  } catch { /* sin almacenamiento: se usa la semilla */ }
  const db = semilla();
  guardar(db);
  return db;
}

function guardar(db) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(db));
  } catch { /* almacenamiento lleno o bloqueado */ }
}

function emitir(evento) {
  oyentes.forEach((f) => f(evento));
  canal?.postMessage(evento);
}

// ---------------------------------------------------------------------
// Reglas (equivalen a las funciones de la base de datos)
// ---------------------------------------------------------------------

const local = (fecha) => new Date(new Date(fecha).getTime() - ZONA_MS);
const aMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

function enHorario(cfg, fecha = new Date(), feriados = []) {
  const l = local(fecha);
  if (feriados.some((f) => f.fecha === l.toISOString().slice(0, 10))) return false;
  const dia = l.getUTCDay() || 7;
  const min = l.getUTCHours() * 60 + l.getUTCMinutes();
  return cfg.dias_habiles.includes(dia) && min >= aMin(cfg.hora_inicio) && min < aMin(cfg.hora_fin);
}

function minutosHabiles(db, desde, hasta) {
  const cfg = db.config;
  let total = 0;
  const d = local(desde);
  const h = local(hasta);
  if (h <= d) return 0;
  for (let dia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); dia <= h; dia = new Date(dia.getTime() + 86400000)) {
    const iso = (dia.getUTCDay() || 7);
    if (!cfg.dias_habiles.includes(iso) || db.feriados.some((f) => f.fecha === dia.toISOString().slice(0, 10))) continue;
    const ini = Math.max(d.getTime(), dia.getTime() + aMin(cfg.hora_inicio) * 60000);
    const fin = Math.min(h.getTime(), dia.getTime() + aMin(cfg.hora_fin) * 60000);
    if (fin > ini) total += (fin - ini) / 60000;
  }
  return Math.round(total * 10) / 10;
}

function auditar(db, actor, tabla, registro, accion, antes, despues) {
  db.auditoria.unshift({
    id: (db.auditoria[0]?.id || 0) + 1, tabla, registro: registro == null ? null : String(registro), accion,
    antes: antes ?? null, despues: despues ?? null, actor_gestor_id: actor?.id ?? null, actor_nombre: actor?.nombre ?? null,
    created_at: ahoraISO(),
  });
  db.auditoria = db.auditoria.slice(0, 500);
}

function diferencias(antes, despues) {
  const a = {};
  const d = {};
  for (const k of Object.keys(despues)) {
    if (JSON.stringify(antes?.[k]) !== JSON.stringify(despues[k])) { a[k] = antes?.[k] ?? null; d[k] = despues[k]; }
  }
  return Object.keys(d).length ? [a, d] : null;
}

function enPadron(db, nro, dni) {
  const n = normalizarContrato(nro);
  const doc = soloDigitos(dni);
  return Boolean(n && doc && db.contratos.some((k) => normalizarContrato(k.nro_contrato) === n && k.dni_pasajero === doc));
}

function reglasCliente(db, nuevo, antes) {
  const cambioDatos = !antes || nuevo.nro_contrato !== antes.nro_contrato || nuevo.dni_pasajero !== antes.dni_pasajero;
  if (cambioDatos || nuevo.tiene_contrato !== antes?.tiene_contrato) {
    if (nuevo.tiene_contrato && enPadron(db, nuevo.nro_contrato, nuevo.dni_pasajero)) {
      Object.assign(nuevo, { contrato_verificado: true, verificacion: 'automatica', verificado_por: null, verificado_at: ahoraISO() });
    } else if (cambioDatos || !nuevo.tiene_contrato) {
      Object.assign(nuevo, { contrato_verificado: false, verificacion: null, verificado_por: null, verificado_at: null });
    }
  }
  if (nuevo.tiene_contrato && (!antes || !antes.tiene_contrato) && nuevo.etapa !== 'contratado') nuevo.etapa = 'contratado';
  if (!antes || nuevo.etapa !== antes.etapa) nuevo.etapa_at = ahoraISO();
  if (nuevo.etapa !== 'perdido') nuevo.motivo_perdida = null;
  nuevo.tipo = nuevo.tiene_contrato ? 'cliente' : 'lead';
  return nuevo;
}

function aplicarMensaje(db, m) {
  const c = db.conversaciones.find((x) => x.id === m.conversacion_id);
  const visible = !m.interno;
  const respuesta = m.autor_tipo === 'gestor' && !m.interno;
  db.mensajes.push(m);
  c.ultimo_mensaje_at = m.created_at;
  if (visible) c.ultimo_mensaje_preview = (m.texto || `Adjunto: ${m.adjunto_nombre || 'archivo'}`).slice(0, 140);
  if (m.autor_tipo === 'cliente') {
    if (!(c.pendiente_respuesta && c.esperando_desde)) c.esperando_desde = m.created_at;
    c.pendiente_respuesta = true;
    c.no_leidos_gestor = (c.no_leidos_gestor || 0) + 1;
    if (db.clientes[c.cliente_id]) db.clientes[c.cliente_id].ultima_actividad_at = m.created_at;
  }
  if (respuesta) {
    c.pendiente_respuesta = false;
    c.esperando_desde = null;
    c.alerta_demora = false;
    c.primera_respuesta_at = c.primera_respuesta_at || m.created_at;
    if (!c.gestor_id) {
      c.gestor_id = m.gestor_id;
      c.gestor_nombre = m.autor_nombre;
      c.asignada_at = m.created_at;
    }
    const cl = db.clientes[c.cliente_id];
    if (cl?.etapa === 'nuevo') { cl.etapa = 'contactado'; cl.etapa_at = m.created_at; }
  }
  if (['gestor', 'bot', 'sistema'].includes(m.autor_tipo) && visible) c.no_leidos_cliente = (c.no_leidos_cliente || 0) + 1;
  return c;
}

const abiertasDe = (db, gid) => db.conversaciones.filter((c) => c.gestor_id === gid && c.estado === 'abierta').length;
const conCapacidad = (db, gid) => !db.config.max_abiertas_por_gestor || abiertasDe(db, gid) < db.config.max_abiertas_por_gestor;

function asignar(db, c, excluir = null) {
  const enEquipo = (g) => g.activo && g.disponible && g.id !== excluir && g.equipos.includes(c.equipo_id) && conCapacidad(db, g.id);
  const limite = Date.now() - db.config.dias_mismo_gestor * 86400000;
  const previa = db.conversaciones
    .filter((x) => x.cliente_id === c.cliente_id && x.id !== c.id && x.gestor_id
      && new Date(x.resuelta_at || x.ultimo_mensaje_at).getTime() >= limite)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((x) => db.gestores.find((g) => g.id === x.gestor_id))
    .find((g) => g && enEquipo(g));
  const elegido = previa || db.gestores.filter(enEquipo)
    .sort((a, b) => abiertasDe(db, a.id) - abiertasDe(db, b.id)
      || (a.ultima_asignacion_at || '').localeCompare(b.ultima_asignacion_at || '')
      || a.created_at.localeCompare(b.created_at))[0];
  if (!elegido) return null;
  Object.assign(c, { gestor_id: elegido.id, gestor_nombre: primerNombre(elegido.nombre), asignada_at: ahoraISO() });
  elegido.ultima_asignacion_at = ahoraISO();
  return elegido;
}

function asignarFila(db) {
  db.conversaciones.filter((c) => c.estado === 'abierta' && !c.gestor_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((c) => asignar(db, c));
}

function notaSistema(db, convId, texto) {
  const m = { id: uuid(), conversacion_id: convId, autor_tipo: 'sistema', autor_nombre: 'Wolf', texto, interno: true, created_at: ahoraISO() };
  aplicarMensaje(db, m);
  return m;
}

function repartir(db, gid, motivo) {
  let reasignadas = 0;
  let enFila = 0;
  db.conversaciones.filter((c) => c.gestor_id === gid && c.estado === 'abierta').forEach((c) => {
    Object.assign(c, { gestor_id: null, gestor_nombre: null, asignada_at: null });
    const nuevo = asignar(db, c, gid);
    if (nuevo) reasignadas += 1; else enFila += 1;
    notaSistema(db, c.id, `Reasignada porque ${motivo}${nuevo ? `. Ahora la atiende ${nuevo.nombre}.` : '. Quedó en fila hasta que alguien del equipo la tome.'}`);
  });
  return { reasignadas, en_fila: enFila };
}

function nuevoMensaje(db, datos) {
  const m = { id: uuid(), interno: false, created_at: ahoraISO(), ...datos };
  const c = aplicarMensaje(db, m);
  guardar(db);
  emitir({ tabla: 'mensajes', tipo: 'INSERT', fila: m });
  emitir({ tabla: 'conversaciones', tipo: 'UPDATE', fila: c });
  return m;
}

function leerArchivo(archivo) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(archivo);
  });
}

async function guardarArchivo(convId, archivo) {
  exigir(archivo.size <= 1.5 * 1024 * 1024, 'En el modo demostración los archivos tienen un máximo de 1,5 MB.');
  const path = `${convId}/${uuid()}`;
  localStorage.setItem(`wolf-demo-archivo:${path}`, await leerArchivo(archivo));
  return path;
}

function catalogosBase(db) {
  return {
    motivos: db.motivos.filter((m) => m.activo).sort((a, b) => a.orden - b.orden),
    sucursales: db.sucursales.filter((s) => s.activo).sort((a, b) => a.orden - b.orden),
    config: { ...db.config, texto_horario: textoHorario(db.config) },
  };
}

// "Escribiendo…" entre pestañas.
// Llega a las otras pestañas y a las otras suscripciones de esta misma pestaña,
// nunca a quien lo envió (igual que el canal de Supabase con self: false).
const canalEscr = 'BroadcastChannel' in window ? new BroadcastChannel('wolf-demo-escribiendo') : null;
const oyentesEscr = new Set();
if (canalEscr) canalEscr.onmessage = (e) => oyentesEscr.forEach((f) => f(e.data));
function escribiendo(convId, onEvento) {
  const f = (d) => { if (d?.convId === convId) onEvento(d.payload); };
  oyentesEscr.add(f);
  return {
    avisar: (payload) => {
      canalEscr?.postMessage({ convId, payload });
      oyentesEscr.forEach((g) => { if (g !== f) g({ convId, payload }); });
    },
    cerrar: () => oyentesEscr.delete(f),
  };
}

// ---------------------------------------------------------------------
// Chat del cliente (demostración)
// ---------------------------------------------------------------------
export function crearApiCliente() {
  let usuarioId = localStorage.getItem(CLAVE_CLIENTE);
  const codigos = new Map();

  return {
    demo: true,

    async iniciar() {
      return { usuarioId };
    },

    async contexto() {
      const db = leer();
      const propias = db.conversaciones.filter((c) => c.cliente_id === usuarioId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const ultima = propias[0] || null;
      return {
        ...catalogosBase(db),
        cliente: db.clientes[usuarioId] || null,
        abierta: ultima && ultima.estado === 'abierta' ? ultima : null,
        ultima,
        enHorario: enHorario(db.config, new Date(), db.feriados),
      };
    },

    async enviarCodigo(email) {
      await esperar(500);
      const db = leer();
      const e = String(email || '').trim().toLowerCase();
      const cli = Object.values(db.clientes)
        .filter((c) => c.email === e && db.conversaciones.some((x) => x.cliente_id === c.id))
        .sort((a, b) => (b.ultima_actividad_at || '').localeCompare(a.ultima_actividad_at || ''))[0];
      if (cli) codigos.set(e, cli.id);
      return {
        ok: true,
        mensaje: `Si ${e} tiene consultas con Wolf, te enviamos un código. Revisá también la carpeta de spam.`,
        demo: `En la demostración el código es ${CODIGO_DEMO}. Probá con marcela@correo.com.`,
      };
    },

    async verificarCodigo(email, codigo) {
      await esperar(400);
      const id = codigos.get(String(email || '').trim().toLowerCase());
      exigir(id && String(codigo).replace(/\D/g, '') === CODIGO_DEMO, 'El código no es correcto o ya venció. Pedí uno nuevo.');
      usuarioId = id;
      localStorage.setItem(CLAVE_CLIENTE, id);
    },

    async canjearEnlace() {
      throw new Error('Los enlaces de acceso funcionan cuando el chat está conectado a Supabase.');
    },

    async bajaAvisos(c) {
      const db = leer();
      if (db.clientes[c]) db.clientes[c].acepta_avisos = false;
      guardar(db);
      return { ok: true };
    },

    async preguntasFrecuentes(motivo) {
      return leer().faq.filter((f) => f.activo && (!f.motivo || f.motivo === motivo)).sort((a, b) => a.orden - b.orden).slice(0, 6);
    },

    async catalogoContratos() {
      return (leer().catalogo || []).filter((c) => c.activo !== false);
    },

    async registrarFaq(id, util = null) {
      const db = leer();
      const f = db.faq.find((x) => x.id === id);
      if (!f) return;
      if (util === null) f.vistas += 1; else if (util) f.utiles += 1; else f.no_utiles += 1;
      guardar(db);
    },

    async iniciarConversacion(d) {
      await esperar(500);
      if (!usuarioId) {
        usuarioId = uuid();
        localStorage.setItem(CLAVE_CLIENTE, usuarioId);
      }
      const db = leer();
      const motivo = db.motivos.find((m) => m.codigo === d.motivo);
      const previo = db.clientes[usuarioId];
      const abierta = db.conversaciones.find((c) => c.cliente_id === usuarioId && c.estado === 'abierta');
      exigir(abierta || db.conversaciones.filter((c) => c.cliente_id === usuarioId
        && Date.parse(c.created_at) > Date.now() - 86400000).length < 5,
      'Ya hiciste varias consultas hoy. Seguí en tu última consulta o escribinos mañana.');

      const base = previo || { id: usuarioId, created_at: ahoraISO(), acepta_avisos: true, etapa: 'nuevo' };
      const cliente = reglasCliente(db, {
        ...base,
        nombre: limpio(d.nombre) || base.nombre,
        celular: soloDigitos(d.celular) || base.celular || null,
        email: limpio(d.email)?.toLowerCase() || base.email || null,
        relacion: d.relacion || base.relacion || null,
        colegio: limpio(d.colegio) || base.colegio || null,
        curso: limpio(d.curso) || base.curso || null,
        sucursal_id: d.sucursal_id ?? base.sucursal_id ?? null,
        tiene_contrato: Boolean(d.tiene_contrato || base.tiene_contrato),
        nro_contrato: d.tiene_contrato ? limpio(d.nro_contrato) || base.nro_contrato : base.nro_contrato || null,
        dni_pasajero: d.tiene_contrato ? soloDigitos(d.dni_pasajero) || base.dni_pasajero : base.dni_pasajero || null,
        acepto_privacidad_at: base.acepto_privacidad_at || ahoraISO(),
        ultima_actividad_at: ahoraISO(),
      }, previo);
      db.clientes[usuarioId] = cliente;

      const fuera = !enHorario(db.config, new Date(), db.feriados);
      if (abierta) {
        guardar(db);
        nuevoMensaje(db, { conversacion_id: abierta.id, autor_tipo: 'cliente', autor_id: usuarioId, texto: d.mensaje });
        return { conversacion_id: abierta.id, numero: abierta.numero, gestor_nombre: abierta.gestor_nombre, fuera_de_horario: fuera, existente: true };
      }

      const c = {
        id: uuid(), numero: ++db.numero, cliente_id: usuarioId, motivo: motivo.codigo, equipo_id: motivo.equipo_id,
        gestor_id: null, gestor_nombre: null, estado: 'abierta', fuera_de_horario: fuera, pendiente_respuesta: true,
        alerta_demora: false, no_leidos_gestor: 0, no_leidos_cliente: 0, created_at: ahoraISO(), ultimo_mensaje_at: ahoraISO(),
        leido_cliente_at: null, leido_gestor_at: null, csat: null,
      };
      db.conversaciones.push(c);
      if (Array.isArray(d.admision) && d.admision.length) (db.admision ||= {})[c.id] = d.admision.slice(0, 80);
      asignar(db, c);
      const t = Date.now();
      const en = (ms) => new Date(t + ms).toISOString();
      aplicarMensaje(db, { id: uuid(), conversacion_id: c.id, autor_tipo: 'sistema', interno: false, created_at: en(0),
        texto: `Consulta iniciada: ${motivo.nombre} ${cliente.tiene_contrato ? `(contrato ${cliente.nro_contrato || 's/n'})` : '(lead)'}` });
      aplicarMensaje(db, { id: uuid(), conversacion_id: c.id, autor_tipo: 'cliente', autor_id: usuarioId, interno: false,
        created_at: en(1), texto: d.mensaje });
      const textoBot = (fuera
        ? `Recibimos tu consulta. Atendemos ${textoHorario(db.config)}, así que te respondemos el próximo día hábil.${cliente.email ? ` Cuando tengas respuesta te avisamos a ${cliente.email}.` : ''}`
        : c.gestor_nombre
          ? `¡Listo! ${c.gestor_nombre} tiene tu consulta y te responde por acá en breve.`
          : 'Tu consulta quedó en fila. Te responde la primera persona disponible del equipo.')
        + (cliente.email ? '' : ' Como no dejaste correo, seguí la conversación desde este mismo dispositivo.');
      aplicarMensaje(db, { id: uuid(), conversacion_id: c.id, autor_tipo: 'bot', autor_nombre: 'Asistente Wolf', interno: false,
        created_at: en(2), texto: textoBot });
      guardar(db);
      emitir({ tabla: 'conversaciones', tipo: 'INSERT', fila: c });

      // Respuesta automática de demostración (en el sistema real responde una persona desde el panel).
      if (c.gestor_id) {
        setTimeout(() => {
          const db2 = leer();
          const conv = db2.conversaciones.find((x) => x.id === c.id);
          if (!conv || conv.estado !== 'abierta' || db2.mensajes.some((m) => m.conversacion_id === c.id && m.autor_tipo === 'gestor')) return;
          const aviso = escribiendo(c.id, () => {});
          aviso.avisar({ quien: 'gestor', nombre: conv.gestor_nombre });
          aviso.cerrar();
          setTimeout(() => {
            const db3 = leer();
            const conv3 = db3.conversaciones.find((x) => x.id === c.id);
            if (db3.mensajes.some((m) => m.conversacion_id === c.id && m.autor_tipo === 'gestor')) return;
            nuevoMensaje(db3, {
              conversacion_id: c.id, autor_tipo: 'gestor', gestor_id: conv3.gestor_id, autor_nombre: conv3.gestor_nombre,
              texto: `¡Hola ${primerNombre(cliente.nombre)}! Soy ${conv3.gestor_nombre}, de Wolf. Esta respuesta es de demostración: en el sistema real te escribe la persona asignada desde el panel.`,
            });
          }, 2500);
        }, 4000);
      }
      return { conversacion_id: c.id, numero: c.numero, gestor_nombre: c.gestor_nombre, fuera_de_horario: fuera, existente: false };
    },

    async conversacion(id) {
      return leer().conversaciones.find((c) => c.id === id);
    },

    async mensajes(convId) {
      return leer().mensajes.filter((m) => m.conversacion_id === convId && !m.interno)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    async enviarTexto(convId, texto) {
      const db = leer();
      const c = db.conversaciones.find((x) => x.id === convId);
      exigir(c && c.estado === 'abierta', 'La consulta ya está cerrada');
      exigir(db.mensajes.filter((m) => m.autor_tipo === 'cliente' && m.autor_id === usuarioId
        && Date.parse(m.created_at) > Date.now() - 60000).length < 15,
      'Estás enviando muchos mensajes seguidos. Esperá un minuto y volvé a intentar.');
      return nuevoMensaje(db, { conversacion_id: convId, autor_tipo: 'cliente', autor_id: usuarioId, texto });
    },

    async enviarArchivo(convId, archivo) {
      const path = await guardarArchivo(convId, archivo);
      return nuevoMensaje(leer(), { conversacion_id: convId, autor_tipo: 'cliente', autor_id: usuarioId,
        adjunto_path: path, adjunto_nombre: archivo.name, adjunto_mime: archivo.type, adjunto_bytes: archivo.size });
    },

    async urlArchivo(path) {
      return localStorage.getItem(`wolf-demo-archivo:${path}`);
    },

    suscribir(convId, { onMensaje, onConversacion }) {
      const f = (e) => {
        if (e.tabla === 'mensajes' && e.fila.conversacion_id === convId && !e.fila.interno) onMensaje?.(e.fila);
        if (e.tabla === 'conversaciones' && e.fila.id === convId) onConversacion?.(e.fila);
      };
      oyentes.add(f);
      return () => oyentes.delete(f);
    },

    escribiendo,

    async marcarLeida(convId) {
      const db = leer();
      const c = db.conversaciones.find((x) => x.id === convId);
      if (!c) return;
      Object.assign(c, { no_leidos_cliente: 0, leido_cliente_at: ahoraISO() });
      guardar(db);
      emitir({ tabla: 'conversaciones', tipo: 'UPDATE', fila: c });
    },

    async calificar(convId, puntaje, comentario) {
      const db = leer();
      const c = db.conversaciones.find((x) => x.id === convId && x.cliente_id === usuarioId);
      exigir(puntaje >= 1 && puntaje <= 5, 'Elegí una calificación de 1 a 5');
      exigir(c && c.estado === 'resuelta' && !c.csat, 'Esta consulta ya fue calificada o todavía no está resuelta');
      Object.assign(c, { csat: puntaje, csat_comentario: limpio(comentario), csat_at: ahoraISO() });
      notaSistema(db, c.id, `El cliente calificó la atención con ${puntaje} de 5${limpio(comentario) ? `. Comentario: ${limpio(comentario)}` : ''}.`);
      guardar(db);
      emitir({ tabla: 'conversaciones', tipo: 'UPDATE', fila: c });
    },

    async latido() {
      const db = leer();
      if (db.clientes[usuarioId]) { db.clientes[usuarioId].ultima_actividad_at = ahoraISO(); guardar(db); }
    },
  };
}

// ---------------------------------------------------------------------
// Panel de gestores (demostración)
// ---------------------------------------------------------------------
export function crearApiPanel() {
  const yo = () => {
    const db = leer();
    return db.gestores.find((g) => g.id === localStorage.getItem(CLAVE_PANEL) && g.activo) || null;
  };
  const esSupervisor = (g) => g && ['admin', 'supervisor'].includes(g.rol);
  const puedeVerConv = (db, g, c) => esSupervisor(g) || c.gestor_id === g.id
    || (!c.gestor_id && g.equipos.includes(c.equipo_id))
    || db.conversaciones.some((x) => x.cliente_id === c.cliente_id && x.gestor_id === g.id);
  const puedeVerCliente = (db, g, id) => esSupervisor(g)
    || db.conversaciones.some((c) => c.cliente_id === id && (c.gestor_id === g.id || (!c.gestor_id && g.equipos.includes(c.equipo_id))));
  const conCliente = (db, c) => {
    const cl = db.clientes[c.cliente_id] || {};
    return { ...c, cliente: { id: cl.id, nombre: cl.nombre, tipo: cl.tipo, colegio: cl.colegio, curso: cl.curso,
      nro_contrato: cl.nro_contrato, etapa: cl.etapa, contrato_verificado: cl.contrato_verificado } };
  };
  const exigirAdmin = () => exigir(yo()?.rol === 'admin', 'Solo un administrador puede hacer este cambio');
  const exigirSupervisor = () => exigir(esSupervisor(yo()), 'Solo supervisores y administradores pueden hacer esto');
  const otroAdmin = (db, id) => db.gestores.some((g) => g.rol === 'admin' && g.activo && g.id !== id);
  const evento = (c) => emitir({ tabla: 'conversaciones', tipo: 'UPDATE', fila: c });
  const rangoLocal = (desde, hasta) => [Date.parse(`${desde}T00:00:00-03:00`), Date.parse(`${hasta}T00:00:00-03:00`) + 86400000];
  const mediana = (v) => {
    const s = v.filter((x) => x != null).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
  };
  const promedio = (v) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null);
  const moda = (v) => {
    const n = {};
    v.forEach((x) => { n[x] = (n[x] || 0) + 1; });
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0];
  };

  return {
    demo: true,

    usuariosDemo() {
      const db = leer();
      return db.gestores.filter((g) => g.activo).map((g) => ({
        ...g, nombresEquipos: g.equipos.map((id) => db.equipos.find((e) => e.id === id)?.nombre).filter(Boolean),
      }));
    },

    async ingresarDemo(gestorId) {
      localStorage.setItem(CLAVE_PANEL, gestorId);
    },

    async sesion() {
      const g = yo();
      return g ? { email: g.email, gestor: { ...g } } : null;
    },

    async ingresarConGoogle() {
      throw new Error('En el modo demostración elegí un usuario de prueba.');
    },

    async salir() {
      localStorage.removeItem(CLAVE_PANEL);
    },

    async catalogos() {
      const db = leer();
      const g = yo();
      return {
        ...catalogosBase(db),
        equipos: db.equipos,
        gestores: db.gestores,
        motivosTodos: [...db.motivos].sort((a, b) => a.orden - b.orden),
        sucursalesTodas: db.sucursales,
        feriados: [...db.feriados].sort((a, b) => a.fecha.localeCompare(b.fecha)),
        etiquetas: [...db.etiquetas].sort((a, b) => a.nombre.localeCompare(b.nombre)),
        respuestas: db.respuestas.filter((r) => !r.equipo_id || esSupervisor(g) || g?.equipos.includes(r.equipo_id))
          .sort((a, b) => a.orden - b.orden),
        faq: [...db.faq].sort((a, b) => a.orden - b.orden),
        solicitudes: [],
      };
    },

    async solicitarAcceso() { return null; },
    async solicitudesAcceso() { return []; },
    async rechazarSolicitud() {},

    async conversaciones() {
      const db = leer();
      const g = yo();
      return db.conversaciones.filter((c) => puedeVerConv(db, g, c)).map((c) => conCliente(db, c))
        .sort((a, b) => b.ultimo_mensaje_at.localeCompare(a.ultimo_mensaje_at));
    },

    async conversacion(id) {
      const db = leer();
      return conCliente(db, db.conversaciones.find((c) => c.id === id));
    },

    async cliente(id) {
      const db = leer();
      const cl = db.clientes[id];
      return {
        ...cl,
        sucursal: db.sucursales.find((s) => s.id === cl.sucursal_id) || null,
        etiquetas: db.cliente_etiquetas.filter((x) => x.cliente_id === id).map((x) => x.etiqueta_id),
        verificador: cl.verificado_por ? { nombre: db.gestores.find((x) => x.id === cl.verificado_por)?.nombre } : null,
      };
    },

    async historial(clienteId) {
      return leer().conversaciones.filter((c) => c.cliente_id === clienteId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    async mensajes(convId) {
      return leer().mensajes.filter((m) => m.conversacion_id === convId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    async charlaConBot(convId) {
      return leer().admision?.[convId] || [];
    },

    async enviarTexto(convId, texto, interno = false) {
      const db = leer();
      const g = yo();
      const c = db.conversaciones.find((x) => x.id === convId);
      exigir(c.estado === 'abierta', 'La consulta está resuelta; reabrila primero');
      return nuevoMensaje(db, { conversacion_id: convId, autor_tipo: 'gestor', gestor_id: g.id,
        autor_nombre: primerNombre(g.nombre), texto, interno });
    },

    async enviarArchivo(convId, archivo) {
      const g = yo();
      const path = await guardarArchivo(convId, archivo);
      return nuevoMensaje(leer(), { conversacion_id: convId, autor_tipo: 'gestor', gestor_id: g.id,
        autor_nombre: primerNombre(g.nombre), adjunto_path: path, adjunto_nombre: archivo.name,
        adjunto_mime: archivo.type, adjunto_bytes: archivo.size });
    },

    async urlArchivo(path) {
      return localStorage.getItem(`wolf-demo-archivo:${path}`);
    },

    async tomar(id) {
      const db = leer();
      const g = db.gestores.find((x) => x.id === yo().id);
      const c = db.conversaciones.find((x) => x.id === id);
      exigir(!c.gestor_id || esSupervisor(g), 'La consulta ya está asignada');
      exigir(esSupervisor(g) || g.equipos.includes(c.equipo_id), 'La consulta es de otro equipo');
      Object.assign(c, { gestor_id: g.id, gestor_nombre: primerNombre(g.nombre), asignada_at: ahoraISO() });
      guardar(db);
      evento(c);
    },

    async transferir(id, { gestorId = null, equipoId = null, nota = null }) {
      const db = leer();
      const g = yo();
      const c = db.conversaciones.find((x) => x.id === id);
      exigir(esSupervisor(g) || c.gestor_id === g.id, 'Solo el gestor asignado o un supervisor pueden transferir');
      let texto;
      if (gestorId) {
        const destino = db.gestores.find((x) => x.id === gestorId);
        Object.assign(c, { gestor_id: destino.id, gestor_nombre: primerNombre(destino.nombre), asignada_at: ahoraISO() });
        if (equipoId) c.equipo_id = equipoId;
        texto = `Transferida a ${destino.nombre} por ${g.nombre}`;
      } else {
        Object.assign(c, { equipo_id: equipoId, gestor_id: null, gestor_nombre: null, asignada_at: null });
        asignar(db, c);
        texto = `Transferida al equipo ${db.equipos.find((e) => e.id === equipoId).nombre} por ${g.nombre}`;
      }
      if (nota?.trim()) texto += `. Nota: ${nota.trim()}`;
      guardar(db);
      nuevoMensaje(db, { conversacion_id: id, autor_tipo: 'sistema', autor_nombre: g.nombre, texto, interno: true });
    },

    async cambiarEstado(id, estado) {
      const db = leer();
      const g = yo();
      const c = db.conversaciones.find((x) => x.id === id);
      exigir(esSupervisor(g) || c.gestor_id === g.id, 'Solo el gestor asignado o un supervisor pueden cambiar el estado');
      if (estado === 'resuelta') {
        Object.assign(c, { estado, resuelta_at: ahoraISO(), pendiente_respuesta: false, esperando_desde: null, alerta_demora: false });
        asignarFila(db);
        guardar(db);
        nuevoMensaje(db, { conversacion_id: id, autor_tipo: 'sistema', autor_nombre: 'Wolf',
          texto: 'Marcamos esta consulta como resuelta. Si necesitás algo más, iniciá una nueva consulta.' });
      } else {
        exigir(!db.conversaciones.some((x) => x.cliente_id === c.cliente_id && x.estado === 'abierta' && x.id !== id),
          'El cliente ya tiene otra consulta abierta');
        Object.assign(c, { estado, resuelta_at: null });
        guardar(db);
        evento(c);
      }
    },

    async marcarLeida(id) {
      const db = leer();
      const c = db.conversaciones.find((x) => x.id === id);
      if (!c || (c.gestor_id && c.gestor_id !== yo()?.id)) return;   // un supervisor que mira no da el "visto"
      Object.assign(c, { no_leidos_gestor: 0, leido_gestor_at: ahoraISO() });
      guardar(db);
      evento(c);
    },

    async setDisponible(valor) {
      const db = leer();
      const g = db.gestores.find((x) => x.id === yo().id);
      g.disponible = valor;
      if (valor) asignarFila(db);
      guardar(db);
    },

    async repartir(gestorId = null) {
      const db = leer();
      const actor = yo();
      const destino = gestorId || actor.id;
      exigir(destino === actor.id || esSupervisor(actor), 'Solo un supervisor puede repartir las consultas de otra persona');
      const r = repartir(db, destino, `${db.gestores.find((x) => x.id === destino).nombre} no está disponible`);
      guardar(db);
      db.conversaciones.forEach(evento);
      return r;
    },

    async actualizarCliente(id, datos) {
      const db = leer();
      const g = yo();
      exigir(puedeVerCliente(db, g, id), 'Sin permiso para editar este cliente');
      const antes = { ...db.clientes[id] };
      const nuevo = { ...antes };
      for (const [k, v] of Object.entries(datos)) {
        if (k === 'tiene_contrato' || k === 'acepta_avisos') nuevo[k] = Boolean(v);
        else if (k === 'celular' || k === 'dni_pasajero') nuevo[k] = soloDigitos(v);
        else if (k === 'email') nuevo[k] = limpio(v)?.toLowerCase() || null;
        else if (k === 'sucursal_id') nuevo[k] = v ? Number(v) : null;
        else nuevo[k] = limpio(v) ?? (k === 'nombre' ? antes.nombre : null);
      }
      db.clientes[id] = reglasCliente(db, nuevo, antes);
      const dif = diferencias(antes, datos);
      if (dif) auditar(db, g, 'clientes', id, 'EDICION', ...dif);
      guardar(db);
    },

    // ----- Contrato, etapa y etiquetas -----
    async contratoEnPadron(nro) {
      const n = normalizarContrato(nro);
      return n ? leer().contratos.filter((k) => normalizarContrato(k.nro_contrato) === n) : [];
    },

    async verificarContrato(clienteId, valor, nota) {
      const db = leer();
      const g = yo();
      exigir(puedeVerCliente(db, g, clienteId), 'Sin permiso para verificar este cliente');
      Object.assign(db.clientes[clienteId], {
        contrato_verificado: valor, verificacion: valor ? 'manual' : null,
        verificado_por: valor ? g.id : null, verificado_at: valor ? ahoraISO() : null,
      });
      auditar(db, g, 'clientes', clienteId, 'VERIFICACION', null, { contrato_verificado: valor, nota: limpio(nota) });
      const abierta = db.conversaciones.find((c) => c.cliente_id === clienteId && c.estado === 'abierta');
      if (abierta) {
        notaSistema(db, abierta.id, `${valor ? 'Contrato verificado por ' : 'Verificación del contrato quitada por '}${g.nombre}${limpio(nota) ? `. Nota: ${limpio(nota)}` : ''}`);
      }
      guardar(db);
      if (abierta) evento(abierta);
    },

    async cambiarEtapa(clienteId, etapa, motivo) {
      const db = leer();
      const g = yo();
      exigir(puedeVerCliente(db, g, clienteId), 'Sin permiso para cambiar este cliente');
      const cl = db.clientes[clienteId];
      const antes = cl.etapa;
      Object.assign(cl, { etapa, etapa_at: ahoraISO(), motivo_perdida: etapa === 'perdido' ? limpio(motivo) : null });
      if (antes !== etapa) auditar(db, g, 'clientes', clienteId, 'ETAPA', { etapa: antes }, { etapa, motivo_perdida: limpio(motivo) });
      guardar(db);
    },

    async agregarEtiqueta(clienteId, etiquetaId) {
      const db = leer();
      const g = yo();
      exigir(puedeVerCliente(db, g, clienteId), 'Sin permiso para cambiar este cliente');
      if (!db.cliente_etiquetas.some((x) => x.cliente_id === clienteId && x.etiqueta_id === etiquetaId)) {
        db.cliente_etiquetas.push({ cliente_id: clienteId, etiqueta_id: etiquetaId, created_by: g.id });
        auditar(db, g, 'cliente_etiquetas', `${clienteId}:${etiquetaId}`, 'INSERT', null, { cliente_id: clienteId, etiqueta_id: etiquetaId });
      }
      guardar(db);
    },

    async quitarEtiqueta(clienteId, etiquetaId) {
      const db = leer();
      db.cliente_etiquetas = db.cliente_etiquetas.filter((x) => !(x.cliente_id === clienteId && x.etiqueta_id === etiquetaId));
      auditar(db, yo(), 'cliente_etiquetas', `${clienteId}:${etiquetaId}`, 'DELETE', { cliente_id: clienteId, etiqueta_id: etiquetaId }, null);
      guardar(db);
    },

    // ----- Vistas -----
    async tablero(dias = 90) {
      const db = leer();
      const g = yo();
      const limite = Date.now() - dias * 86400000;
      return Object.values(db.clientes).filter((cl) => puedeVerCliente(db, g, cl.id)).map((cl) => {
        const u = db.conversaciones.filter((c) => c.cliente_id === cl.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
        return {
          id: cl.id, nombre: cl.nombre, colegio: cl.colegio, curso: cl.curso, tipo: cl.tipo, etapa: cl.etapa,
          etapa_at: cl.etapa_at, motivo_perdida: cl.motivo_perdida, contrato_verificado: cl.contrato_verificado,
          sucursal_id: cl.sucursal_id, ultima_actividad_at: u?.ultimo_mensaje_at || cl.created_at,
          conversacion_id: u?.id, numero: u?.numero, motivo: u?.motivo, gestor_id: u?.gestor_id,
          gestor_nombre: u?.gestor_nombre, estado: u?.estado,
          etiquetas: db.cliente_etiquetas.filter((x) => x.cliente_id === cl.id).map((x) => x.etiqueta_id),
        };
      }).filter((x) => Date.parse(x.ultima_actividad_at) >= limite)
        .sort((a, b) => b.ultima_actividad_at.localeCompare(a.ultima_actividad_at));
    },

    async reporte(desde, hasta) {
      exigirSupervisor();
      const db = leer();
      const [ini, fin] = rangoLocal(desde, hasta);
      const c = db.conversaciones.filter((x) => Date.parse(x.created_at) >= ini && Date.parse(x.created_at) < fin)
        .map((x) => ({ ...x, min_resp: x.primera_respuesta_at ? minutosHabiles(db, x.created_at, x.primera_respuesta_at) : null }));
      const cli = Object.values(db.clientes).filter((x) => Date.parse(x.created_at) >= ini && Date.parse(x.created_at) < fin);
      const porClave = (arr, f) => arr.reduce((acc, x) => { const k = f(x); (acc[k] = acc[k] || []).push(x); return acc; }, {});
      const csats = c.filter((x) => x.csat).map((x) => x.csat);
      const abiertas = db.conversaciones.filter((x) => x.estado === 'abierta');
      return {
        periodo: { desde, hasta },
        objetivo_minutos: db.config.minutos_alerta,
        totales: {
          consultas: c.length,
          respondidas: c.filter((x) => x.primera_respuesta_at).length,
          resueltas: c.filter((x) => x.estado === 'resuelta').length,
          fuera_de_horario: c.filter((x) => x.fuera_de_horario).length,
          mediana_respuesta: mediana(c.map((x) => x.min_resp)),
          en_objetivo: c.filter((x) => x.min_resp != null && x.min_resp <= db.config.minutos_alerta).length,
          csat_promedio: promedio(csats),
          csat_respuestas: csats.length,
        },
        ahora: {
          abiertas: abiertas.length,
          en_fila: abiertas.filter((x) => !x.gestor_id).length,
          con_demora: abiertas.filter((x) => x.alerta_demora).length,
        },
        por_dia: Object.entries(porClave(c, (x) => local(x.created_at).toISOString().slice(0, 10)))
          .map(([fecha, v]) => ({ fecha, consultas: v.length })).sort((a, b) => a.fecha.localeCompare(b.fecha)),
        por_franja: Object.entries(porClave(c, (x) => { const l = local(x.created_at); return `${l.getUTCDay() || 7}-${l.getUTCHours()}`; }))
          .map(([k, v]) => ({ dia: Number(k.split('-')[0]), hora: Number(k.split('-')[1]), consultas: v.length })),
        por_motivo: Object.entries(porClave(c, (x) => x.motivo)).map(([motivo, v]) => {
          const m = db.motivos.find((x) => x.codigo === motivo);
          return { motivo, nombre: m?.nombre, color: m?.color, consultas: v.length };
        }).sort((a, b) => b.consultas - a.consultas),
        por_gestor: Object.entries(porClave(c.filter((x) => x.gestor_id), (x) => x.gestor_id)).map(([gid, v]) => ({
          gestor_id: gid, nombre: db.gestores.find((x) => x.id === gid)?.nombre,
          asignadas: v.length, respondidas: v.filter((x) => x.primera_respuesta_at).length,
          resueltas: v.filter((x) => x.estado === 'resuelta').length, mediana_respuesta: mediana(v.map((x) => x.min_resp)),
          csat_promedio: promedio(v.filter((x) => x.csat).map((x) => x.csat)), csat_respuestas: v.filter((x) => x.csat).length,
        })).sort((a, b) => b.asignadas - a.asignadas),
        embudo: {
          nuevos: cli.length,
          por_etapa: Object.fromEntries(Object.entries(porClave(cli, (x) => x.etapa)).map(([k, v]) => [k, v.length])),
        },
        por_colegio: Object.entries(porClave(c.filter((x) => normalizarTexto(db.clientes[x.cliente_id]?.colegio)),
          (x) => normalizarTexto(db.clientes[x.cliente_id].colegio))).map(([, v]) => {
          const ids = [...new Set(v.map((x) => x.cliente_id))];
          return {
            colegio: moda(v.map((x) => db.clientes[x.cliente_id].colegio)),
            consultas: v.length, clientes: ids.length,
            contratados: ids.filter((id) => db.clientes[id].etapa === 'contratado').length,
          };
        }).sort((a, b) => b.consultas - a.consultas).slice(0, 15),
        faq: db.faq.map((f) => ({ pregunta: f.pregunta, vistas: f.vistas, utiles: f.utiles, no_utiles: f.no_utiles }))
          .sort((a, b) => b.vistas - a.vistas),
      };
    },

    async exportarConsultas(desde, hasta) {
      exigirSupervisor();
      const db = leer();
      const [ini, fin] = rangoLocal(desde, hasta);
      const f = (iso) => local(iso).toISOString();
      return db.conversaciones.filter((x) => Date.parse(x.created_at) >= ini && Date.parse(x.created_at) < fin)
        .sort((a, b) => a.numero - b.numero).map((c) => {
          const cl = db.clientes[c.cliente_id] || {};
          return {
            'N°': c.numero, Fecha: f(c.created_at).slice(0, 10).split('-').reverse().join('/'), Hora: f(c.created_at).slice(11, 16),
            Motivo: db.motivos.find((m) => m.codigo === c.motivo)?.nombre, Equipo: db.equipos.find((e) => e.id === c.equipo_id)?.nombre,
            Gestor: db.gestores.find((g) => g.id === c.gestor_id)?.nombre, Estado: c.estado === 'abierta' ? 'Abierta' : 'Resuelta',
            'Fuera de horario': c.fuera_de_horario ? 'Sí' : 'No',
            'Primera respuesta (min hábiles)': c.primera_respuesta_at ? minutosHabiles(db, c.created_at, c.primera_respuesta_at) : null,
            Calificación: c.csat, Comentario: c.csat_comentario, Cliente: cl.nombre, Tipo: cl.tipo === 'cliente' ? 'Cliente' : 'Lead',
            Etapa: cl.etapa, Colegio: cl.colegio, Curso: cl.curso, 'N° de contrato': cl.nro_contrato,
            'Contrato verificado': cl.contrato_verificado ? 'Sí' : 'No',
          };
        });
    },

    async exportarClientes() {
      exigirSupervisor();
      const db = leer();
      const REL = { alumno: 'Alumno/a', familiar: 'Madre, padre o tutor', docente: 'Docente o coordinador', otro: 'Otro' };
      return Object.values(db.clientes).map((c) => ({
        Nombre: c.nombre, Relación: REL[c.relacion], Colegio: c.colegio, Curso: c.curso,
        Sucursal: db.sucursales.find((s) => s.id === c.sucursal_id)?.nombre, Celular: c.celular, Correo: c.email,
        Tipo: c.tipo === 'cliente' ? 'Cliente' : 'Lead', Etapa: c.etapa, 'Motivo de pérdida': c.motivo_perdida,
        Etiquetas: db.cliente_etiquetas.filter((x) => x.cliente_id === c.id)
          .map((x) => db.etiquetas.find((e) => e.id === x.etiqueta_id)?.nombre).filter(Boolean).join(', '),
        'N° de contrato': c.nro_contrato, 'DNI del pasajero': c.dni_pasajero,
        'Contrato verificado': c.contrato_verificado ? 'Sí' : 'No', 'Acepta avisos': c.acepta_avisos === false ? 'No' : 'Sí',
        Consultas: db.conversaciones.filter((x) => x.cliente_id === c.id).length,
        Alta: local(c.created_at).toISOString().slice(0, 10).split('-').reverse().join('/'),
        'Última actividad': c.ultima_actividad_at
          ? `${local(c.ultima_actividad_at).toISOString().slice(0, 10).split('-').reverse().join('/')} ${local(c.ultima_actividad_at).toISOString().slice(11, 16)}`
          : null,
      }));
    },

    // ----- Avisos por correo -----
    async valoresColegios() {
      const db = leer();
      const grupos = {};
      Object.values(db.clientes).forEach((c) => {
        const k = normalizarTexto(c.colegio);
        if (k) (grupos[k] = grupos[k] || []).push(c.colegio);
      });
      return Object.entries(grupos).map(([clave, v]) => ({ clave, nombre: moda(v), clientes: v.length }))
        .sort((a, b) => b.clientes - a.clientes);
    },

    async valoresCursos(claves) {
      const db = leer();
      const n = {};
      Object.values(db.clientes).filter((c) => c.curso && (!claves?.length || claves.includes(normalizarTexto(c.colegio))))
        .forEach((c) => { n[c.curso] = (n[c.curso] || 0) + 1; });
      return Object.entries(n).map(([curso, clientes]) => ({ curso, clientes })).sort((a, b) => a.curso.localeCompare(b.curso));
    },

    async destinatarios(filtro) {
      exigirSupervisor();
      const db = leer();
      const vistos = new Set();
      return Object.values(db.clientes)
        .sort((a, b) => (b.ultima_actividad_at || '').localeCompare(a.ultima_actividad_at || ''))
        .filter((c) => c.email && c.acepta_avisos !== false
          && (!filtro.colegios?.length || filtro.colegios.includes(normalizarTexto(c.colegio)))
          && (!filtro.cursos?.length || filtro.cursos.includes(c.curso))
          && (!filtro.sucursal_id || c.sucursal_id === Number(filtro.sucursal_id))
          && (!filtro.etiqueta_id || db.cliente_etiquetas.some((x) => x.cliente_id === c.id && x.etiqueta_id === Number(filtro.etiqueta_id)))
          && (!filtro.etapa || c.etapa === filtro.etapa)
          && (!filtro.tipo || c.tipo === filtro.tipo))
        .filter((c) => !vistos.has(c.email) && vistos.add(c.email))
        .map((c) => ({ cliente_id: c.id, nombre: c.nombre, email: c.email, colegio: c.colegio, curso: c.curso }));
    },

    async crearAviso(asunto, cuerpo, filtro) {
      exigirSupervisor();
      const lista = await this.destinatarios(filtro);
      exigir(lista.length, 'Ningún cliente con correo coincide con ese filtro');
      const db = leer();
      const g = yo();
      const a = { id: uuid(), asunto, cuerpo, filtro, destinatarios: lista.length, enviados: 0, fallidos: 0, estado: 'pendiente',
        creado_por: g.id, creado_nombre: g.nombre, created_at: ahoraISO(), enviado_at: null };
      db.avisos.unshift(a);
      lista.forEach((d) => db.aviso_destinatarios.push({ aviso_id: a.id, cliente_id: d.cliente_id, email: d.email, estado: 'pendiente' }));
      guardar(db);
      return { id: a.id, destinatarios: lista.length };
    },

    async enviarAviso(id) {
      await esperar(900);
      const db = leer();
      const a = db.avisos.find((x) => x.id === id);
      db.aviso_destinatarios.filter((d) => d.aviso_id === id).forEach((d) => { d.estado = 'enviado'; });
      Object.assign(a, { enviados: a.destinatarios, estado: 'enviado', enviado_at: ahoraISO() });
      guardar(db);
      return { enviados: a.enviados, fallidos: 0, pendientes: 0, estado: 'enviado' };
    },

    async avisos() {
      return leer().avisos;
    },

    // ----- IA, push y "escribiendo" -----
    async sugerir(convId) {
      await esperar(900);
      const db = leer();
      const c = db.conversaciones.find((x) => x.id === convId);
      const cl = db.clientes[c.cliente_id];
      const g = yo();
      return `¡Hola ${primerNombre(cl?.nombre)}! Soy ${primerNombre(g.nombre)}, de Wolf. Gracias por escribirnos. `
        + 'Te confirmo [completar: el dato que pidió] y quedo atenta a cualquier otra consulta. '
        + '(Borrador de demostración: con la IA activada, se arma con la conversación y las preguntas frecuentes.)';
    },
    async guardarSuscripcion() {
      throw new Error('Las notificaciones push funcionan cuando el panel está conectado a Supabase.');
    },
    async borrarSuscripcion() {},
    escribiendo,

    suscribirBandeja(cb) {
      const f = (e) => { if (e.tabla === 'conversaciones') cb({ eventType: e.tipo, new: e.fila }); };
      oyentes.add(f);
      return () => oyentes.delete(f);
    },

    suscribirMensajes(convId, cb) {
      const f = (e) => { if (e.tabla === 'mensajes' && e.fila.conversacion_id === convId) cb(e.fila); };
      oyentes.add(f);
      return () => oyentes.delete(f);
    },

    // ----- Administración -----
    async guardarGestor({ id, email, nombre, rol, activo, disponible, equipos }) {
      const db = leer();
      exigirAdmin();
      const actor = yo();
      exigir(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'El correo no tiene un formato válido');
      exigir(!db.gestores.some((g) => g.email === email && g.id !== id), 'Ya existe una persona con ese correo');
      if (id) {
        const g = db.gestores.find((x) => x.id === id);
        exigir(!(g.rol === 'admin' && g.activo && (rol !== 'admin' || !activo) && !otroAdmin(db, id)),
          'Tiene que quedar al menos un administrador activo');
        const antes = { ...g };
        Object.assign(g, { email, nombre, rol, activo, disponible, equipos });
        if (antes.email !== email) g.user_id = null;
        const dif = diferencias(antes, { email, nombre, rol, activo, disponible, equipos });
        if (dif) auditar(db, actor, 'gestores', id, 'UPDATE', ...dif);
        if (antes.activo && !activo) repartir(db, id, `${nombre} ya no tiene acceso al panel`);
        if ((activo && disponible) && (!antes.activo || !antes.disponible)) asignarFila(db);
      } else {
        const g = { id: uuid(), email, nombre, rol, activo, disponible, equipos, user_id: null, ultima_asignacion_at: null, created_at: ahoraISO() };
        db.gestores.push(g);
        auditar(db, actor, 'gestores', g.id, 'INSERT', null, { email, nombre, rol, activo, disponible, equipos });
        asignarFila(db);
      }
      guardar(db);
    },

    async eliminarGestor(id) {
      const db = leer();
      exigirAdmin();
      const g = db.gestores.find((x) => x.id === id);
      exigir(!db.conversaciones.some((c) => c.gestor_id === id) && !db.mensajes.some((m) => m.gestor_id === id),
        `${g.nombre} tiene consultas en su historial: dala de baja en lugar de eliminarla`);
      exigir(!(g.rol === 'admin' && g.activo && !otroAdmin(db, id)), 'Tiene que quedar al menos un administrador activo');
      db.gestores = db.gestores.filter((x) => x.id !== id);
      auditar(db, yo(), 'gestores', id, 'DELETE', { nombre: g.nombre, email: g.email }, null);
      guardar(db);
    },

    async guardarEquipo({ id, nombre, integrantes }) {
      const db = leer();
      exigirAdmin();
      exigir(nombre.trim().length >= 2, 'Escribí el nombre del equipo');
      exigir(!db.equipos.some((e) => e.nombre.toLowerCase() === nombre.trim().toLowerCase() && e.id !== id), 'Ya existe un equipo con ese nombre');
      let e = db.equipos.find((x) => x.id === id);
      if (e) e.nombre = nombre.trim();
      else {
        e = { id: Math.max(0, ...db.equipos.map((x) => x.id)) + 1, nombre: nombre.trim() };
        db.equipos.push(e);
      }
      for (const g of db.gestores) {
        const tiene = g.equipos.includes(e.id);
        const debe = integrantes.includes(g.id);
        if (tiene && !debe) g.equipos = g.equipos.filter((x) => x !== e.id);
        if (!tiene && debe) g.equipos = [...g.equipos, e.id];
      }
      auditar(db, yo(), 'equipos', e.id, id ? 'UPDATE' : 'INSERT', null, { nombre: e.nombre, integrantes: integrantes.length });
      asignarFila(db);
      guardar(db);
      return e;
    },

    async eliminarEquipo(id) {
      const db = leer();
      exigirAdmin();
      const e = db.equipos.find((x) => x.id === id);
      const m = db.motivos.find((x) => x.equipo_id === id);
      exigir(!m, `El equipo ${e.nombre} recibe el motivo "${m?.nombre}": asigná ese motivo a otro equipo antes de eliminarlo`);
      exigir(!db.conversaciones.some((c) => c.equipo_id === id && c.estado === 'abierta'),
        `El equipo ${e.nombre} tiene consultas abiertas: transferilas a otro equipo antes de eliminarlo`);
      db.equipos = db.equipos.filter((x) => x.id !== id);
      db.gestores.forEach((g) => { g.equipos = g.equipos.filter((x) => x !== id); });
      auditar(db, yo(), 'equipos', id, 'DELETE', { nombre: e.nombre }, null);
      guardar(db);
    },

    async guardarMotivo(codigo, cambios) {
      const db = leer();
      exigirAdmin();
      let m = db.motivos.find((x) => x.codigo === codigo);
      const futuro = { ...(m || { activo: true }), ...cambios };
      exigir(!futuro.activo || futuro.equipo_id, `Elegí qué equipo recibe el motivo "${futuro.nombre}"`);
      exigir(futuro.activo || db.motivos.some((x) => x.activo && x.codigo !== codigo), 'Tiene que quedar al menos un motivo visible en el chat');
      if (m) {
        const dif = diferencias(m, cambios);
        Object.assign(m, cambios);
        if (dif && !(Object.keys(cambios).length === 1 && 'orden' in cambios)) auditar(db, yo(), 'motivos', codigo, 'UPDATE', ...dif);
      } else {
        const base = futuro.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'motivo';
        let cod = base;
        for (let n = 2; db.motivos.some((x) => x.codigo === cod); n += 1) cod = `${base}_${n}`;
        m = { color: '#77757f', disponible_para: 'todos', ...futuro, codigo: cod, orden: Math.max(0, ...db.motivos.map((x) => x.orden)) + 1 };
        db.motivos.push(m);
        auditar(db, yo(), 'motivos', cod, 'INSERT', null, { nombre: m.nombre, equipo_id: m.equipo_id });
      }
      guardar(db);
    },

    async eliminarMotivo(codigo) {
      const db = leer();
      exigirAdmin();
      const m = db.motivos.find((x) => x.codigo === codigo);
      exigir(!db.conversaciones.some((c) => c.motivo === codigo), `El motivo "${m.nombre}" tiene consultas registradas: ocultalo en lugar de eliminarlo`);
      exigir(!m.activo || db.motivos.some((x) => x.activo && x.codigo !== codigo), 'Tiene que quedar al menos un motivo visible en el chat');
      db.motivos = db.motivos.filter((x) => x.codigo !== codigo);
      auditar(db, yo(), 'motivos', codigo, 'DELETE', { nombre: m.nombre }, null);
      guardar(db);
    },

    async guardarSucursal({ id, nombre, activo }) {
      const db = leer();
      exigirAdmin();
      exigir((nombre || '').trim().length >= 2, 'Escribí el nombre de la sucursal');
      if (id) Object.assign(db.sucursales.find((s) => s.id === id), { nombre, activo });
      else db.sucursales.push({ id: Math.max(0, ...db.sucursales.map((s) => s.id)) + 1, nombre, orden: db.sucursales.length + 1, activo: true });
      auditar(db, yo(), 'sucursales', id || nombre, id ? 'UPDATE' : 'INSERT', null, { nombre, activo });
      guardar(db);
    },

    async eliminarSucursal(id) {
      const db = leer();
      exigirAdmin();
      const s = db.sucursales.find((x) => x.id === id);
      exigir(!Object.values(db.clientes).some((c) => c.sucursal_id === id), `Hay clientes de la sucursal ${s.nombre}: desactivala en lugar de eliminarla`);
      db.sucursales = db.sucursales.filter((x) => x.id !== id);
      auditar(db, yo(), 'sucursales', id, 'DELETE', { nombre: s.nombre }, null);
      guardar(db);
    },

    async agregarFeriado({ fecha, descripcion }) {
      const db = leer();
      exigirAdmin();
      db.feriados = db.feriados.filter((f) => f.fecha !== fecha);
      db.feriados.push({ fecha, descripcion: descripcion.trim() });
      auditar(db, yo(), 'feriados', fecha, 'INSERT', null, { fecha, descripcion });
      guardar(db);
    },

    async eliminarFeriado(fecha) {
      const db = leer();
      exigirAdmin();
      db.feriados = db.feriados.filter((f) => f.fecha !== fecha);
      auditar(db, yo(), 'feriados', fecha, 'DELETE', { fecha }, null);
      guardar(db);
    },

    async guardarRespuesta({ id, ...datos }) {
      const db = leer();
      exigirAdmin();
      exigir((datos.titulo || '').trim().length >= 2 && (datos.texto || '').trim(), 'Completá el título y el texto');
      if (id) Object.assign(db.respuestas.find((r) => r.id === id), datos);
      else db.respuestas.push({ id: uuid(), orden: db.respuestas.length + 1, activo: true, ...datos });
      auditar(db, yo(), 'respuestas_rapidas', id || datos.titulo, id ? 'UPDATE' : 'INSERT', null, { titulo: datos.titulo });
      guardar(db);
    },

    async eliminarRespuesta(id) {
      const db = leer();
      exigirAdmin();
      const r = db.respuestas.find((x) => x.id === id);
      db.respuestas = db.respuestas.filter((x) => x.id !== id);
      auditar(db, yo(), 'respuestas_rapidas', id, 'DELETE', { titulo: r?.titulo }, null);
      guardar(db);
    },

    async guardarFaq({ id, ...datos }) {
      const db = leer();
      exigirAdmin();
      exigir((datos.pregunta || '').trim().length >= 5 && (datos.respuesta || '').trim().length >= 5, 'Completá la pregunta y la respuesta');
      if (id) Object.assign(db.faq.find((f) => f.id === id), datos);
      else db.faq.push({ id: uuid(), orden: db.faq.length + 1, activo: true, vistas: 0, utiles: 0, no_utiles: 0, ...datos });
      auditar(db, yo(), 'preguntas_frecuentes', id || datos.pregunta, id ? 'UPDATE' : 'INSERT', null, { pregunta: datos.pregunta });
      guardar(db);
    },

    async eliminarFaq(id) {
      const db = leer();
      exigirAdmin();
      const f = db.faq.find((x) => x.id === id);
      db.faq = db.faq.filter((x) => x.id !== id);
      auditar(db, yo(), 'preguntas_frecuentes', id, 'DELETE', { pregunta: f?.pregunta }, null);
      guardar(db);
    },

    async guardarEtiqueta({ id, nombre, color }) {
      const db = leer();
      exigirAdmin();
      exigir((nombre || '').trim().length >= 2, 'Escribí el nombre de la etiqueta');
      exigir(!db.etiquetas.some((e) => e.nombre.toLowerCase() === nombre.trim().toLowerCase() && e.id !== id), 'Ya existe una etiqueta con ese nombre');
      if (id) Object.assign(db.etiquetas.find((e) => e.id === id), { nombre: nombre.trim(), color });
      else db.etiquetas.push({ id: Math.max(0, ...db.etiquetas.map((e) => e.id)) + 1, nombre: nombre.trim(), color });
      auditar(db, yo(), 'etiquetas', id || nombre, id ? 'UPDATE' : 'INSERT', null, { nombre, color });
      guardar(db);
    },

    async eliminarEtiqueta(id) {
      const db = leer();
      exigirAdmin();
      const e = db.etiquetas.find((x) => x.id === id);
      db.etiquetas = db.etiquetas.filter((x) => x.id !== id);
      db.cliente_etiquetas = db.cliente_etiquetas.filter((x) => x.etiqueta_id !== id);
      auditar(db, yo(), 'etiquetas', id, 'DELETE', { nombre: e?.nombre }, null);
      guardar(db);
    },

    async importarContratos(filas, reemplazar) {
      await esperar(500);
      const db = leer();
      exigirAdmin();
      const validas = new Map();
      for (const f of filas) {
        const nro = limpio(f.nro_contrato);
        const dni = soloDigitos(f.dni_pasajero);
        if (!nro || nro.length > 40 || !/^\d{7,9}$/.test(dni || '')) continue;
        validas.set(`${nro}|${dni}`, { nro_contrato: nro, dni_pasajero: dni, pasajero: limpio(f.pasajero), colegio: limpio(f.colegio),
          curso: limpio(f.curso), viaje: limpio(f.viaje), actualizado_at: ahoraISO() });
      }
      const previo = db.contratos.length;
      if (reemplazar) db.contratos = [];
      for (const k of validas.values()) {
        db.contratos = db.contratos.filter((x) => !(x.nro_contrato === k.nro_contrato && x.dni_pasajero === k.dni_pasajero));
        db.contratos.push(k);
      }
      let verificados = 0;
      let quitados = 0;
      for (const c of Object.values(db.clientes)) {
        const ok = c.tiene_contrato && enPadron(db, c.nro_contrato, c.dni_pasajero);
        if (ok && !c.contrato_verificado) {
          Object.assign(c, { contrato_verificado: true, verificacion: 'automatica', verificado_at: ahoraISO() });
          verificados += 1;
        } else if (!ok && reemplazar && c.verificacion === 'automatica') {
          Object.assign(c, { contrato_verificado: false, verificacion: null, verificado_at: null });
          quitados += 1;
        }
      }
      const r = {
        filas: filas.length, validas: validas.size, invalidas: filas.length - validas.size,
        eliminados: reemplazar ? Math.max(0, previo - validas.size) : 0, clientes_verificados: verificados,
        verificaciones_quitadas: quitados, total_padron: db.contratos.length,
      };
      auditar(db, yo(), 'contratos', null, 'IMPORTACION', null, { ...r, reemplazo: reemplazar });
      guardar(db);
      return r;
    },

    async resumenPadron() {
      const db = leer();
      return { total: db.contratos.length, actualizado: db.contratos.map((k) => k.actualizado_at).sort().pop() || null };
    },

    async auditoria({ desde = null, tabla = null, limite = 200 } = {}) {
      exigirAdmin();
      return leer().auditoria.filter((a) => (!tabla || a.tabla === tabla) && (!desde || a.created_at >= desde)).slice(0, limite);
    },

    async guardarConfig(cambios) {
      const db = leer();
      exigirAdmin();
      exigir(!cambios.politica_privacidad_url || /^https:\/\/\S+$/i.test(cambios.politica_privacidad_url),
        'La dirección de la política tiene que empezar con https://');
      const dif = diferencias(db.config, cambios);
      Object.assign(db.config, cambios);
      if (dif) auditar(db, yo(), 'configuracion', 1, 'UPDATE', ...dif);
      asignarFila(db);
      guardar(db);
    },

    reiniciarDemo() {
      localStorage.removeItem(CLAVE);
      localStorage.removeItem(CLAVE_CLIENTE);
      Object.keys(localStorage).filter((k) => k.startsWith('wolf-demo-archivo:')).forEach((k) => localStorage.removeItem(k));
    },
  };
}
