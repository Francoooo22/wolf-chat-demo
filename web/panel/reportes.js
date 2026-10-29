// Panel — Reportes (supervisores y administradores).
// Gráficos hechos a mano en SVG/HTML, sin librerías: una serie por gráfico,
// marcas finas, grilla tenue, tooltip al pasar el mouse o con el teclado y
// los mismos datos disponibles como tabla.
import { api, st, registrarVista, intentar, hoyISO, sumarDias, numero, toast } from './comun.js';
import { $, escapar, ETAPAS, nombreEtapa, ICONOS, descargarExcel } from '../js/util.js';

const r = { periodo: '30', desde: null, hasta: null, datos: null };
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
// Rampa secuencial azul (claro → oscuro) para el mapa de calor.
const RAMPA = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

registrarVista('reportes', { mostrar: cargar });

const cont = () => $('#vista-reportes');

function rango() {
  const hoy = hoyISO();
  if (r.periodo === '7') return [sumarDias(hoy, -6), hoy];
  if (r.periodo === '30') return [sumarDias(hoy, -29), hoy];
  if (r.periodo === '90') return [sumarDias(hoy, -89), hoy];
  if (r.periodo === 'mes') return [`${hoy.slice(0, 8)}01`, hoy];
  if (r.periodo === 'mes-anterior') {
    const fin = sumarDias(`${hoy.slice(0, 8)}01`, -1);
    return [`${fin.slice(0, 8)}01`, fin];
  }
  return [r.desde || sumarDias(hoy, -29), r.hasta || hoy];
}

async function cargar() {
  if (!cont().dataset.armado) armar();
  const [desde, hasta] = rango();
  r.desde = desde;
  r.hasta = hasta;
  $('#rep-desde').value = desde;
  $('#rep-hasta').value = hasta;
  $('#rep-contenido').classList.add('recargando');   // mantiene el dibujo anterior mientras carga
  const datos = await intentar(() => api.reporte(desde, hasta));
  $('#rep-contenido').classList.remove('recargando');
  if (!datos) return;
  r.datos = datos;
  pintar();
}

function armar() {
  cont().dataset.armado = '1';
  cont().innerHTML = `
    <div class="vista-cab">
      <div>
        <h1>Reportes</h1>
        <p>Los tiempos de respuesta se cuentan en minutos hábiles: solo dentro del horario de atención y sin feriados.</p>
      </div>
      <div class="vista-acciones">
        <button class="boton" type="button" data-exportar="consultas">Excel de consultas</button>
        <button class="boton" type="button" data-exportar="clientes">Excel de clientes</button>
      </div>
    </div>
    <div class="filtros-vista">
      <select class="control" id="rep-periodo" aria-label="Período">
        <option value="7">Últimos 7 días</option>
        <option value="30" selected>Últimos 30 días</option>
        <option value="90">Últimos 90 días</option>
        <option value="mes">Este mes</option>
        <option value="mes-anterior">Mes anterior</option>
        <option value="personalizado">Personalizado</option>
      </select>
      <label class="rango"><span>Desde</span><input class="control" type="date" id="rep-desde"></label>
      <label class="rango"><span>Hasta</span><input class="control" type="date" id="rep-hasta"></label>
    </div>
    <div id="rep-contenido" class="reporte"></div>
    <div class="viz-tip" id="viz-tip" role="tooltip" hidden><b></b><span></span></div>`;

  $('#rep-periodo').addEventListener('change', (e) => { r.periodo = e.target.value; cargar(); });
  const cambioFecha = () => {
    r.periodo = 'personalizado';
    $('#rep-periodo').value = 'personalizado';
    r.desde = $('#rep-desde').value;
    r.hasta = $('#rep-hasta').value;
    if (r.desde && r.hasta && r.desde <= r.hasta) cargar();
  };
  $('#rep-desde').addEventListener('change', cambioFecha);
  $('#rep-hasta').addEventListener('change', cambioFecha);
  cont().addEventListener('click', (e) => {
    const b = e.target.closest('[data-exportar]');
    if (b) exportar(b.dataset.exportar, b);
  });

  // Tooltip compartido: el valor primero, la etiqueta después. Solo textContent.
  const tip = $('#viz-tip');
  const mostrar = (el, x, y) => {
    tip.querySelector('b').textContent = el.dataset.tipValor;
    tip.querySelector('span').textContent = el.dataset.tipEtiqueta;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    tip.style.top = `${Math.max(8, y - tip.offsetHeight - 12)}px`;
  };
  cont().addEventListener('pointermove', (e) => {
    const el = e.target.closest('[data-tip-valor]');
    if (el) mostrar(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  cont().addEventListener('pointerleave', () => { tip.hidden = true; });
  cont().addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip-valor]');
    if (!el) return;
    const rc = el.getBoundingClientRect();
    mostrar(el, rc.left + rc.width / 2, rc.top);
  });
  cont().addEventListener('focusout', () => { tip.hidden = true; });
  cont().addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

  new ResizeObserver(() => { if (r.datos) pintarDias(); }).observe(cont());
}

