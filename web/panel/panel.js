// Panel de gestores — Atención Wolf. Punto de entrada: ingreso, barra superior y navegación.
import {
  api, st, CONFIG, MODO_DEMO, ROL, esSupervisor, esAdmin, toast, intentar, cambiarVista, cargarCatalogos,
  alCargarCatalogos, dialogo,
} from './comun.js';
import { iniciarBandeja, abrirConversacion, programarRecarga } from './bandeja.js';
import { iniciarPwa, cerrarPush } from './pwa.js';
import './leads.js';
import './reportes.js';
import './avisos.js';
import './admin.js';
import { $, escapar } from '../js/util.js';

document.querySelectorAll('img.logo').forEach((img) => { img.src = CONFIG.MARCA.logo; });

// ---------------------------------------------------------------------
// Ingreso
// ---------------------------------------------------------------------

iniciar();

async function iniciar() {
  let s;
  try {
    s = await api.sesion();
  } catch (e) {
    console.error(e);
    mostrarIngreso(`No se pudo verificar la sesión: ${e.message}`);
    return;
  }
  if (!s) {
    mostrarIngreso();
    return;
  }
  if (!s.gestor) {
    // Le avisamos al administrador: queda una solicitud pendiente en Administración → Personas.
    const sol = await api.solicitarAcceso();
    const texto = sol?.estado === 'rechazada'
      ? `La solicitud de acceso de ${s.email} fue rechazada. Si es un error, hablá con un administrador.`
      : sol
        ? `La cuenta ${s.email} todavía no está habilitada. Ya le avisamos al administrador; cuando te habilite, volvé a ingresar.`
        : `La cuenta ${s.email} no está habilitada en el panel. Pedile a un administrador que te dé de alta.`;
    mostrarIngreso(texto, true);
    return;
  }
  st.yo = s.gestor;
  await entrar();
}

function mostrarIngreso(error = '', ofrecerSalir = false) {
  $('#pantalla-ingreso').hidden = false;
  $('#panel').hidden = true;
  $('#ingreso-error').textContent = error;
  const btn = $('#btn-google');

  if (api.demo) {
    btn.hidden = true;
    $('#ingreso-texto').textContent = 'Modo demostración: elegí con qué usuario de prueba entrar.';
    const caja = $('#demo-usuarios');
    caja.hidden = false;
    caja.replaceChildren(...api.usuariosDemo().map((g) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'boton';
      const equipos = g.nombresEquipos.join(', ');
      b.innerHTML = `<span>${escapar(g.nombre)}</span><small>${ROL[g.rol]}${equipos ? `, ${escapar(equipos)}` : ''}</small>`;
      b.addEventListener('click', async () => { await api.ingresarDemo(g.id); location.reload(); });
      return b;
    }));
    return;
  }

  if (ofrecerSalir) {
    btn.textContent = 'Ingresar con otra cuenta';
    btn.onclick = async () => { await api.salir(); location.reload(); };
  } else {
    btn.onclick = () => intentar(() => api.ingresarConGoogle());
  }
}

async function entrar() {
  $('#pantalla-ingreso').hidden = true;
  $('#panel').hidden = false;
  $('#marca-demo').hidden = !MODO_DEMO;

  await cargarCatalogos();
  await iniciarBandeja();
  iniciarPwa();

  // Enlace directo a una consulta (desde una notificación): ?c=<id>
  const p = new URLSearchParams(location.search);
  const c = p.get('c');
  if (c) {
    history.replaceState(null, '', location.pathname);
    abrirConversacion(c);
  }
  // Enlace desde el aviso de solicitud de acceso: ?admin=personas
  if (p.get('admin') && esAdmin()) {
    history.replaceState(null, '', location.pathname);
    cambiarVista('admin');
  }
}

let avisadas = 0;   // solicitudes de acceso ya avisadas en pantalla

// Barra superior: nombre, rol y secciones visibles. Se actualiza cada vez que se recargan los catálogos.
alCargarCatalogos(() => {
  $('#usuario').textContent = st.yo.nombre;
  $('#nav-leads').hidden = false;
  $('#nav-reportes').hidden = !esSupervisor();
  $('#nav-avisos').hidden = !esSupervisor();
  $('#nav-admin').hidden = !esAdmin();
  const pendientes = esAdmin() ? (st.cat.solicitudes || []).length : 0;
  $('#nav-admin').textContent = pendientes ? `Administración (${pendientes})` : 'Administración';
  $('#nav-admin').title = pendientes ? `${pendientes} solicitud${pendientes === 1 ? '' : 'es'} de acceso pendiente${pendientes === 1 ? '' : 's'}` : '';
  if (pendientes > avisadas) {
    toast(`${pendientes} persona${pendientes === 1 ? '' : 's'} pidió acceso al panel. Revisalo en Administración → Personas.`);
  }
  avisadas = pendientes;
  $('#disponible').checked = st.yo.disponible !== false;
  actualizarDisponible();
  const vista = st.vista;
  if ((['reportes', 'avisos'].includes(vista) && !esSupervisor()) || (vista === 'admin' && !esAdmin())) cambiarVista('bandeja');
});

// ---------------------------------------------------------------------
// Barra superior
// ---------------------------------------------------------------------

function actualizarDisponible() {
  $('#disponible-texto').textContent = $('#disponible').checked ? 'Disponible' : 'Ausente';
}

$('#disponible').addEventListener('change', async (e) => {
  const valor = e.target.checked;
  actualizarDisponible();
  const r = await intentar(() => api.setDisponible(valor),
    valor ? 'Ya podés recibir consultas nuevas' : 'No vas a recibir consultas nuevas hasta que vuelvas a estar disponible');
  if (r === undefined) {
    e.target.checked = !valor;   // falló: vuelve al estado anterior
    actualizarDisponible();
    return;
  }
  st.yo.disponible = valor;
  if (valor) {
    programarRecarga();
    return;
  }
  // Al quedar ausente: ofrecer repartir las consultas abiertas entre el equipo.
  const abiertas = st.convs.filter((c) => c.estado === 'abierta' && c.gestor_id === st.yo.id).length;
  if (!abiertas) return;
  const { valor: eleccion } = await dialogo({
    titulo: 'Quedaste como ausente',
    cuerpo: `<p class="dlg-texto">Tenés <b>${abiertas}</b> ${abiertas === 1 ? 'consulta abierta' : 'consultas abiertas'}.
      ¿Las repartimos entre tu equipo para que nadie se quede esperando?</p>
      <p class="ayuda-campo">Si las conservás, siguen a tu nombre y el sistema las reasigna solo si no se responden a tiempo.</p>`,
    botones: [{ valor: 'cancelar', texto: 'Conservarlas' }, { valor: 'repartir', texto: 'Repartirlas', primario: true }],
  });
  if (eleccion !== 'repartir') return;
  await intentar(() => api.repartir(), (x) => `${x.reasignadas} ${x.reasignadas === 1 ? 'consulta reasignada' : 'consultas reasignadas'}`
    + `${x.en_fila ? `; ${x.en_fila} en fila porque no había nadie disponible` : ''}`);
  programarRecarga();
});

$('#btn-salir').addEventListener('click', async () => {
  await cerrarPush();
  await api.salir();
  location.href = location.pathname;
});

document.querySelectorAll('.barra nav button').forEach((b) => {
  b.addEventListener('click', () => cambiarVista(b.dataset.vista));
});

window.addEventListener('error', (e) => console.error(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  if (e.reason?.message) toast(e.reason.message, true);
});
