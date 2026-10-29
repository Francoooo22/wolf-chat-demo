// Panel — Administración (solo rol administrador): todo se configura desde acá.
import {
  api, st, CONFIG, MODO_DEMO, ROL, PALETA, esAdmin, nombreEquipo, chipMotivo, chipEtiqueta, toast, intentar,
  registrarVista, cambiarVista, cargarCatalogos, prepararEliminar, dialogo, confirmar, hoyISO, fechaHora, numero,
} from './comun.js';
import { $, escapar, textoHorario, TEXTOS_POR_DEFECTO, leerPlanilla, normalizarTexto } from '../js/util.js';

const SECCIONES = [
  { id: 'personas', texto: 'Personas' },
  { id: 'equipos', texto: 'Equipos' },
  { id: 'motivos', texto: 'Motivos de consulta' },
  { id: 'horario', texto: 'Horario y reparto' },
  { id: 'textos', texto: 'Textos del chat' },
  { id: 'respuestas', texto: CONFIG.IA_DISPONIBLE ? 'Respuestas rápidas e IA' : 'Respuestas rápidas' },
  { id: 'faq', texto: 'Preguntas frecuentes' },
  { id: 'etiquetas', texto: 'Etiquetas' },
  { id: 'sucursales', texto: 'Sucursales' },
  { id: 'contratos', texto: 'Padrón de contratos' },
  { id: 'registro', texto: 'Registro de cambios' },
];
const PARA_QUIEN = { todos: 'Todos', cliente: 'Solo con contrato', lead: 'Solo sin contrato' };
const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_COMPLETOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const FLECHA_ARRIBA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FLECHA_ABAJO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const ad = {
  seccion: 'personas',
  padron: null,          // resumen del padrón de contratos
  importacion: null,     // { nombre, filas, columnas, mapa }
  registro: { tabla: '', desde: '', filas: null },
};

registrarVista('admin', { mostrar: renderAdmin });

const hhmm = (t) => String(t || '').slice(0, 5);

function fechaLarga(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d, 12));
  const t = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(f);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export async function renderAdmin() {
  await cargarCatalogos();
  if (!esAdmin()) {
    cambiarVista('bandeja');
    return;
  }
  if (ad.seccion === 'contratos' && !ad.padron) ad.padron = await intentar(() => api.resumenPadron());
  if (ad.seccion === 'registro' && !ad.registro.filas) await cargarRegistro(false);
  const secciones = MODO_DEMO ? [...SECCIONES, { id: 'demo', texto: 'Demostración' }] : SECCIONES;
  $('#vista-admin').innerHTML = `
    <div class="admin-layout">
      <nav class="admin-nav" aria-label="Configuración">
        ${secciones.map((s) => `<button type="button" data-seccion="${s.id}" ${s.id === ad.seccion ? 'aria-current="page"' : ''}>${s.texto}</button>`).join('')}
      </nav>
      <div class="admin-contenido">${SECCION[ad.seccion]()}</div>
    </div>`;
  actualizarVistasPrevias();
}

const abiertasDe = (id) => st.convs.filter((c) => c.estado === 'abierta' && c.gestor_id === id).length;

