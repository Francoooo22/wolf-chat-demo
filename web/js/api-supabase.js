// Acceso a Supabase para el chat del cliente y el panel de gestores.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { CONFIG } from './config.js';
import { normalizarContrato } from './util.js';

const BUCKET = 'adjuntos';

// detectSessionInUrl solo lo necesita el panel (vuelta del ingreso con Google).
// El chat del cliente no toma sesiones desde la URL: canjea el enlace de acceso
// a mano con verifyOtp, así un enlace armado por un tercero no le cambia la sesión.
function nuevoCliente(storageKey, { detectSessionInUrl = false } = {}) {
  return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl, storageKey },
  });
}

const MENSAJES_ERROR = {
  23505: 'Ya existe uno con ese nombre o correo.',
  23514: 'Algún dato no tiene el formato correcto. Revisá lo que cargaste.',
  23503: 'Hay registros que dependen de este dato.',
  42501: 'No tenés permiso para hacer este cambio.',
  captcha_failed: 'No pudimos verificar que no seas un robot. Probá de nuevo.',
  over_request_rate_limit: 'Hay demasiados intentos desde tu conexión. Esperá unos minutos y probá de nuevo.',
};

// Lanza el error de Supabase con un mensaje legible. Los errores de las reglas
// de la base (código P0001) ya vienen redactados para mostrar.
function ok({ data, error }) {
  if (error) {
    const e = new Error(MENSAJES_ERROR[error.code] || error.message || 'Error de conexión');
    e.original = error;
    e.legible = Boolean(MENSAJES_ERROR[error.code]) || error.code === 'P0001';   // se puede mostrar tal cual
    throw e;
  }
  return data;
}

