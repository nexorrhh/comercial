// Cliente de Supabase con la service_role key: sólo para uso del servidor
// (nunca exponer esta key al navegador). Se usa para administrar usuarios de
// Auth (alta, cambio de contraseña) y para validar el access token de una
// sesión ya iniciada.
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en las variables de entorno');
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

module.exports = supabaseAdmin;
