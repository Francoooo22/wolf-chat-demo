// Panel — instalación como aplicación y notificaciones push.
import { api, st, CONFIG, MODO_DEMO, toast, intentar } from './comun.js';
import { abrirConversacion } from './bandeja.js';
import { $ } from '../js/util.js';

let registro = null;
const pushPosible = () => !MODO_DEMO && Boolean(CONFIG.VAPID_PUBLIC_KEY) && registro && 'PushManager' in window;

function claveServidor(b64) {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function iniciarPwa() {
  if ('serviceWorker' in navigator) {
    try {
      registro = await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('Sin service worker', e);
    }
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.tipo === 'abrir' && e.data.conversacion) abrirConversacion(e.data.conversacion);
    });
  }
  if (pushPosible()) {
    const sub = await registro.pushManager.getSubscription().catch(() => null);
    st.pushActivo = Boolean(sub);
    // Vuelve a asociar el dispositivo a quien ingresó (por si antes lo usaba otra persona).
    if (sub) api.guardarSuscripcion(sub.toJSON()).catch(() => {});
  }
  actualizarBoton();
  $('#btn-avisos').addEventListener('click', activar);
}

function actualizarBoton() {
  const permiso = 'Notification' in window ? Notification.permission : 'denied';
  const falta = pushPosible() ? !st.pushActivo && permiso !== 'denied' : permiso === 'default';
  $('#btn-avisos').hidden = !falta;
}

async function activar() {
  if (!('Notification' in window)) {
    toast('Este navegador no permite notificaciones. En iPhone, primero agregá el panel a la pantalla de inicio.', true);
    return;
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    toast('Sin permiso no podemos avisarte. Podés habilitarlo desde la configuración del navegador.', true);
    actualizarBoton();
    return;
  }
  if (pushPosible()) {
    const ok = await intentar(async () => {
      const sub = await registro.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: claveServidor(CONFIG.VAPID_PUBLIC_KEY),
      });
      await api.guardarSuscripcion(sub.toJSON());
    }, 'Listo: te avisamos en este dispositivo aunque el panel esté cerrado');
    st.pushActivo = Boolean(ok);
  } else {
    toast('Avisos activados mientras el panel esté abierto');
  }
  actualizarBoton();
}

// Al salir, este dispositivo deja de recibir avisos de esta persona.
export async function cerrarPush() {
  if (!pushPosible()) return;
  const sub = await registro.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await api.borrarSuscripcion(sub.endpoint).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
