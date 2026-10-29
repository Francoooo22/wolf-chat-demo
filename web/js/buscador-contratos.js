// Busca el contrato del cliente a partir de lo que escribe: número ("2.464"), código
// ("WT26CBU004"), sigla ("DAD", "I.R.M.") o parte del nombre del colegio, aun con errores de tipeo.
// Sin dependencias: lo usa el chat y lo prueban los tests.

const RELLENO = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

// Minúsculas, sin tildes, sin puntos ("I.R.M." → "irm") y con el resto de los signos como espacio.
export const limpiar = (t) => String(t ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\./g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const compacto = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function distancia(a, b) {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const actual = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = actual;
    }
  }
  return fila[b.length];
}

// ¿La palabra escrita corresponde a la palabra del nombre? (igual, empieza igual o con 1-2 errores)
function coincide(escrita, palabra) {
  if (palabra === escrita || (escrita.length >= 2 && palabra.startsWith(escrita))) return true;
  if (/\d/.test(escrita) || escrita.length < 4) return false;
  const tolerancia = escrita.length >= 8 ? 2 : 1;
  return distancia(escrita, palabra.slice(0, escrita.length)) <= tolerancia || distancia(escrita, palabra) <= tolerancia;
}

// Sigla escrita al comienzo del nombre: "DAD - DEPARTAMENTO DE APLICACIÓN DOCENTE".
const siglaExplicita = (nombre) => compacto(/^\s*([A-ZÁÉÍÓÚÑ0-9.]{2,8})\s+-\s+/.exec(String(nombre))?.[1] ?? '').toLowerCase();

function puntaje(escrito, palabras, contrato) {
  const nombre = limpiar(contrato.colegio);
  const del_nombre = nombre.split(' ').filter(Boolean);
  if (!del_nombre.length) return 0;

  const sigla = escrito.replace(/ /g, '');
  if (sigla.length >= 2 && sigla === siglaExplicita(contrato.colegio)) return 100;

  // Iniciales de las palabras que importan: "instituto rodeo del medio" → "irm".
  const iniciales = del_nombre.filter((p) => !RELLENO.has(p) && !/^\d/.test(p)).map((p) => p[0]).join('');
  if (/^[a-z]{2,6}$/.test(sigla)) {
    if (sigla === iniciales) return 95;
    if (sigla.length >= 3 && iniciales.startsWith(sigla)) return 70;
  }

  // Todas las palabras escritas deben aparecer (completas, empezadas o con un error de tipeo).
  const buscadas = palabras.filter((p) => !RELLENO.has(p));
  if (!buscadas.length || !buscadas.every((p) => del_nombre.some((n) => coincide(p, n)))) return 0;
  const exactas = buscadas.filter((p) => del_nombre.includes(p)).length;
  const sobran = del_nombre.length - buscadas.length;
  return 75 + 10 * (exactas / buscadas.length) - Math.min(sobran, 10) + (nombre.startsWith(escrito) ? 5 : 0);
}

// Devuelve { tipo: 'exacto' | 'varios' | 'ninguno', contratos: [...] } con hasta `maximo` contratos.
export function buscarContrato(texto, catalogo, maximo = 6) {
  const escrito = limpiar(texto);
  if (!escrito) return { tipo: 'ninguno', contratos: [] };

  // Número o código de contrato: "2.464", "2464", "WT26CBU004", "wt26 cbu 004".
  const clave = compacto(texto);
  const exactos = catalogo.filter((c) => compacto(c.nro_contrato) === clave || (c.codigo && compacto(c.codigo) === clave));
  if (exactos.length === 1) return { tipo: 'exacto', contratos: exactos };

  const palabras = escrito.split(' ');
  const hallados = catalogo
    .map((c) => ({ c, p: puntaje(escrito, palabras, c) }))
    .filter((x) => x.p >= 60)
    .sort((a, b) => b.p - a.p || a.c.colegio.localeCompare(b.c.colegio) || a.c.anio - b.c.anio);

  return {
    tipo: hallados.length ? 'varios' : 'ninguno',
    contratos: hallados.slice(0, maximo).map((x) => x.c),
    total: hallados.length,
  };
}
