/*
 * Botón flotante del chat de Wolf para insertar en cualquier sitio (Framer, WordPress, etc.).
 *
 * Uso (pegar antes de </body>):
 *   <script src="https://chat.wolfinternacional.com/widget/wolf-chat.js" defer></script>
 *
 * Opciones (atributos del <script>):
 *   data-chat-url   URL del chat. Por defecto, la carpeta /chat/ junto a este archivo.
 *   data-saludo     Texto de la burbuja de invitación. Con data-saludo="no" no se muestra.
 *   data-posicion   "derecha" (por defecto) o "izquierda".
 *
 * Para abrir el chat desde un botón o enlace del sitio: enlace a "#wolf-chat",
 * cualquier elemento con el atributo data-wolf-chat, o window.WolfChat.abrir().
 */
(() => {
  if (window.WolfChat) return;

  const script = document.currentScript;
  const chatUrl = new URL(script?.dataset.chatUrl || '../chat/', script?.src || location.href);
  chatUrl.searchParams.set('embed', '1');
  const origenChat = chatUrl.origin;
  const saludo = script?.dataset.saludo ?? '¿Tenés una consulta? Escribinos por acá';
  const izquierda = script?.dataset.posicion === 'izquierda';
  const CLAVE_ACTIVO = 'wolf-chat-activo';

  const leer = (store, k) => { try { return store.getItem(k); } catch { return null; } };
  const escribir = (store, k, v) => { try { store.setItem(k, v); } catch { /* bloqueado */ } };

  const host = document.createElement('div');
  host.id = 'wolf-chat';
  const raiz = host.attachShadow({ mode: 'open' });
  const lado = izquierda ? 'left' : 'right';

  raiz.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .lanzador {
        position: fixed; bottom: 22px; ${lado}: 22px; z-index: 2147483000;
        width: 62px; height: 62px; border: 0; border-radius: 50%;
        background: #0b34dc; color: #fff; cursor: pointer;
        display: grid; place-items: center;
        box-shadow: 0 12px 28px -8px rgba(11, 52, 220, 0.6), 0 2px 6px rgba(30, 29, 62, 0.25);
        transition: transform .18s ease, background .18s ease;
      }
      .lanzador:hover { background: #0827a6; transform: scale(1.04); }
      .lanzador:focus-visible { outline: 3px solid #95d2e0; outline-offset: 3px; }
      .lanzador svg { width: 30px; height: 30px; }
      .lanzador .x { display: none; }
      :host([data-abierto]) .lanzador .globo { display: none; }
      :host([data-abierto]) .lanzador .x { display: block; }
      .contador {
        position: absolute; top: -2px; ${izquierda ? 'left' : 'right'}: -2px;
        min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px;
        background: #e8463a; color: #fff; border: 2px solid #fff;
        font: 700 12px/18px system-ui, sans-serif; text-align: center;
      }
      .saludo {
        position: fixed; bottom: 96px; ${lado}: 22px; z-index: 2147483000;
        max-width: 260px; padding: 12px 36px 12px 16px; border-radius: 18px;
        border-bottom-${lado}-radius: 6px;
        background: #fff; color: #1e1d3e;
        font: 500 15px/1.35 'Satoshi', system-ui, -apple-system, 'Segoe UI', sans-serif;
        box-shadow: 0 12px 30px -10px rgba(30, 29, 62, 0.35), 0 0 0 1px rgba(30, 29, 62, 0.06);
        cursor: pointer;
        animation: entra .3s ease-out both;
      }
      .saludo button {
        position: absolute; top: 6px; right: 6px; width: 26px; height: 26px;
        border: 0; border-radius: 50%; background: transparent; color: #64636c;
        cursor: pointer; font: 400 18px/1 system-ui, sans-serif;
      }
      .panel {
        position: fixed; bottom: 96px; ${lado}: 22px; z-index: 2147483000;
        width: 400px; height: min(660px, calc(100vh - 120px));
        border-radius: 24px; overflow: hidden; background: #eae8e1;
        box-shadow: 0 30px 70px -20px rgba(30, 29, 62, 0.5), 0 0 0 1px rgba(30, 29, 62, 0.08);
        animation: entra .22s ease-out both;
      }
      .panel iframe { width: 100%; height: 100%; border: 0; display: block; }
      [hidden] { display: none !important; }
      @keyframes entra { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
      @media (max-width: 640px) {
        .panel { inset: 0; width: 100%; height: 100%; border-radius: 0; }
        :host([data-abierto]) .lanzador { display: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .saludo, .panel { animation: none; }
        .lanzador { transition: none; }
      }
    </style>
    <div class="saludo" hidden role="status">
      <span class="saludo-texto"></span>
      <button type="button" aria-label="Cerrar invitación">×</button>
    </div>
    <div class="panel" hidden>
      <iframe title="Chat con Wolf Travel" allow="clipboard-write"></iframe>
    </div>
    <button class="lanzador" type="button" aria-label="Abrir el chat con Wolf" aria-expanded="false">
      <svg class="globo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c-4.9 0-8.5 3.3-8.5 7.5 0 2.2 1 4.1 2.7 5.5L5.5 20l4-1.9c.8.2 1.6.3 2.5.3 4.9 0 8.5-3.3 8.5-7.5S16.9 3.5 12 3.5z" fill="currentColor"/></svg>
      <svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      <span class="contador" hidden></span>
    </button>`;

  const lanzador = raiz.querySelector('.lanzador');
  const panel = raiz.querySelector('.panel');
  const iframe = raiz.querySelector('iframe');
  const contador = raiz.querySelector('.contador');
  const burbuja = raiz.querySelector('.saludo');

  let cargado = false;
  let abierto = false;

  function cargar() {
    if (cargado) return;
    cargado = true;
    iframe.src = chatUrl.href;
    iframe.addEventListener('load', avisarVisibilidad);
  }

  function avisarVisibilidad() {
    iframe.contentWindow?.postMessage({ type: 'wolf-chat:visibilidad', abierto }, origenChat);
  }

  function abrir() {
    cargar();
    abierto = true;
    panel.hidden = false;
    burbuja.hidden = true;
    host.setAttribute('data-abierto', '');
    lanzador.setAttribute('aria-expanded', 'true');
    lanzador.setAttribute('aria-label', 'Cerrar el chat con Wolf');
    escribir(sessionStorage, 'wolf-chat-saludo', '1');
    avisarVisibilidad();
    setTimeout(() => iframe.focus(), 50);
  }

  function cerrar() {
    abierto = false;
    panel.hidden = true;
    host.removeAttribute('data-abierto');
    lanzador.setAttribute('aria-expanded', 'false');
    lanzador.setAttribute('aria-label', 'Abrir el chat con Wolf');
    avisarVisibilidad();
    lanzador.focus();
  }

  lanzador.addEventListener('click', () => (abierto ? cerrar() : abrir()));
  burbuja.addEventListener('click', (e) => {
    if (e.target.closest('button')) {
      burbuja.hidden = true;
      escribir(sessionStorage, 'wolf-chat-saludo', '1');
    } else {
      abrir();
    }
  });

  window.addEventListener('message', (e) => {
    if (e.origin !== origenChat || e.source !== iframe.contentWindow) return;
    const d = e.data || {};
    if (d.type === 'wolf-chat:cerrar') cerrar();
    if (d.type === 'wolf-chat:estado' && d.conversacion) escribir(localStorage, CLAVE_ACTIVO, '1');
    if (d.type === 'wolf-chat:no-leidos') {
      contador.hidden = !d.cantidad;
      contador.textContent = d.cantidad > 9 ? '9+' : String(d.cantidad || '');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && abierto) cerrar();
  });

  // Enlaces del sitio que abren el chat.
  document.addEventListener('click', (e) => {
    const disparador = e.target.closest?.('a[href$="#wolf-chat"], [data-wolf-chat]');
    if (!disparador) return;
    e.preventDefault();
    abrir();
  });

  function montar() {
    document.body.append(host);
    // Quien ya chateó antes: el chat se carga oculto para avisar respuestas nuevas.
    if (leer(localStorage, CLAVE_ACTIVO)) {
      (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(cargar);
    }
    if (saludo && saludo !== 'no' && !leer(sessionStorage, 'wolf-chat-saludo')) {
      setTimeout(() => {
        if (abierto) return;
        raiz.querySelector('.saludo-texto').textContent = saludo;
        burbuja.hidden = false;
      }, 6000);
    }
    if (location.hash === '#wolf-chat') abrir();
  }

  if (document.body) montar();
  else document.addEventListener('DOMContentLoaded', montar);

  window.WolfChat = { abrir, cerrar };
})();