// Llama a una función del servidor (Edge Function) y devuelve su respuesta.
async function funcion(sb, nombre, body) {
  const { data, error } = await sb.functions.invoke(nombre, { body });
  if (error) {
    let mensaje = 'No pudimos completar la operación. Probá de nuevo.';
    try {
      const j = await error.context.json();
      mensaje = j.error || mensaje;
    } catch { /* respuesta sin JSON */ }
    const e = new Error(mensaje);
    e.status = error.context?.status;
    e.legible = true;
    throw e;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function extension(nombre) {
  const m = /\.([a-z0-9]{1,5})$/i.exec(nombre || '');
  return m ? m[1].toLowerCase() : 'bin';
}

async function subirArchivo(sb, convId, archivo) {
  const path = `${convId}/${crypto.randomUUID()}.${extension(archivo.name)}`;
  ok(await sb.storage.from(BUCKET).upload(path, archivo, { contentType: archivo.type, upsert: false }));
  return path;
}

async function urlFirmada(sb, path) {
  const data = ok(await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60));
  return data.signedUrl;
}

async function catalogosBase(sb) {
  const [motivos, sucursales, config, horario] = await Promise.all([
    sb.from('motivos').select('*').eq('activo', true).order('orden'),
    sb.from('sucursales').select('*').eq('activo', true).order('orden').order('nombre'),
    sb.from('configuracion').select('*').single(),
    sb.rpc('texto_horario'),
  ]);
  return {
    motivos: ok(motivos),
    sucursales: ok(sucursales),
    config: { ...ok(config), texto_horario: ok(horario) },
  };
}

// "Escribiendo…": aviso efímero entre el chat y el panel (no se guarda).
function canalEscribiendo(sb, convId, onEvento) {
  const canal = sb.channel(`escribiendo-${convId}`, { config: { broadcast: { self: false } } });
  canal.on('broadcast', { event: 'escribiendo' }, ({ payload }) => onEvento(payload)).subscribe();
  return {
    avisar: (datos) => canal.send({ type: 'broadcast', event: 'escribiendo', payload: datos }),
    cerrar: () => sb.removeChannel(canal),
  };
}

// ---------------------------------------------------------------------
// Chat del cliente
// ---------------------------------------------------------------------
export function crearApiCliente() {
  const sb = nuevoCliente('wolf-chat-cliente');

  // La sesión anónima se crea recién al enviar la primera consulta, para no
  // generar usuarios por cada visita a la web.
  async function usuarioActual() {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user ?? null;
  }

  async function entrarConToken(tokenHash) {
    let r = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (r.error) r = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'email' });
    ok(r);
  }

  return {
    async iniciar() {
      const user = await usuarioActual();
      return { usuarioId: user?.id ?? null };
    },

    async contexto() {
      const user = await usuarioActual();
      const [base, enHorario] = await Promise.all([catalogosBase(sb), sb.rpc('en_horario')]);
      let cliente = null;
      let ultima = null;
      if (user) {
        const [c, convs] = await Promise.all([
          sb.from('clientes').select('*').eq('id', user.id).maybeSingle(),
          sb.from('conversaciones').select('*').eq('cliente_id', user.id)
            .order('created_at', { ascending: false }).limit(1),
        ]);
        cliente = ok(c);
        ultima = ok(convs)[0] || null;
      }
      return {
        ...base,
        cliente,
        abierta: ultima && ultima.estado === 'abierta' ? ultima : null,
        ultima,
        enHorario: ok(enHorario),
      };
    },

    // ----- Recuperar las consultas desde otro dispositivo -----
    async enviarCodigo(email, captcha) {
      return funcion(sb, 'acceso-cliente', { accion: 'enviar_codigo', email, captcha });
    },
    async verificarCodigo(email, codigo) {
      const d = await funcion(sb, 'acceso-cliente', { accion: 'verificar_codigo', email, codigo });
      await entrarConToken(d.token_hash);
    },
    async canjearEnlace(token) {
      const d = await funcion(sb, 'acceso-cliente', { accion: 'canjear_enlace', token });
      await entrarConToken(d.token_hash);
    },
    async bajaAvisos(c, t) {
      return funcion(sb, 'acceso-cliente', { accion: 'baja_avisos', c, t });
    },

    async preguntasFrecuentes(motivo) {
      return ok(await sb.from('preguntas_frecuentes').select('id, pregunta, respuesta, motivo')
        .eq('activo', true).or(`motivo.is.null,motivo.eq.${motivo}`).order('orden').limit(6));
    },
    async registrarFaq(id, util = null) {
      await sb.rpc('registrar_faq', { p_id: id, p_util: util });
    },

    // Contratos vigentes para elegir (año, destino, producto, número, colegio).
    async catalogoContratos() {
      return ok(await sb.rpc('catalogo_contratos')) || [];
    },

    async iniciarConversacion(datos, captcha) {
      if (!(await usuarioActual())) {
        ok(await sb.auth.signInAnonymously(captcha ? { options: { captchaToken: captcha } } : undefined));
      }
      return ok(await sb.rpc('iniciar_conversacion', { p_datos: datos }));
    },

    async conversacion(id) {
      return ok(await sb.from('conversaciones').select('*').eq('id', id).single());
    },

    async mensajes(convId) {
      return ok(await sb.from('mensajes').select('*').eq('conversacion_id', convId).eq('interno', false).order('created_at'));
    },

    async enviarTexto(convId, texto) {
      return ok(await sb.from('mensajes')
        .insert({ conversacion_id: convId, autor_tipo: 'cliente', texto })
        .select().single());
    },

    async enviarArchivo(convId, archivo) {
      const path = await subirArchivo(sb, convId, archivo);
      return ok(await sb.from('mensajes').insert({
        conversacion_id: convId, autor_tipo: 'cliente', adjunto_path: path,
        adjunto_nombre: archivo.name, adjunto_mime: archivo.type, adjunto_bytes: archivo.size,
      }).select().single());
    },

    urlArchivo: (path) => urlFirmada(sb, path),

    suscribir(convId, { onMensaje, onConversacion }) {
      const canal = sb.channel(`cliente-${convId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `conversacion_id=eq.${convId}` },
          (p) => { if (!p.new?.interno) onMensaje?.(p.new); })
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'conversaciones', filter: `id=eq.${convId}` },
          (p) => onConversacion?.(p.new))
        .subscribe();
      return () => sb.removeChannel(canal);
    },

    escribiendo: (convId, onEvento) => canalEscribiendo(sb, convId, onEvento),

    async marcarLeida(convId) {
      ok(await sb.rpc('marcar_leida', { p_conv: convId }));
    },

    async calificar(convId, puntaje, comentario) {
      ok(await sb.rpc('calificar_atencion', { p_conv: convId, p_puntaje: puntaje, p_comentario: comentario || null }));
    },

    async latido() {
      await sb.rpc('latido_cliente');
    },
  };
}

// ---------------------------------------------------------------------
// Panel de gestores
// ---------------------------------------------------------------------
export function crearApiPanel() {
  const sb = nuevoCliente('wolf-chat-panel', { detectSessionInUrl: true });
  const SELECT_LISTA = '*, cliente:clientes(id, nombre, tipo, colegio, curso, nro_contrato, etapa, contrato_verificado)';

  return {
    async sesion() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const gestor = ok(await sb.rpc('vincular_gestor'));
      return { email: session.user.email, gestor };
    },

    // Cuenta de Google sin alta: deja una solicitud para el administrador. Devuelve { estado } o null.
    async solicitarAcceso() {
      const r = await sb.rpc('solicitar_acceso');
      return r.error ? null : r.data;
    },

    async ingresarConGoogle() {
      ok(await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname },
      }));
    },

    async salir() {
      await sb.auth.signOut();
    },

    // Solicitudes de acceso pendientes (solo las ve un administrador). Si la migración todavía no se aplicó, queda vacío.
    async solicitudesAcceso() {
      const r = await sb.from('solicitudes_acceso').select('*').eq('estado', 'pendiente').order('created_at');
      return r.error ? [] : r.data;
    },
    rechazarSolicitud: async (id) => ok(await sb.rpc('rechazar_solicitud', { p_id: id })),

    async catalogos() {
      const base = await catalogosBase(sb);
      const [equipos, gestores, motivosTodos, sucursalesTodas, feriados, etiquetas, respuestas, faq, solicitudes] = await Promise.all([
        sb.from('equipos').select('*').order('nombre'),
        sb.from('gestores').select('*, equipos:gestor_equipos(equipo_id)').order('nombre'),
        sb.from('motivos').select('*').order('orden'),
        sb.from('sucursales').select('*').order('orden').order('nombre'),
        sb.from('feriados').select('*').order('fecha'),
        sb.from('etiquetas').select('*').order('nombre'),
        sb.from('respuestas_rapidas').select('*').order('orden').order('titulo'),
        sb.from('preguntas_frecuentes').select('*').order('orden').order('pregunta'),
        this.solicitudesAcceso(),
      ]);
      return {
        ...base,
        solicitudes,
        equipos: ok(equipos),
        gestores: ok(gestores).map((g) => ({ ...g, equipos: g.equipos.map((e) => e.equipo_id) })),
        motivosTodos: ok(motivosTodos),
        sucursalesTodas: ok(sucursalesTodas),
        feriados: ok(feriados),
        etiquetas: ok(etiquetas),
        respuestas: ok(respuestas),
        faq: ok(faq),
      };
    },

    async conversaciones() {
      return ok(await sb.from('conversaciones').select(SELECT_LISTA)
        .order('ultimo_mensaje_at', { ascending: false }).limit(500));
    },

    async conversacion(id) {
      return ok(await sb.from('conversaciones').select(SELECT_LISTA).eq('id', id).single());
    },

    async cliente(id) {
      const c = ok(await sb.from('clientes')
        .select('*, sucursal:sucursales(nombre), etiquetas:cliente_etiquetas(etiqueta_id), verificador:gestores!clientes_verificado_por_fkey(nombre)')
        .eq('id', id).single());
      return { ...c, etiquetas: c.etiquetas.map((e) => e.etiqueta_id) };
    },

    async historial(clienteId) {
      return ok(await sb.from('conversaciones')
        .select('id, numero, motivo, estado, created_at, gestor_nombre, csat')
        .eq('cliente_id', clienteId).order('created_at', { ascending: false }));
    },

    async mensajes(convId) {
      return ok(await sb.from('mensajes').select('*').eq('conversacion_id', convId).order('created_at'));
    },

    // Charla del cliente con el bot antes de llegar al equipo: [{ de: 'bot' | 'cliente', texto }].
    async charlaConBot(convId) {
      const r = ok(await sb.from('admision_chat').select('lineas').eq('conversacion_id', convId).maybeSingle());
      return r?.lineas || [];
    },

    async enviarTexto(convId, texto, interno = false) {
      return ok(await sb.from('mensajes')
        .insert({ conversacion_id: convId, autor_tipo: 'gestor', texto, interno })
        .select().single());
    },

    async enviarArchivo(convId, archivo) {
      const path = await subirArchivo(sb, convId, archivo);
      return ok(await sb.from('mensajes').insert({
        conversacion_id: convId, autor_tipo: 'gestor', adjunto_path: path,
        adjunto_nombre: archivo.name, adjunto_mime: archivo.type, adjunto_bytes: archivo.size,
      }).select().single());
    },

    urlArchivo: (path) => urlFirmada(sb, path),

    tomar: async (id) => ok(await sb.rpc('tomar_conversacion', { p_conv: id })),
    cambiarEstado: async (id, estado) => ok(await sb.rpc('cambiar_estado', { p_conv: id, p_estado: estado })),
    marcarLeida: async (id) => ok(await sb.rpc('marcar_leida', { p_conv: id })),
    setDisponible: async (valor) => ok(await sb.rpc('set_disponible', { p_disponible: valor })),
    repartir: async (gestorId = null) => ok(await sb.rpc('repartir_consultas', { p_gestor: gestorId })),
    actualizarCliente: async (id, datos) => ok(await sb.rpc('actualizar_cliente', { p_cliente: id, p_datos: datos })),

    async transferir(id, { gestorId = null, equipoId = null, nota = null }) {
      ok(await sb.rpc('transferir_conversacion', {
        p_conv: id, p_gestor: gestorId, p_equipo: equipoId, p_nota: nota,
      }));
    },

    // ----- Contrato, etapa y etiquetas -----
    async contratoEnPadron(nro) {
      if (!nro) return [];
      return ok(await sb.from('contratos').select('*').eq('nro_normalizado', normalizarContrato(nro)).limit(10));
    },
    verificarContrato: async (clienteId, valor, nota) =>
      ok(await sb.rpc('verificar_contrato', { p_cliente: clienteId, p_verificado: valor, p_nota: nota || null })),
    cambiarEtapa: async (clienteId, etapa, motivo) =>
      ok(await sb.rpc('cambiar_etapa', { p_cliente: clienteId, p_etapa: etapa, p_motivo_perdida: motivo || null })),
    async agregarEtiqueta(clienteId, etiquetaId, gestorId) {
      ok(await sb.from('cliente_etiquetas').insert({ cliente_id: clienteId, etiqueta_id: etiquetaId, created_by: gestorId }));
    },
    async quitarEtiqueta(clienteId, etiquetaId) {
      ok(await sb.from('cliente_etiquetas').delete().eq('cliente_id', clienteId).eq('etiqueta_id', etiquetaId));
    },

    // ----- Vistas -----
    tablero: async (dias = 90) => ok(await sb.rpc('tablero_leads', { p_dias: dias })),
    reporte: async (desde, hasta) => ok(await sb.rpc('reporte', { p_desde: desde, p_hasta: hasta })),
    exportarConsultas: async (desde, hasta) => ok(await sb.rpc('exportar_consultas', { p_desde: desde, p_hasta: hasta })),
    exportarClientes: async () => ok(await sb.rpc('exportar_clientes')),

    // ----- Avisos por correo -----
    valoresColegios: async () => ok(await sb.rpc('valores_colegios')),
    valoresCursos: async (claves) => ok(await sb.rpc('valores_cursos', { p_claves: claves })),
    destinatarios: async (filtro) => ok(await sb.rpc('destinatarios_aviso', { p_filtro: filtro })),
    crearAviso: async (asunto, cuerpo, filtro) => ok(await sb.rpc('crear_aviso', { p_asunto: asunto, p_cuerpo: cuerpo, p_filtro: filtro })),
    enviarAviso: async (id) => funcion(sb, 'enviar-aviso', { aviso_id: id }),
    avisos: async () => ok(await sb.from('avisos').select('*').order('created_at', { ascending: false }).limit(50)),

    // ----- IA, push y "escribiendo" -----
    sugerir: async (convId) => (await funcion(sb, 'sugerir-respuesta', { conversacion_id: convId })).texto,
    guardarSuscripcion: async (sub) => ok(await sb.rpc('guardar_suscripcion_push', { p_sub: sub, p_user_agent: navigator.userAgent })),
    borrarSuscripcion: async (endpoint) => ok(await sb.rpc('borrar_suscripcion_push', { p_endpoint: endpoint })),
    escribiendo: (convId, onEvento) => canalEscribiendo(sb, convId, onEvento),

    suscribirBandeja(cb) {
      const canal = sb.channel('panel-bandeja')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversaciones' }, (p) => cb(p))
        .subscribe();
      return () => sb.removeChannel(canal);
    },

    suscribirMensajes(convId, cb) {
      const canal = sb.channel(`panel-${convId}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'mensajes', filter: `conversacion_id=eq.${convId}` },
          (p) => cb(p.new))
        .subscribe();
      return () => sb.removeChannel(canal);
    },

    // ----- Administración -----
    async guardarGestor({ id, email, nombre, rol, activo, disponible, equipos }) {
      const fila = { email: email.trim().toLowerCase(), nombre: nombre.trim(), rol, activo, disponible };
      const g = id
        ? ok(await sb.from('gestores').update(fila).eq('id', id).select().single())
        : ok(await sb.from('gestores').insert(fila).select().single());
      ok(await sb.from('gestor_equipos').delete().eq('gestor_id', g.id));
      if (equipos.length) {
        ok(await sb.from('gestor_equipos').insert(equipos.map((e) => ({ gestor_id: g.id, equipo_id: e }))));
      }
      return g;
    },
    eliminarGestor: async (id) => ok(await sb.from('gestores').delete().eq('id', id)),

    async guardarEquipo({ id, nombre, integrantes }) {
      const e = id
        ? ok(await sb.from('equipos').update({ nombre: nombre.trim() }).eq('id', id).select().single())
        : ok(await sb.from('equipos').insert({ nombre: nombre.trim() }).select().single());
      ok(await sb.rpc('set_integrantes_equipo', { p_equipo: e.id, p_gestores: integrantes }));
      return e;
    },
    eliminarEquipo: async (id) => ok(await sb.from('equipos').delete().eq('id', id)),

    // codigo vacío = motivo nuevo (la base arma el código y el orden).
    async guardarMotivo(codigo, cambios) {
      if (codigo) ok(await sb.from('motivos').update(cambios).eq('codigo', codigo));
      else ok(await sb.from('motivos').insert(cambios));
    },
    eliminarMotivo: async (codigo) => ok(await sb.from('motivos').delete().eq('codigo', codigo)),

    async guardarSucursal({ id, nombre, activo }) {
      if (id) ok(await sb.from('sucursales').update({ nombre, activo }).eq('id', id));
      else ok(await sb.from('sucursales').insert({ nombre, activo: true }));
    },
    eliminarSucursal: async (id) => ok(await sb.from('sucursales').delete().eq('id', id)),

    agregarFeriado: async ({ fecha, descripcion }) => ok(await sb.from('feriados').upsert({ fecha, descripcion: descripcion.trim() })),
    eliminarFeriado: async (fecha) => ok(await sb.from('feriados').delete().eq('fecha', fecha)),

    async guardarRespuesta({ id, ...datos }) {
      if (id) ok(await sb.from('respuestas_rapidas').update(datos).eq('id', id));
      else ok(await sb.from('respuestas_rapidas').insert(datos));
    },
    eliminarRespuesta: async (id) => ok(await sb.from('respuestas_rapidas').delete().eq('id', id)),

    async guardarFaq({ id, ...datos }) {
      if (id) ok(await sb.from('preguntas_frecuentes').update(datos).eq('id', id));
      else ok(await sb.from('preguntas_frecuentes').insert(datos));
    },
    eliminarFaq: async (id) => ok(await sb.from('preguntas_frecuentes').delete().eq('id', id)),

    async guardarEtiqueta({ id, nombre, color }) {
      if (id) ok(await sb.from('etiquetas').update({ nombre, color }).eq('id', id));
      else ok(await sb.from('etiquetas').insert({ nombre, color }));
    },
    eliminarEtiqueta: async (id) => ok(await sb.from('etiquetas').delete().eq('id', id)),

    importarContratos: async (filas, reemplazar) =>
      ok(await sb.rpc('importar_contratos', { p_filas: filas, p_reemplazar: reemplazar })),
    async resumenPadron() {
      const { count, error } = await sb.from('contratos').select('nro_contrato', { count: 'exact', head: true });
      if (error) ok({ error });
      const ult = ok(await sb.from('contratos').select('actualizado_at').order('actualizado_at', { ascending: false }).limit(1));
      return { total: count ?? 0, actualizado: ult[0]?.actualizado_at ?? null };
    },

    async auditoria({ desde = null, tabla = null, limite = 200 } = {}) {
      let q = sb.from('auditoria').select('*').order('created_at', { ascending: false }).limit(limite);
      if (desde) q = q.gte('created_at', desde);
      if (tabla) q = q.eq('tabla', tabla);
      return ok(await q);
    },

    async guardarConfig(cambios) {
      ok(await sb.from('configuracion').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', 1));
    },
  };
}