const tipAttr = (valor, etiqueta) => `data-tip-valor="${escapar(valor)}" data-tip-etiqueta="${escapar(etiqueta)}"`;
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
const minutos = (m) => (m == null ? '—' : `${numero(m, m < 10 ? 1 : 0)} min`);
const fechaDM = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function pintar() {
  const d = r.datos;
  const t = d.totales;
  const embudo = d.embudo;
  const contratados = embudo.por_etapa?.contratado || 0;

  $('#rep-contenido').innerHTML = `
    <div class="kpis">
      ${tile('Consultas', numero(t.consultas), `${numero(t.fuera_de_horario)} fuera de horario (${pct(t.fuera_de_horario, t.consultas)})`)}
      ${tile('Primera respuesta (mediana)', minutos(t.mediana_respuesta),
        `${pct(t.en_objetivo, t.respondidas)} dentro del objetivo de ${d.objetivo_minutos} min`)}
      ${tile('Respondidas', pct(t.respondidas, t.consultas), `${numero(t.respondidas)} de ${numero(t.consultas)} · ${numero(t.resueltas)} resueltas`)}
      ${tile('Calificación', t.csat_promedio == null ? '—' : `${numero(t.csat_promedio, 1)} / 5`,
        t.csat_respuestas ? `${numero(t.csat_respuestas)} respuestas a la encuesta` : 'Todavía sin respuestas')}
      ${tile('Conversión de leads', pct(contratados, embudo.nuevos), `${numero(contratados)} contratados de ${numero(embudo.nuevos)} contactos nuevos`)}
    </div>

    <div class="ahora">
      <span>Ahora:</span>
      <b>${numero(d.ahora.abiertas)}</b> abiertas ·
      <b>${numero(d.ahora.en_fila)}</b> en fila ·
      ${d.ahora.con_demora
        ? `<span class="chip alerta">${ICONOS.reloj}${numero(d.ahora.con_demora)} con demora</span>`
        : '<span class="chip ok">Sin demoras</span>'}
    </div>

    <section class="tarjeta viz">
      <h2>Consultas por ${dias(r.desde, r.hasta) > 62 ? 'semana' : 'día'}</h2>
      <div class="grafico" id="rep-dias"></div>
      <details class="ver-tabla"><summary>Ver como tabla</summary><div id="rep-dias-tabla"></div></details>
    </section>

    <div class="viz-dos">
      <section class="tarjeta viz">
        <h2>Por motivo</h2>
        ${barras(d.por_motivo.map((m) => ({
          etiqueta: `<span class="punto-motivo" style="--c:${escapar(m.color || '#77757f')}"></span>${escapar(m.nombre || m.motivo)}`,
          texto: m.nombre || m.motivo, valor: m.consultas,
          tip: `${numero(m.consultas)} consultas (${pct(m.consultas, t.consultas)})`,
        })), 'Sin consultas en el período.')}
      </section>
      <section class="tarjeta viz">
        <h2>Contactos nuevos del período, por etapa actual</h2>
        ${barras(ETAPAS.map((e) => ({
          etiqueta: escapar(e.nombre), texto: e.nombre, valor: embudo.por_etapa?.[e.id] || 0,
          tip: `${numero(embudo.por_etapa?.[e.id] || 0)} contactos (${pct(embudo.por_etapa?.[e.id] || 0, embudo.nuevos)})`,
        })), 'Sin contactos nuevos en el período.', embudo.nuevos)}
      </section>
    </div>

    <section class="tarjeta viz">
      <h2>¿Cuándo escriben?</h2>
      <p class="viz-nota">Consultas por día de la semana y hora de llegada. Atienden ${escapar(st.cat.config.texto_horario)}.</p>
      ${mapaCalor(d.por_franja)}
    </section>

    <section class="tarjeta">
      <h2>Por gestor</h2>
      ${tabla(['Gestor', 'Asignadas', 'Respondidas', 'Resueltas', 'Mediana 1ª respuesta', 'Calificación'],
        d.por_gestor.map((g) => [escapar(g.nombre), numero(g.asignadas), numero(g.respondidas), numero(g.resueltas),
          minutos(g.mediana_respuesta), g.csat_promedio == null ? '—' : `${numero(g.csat_promedio, 1)} (${g.csat_respuestas})`]),
        'Sin consultas asignadas en el período.')}
    </section>

    <div class="viz-dos">
      <section class="tarjeta">
        <h2>Colegios con más consultas</h2>
        ${tabla(['Colegio', 'Consultas', 'Contactos', 'Contratados'],
          d.por_colegio.map((c) => [escapar(c.colegio), numero(c.consultas), numero(c.clientes), numero(c.contratados)]),
          'Sin datos de colegio en el período.')}
        <p class="viz-nota">Los nombres se agrupan sin tildes ni mayúsculas; se muestra la forma más usada.</p>
      </section>
      <section class="tarjeta">
        <h2>Preguntas frecuentes</h2>
        ${tabla(['Pregunta', 'Vistas', 'Le sirvió', 'No le sirvió'],
          d.faq.map((f) => [escapar(f.pregunta), numero(f.vistas), `${numero(f.utiles)} (${pct(f.utiles, f.utiles + f.no_utiles)})`, numero(f.no_utiles)]),
          'Todavía no hay preguntas frecuentes cargadas.')}
        <p class="viz-nota">Totales desde que se cargó cada pregunta (no dependen del período).</p>
      </section>
    </div>`;
  pintarDias();
}

