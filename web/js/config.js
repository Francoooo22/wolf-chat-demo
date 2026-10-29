// Configuración del chat y del panel.
//
// Completar SUPABASE_URL y SUPABASE_ANON_KEY con los datos del proyecto
// (Supabase → Project Settings → API). La "anon key" es pública por diseño:
// la seguridad la dan las políticas de la base de datos.
//
// Mientras SUPABASE_URL quede vacío, el chat y el panel funcionan en
// MODO DEMOSTRACIÓN: los datos se guardan solo en este navegador.

export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  MARCA: {
    nombre: 'Wolf Travel',
    // Logo del sitio wolfinternacional.com. Conviene subir una copia al hosting del chat.
    logo: 'https://framerusercontent.com/images/jmfg48wFX4eiU9em04XgN0lcCxM.png',
  },

  // El horario, los motivos, los equipos, las sucursales y los textos del chat
  // se configuran desde el panel (Administración), no desde este archivo.

  // Tamaño máximo de adjuntos (debe coincidir con el bucket "adjuntos").
  ADJUNTO_MAX_MB: 10,

  // Cloudflare Turnstile (verificación anti-robots, gratuita). "Site key" pública.
  // Si queda vacío, el chat no pide verificación (no recomendado en producción).
  // Debe coincidir con la "Secret key" cargada en Supabase → Authentication → Attack Protection
  // y con el secreto TURNSTILE_SECRET de las Edge Functions.
  TURNSTILE_SITE_KEY: '',

  // Clave pública VAPID para las notificaciones push del panel
  // (se genera junto con la privada: ver README, "Notificaciones push").
  VAPID_PUBLIC_KEY: '',

  // Sugerencias de respuesta con IA: DESACTIVADAS por decisión del 25/10/2026.
  // El código queda en el proyecto (panel y función sugerir-respuesta) por si se quiere
  // reactivar: ver README, "Funciones desactivadas". Con false no aparece en ningún lado.
  IA_DISPONIBLE: false,

  // Página de la política de privacidad. Se usa si en Administración → Textos
  // no se cargó otra dirección.
  POLITICA_PRIVACIDAD: '../privacidad/',
};