const SECCION = {
  personas() {
    const gestores = [...st.cat.gestores].sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre));
    const estado = (g) => {
      if (!g.activo) return '<span class="chip gris">Sin acceso</span>';
      const base = g.disponible ? '<span class="chip ok">Disponible</span>' : '<span class="chip ausente">Ausente</span>';
      return base + (!g.user_id && !MODO_DEMO ? ' <small>Todavía no ingresó</small>' : '');
    };
    const equipos = (g) => {
      const nombres = g.equipos.map(nombreEquipo);
      if (nombres.length) return escapar(nombres.join(', '));
      return g.rol === 'gestor' ? '<small>Ninguno: no recibe consultas</small>' : '<small>Ninguno</small>';
    };
    const solicitudes = st.cat.solicitudes || [];
    const pedidos = solicitudes.length ? `
      <section class="tarjeta">
        <div class="encabezado"><div><h2>Solicitudes de acceso (${solicitudes.length})</h2>
          <p>Personas que ingresaron con su cuenta de Google sin estar dadas de alta. Al habilitarlas elegís su rol y de qué equipos reciben consultas.</p></div></div>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Nombre</th><th>Cuenta de Google</th><th>Pidió acceso</th><th></th></tr></thead>
          <tbody>${solicitudes.map((x) => `
            <tr>
              <td><b>${escapar(x.nombre || '—')}</b></td>
              <td>${escapar(x.email)}</td>
              <td>${escapar(fechaHora(x.created_at))}</td>
              <td><button class="boton primario chico" type="button" data-admin="habilitar-solicitud" data-id="${x.id}">Habilitar</button>
                  <button class="texto-boton" type="button" data-admin="rechazar-solicitud" data-id="${x.id}">Rechazar</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>` : '';
    return `${pedidos}
      <section class="tarjeta">
        <div class="encabezado">
          <div><h2>Personas</h2>
            <p>Quiénes ingresan al panel con su cuenta de Google, qué rol tienen y de qué equipos reciben consultas.
            Si alguien deja de tener acceso, sus consultas abiertas se reparten solas entre su equipo.</p></div>
          <button class="boton primario" type="button" data-admin="nuevo-gestor">Agregar persona</button>
        </div>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Nombre</th><th>Cuenta de Google</th><th>Rol</th><th>Equipos</th><th>Abiertas</th><th>Estado</th><th></th></tr></thead>
          <tbody>${gestores.map((g) => `
            <tr class="${g.activo ? '' : 'de-baja'}">
              <td><b>${escapar(g.nombre)}</b>${g.id === st.yo.id ? ' <small>(vos)</small>' : ''}</td>
              <td>${escapar(g.email)}</td>
              <td>${ROL[g.rol]}</td>
              <td>${equipos(g)}</td>
              <td class="num">${abiertasDe(g.id) || ''}</td>
              <td>${estado(g)}</td>
              <td><button class="texto-boton" type="button" data-admin="editar-gestor" data-id="${g.id}">Editar</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>`;
  },

  equipos() {
    const cat = st.cat;
    return `
      <section class="tarjeta">
        <div class="encabezado">
          <div><h2>Equipos</h2>
            <p>Cada motivo de consulta llega a un equipo. Dentro del equipo, cada consulta nueva va a quien esté disponible
            y tenga menos consultas abiertas.</p></div>
          <button class="boton primario" type="button" data-admin="nuevo-equipo">Nuevo equipo</button>
        </div>
        <div class="equipos-lista">
          ${cat.equipos.map((e) => {
            const integrantes = cat.gestores.filter((g) => g.activo && g.equipos.includes(e.id));
            const motivos = cat.motivosTodos.filter((m) => m.equipo_id === e.id);
            const sinNadie = motivos.some((m) => m.activo) && !integrantes.some((g) => g.disponible);
            return `
              <article class="equipo">
                <div class="equipo-cab">
                  <h3>${escapar(e.nombre)}</h3>
                  <button class="texto-boton" type="button" data-admin="editar-equipo" data-id="${e.id}">Editar</button>
                </div>
                <dl>
                  <dt>Integrantes</dt>
                  <dd>${integrantes.length
                    ? integrantes.map((g) => `<span class="chip ${g.disponible ? '' : 'ausente'}">${escapar(g.nombre)}${g.disponible ? '' : ', ausente'}</span>`).join('')
                    : '<span class="nadie">Sin integrantes</span>'}</dd>
                  <dt>Recibe</dt>
                  <dd>${motivos.length ? motivos.map(chipMotivo).join('') : '<span class="nadie">Ningún motivo</span>'}</dd>
                </dl>
                ${sinNadie ? '<p class="advertencia">No hay nadie disponible en este equipo: sus consultas quedan en fila hasta que alguien las tome.</p>' : ''}
              </article>`;
          }).join('')}
        </div>
      </section>`;
  },

  motivos() {
    const lista = st.cat.motivosTodos;
    return `
      <section class="tarjeta">
        <div class="encabezado">
          <div><h2>Motivos de consulta</h2>
            <p>Las opciones que el cliente elige en el chat, en este orden, y el equipo que recibe cada una.</p></div>
          <button class="boton primario" type="button" data-admin="nuevo-motivo">Agregar motivo</button>
        </div>
        <div class="tabla-scroll"><table>
          <thead><tr><th>Orden</th><th>Motivo</th><th>Quién lo ve</th><th>Equipo</th><th>En el chat</th><th></th></tr></thead>
          <tbody>${lista.map((m, i) => `
            <tr class="${m.activo ? '' : 'de-baja'}">
              <td><span class="orden">
                <button type="button" data-admin="subir-motivo" data-codigo="${escapar(m.codigo)}" ${i === 0 ? 'disabled' : ''} aria-label="Subir ${escapar(m.nombre)}">${FLECHA_ARRIBA}</button>
                <button type="button" data-admin="bajar-motivo" data-codigo="${escapar(m.codigo)}" ${i === lista.length - 1 ? 'disabled' : ''} aria-label="Bajar ${escapar(m.nombre)}">${FLECHA_ABAJO}</button>
              </span></td>
              <td>${chipMotivo(m)}</td>
              <td>${PARA_QUIEN[m.disponible_para]}</td>
              <td>${escapar(nombreEquipo(m.equipo_id))}</td>
              <td>${m.activo ? 'Visible' : 'Oculto'}</td>
              <td><button class="texto-boton" type="button" data-admin="editar-motivo" data-codigo="${escapar(m.codigo)}">Editar</button></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </section>`;
  },

  sucursales() {
    return `
      <section class="tarjeta">
        <h2>Sucursales</h2>
        <p>Las opciones que el bot ofrece al cliente. Con una sola sucursal activa, el bot no pregunta.</p>
        <table>
          <thead><tr><th>Nombre</th><th>Activa</th><th></th></tr></thead>
          <tbody>${st.cat.sucursalesTodas.map((s) => `
            <tr class="${s.activo ? '' : 'de-baja'}">
              <td><input class="control" value="${escapar(s.nombre)}" data-sucursal-nombre="${s.id}" aria-label="Nombre de la sucursal" maxlength="60"></td>
              <td style="width:80px"><input type="checkbox" data-sucursal-activa="${s.id}" ${s.activo ? 'checked' : ''} aria-label="Activa"></td>
              <td style="width:90px"><button class="texto-boton peligro" type="button" data-admin="eliminar-sucursal" data-id="${s.id}">Eliminar</button></td>
            </tr>`).join('') || '<tr><td colspan="3" class="nadie">Todavía no hay sucursales cargadas.</td></tr>'}</tbody>
        </table>
        <form class="form-linea" id="form-sucursal">
          <input class="control" name="nombre" placeholder="Nombre de la sucursal nueva" required minlength="2" maxlength="60" aria-label="Sucursal nueva">
          <button class="boton">Agregar sucursal</button>
        </form>
      </section>`;
  },

  horario() {
    const c = st.cat.config;
    const hoy = hoyISO();
    const proximos = st.cat.feriados.filter((f) => f.fecha >= hoy);
    return `
      <section class="tarjeta">
        <h2>Horario de atención</h2>
        <p>Fuera de horario el chat igual toma la consulta y le avisa al cliente cuándo le van a responder.</p>
        <form id="form-horario" class="form-grilla">
          <fieldset class="campo ancho" style="border:0;padding:0;margin:0">
            <span>Días de atención</span>
            <div class="dias">${DIAS_SEMANA.map((d, i) => `
              <label title="${DIAS_COMPLETOS[i]}"><input type="checkbox" name="dia" value="${i + 1}" ${c.dias_habiles.map(Number).includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`).join('')}
            </div>
          </fieldset>
          <label class="campo"><span>Desde</span><input type="time" name="hora_inicio" value="${hhmm(c.hora_inicio)}" required></label>
          <label class="campo"><span>Hasta</span><input type="time" name="hora_fin" value="${hhmm(c.hora_fin)}" required></label>
          <p class="vista-previa ancho" id="vista-horario"></p>

          <h3 class="ancho subtitulo">Reparto de consultas</h3>
          <label class="campo"><span>Avisar demora con (minutos hábiles sin respuesta)</span><input type="number" name="minutos_alerta" min="5" max="480" value="${c.minutos_alerta}" required></label>
          <label class="campo"><span>Reasignar si nadie responde en (minutos hábiles; 0 = nunca)</span><input type="number" name="minutos_reasignar" min="0" max="1440" value="${c.minutos_reasignar}" required></label>
          <label class="campo"><span>Máximo de consultas abiertas por persona (0 = sin límite)</span><input type="number" name="max_abiertas_por_gestor" min="0" max="500" value="${c.max_abiertas_por_gestor}" required></label>
          <label class="campo"><span>Volver al mismo gestor si el cliente escribe dentro de (días)</span><input type="number" name="dias_mismo_gestor" min="0" max="365" value="${c.dias_mismo_gestor}" required></label>
          <p class="ayuda-campo ancho">Cuando todos los del equipo llegan al máximo, las consultas nuevas esperan en fila y se asignan solas
            apenas alguien resuelve una. La reasignación automática pasa la consulta a otra persona del equipo una sola vez por espera,
            y deja una nota interna.</p>
          <div class="pie-form ancho"><button class="boton primario" type="submit">Guardar</button></div>
        </form>
      </section>

      <section class="tarjeta">
        <h2>Feriados</h2>
        <p>Los feriados cuentan como fuera de horario y no suman minutos a la alerta de demora.</p>
        <table>
          <thead><tr><th>Fecha</th><th>Motivo</th><th></th></tr></thead>
          <tbody>${proximos.map((f) => `
            <tr><td>${fechaLarga(f.fecha)}</td><td>${escapar(f.descripcion)}</td>
                <td style="width:80px"><button class="texto-boton peligro" type="button" data-admin="eliminar-feriado" data-fecha="${f.fecha}">Quitar</button></td></tr>`).join('')
            || '<tr><td colspan="3" class="nadie">No hay feriados cargados desde hoy en adelante.</td></tr>'}</tbody>
        </table>
        <form class="form-linea" id="form-feriado">
          <input class="control" type="date" name="fecha" required min="${hoy}" aria-label="Fecha del feriado">
          <input class="control" name="descripcion" placeholder="Ej.: Navidad" required maxlength="80" aria-label="Motivo del feriado">
          <button class="boton">Agregar feriado</button>
        </form>
      </section>`;
  },

  textos() {
    const c = st.cat.config;
    return `
      <section class="tarjeta">
        <h2>Textos del chat</h2>
        <p>Lo primero que lee el cliente. El aviso de privacidad aparece antes de pedir cualquier dato personal y tiene que
        aceptarlo para seguir.</p>
        <div class="textos-layout">
          <form id="form-textos" class="form-grilla" style="grid-template-columns:1fr">
            <label class="campo"><span>Saludo</span>
              <input name="texto_bienvenida" required minlength="2" maxlength="300" value="${escapar(c.texto_bienvenida || TEXTOS_POR_DEFECTO.texto_bienvenida)}"></label>
            <label class="campo"><span>Aviso de privacidad</span>
              <textarea name="texto_privacidad" required minlength="10" maxlength="1000" rows="6">${escapar(c.texto_privacidad || TEXTOS_POR_DEFECTO.texto_privacidad)}</textarea></label>
            <p class="ayuda-campo">Tiene que mencionar la transferencia de datos a proveedores de otros países y pedir el
              consentimiento expreso (Ley 25.326, art. 12, y Decreto 1558/2001, art. 12).</p>
            <label class="campo"><span>Dirección de la política de privacidad (opcional)</span>
              <input name="politica_privacidad_url" type="url" pattern="https://.+" placeholder="https://www.wolfinternacional.com/privacidad" value="${escapar(c.politica_privacidad_url || '')}"></label>
            <p class="ayuda-campo">Si queda vacía, el chat enlaza la política incluida en el sistema (página <i>privacidad</i>).</p>
            <div class="pie-form">
              <button class="boton primario" type="submit">Guardar textos</button>
              <button class="boton" type="button" data-admin="restablecer-textos">Volver a los textos originales</button>
            </div>
          </form>
          <div>
            <div class="simulador" aria-label="Vista previa del chat">
              <div class="simulador-cab">Atención Wolf</div>
              <div class="simulador-hilo" id="simulador-hilo"></div>
            </div>
          </div>
        </div>
      </section>`;
  },

  respuestas() {
    const c = st.cat.config;
    const lista = st.cat.respuestas;
    return `
      <section class="tarjeta">
        <div class="encabezado">
          <div><h2>Respuestas rápidas</h2>
            <p>Textos guardados que los gestores insertan con un clic o escribiendo <b>/</b> en la respuesta. Podés usar
            <code>{nombre}</code>, <code>{gestor}</code>, <code>{contrato}</code>, <code>{colegio}</code> y <code>{curso}</code>.</p></div>
          <button class="boton primario" type="button" data-admin="nueva-respuesta">Nueva respuesta</button>
        </div>
        ${lista.length ? `<div class="tabla-scroll"><table>
          <thead><tr><th>Título</th><th>Texto</th><th>Equipo</th><th>Estado</th><th></th></tr></thead>
          <tbody>${lista.map((r) => `
            <tr class="${r.activo ? '' : 'de-baja'}">
              <td><b>${escapar(r.titulo)}</b></td>
              <td class="recorte">${escapar(r.texto)}</td>
              <td>${r.equipo_id ? escapar(nombreEquipo(r.equipo_id)) : 'Todos'}</td>
              <td>${r.activo ? 'Activa' : 'Oculta'}</td>
              <td><button class="texto-boton" type="button" data-admin="editar-respuesta" data-id="${r.id}">Editar</button></td>
            </tr>`).join('')}</tbody></table></div>`
          : '<p class="nadie">Todavía no hay respuestas rápidas.</p>'}
      </section>
      ${CONFIG.IA_DISPONIBLE ? `
      <section class="tarjeta">
        <h2>Sugerencias con IA</h2>
        <p>Agrega en la bandeja el botón <b>Sugerir con IA</b>: arma un borrador con la conversación, las preguntas frecuentes y
        las respuestas rápidas. El gestor siempre lo revisa antes de enviarlo; la IA nunca le escribe sola al cliente.</p>
        <form id="form-ia" class="interruptor-fila">
          <label class="check-linea"><input type="checkbox" name="ia_habilitada" ${c.ia_habilitada ? 'checked' : ''}> Activar sugerencias con IA</label>
        </form>
        <p class="ayuda-campo">Se envía al proveedor (Anthropic, Estados Unidos) el texto de la conversación sin DNI, celular, correo
          ni número de contrato. Requiere cargar la clave del servicio en Supabase (ver README) y que la política de privacidad lo mencione.</p>
      </section>` : ''}`;
  },

  faq() {
    const lista = st.cat.faq;
    const motivoNombre = (cod) => st.cat.motivosTodos.find((m) => m.codigo === cod)?.nombre || cod;
    return `
      <section class="tarjeta">
        <div class="encabezado">
          <div><h2>Preguntas frecuentes</h2>
            <p>El bot las ofrece después de que el cliente elige el motivo. Si una le resuelve la duda, no hace falta que
            abra la consulta. Mostramos hasta 6 por motivo.</p></div>
          <button class="boton primario" type="button" data-admin="nueva-faq">Nueva pregunta</button>
        </div>
        ${lista.length ? `<div class="tabla-scroll"><table>
          <thead><tr><th>Pregunta</th><th>Motivo</th><th class="num">Vistas</th><th class="num">Le sirvió</th><th>Estado</th><th></th></tr></thead>
          <tbody>${lista.map((f) => `
            <tr class="${f.activo ? '' : 'de-baja'}">
              <td><b>${escapar(f.pregunta)}</b></td>
              <td>${f.motivo ? escapar(motivoNombre(f.motivo)) : 'Todos'}</td>
              <td class="num">${numero(f.vistas)}</td>
              <td class="num">${f.utiles + f.no_utiles ? `${Math.round((f.utiles / (f.utiles + f.no_utiles)) * 100)} %` : '—'}</td>
              <td>${f.activo ? 'Visible' : 'Oculta'}</td>
              <td><button class="texto-boton" type="button" data-admin="editar-faq" data-id="${f.id}">Editar</button></td>
            </tr>`).join('')}</tbody></table></div>`
          : '<p class="nadie">Todavía no hay preguntas frecuentes.</p>'}
      </section>`;
  },

  etiquetas() {
    return `
      <section class="tarjeta">
        <div class="encabezado">
          <div><h2>Etiquetas</h2>
            <p>Marcas libres para agrupar clientes y leads (por ejemplo, destino y año del viaje). Se usan en la ficha, el
            tablero de leads y los avisos por correo.</p></div>
          <button class="boton primario" type="button" data-admin="nueva-etiqueta">Nueva etiqueta</button>
        </div>
        <div class="etiquetas-admin">
          ${st.cat.etiquetas.map((e) => `<button type="button" class="etiqueta-editar" data-admin="editar-etiqueta" data-id="${e.id}">${chipEtiqueta(e)}<span>Editar</span></button>`).join('')
            || '<p class="nadie">Todavía no hay etiquetas.</p>'}
        </div>
      </section>`;
  },

  contratos() {
    const p = ad.padron;
    const imp = ad.importacion;
    return `
      <section class="tarjeta">
        <h2>Padrón de contratos</h2>
        <p>Con el padrón cargado, cuando un cliente escribe su número de contrato y el DNI del pasajero, el sistema los
        compara y marca el contrato como <b>verificado</b> automáticamente. Si no coinciden, el gestor lo verifica a mano en
        PAX Manager y lo marca desde la ficha.</p>
        <p class="resumen-padron">${p
          ? `<b>${numero(p.total)}</b> pasajeros en el padrón${p.actualizado ? ` · actualizado el ${fechaHora(p.actualizado)}` : ''}`
          : 'No se pudo leer el padrón.'}</p>
      </section>

      <section class="tarjeta">
        <h2>Importar desde PAX Manager</h2>
        <p>Exportá desde PAX Manager un listado en Excel o CSV con, al menos, el número de contrato y el DNI de cada pasajero.
        Las columnas de pasajero, colegio, curso y viaje son opcionales.</p>
        <label class="archivo-carga">
          <input type="file" id="archivo-padron" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel">
          <span class="boton">Elegir archivo</span>
          <span>${imp ? `${escapar(imp.nombre)}: ${numero(imp.filas.length)} filas` : 'Ningún archivo elegido'}</span>
        </label>
        ${imp ? mapeoImportacion(imp) : ''}
      </section>`;
  },

  registro() {
    const r = ad.registro;
    const tablas = Object.entries(NOMBRE_TABLA);
    return `
      <section class="tarjeta">
        <h2>Registro de cambios</h2>
        <p>Quién cambió qué en la configuración y en los datos de los clientes. Solo lo ven los administradores y no se puede borrar
        desde el panel.</p>
        <form class="filtros-vista" id="form-registro">
          <select class="control" name="tabla" aria-label="Sección">
            <option value="">Todas las secciones</option>
            ${tablas.map(([k, v]) => `<option value="${k}" ${r.tabla === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
          <label class="rango"><span>Desde</span><input class="control" type="date" name="desde" value="${r.desde}"></label>
        </form>
        ${r.filas?.length ? `<div class="tabla-scroll"><table class="tabla-registro">
          <thead><tr><th>Fecha</th><th>Quién</th><th>Qué</th><th>Detalle</th></tr></thead>
          <tbody>${r.filas.map((x) => `
            <tr><td class="nowrap">${fechaHora(x.created_at)}</td>
                <td>${escapar(x.actor_nombre || 'Sistema')}</td>
                <td><b>${escapar(NOMBRE_TABLA[x.tabla] || x.tabla)}</b><br><small>${escapar(NOMBRE_ACCION[x.accion] || x.accion)}</small></td>
                <td>${detalleCambio(x)}</td></tr>`).join('')}</tbody></table></div>
          ${r.filas.length >= 200 ? '<p class="ayuda-campo">Se muestran los últimos 200 cambios. Filtrá por sección o fecha para ver más atrás.</p>' : ''}`
          : '<p class="nadie">No hay cambios registrados con ese filtro.</p>'}
      </section>`;
  },

  demo() {
    return `
      <section class="tarjeta">
        <h2>Demostración</h2>
        <p>Borra las consultas y los cambios de prueba y vuelve a los datos iniciales.</p>
        <button class="boton peligro" type="button" data-admin="reiniciar-demo">Reiniciar la demostración</button>
      </section>`;
  },
};

// ---------------------------------------------------------------------
// Registro de cambios
// ---------------------------------------------------------------------

const NOMBRE_TABLA = {
  configuracion: 'Configuración', gestores: 'Personas', gestor_equipos: 'Integrantes de equipos', equipos: 'Equipos',
  motivos: 'Motivos', sucursales: 'Sucursales', feriados: 'Feriados', respuestas_rapidas: 'Respuestas rápidas',
  preguntas_frecuentes: 'Preguntas frecuentes', etiquetas: 'Etiquetas', cliente_etiquetas: 'Etiquetas de clientes',
  clientes: 'Clientes', contratos: 'Padrón de contratos',
};
const NOMBRE_ACCION = {
  INSERT: 'Alta', UPDATE: 'Cambio', DELETE: 'Baja', EDICION: 'Edición de datos', ETAPA: 'Cambio de etapa',
  VERIFICACION: 'Verificación de contrato', IMPORTACION: 'Importación',
};

function valorLegible(v) {
  if (v === null || v === undefined || v === '') return 'vacío';
  if (v === true) return 'sí';
  if (v === false) return 'no';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 90 ? `${t.slice(0, 90)}…` : t;
}

function detalleCambio(x) {
  const antes = x.antes || {};
  const despues = x.despues || {};
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    .filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
  if (!claves.length) return x.registro ? `<small>${escapar(x.registro)}</small>` : '';
  return `<ul class="cambios">${claves.slice(0, 8).map((k) => {
    const campo = k.replaceAll('_', ' ');
    if (x.accion === 'UPDATE' || (k in antes && k in despues)) {
      return `<li><b>${escapar(campo)}</b>: ${escapar(valorLegible(antes[k]))} → ${escapar(valorLegible(despues[k]))}</li>`;
    }
    return `<li><b>${escapar(campo)}</b>: ${escapar(valorLegible(k in despues ? despues[k] : antes[k]))}</li>`;
  }).join('')}${claves.length > 8 ? `<li>y ${claves.length - 8} campos más</li>` : ''}</ul>`;
}

async function cargarRegistro(pintar = true) {
  const r = ad.registro;
  const desde = r.desde ? new Date(`${r.desde}T00:00:00-03:00`).toISOString() : null;
  r.filas = (await intentar(() => api.auditoria({ tabla: r.tabla || null, desde, limite: 200 }))) || [];
  if (pintar) renderAdmin();
}

// ---------------------------------------------------------------------
// Importación del padrón
// ---------------------------------------------------------------------

const CAMPOS_PADRON = [
  { id: 'nro_contrato', nombre: 'N° de contrato', requerido: true, patron: /contrato|^n(ro|ú|u)?m?(ero)?\.?$|^nro|^n°/ },
  { id: 'dni_pasajero', nombre: 'DNI del pasajero', requerido: true, patron: /dni|documento|^doc/ },
  { id: 'pasajero', nombre: 'Pasajero', patron: /pasajero|nombre|apellido/ },
  { id: 'colegio', nombre: 'Colegio', patron: /colegio|escuela|instituci/ },
  { id: 'curso', nombre: 'Curso', patron: /curso|divisi|grado|a(n|ñ)o/ },
  { id: 'viaje', nombre: 'Viaje', patron: /viaje|destino|programa|paquete/ },
];
const MAX_FILAS_PADRON = 50000;

function adivinarMapa(columnas) {
  const usadas = new Set();
  const mapa = {};
  for (const campo of CAMPOS_PADRON) {
    const col = columnas.find((c) => !usadas.has(c) && campo.patron.test(normalizarTexto(c) || ''));
    if (col) { mapa[campo.id] = col; usadas.add(col); }
  }
  return mapa;
}

function filasMapeadas(imp) {
  return imp.filas.map((f) => Object.fromEntries(CAMPOS_PADRON
    .filter((c) => imp.mapa[c.id])
    .map((c) => [c.id, String(f[imp.mapa[c.id]] ?? '').trim()])));
}

const filaValida = (f) => f.nro_contrato && f.nro_contrato.length <= 40 && /^\d{7,9}$/.test(String(f.dni_pasajero || '').replace(/\D/g, ''));

function mapeoImportacion(imp) {
  const filas = filasMapeadas(imp);
  const validas = filas.filter(filaValida).length;
  const listo = imp.mapa.nro_contrato && imp.mapa.dni_pasajero;
  return `
    <form id="form-padron" class="padron-mapeo">
      <h3>1. ¿Qué columna es cada dato?</h3>
      <div class="form-grilla tres">
        ${CAMPOS_PADRON.map((c) => `
          <label class="campo"><span>${c.nombre}${c.requerido ? ' *' : ''}</span>
            <select name="${c.id}" data-mapa="${c.id}">
              <option value="">${c.requerido ? 'Elegí una columna' : 'No importar'}</option>
              ${imp.columnas.map((col) => `<option value="${escapar(col)}" ${imp.mapa[c.id] === col ? 'selected' : ''}>${escapar(col)}</option>`).join('')}
            </select></label>`).join('')}
      </div>
      <h3>2. Revisá las primeras filas</h3>
      ${listo ? `<div class="tabla-scroll"><table class="tabla-datos">
        <thead><tr>${CAMPOS_PADRON.filter((c) => imp.mapa[c.id]).map((c) => `<th>${c.nombre}</th>`).join('')}<th></th></tr></thead>
        <tbody>${filas.slice(0, 5).map((f) => `<tr>${CAMPOS_PADRON.filter((c) => imp.mapa[c.id]).map((c) => `<td>${escapar(f[c.id])}</td>`).join('')}
          <td>${filaValida(f) ? '✓' : '<span class="error-texto">No válida</span>'}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="resumen-padron"><b>${numero(validas)}</b> filas válidas de ${numero(filas.length)}${filas.length - validas
        ? ` · ${numero(filas.length - validas)} sin número de contrato o con DNI incorrecto (no se importan)` : ''}.</p>`
        : '<p class="advertencia">Elegí las columnas del número de contrato y del DNI para continuar.</p>'}
      <h3>3. Importar</h3>
      <label class="check-linea"><input type="checkbox" name="reemplazar">
        Reemplazar el padrón completo: borra los pasajeros que no estén en este archivo y quita la verificación automática de esos clientes.</label>
      <div class="pie-form">
        <button class="boton primario" type="submit" ${listo && validas ? '' : 'disabled'}>Importar ${numero(validas)} pasajeros</button>
        <button class="boton" type="button" data-admin="cancelar-importacion">Cancelar</button>
      </div>
    </form>`;
}

async function elegirArchivoPadron(archivo) {
  let filas;
  try {
    filas = await leerPlanilla(archivo);
  } catch (e) {
    console.error(e);
    toast('No se pudo leer el archivo. Probá guardarlo como .xlsx o .csv.', true);
    return;
  }
  if (!filas.length) {
    toast('El archivo no tiene filas con datos.', true);
    return;
  }
  if (filas.length > MAX_FILAS_PADRON) {
    toast(`El archivo tiene ${numero(filas.length)} filas; el máximo por importación es ${numero(MAX_FILAS_PADRON)}.`, true);
    return;
  }
  const columnas = Object.keys(filas[0]).filter((c) => c && !c.startsWith('__EMPTY'));
  ad.importacion = { nombre: archivo.name, filas, columnas, mapa: adivinarMapa(columnas) };
  renderAdmin();
}

async function importarPadron(f) {
  const imp = ad.importacion;
  const filas = filasMapeadas(imp).filter(filaValida);
  const reemplazar = f.reemplazar.checked;
  if (reemplazar && !(await confirmar('Reemplazar el padrón',
    `Quedan en el padrón solo los ${numero(filas.length)} pasajeros de este archivo. Los demás se borran.`,
    { aceptar: 'Reemplazar', peligro: true }))) return;
  const boton = f.querySelector('button[type=submit]');
  boton.disabled = true;
  boton.textContent = 'Importando…';
  const r = await intentar(() => api.importarContratos(filas, reemplazar));
  if (!r) {
    boton.disabled = false;
    boton.textContent = 'Importar';
    return;
  }
  ad.importacion = null;
  ad.padron = await intentar(() => api.resumenPadron());
  await renderAdmin();
  await dialogo({
    titulo: 'Padrón importado',
    cuerpo: `<ul class="resultado-importacion">
      <li><b>${numero(r.validas)}</b> pasajeros cargados o actualizados</li>
      ${r.invalidas ? `<li>${numero(r.invalidas)} filas no se importaron (sin número de contrato, DNI incorrecto o repetidas)</li>` : ''}
      ${r.eliminados ? `<li>${numero(r.eliminados)} pasajeros borrados del padrón</li>` : ''}
      <li><b>${numero(r.clientes_verificados)}</b> clientes quedaron con el contrato verificado</li>
      ${r.verificaciones_quitadas ? `<li>${numero(r.verificaciones_quitadas)} clientes perdieron la verificación automática</li>` : ''}
      <li>Total en el padrón: ${numero(r.total_padron)}</li></ul>`,
    botones: [{ valor: 'ok', texto: 'Listo', primario: true }],
  });
}

// ---------------------------------------------------------------------
// Vistas previas que se actualizan mientras se escribe
// ---------------------------------------------------------------------

function actualizarVistasPrevias() {
  const fh = $('#form-horario');
  if (fh) {
    const dias = [...fh.querySelectorAll('input[name=dia]:checked')].map((i) => Number(i.value));
    $('#vista-horario').innerHTML = dias.length && fh.hora_inicio.value && fh.hora_fin.value
      ? `El chat va a decir: <b>“Te respondemos ${escapar(textoHorario({ dias_habiles: dias, hora_inicio: fh.hora_inicio.value, hora_fin: fh.hora_fin.value }))}”</b>`
      : 'Elegí al menos un día y el horario.';
  }
  const ft = $('#form-textos');
  if (ft) {
    const url = ft.politica_privacidad_url.value.trim();
    $('#simulador-hilo').innerHTML = `
      <div class="globo-bot">${escapar(ft.texto_bienvenida.value)}</div>
      <div class="globo-bot">Te hago unas preguntas cortas y te paso con la persona indicada.</div>
      <div class="globo-bot">${escapar(ft.texto_privacidad.value)}\n<a href="${escapar(url || '../privacidad/')}" target="_blank" rel="noopener">Ver la política de privacidad</a></div>
      <span class="boton-sim">Acepto y sigo</span>`;
  }
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------

$('#vista-admin').addEventListener('input', (e) => {
  if (e.target.closest('#form-horario, #form-textos')) actualizarVistasPrevias();
});

$('#vista-admin').addEventListener('click', async (e) => {
  const sec = e.target.closest('[data-seccion]');
  if (sec) {
    ad.seccion = sec.dataset.seccion;
    if (ad.seccion === 'contratos') ad.padron = null;
    if (ad.seccion === 'registro') ad.registro.filas = null;
    renderAdmin();
    return;
  }
  const b = e.target.closest('[data-admin]');
  if (!b || b.disabled) return;
  const accion = b.dataset.admin;
  const cat = st.cat;

  if (accion === 'habilitar-solicitud') {
    const x = (cat.solicitudes || []).find((y) => y.id === b.dataset.id);
    if (x) editarGestor(null, { nombre: x.nombre || '', email: x.email });
  }
  if (accion === 'rechazar-solicitud') {
    const x = (cat.solicitudes || []).find((y) => y.id === b.dataset.id);
    if (x && await confirmar('Rechazar solicitud', `${escapar(x.nombre || x.email)} no va a poder ingresar al panel.`, { aceptar: 'Rechazar', peligro: true })
      && await intentar(() => api.rechazarSolicitud(x.id), 'Solicitud rechazada')) {
      await cargarCatalogos();
      renderAdmin();
    }
  }
  if (accion === 'nuevo-gestor') editarGestor(null);
  if (accion === 'editar-gestor') editarGestor(cat.gestores.find((g) => g.id === b.dataset.id));
  if (accion === 'nuevo-equipo') editarEquipo(null);
  if (accion === 'editar-equipo') editarEquipo(cat.equipos.find((x) => x.id === Number(b.dataset.id)));
  if (accion === 'nuevo-motivo') editarMotivo(null);
  if (accion === 'editar-motivo') editarMotivo(cat.motivosTodos.find((m) => m.codigo === b.dataset.codigo));
  if (accion === 'nueva-respuesta') editarRespuesta(null);
  if (accion === 'editar-respuesta') editarRespuesta(cat.respuestas.find((r) => r.id === b.dataset.id));
  if (accion === 'nueva-faq') editarFaq(null);
  if (accion === 'editar-faq') editarFaq(cat.faq.find((f) => f.id === b.dataset.id));
  if (accion === 'nueva-etiqueta') editarEtiqueta(null);
  if (accion === 'editar-etiqueta') editarEtiqueta(cat.etiquetas.find((x) => x.id === Number(b.dataset.id)));
  if (accion === 'cancelar-importacion') { ad.importacion = null; renderAdmin(); }

  if (accion === 'subir-motivo' || accion === 'bajar-motivo') {
    const lista = [...cat.motivosTodos];
    const i = lista.findIndex((m) => m.codigo === b.dataset.codigo);
    const j = accion === 'subir-motivo' ? i - 1 : i + 1;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    const cambios = lista.map((m, k) => ({ m, orden: k + 1 })).filter(({ m, orden }) => m.orden !== orden);
    const r = await intentar(async () => {
      for (const { m, orden } of cambios) await api.guardarMotivo(m.codigo, { orden });
    });
    if (r) renderAdmin();
  }

  if (accion === 'eliminar-sucursal') {
    const s = cat.sucursalesTodas.find((x) => x.id === Number(b.dataset.id));
    if (b.classList.contains('confirmar')) {
      if (await intentar(() => api.eliminarSucursal(s.id), `Sucursal ${s.nombre} eliminada`)) renderAdmin();
    } else {
      b.classList.add('confirmar');
      b.textContent = '¿Eliminar?';
    }
  }

  if (accion === 'eliminar-feriado') {
    if (await intentar(() => api.eliminarFeriado(b.dataset.fecha), 'Feriado quitado')) renderAdmin();
  }

  if (accion === 'restablecer-textos') {
    const f = $('#form-textos');
    f.texto_bienvenida.value = TEXTOS_POR_DEFECTO.texto_bienvenida;
    f.texto_privacidad.value = TEXTOS_POR_DEFECTO.texto_privacidad;
    actualizarVistasPrevias();
    toast('Textos originales cargados. Guardá para aplicarlos.');
  }

  if (accion === 'reiniciar-demo') {
    api.reiniciarDemo();
    location.reload();
  }
});

$('#vista-admin').addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.sucursalNombre || t.dataset.sucursalActiva) {
    const id = Number(t.dataset.sucursalNombre || t.dataset.sucursalActiva);
    const nombre = $(`[data-sucursal-nombre="${id}"]`).value.trim();
    const activo = $(`[data-sucursal-activa="${id}"]`).checked;
    if (nombre.length < 2) {
      toast('Escribí el nombre de la sucursal', true);
      return;
    }
    if (await intentar(() => api.guardarSucursal({ id, nombre, activo }), 'Sucursal guardada')) renderAdmin();
  }
  if (t.id === 'archivo-padron' && t.files?.[0]) {
    await elegirArchivoPadron(t.files[0]);
  }
  if (t.dataset.mapa && ad.importacion) {
    ad.importacion.mapa[t.dataset.mapa] = t.value || undefined;
    renderAdmin();
  }
  if (t.closest('#form-registro')) {
    const f = t.closest('#form-registro');
    ad.registro.tabla = f.tabla.value;
    ad.registro.desde = f.desde.value;
    await cargarRegistro();
  }
  if (t.name === 'ia_habilitada' && CONFIG.IA_DISPONIBLE) {
    const valor = t.checked;
    if (await intentar(() => api.guardarConfig({ ia_habilitada: valor }),
      valor ? 'Sugerencias con IA activadas' : 'Sugerencias con IA desactivadas')) renderAdmin();
    else t.checked = !valor;
  }
});

$('#vista-admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;

  if (f.id === 'form-horario') {
    const dias = [...f.querySelectorAll('input[name=dia]:checked')].map((i) => Number(i.value));
    if (!dias.length) {
      toast('Elegí al menos un día de atención', true);
      return;
    }
    if (f.hora_fin.value <= f.hora_inicio.value) {
      toast('La hora de cierre tiene que ser posterior a la de inicio', true);
      return;
    }
    if (await intentar(() => api.guardarConfig({
      dias_habiles: dias, hora_inicio: f.hora_inicio.value, hora_fin: f.hora_fin.value,
      minutos_alerta: Number(f.minutos_alerta.value), dias_mismo_gestor: Number(f.dias_mismo_gestor.value),
      minutos_reasignar: Number(f.minutos_reasignar.value), max_abiertas_por_gestor: Number(f.max_abiertas_por_gestor.value),
    }), 'Horario y reparto guardados')) renderAdmin();
  }

  if (f.id === 'form-feriado') {
    if (await intentar(() => api.agregarFeriado({ fecha: f.fecha.value, descripcion: f.descripcion.value }), 'Feriado agregado')) renderAdmin();
  }

  if (f.id === 'form-sucursal') {
    if (await intentar(() => api.guardarSucursal({ nombre: f.nombre.value.trim() }), 'Sucursal agregada')) renderAdmin();
  }

  if (f.id === 'form-textos') {
    if (await intentar(() => api.guardarConfig({
      texto_bienvenida: f.texto_bienvenida.value.trim(),
      texto_privacidad: f.texto_privacidad.value.trim(),
      politica_privacidad_url: f.politica_privacidad_url.value.trim() || null,
    }), 'Textos guardados: el chat ya los muestra')) renderAdmin();
  }

  if (f.id === 'form-padron') await importarPadron(f);
});

// ---------------------------------------------------------------------
// Diálogos de administración
// ---------------------------------------------------------------------

function editarGestor(g, previo = null) {
  const dlg = $('#dlg-gestor');
  const f = $('#form-gestor');
  $('#dlg-gestor-titulo').textContent = g ? `Editar a ${g.nombre}` : 'Agregar persona';
  $('#gestor-ayuda-email').hidden = !g;
  f.nombre.value = g?.nombre || previo?.nombre || '';
  f.email.value = g?.email || previo?.email || '';
  f.rol.value = g?.rol || 'gestor';
  f.activo.checked = g ? g.activo : true;
  f.disponible.checked = g ? g.disponible !== false : true;
  $('#gestor-equipos').innerHTML = st.cat.equipos.map((e) => `
    <label><input type="checkbox" value="${e.id}" ${g?.equipos.includes(e.id) ? 'checked' : ''}> ${escapar(e.nombre)}</label>`).join('');
  const abiertas = g ? abiertasDe(g.id) : 0;
  const repartir = $('#gestor-repartir');
  repartir.hidden = !abiertas;
  repartir.textContent = `Repartir sus ${abiertas} consulta${abiertas === 1 ? '' : 's'} abierta${abiertas === 1 ? '' : 's'}`;
  repartir.onclick = async () => {
    const r = await intentar(() => api.repartir(g.id),
      (x) => `${x.reasignadas} reasignada${x.reasignadas === 1 ? '' : 's'}${x.en_fila ? `, ${x.en_fila} en fila` : ''}`);
    if (r) {
      repartir.hidden = true;
      st.convs = st.convs.map((c) => (c.gestor_id === g.id && c.estado === 'abierta' ? { ...c, gestor_id: null } : c));
    }
  };
  prepararEliminar(dlg, Boolean(g) && g.id !== st.yo.id);
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue === 'eliminar') {
      if (await intentar(() => api.eliminarGestor(g.id), `Se eliminó a ${g.nombre} del panel`)) renderAdmin();
      return;
    }
    if (dlg.returnValue !== 'ok') return;
    const equipos = [...$('#gestor-equipos').querySelectorAll('input:checked')].map((i) => Number(i.value));
    const r = await intentar(() => api.guardarGestor({
      id: g?.id, email: f.email.value.trim().toLowerCase(), nombre: f.nombre.value.trim(),
      rol: f.rol.value, activo: f.activo.checked, disponible: f.disponible.checked, equipos,
    }), g ? 'Cambios guardados' : 'Persona agregada. Ya puede ingresar con su cuenta de Google.');
    if (r) {
      if (previo) await cargarCatalogos();   // la solicitud pasó a aprobada
      renderAdmin();
    }
  };
}

function editarEquipo(eq) {
  const dlg = $('#dlg-equipo');
  const f = $('#form-equipo');
  $('#dlg-equipo-titulo').textContent = eq ? `Editar equipo ${eq.nombre}` : 'Nuevo equipo';
  f.nombre.value = eq?.nombre || '';
  const personas = st.cat.gestores.filter((g) => g.activo).sort((a, b) => a.nombre.localeCompare(b.nombre));
  $('#equipo-integrantes').innerHTML = personas.map((g) => `
    <label><input type="checkbox" value="${g.id}" ${eq && g.equipos.includes(eq.id) ? 'checked' : ''}>
      <span>${escapar(g.nombre)} <small>${ROL[g.rol]}${g.disponible ? '' : ', ausente'}</small></span></label>`).join('')
    || '<span class="nadie">Primero agregá personas en la sección Personas.</span>';
  prepararEliminar(dlg, Boolean(eq));
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue === 'eliminar') {
      if (await intentar(() => api.eliminarEquipo(eq.id), `Equipo ${eq.nombre} eliminado`)) renderAdmin();
      return;
    }
    if (dlg.returnValue !== 'ok') return;
    const integrantes = [...$('#equipo-integrantes').querySelectorAll('input:checked')].map((i) => i.value);
    const r = await intentar(() => api.guardarEquipo({ id: eq?.id, nombre: f.nombre.value, integrantes }),
      eq ? 'Equipo actualizado' : 'Equipo creado');
    if (r) renderAdmin();
  };
}

const muestrasColor = (actual) => PALETA.map(([c, nombre]) => `
  <label title="${nombre}"><input type="radio" name="color" value="${c}" ${c === actual ? 'checked' : ''} aria-label="${nombre}"><span style="--c:${c}"></span></label>`).join('');

function editarMotivo(m) {
  const dlg = $('#dlg-motivo');
  const f = $('#form-motivo');
  $('#dlg-motivo-titulo').textContent = m ? `Editar motivo ${m.nombre}` : 'Nuevo motivo';
  f.nombre.value = m?.nombre || '';
  f.equipo_id.innerHTML = `<option value="">Elegí un equipo</option>${st.cat.equipos
    .map((e) => `<option value="${e.id}" ${m?.equipo_id === e.id ? 'selected' : ''}>${escapar(e.nombre)}</option>`).join('')}`;
  f.disponible_para.value = m?.disponible_para || 'todos';
  f.activo.checked = m ? m.activo : true;
  $('#motivo-colores').innerHTML = muestrasColor(m?.color || PALETA[0][0]);
  if (!f.querySelector('input[name=color]:checked')) f.querySelector('input[name=color]').checked = true;
  prepararEliminar(dlg, Boolean(m));
  dlg.returnValue = '';
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue === 'eliminar') {
      if (await intentar(() => api.eliminarMotivo(m.codigo), `Motivo ${m.nombre} eliminado`)) renderAdmin();
      return;
    }
    if (dlg.returnValue !== 'ok') return;
    const datos = {
      nombre: f.nombre.value.trim(),
      equipo_id: Number(f.equipo_id.value),
      disponible_para: f.disponible_para.value,
      color: f.querySelector('input[name=color]:checked').value,
      activo: f.activo.checked,
    };
    const r = await intentar(() => api.guardarMotivo(m?.codigo || null, datos), m ? 'Motivo actualizado' : 'Motivo agregado al chat');
    if (r) renderAdmin();
  };
}

async function editarRespuesta(r) {
  const { valor, form } = await dialogo({
    titulo: r ? 'Editar respuesta rápida' : 'Nueva respuesta rápida',
    ancho: 560,
    eliminar: r ? 'Eliminar' : null,
    cuerpo: `
      <label class="campo"><span>Título (para buscarla)</span><input name="titulo" required minlength="2" maxlength="60" placeholder="Ej.: Pedir comprobante"></label>
      <label class="campo"><span>Texto</span><textarea name="texto" required maxlength="2000" rows="6"></textarea></label>
      <p class="ayuda-campo">Variables: {nombre} del cliente, {gestor} que responde, {contrato}, {colegio} y {curso}.</p>
      <label class="campo"><span>Para qué equipo</span><select name="equipo_id">
        <option value="">Todos los equipos</option>
        ${st.cat.equipos.map((e) => `<option value="${e.id}">${escapar(e.nombre)}</option>`).join('')}
      </select></label>
      <div class="checks"><label><input type="checkbox" name="activo" checked> Activa</label></div>`,
    botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: 'Guardar', primario: true }],
    alAbrir: (f) => {
      f.titulo.value = r?.titulo || '';
      f.texto.value = r?.texto || '';
      f.equipo_id.value = r?.equipo_id || '';
      f.activo.checked = r ? r.activo : true;
    },
  });
  if (valor === 'eliminar') {
    if (await intentar(() => api.eliminarRespuesta(r.id), 'Respuesta eliminada')) renderAdmin();
    return;
  }
  if (valor !== 'ok') return;
  if (await intentar(() => api.guardarRespuesta({
    id: r?.id, titulo: form.titulo.value.trim(), texto: form.texto.value.trim(),
    equipo_id: form.equipo_id.value ? Number(form.equipo_id.value) : null, activo: form.activo.checked,
  }), r ? 'Respuesta actualizada' : 'Respuesta agregada')) renderAdmin();
}

async function editarFaq(p) {
  const { valor, form } = await dialogo({
    titulo: p ? 'Editar pregunta frecuente' : 'Nueva pregunta frecuente',
    ancho: 560,
    eliminar: p ? 'Eliminar' : null,
    cuerpo: `
      <label class="campo"><span>Pregunta (como la lee el cliente)</span><input name="pregunta" required minlength="5" maxlength="200"></label>
      <label class="campo"><span>Respuesta</span><textarea name="respuesta" required minlength="5" maxlength="2000" rows="6"></textarea></label>
      <p class="ayuda-campo">Podés incluir enlaces completos (https://…). No pongas montos ni fechas que cambien seguido.</p>
      <label class="campo"><span>Se muestra con el motivo</span><select name="motivo">
        <option value="">Todos los motivos</option>
        ${st.cat.motivosTodos.map((m) => `<option value="${escapar(m.codigo)}">${escapar(m.nombre)}</option>`).join('')}
      </select></label>
      <div class="checks"><label><input type="checkbox" name="activo" checked> Visible en el chat</label></div>`,
    botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: 'Guardar', primario: true }],
    alAbrir: (f) => {
      f.pregunta.value = p?.pregunta || '';
      f.respuesta.value = p?.respuesta || '';
      f.motivo.value = p?.motivo || '';
      f.activo.checked = p ? p.activo : true;
    },
  });
  if (valor === 'eliminar') {
    if (await intentar(() => api.eliminarFaq(p.id), 'Pregunta eliminada')) renderAdmin();
    return;
  }
  if (valor !== 'ok') return;
  if (await intentar(() => api.guardarFaq({
    id: p?.id, pregunta: form.pregunta.value.trim(), respuesta: form.respuesta.value.trim(),
    motivo: form.motivo.value || null, activo: form.activo.checked,
  }), p ? 'Pregunta actualizada' : 'Pregunta agregada al chat')) renderAdmin();
}

async function editarEtiqueta(et) {
  const { valor, form } = await dialogo({
    titulo: et ? `Editar etiqueta ${et.nombre}` : 'Nueva etiqueta',
    eliminar: et ? 'Eliminar' : null,
    cuerpo: `
      <label class="campo"><span>Nombre</span><input name="nombre" required minlength="2" maxlength="40" placeholder="Ej.: Bariloche 2027"></label>
      <fieldset class="campo" style="border:0;padding:0;margin:0"><span>Color</span><div class="muestras">${muestrasColor(et?.color || PALETA[0][0])}</div></fieldset>
      ${et ? '<p class="ayuda-campo">Si la eliminás, se quita de todos los clientes que la tengan.</p>' : ''}`,
    botones: [{ valor: 'cancelar', texto: 'Cancelar' }, { valor: 'ok', texto: 'Guardar', primario: true }],
    alAbrir: (f) => { f.nombre.value = et?.nombre || ''; },
  });
  if (valor === 'eliminar') {
    if (await intentar(() => api.eliminarEtiqueta(et.id), 'Etiqueta eliminada')) renderAdmin();
    return;
  }
  if (valor !== 'ok') return;
  if (await intentar(() => api.guardarEtiqueta({
    id: et?.id, nombre: form.nombre.value.trim(), color: form.querySelector('input[name=color]:checked').value,
  }), et ? 'Etiqueta actualizada' : 'Etiqueta creada')) renderAdmin();
}