function tile(etiqueta, valor, detalle) {
  return `<div class="kpi"><span class="kpi-etiqueta">${escapar(etiqueta)}</span><b class="kpi-valor">${escapar(valor)}</b><span class="kpi-detalle">${escapar(detalle)}</span></div>`;
}

const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;

// Serie continua (completa los días sin consultas). Más de 62 días: por semana (desde el lunes).
function serieTemporal() {
  const porFecha = new Map(r.datos.por_dia.map((x) => [x.fecha.slice(0, 10), x.consultas]));
  const puntos = [];
  for (let f = r.desde; f <= r.hasta; f = sumarDias(f, 1)) puntos.push({ fecha: f, valor: porFecha.get(f) || 0 });
  if (dias(r.desde, r.hasta) <= 62) {
    return puntos.map((p) => ({ ...p, etiqueta: fechaDM(p.fecha), largo: fechaLarga(p.fecha) }));
  }
  const semanas = new Map();
  for (const p of puntos) {
    const dow = (new Date(`${p.fecha}T12:00:00Z`).getUTCDay() + 6) % 7;
    const lunes = sumarDias(p.fecha, -dow);
    semanas.set(lunes, (semanas.get(lunes) || 0) + p.valor);
  }
  return [...semanas].map(([lunes, valor]) => ({
    fecha: lunes, valor, etiqueta: fechaDM(lunes), largo: `Semana del ${fechaDM(lunes)} al ${fechaDM(sumarDias(lunes, 6))}`,
  }));
}

