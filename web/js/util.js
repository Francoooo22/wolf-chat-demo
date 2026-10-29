// Utilidades compartidas por el chat y el panel.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function escapar(texto) {
  return String(texto ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// Texto seguro con enlaces clickeables.
export function textoConEnlaces(texto) {
  return escapar(texto).replace(
    /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

export const primerNombre = (nombre) => (nombre || '').trim().split(/\s+/)[0] || '';

// Igual que public.texto_dias / public.texto_horario en la base.
const DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];

export function textoDias(dias) {
  const v = [...new Set(dias.map(Number))].sort((a, b) => a - b);
  const k = v.length;
  if (!k) return 'ningún día';
  if (k === 7) return 'todos los días';
  if (k === 1) return `los ${DIAS[v[0] - 1]}`;
  if (v[k - 1] - v[0] === k - 1) return `de ${DIA[v[0] - 1]} a ${DIA[v[k - 1] - 1]}`;
  return `los ${v.slice(0, -1).map((d) => DIAS[d - 1]).join(', ')} y ${DIAS[v[k - 1] - 1]}`;
}

export function textoHorario(cfg) {
  const h = (t) => {
    const [hh, mm] = String(t).split(':').map(Number);
    return mm ? `${hh}:${String(mm).padStart(2, '0')}` : `${hh}`;
  };
  return `${textoDias(cfg.dias_habiles)} de ${h(cfg.hora_inicio)} a ${h(cfg.hora_fin)} h`;
}

// Igual que public.normalizar_contrato / public.normalizar_texto en la base.
export const normalizarContrato = (t) => String(t ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
export const normalizarTexto = (t) => String(t ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() || null;

export const ETAPAS = [
  { id: 'nuevo', nombre: 'Nuevo' },
  { id: 'contactado', nombre: 'Contactado' },
  { id: 'cotizado', nombre: 'Cotizado' },
  { id: 'negociando', nombre: 'Negociando' },
  { id: 'contratado', nombre: 'Contratado' },
  { id: 'perdido', nombre: 'Perdido' },
];
export const nombreEtapa = (id) => ETAPAS.find((e) => e.id === id)?.nombre || id;

// Descargas: Excel (SheetJS, se carga solo cuando hace falta) y texto plano.
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
let sheetjs;
export async function cargarSheetJS() {
  sheetjs = sheetjs || await import(SHEETJS);
  return sheetjs;
}

export async function descargarExcel(nombreArchivo, hojas) {
  const XLSX = await cargarSheetJS();
  const libro = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) {
    const hoja = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]);
    const cols = Object.keys(filas[0] || {});
    hoja['!cols'] = cols.map((c) => ({
      wch: Math.min(48, Math.max(c.length, ...filas.slice(0, 200).map((f) => String(f[c] ?? '').length)) + 2),
    }));
    XLSX.utils.book_append_sheet(libro, hoja, nombre.slice(0, 31));
  }
  XLSX.writeFile(libro, nombreArchivo);
}

// Lee la primera hoja de un Excel o un CSV. Los CSV pueden venir en UTF-8 o en la
// codificación de Excel en Windows, y separados por coma, punto y coma o tabulación.
export async function leerPlanilla(archivo) {
  const XLSX = await cargarSheetJS();
  const datos = await archivo.arrayBuffer();
  let libro;
  if (/\.(csv|txt)$/i.test(archivo.name) || /csv|text\/plain/.test(archivo.type)) {
    let texto = new TextDecoder('utf-8').decode(datos);
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(datos);
    texto = texto.replace(/^﻿/, '');
    const primera = texto.split(/\r?\n/, 1)[0];
    const contar = (c) => primera.split(c).length - 1;
    const FS = [';', '\t', ','].sort((a, b) => contar(b) - contar(a))[0];
    libro = XLSX.read(texto, { type: 'string', raw: true, FS });   // raw: conserva ceros a la izquierda
  } else {
    libro = XLSX.read(datos, { type: 'array' });
  }
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false });
}

export function descargarTexto(nombreArchivo, texto) {
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombreArchivo });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const TEXTOS_POR_DEFECTO = {
  texto_bienvenida: '¡Hola! Soy el asistente de Wolf Travel 👋',
  texto_privacidad: 'Antes de empezar: usamos los datos que nos des solo para responder tu consulta y gestionar tu viaje. '
    + 'Los guardan nuestros proveedores en Brasil y en Estados Unidos; al aceptar, das tu consentimiento expreso '
    + 'para esa transferencia internacional. Podés pedir verlos, corregirlos o borrarlos cuando quieras.',
};

const ZONA = 'America/Argentina/Mendoza';
const fmtHora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA });
const fmtDia = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: ZONA });
const fmtFechaCorta = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', timeZone: ZONA });
const fmtClaveDia = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA });

export const hora = (iso) => fmtHora.format(new Date(iso));
export const claveDia = (iso) => fmtClaveDia.format(new Date(iso));

export function etiquetaDia(iso) {
  const hoy = claveDia(new Date().toISOString());
  const ayer = claveDia(new Date(Date.now() - 86400000).toISOString());
  const k = claveDia(iso);
  if (k === hoy) return 'Hoy';
  if (k === ayer) return 'Ayer';
  const t = fmtDia.format(new Date(iso));
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// "10:42" si es de hoy, "ayer" o "23/10" si es anterior.
export function momentoCorto(iso) {
  if (!iso) return '';
  const k = claveDia(iso);
  if (k === claveDia(new Date().toISOString())) return hora(iso);
  if (k === claveDia(new Date(Date.now() - 86400000).toISOString())) return 'ayer';
  return fmtFechaCorta.format(new Date(iso));
}

export function hace(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function tamanio(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const ICONOS = {
  enviar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.6 21 12 3.4 3.4l.1 6.7L15 12 3.5 13.9z" fill="currentColor"/></svg>',
  clip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cerrar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 2v5h5" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="12" y="17" text-anchor="middle" font-size="5.5" font-weight="700" fill="currentColor" font-family="sans-serif">PDF</text></svg>',
  reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  luna: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  candado: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  volver: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.2-3.6A8 8 0 1 1 8 19.1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8.5c0 3 2.5 6 6 6.5l1-1.3-1.8-.9-.8.8c-1-.4-2.1-1.5-2.5-2.5l.8-.8-.9-1.8z" fill="currentColor"/></svg>',
};
