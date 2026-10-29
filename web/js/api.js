// Punto de entrada de datos: usa Supabase si está configurado; si no, el modo demostración.
import { CONFIG } from './config.js';

export const MODO_DEMO = !CONFIG.SUPABASE_URL;

const modulo = MODO_DEMO ? await import('./api-demo.js') : await import('./api-supabase.js');

export const crearApiCliente = modulo.crearApiCliente;
export const crearApiPanel = modulo.crearApiPanel;