function fechaLarga(iso) {
  const t = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${iso}T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function maximoLindo(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function pintarDias() {
  const caja = $('#rep-dias');
  if (!caja) return;
  const serie = serieTemporal();
  const W = Math.max(300, caja.clientWidth);
  const H = 220;
  const m = { izq: 36, der: 8, arr: 14, aba: 26 };
  const ancho = W - m.izq - m.der;
  const alto = H - m.arr - m.aba;
  const max = maximoLindo(Math.max(1, ...serie.map((p) => p.valor)));
  const banda = ancho / serie.length;
  const grosor = Math.max(2, Math.min(24, banda * 0.66));
  const y = (v) => m.arr + alto - (v / max) * alto;
  const cada = Math.ceil(serie.length / Math.max(2, Math.floor(ancho / 56)));

  const ticks = [0, max / 2, max];
  const grilla = ticks.map((t) => `
    <line x1="${m.izq}" x2="${W - m.der}" y1="${y(t)}" y2="${y(t)}" class="grilla"/>
    <text x="${m.izq - 8}" y="${y(t) + 4}" text-anchor="end" class="eje">${numero(t)}</text>`).join('');

  const marcas = serie.map((p, i) => {
    const cx = m.izq + banda * i + banda / 2;
    const x = cx - grosor / 2;
    const h = (p.valor / max) * alto;
    const r0 = Math.min(4, h, grosor / 2);
    const top = y(p.valor);
    const base = m.arr + alto;
    const barra = h > 0
      ? `<path class="barra" d="M${x},${base} V${top + r0} Q${x},${top} ${x + r0},${top} H${x + grosor - r0} Q${x + grosor},${top} ${x + grosor},${top + r0} V${base} Z"/>`
      : '';
    const etiqueta = i % cada === 0 ? `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="eje">${p.etiqueta}</text>` : '';
    return `<g class="marca" tabindex="0" ${tipAttr(`${numero(p.valor)} ${p.valor === 1 ? 'consulta' : 'consultas'}`, p.largo)}>
      <rect x="${m.izq + banda * i}" y="${m.arr}" width="${banda}" height="${alto}" class="hit"/>${barra}</g>${etiqueta}`;
  }).join('');

  caja.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Consultas por ${dias(r.desde, r.hasta) > 62 ? 'semana' : 'día'}: total ${numero(serie.reduce((a, p) => a + p.valor, 0))}">
      ${grilla}
      <line x1="${m.izq}" x2="${W - m.der}" y1="${m.arr + alto}" y2="${m.arr + alto}" class="base"/>
      ${marcas}
    </svg>`;
  $('#rep-dias-tabla').innerHTML = tabla(['Fecha', 'Consultas'], serie.map((p) => [escapar(p.largo), numero(p.valor)]), '');
}

// Barras horizontales: una sola serie, un solo color; la etiqueta lleva la identidad.
function barras(items, vacio, total = null) {
  const max = Math.max(...items.map((i) => i.valor), 0);
  if (!max) return `<p class="nadie">${vacio}</p>`;
  return `
    <div class="barras-h" role="list">
      ${items.map((i) => `
        <div class="bh-fila" role="listitem" tabindex="0" ${tipAttr(i.tip, i.texto)}>
          <span class="bh-etiqueta">${i.etiqueta}</span>
          <span class="bh-pista"><span class="bh-barra ${i.valor ? '' : 'cero'}" style="width:${(i.valor / max) * 100}%"></span></span>
          <span class="bh-valor">${numero(i.valor)}</span>
        </div>`).join('')}
    </div>
    ${total != null ? `<p class="viz-nota">Total: ${numero(total)}</p>` : ''}`;
}

function mapaCalor(franjas) {
  const valor = new Map(franjas.map((f) => [`${f.dia}-${f.hora}`, f.consultas]));
  const max = Math.max(0, ...franjas.map((f) => f.consultas));
  if (!max) return '<p class="nadie">Sin consultas en el período.</p>';
  const color = (v) => (v ? RAMPA[Math.min(RAMPA.length - 1, Math.floor((v / max) * RAMPA.length - 1e-9))] : null);
  const horas = Array.from({ length: 24 }, (_, h) => h);
  return `
    <div class="calor-scroll">
      <div class="calor" role="table" aria-label="Consultas por día y hora">
        <span></span>${horas.map((h) => `<span class="calor-hora">${h % 3 === 0 ? `${h} h` : ''}</span>`).join('')}
        ${DIAS.map((dia, i) => `
          <span class="calor-dia">${DIAS_CORTOS[i]}</span>
          ${horas.map((h) => {
            const v = valor.get(`${i + 1}-${h}`) || 0;
            const c = color(v);
            return `<span class="celda ${v ? '' : 'cero'}" ${c ? `style="--c:${c}"` : ''} tabindex="${v ? 0 : -1}"
              ${tipAttr(`${numero(v)} ${v === 1 ? 'consulta' : 'consultas'}`, `${dia} de ${h} a ${h + 1} h`)}></span>`;
          }).join('')}`).join('')}
      </div>
    </div>
    <div class="calor-leyenda"><span>Menos</span>${RAMPA.map((c) => `<i style="--c:${c}"></i>`).join('')}<span>Más</span></div>`;
}

function tabla(columnas, filas, vacio) {
  if (!filas.length) return vacio ? `<p class="nadie">${vacio}</p>` : '';
  return `<div class="tabla-scroll"><table class="tabla-datos">
    <thead><tr>${columnas.map((c, i) => `<th class="${i ? 'num' : ''}">${escapar(c)}</th>`).join('')}</tr></thead>
    <tbody>${filas.map((f) => `<tr>${f.map((v, i) => `<td class="${i ? 'num' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------------------------------------------------------------------
// Exportar a Excel
// ---------------------------------------------------------------------

// La base devuelve los objetos con las claves reordenadas: se vuelven a poner en orden.
const COLUMNAS_CONSULTAS = ['N°', 'Fecha', 'Hora', 'Motivo', 'Equipo', 'Gestor', 'Estado', 'Fuera de horario',
  'Primera respuesta (min hábiles)', 'Calificación', 'Comentario', 'Cliente', 'Tipo', 'Etapa', 'Colegio', 'Curso',
  'N° de contrato', 'Contrato verificado'];
const COLUMNAS_CLIENTES = ['Nombre', 'Relación', 'Colegio', 'Curso', 'Sucursal', 'Celular', 'Correo', 'Tipo', 'Etapa',
  'Motivo de pérdida', 'Etiquetas', 'N° de contrato', 'DNI del pasajero', 'Contrato verificado', 'Acepta avisos',
  'Consultas', 'Alta', 'Última actividad'];

function ordenar(filas, columnas) {
  return filas.map((f) => {
    const o = {};
    for (const c of columnas) o[c] = c === 'Etapa' && f[c] ? nombreEtapa(f[c]) : f[c] ?? null;
    for (const k of Object.keys(f)) if (!(k in o)) o[k] = f[k];
    return o;
  });
}

async function exportar(que, boton) {
  boton.disabled = true;
  const texto = boton.textContent;
  boton.textContent = 'Preparando…';
  try {
    if (que === 'consultas') {
      const filas = await api.exportarConsultas(r.desde, r.hasta);
      const d = r.datos;
      await descargarExcel(`wolf-consultas-${r.desde}-a-${r.hasta}.xlsx`, {
        Consultas: ordenar(filas, COLUMNAS_CONSULTAS),
        'Por día': serieTemporal().map((p) => ({ Fecha: p.largo, Consultas: p.valor })),
        'Por motivo': d.por_motivo.map((m) => ({ Motivo: m.nombre || m.motivo, Consultas: m.consultas })),
        'Por gestor': d.por_gestor.map((g) => ({
          Gestor: g.nombre, Asignadas: g.asignadas, Respondidas: g.respondidas, Resueltas: g.resueltas,
          'Mediana 1ª respuesta (min hábiles)': g.mediana_respuesta, Calificación: g.csat_promedio, 'Respuestas a la encuesta': g.csat_respuestas,
        })),
        'Por colegio': d.por_colegio.map((c) => ({ Colegio: c.colegio, Consultas: c.consultas, Contactos: c.clientes, Contratados: c.contratados })),
      });
    } else {
      const filas = await api.exportarClientes();
      await descargarExcel(`wolf-clientes-${hoyISO()}.xlsx`, { Clientes: ordenar(filas, COLUMNAS_CLIENTES) });
    }
    toast('Excel descargado. Tiene datos personales: guardalo en un lugar seguro.');
  } catch (e) {
    console.error(e);
    toast(e.message || 'No se pudo exportar', true);
  } finally {
    boton.disabled = false;
    boton.textContent = texto;
  }
}
