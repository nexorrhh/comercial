// Cliente de Supabase con la anon key: se usa únicamente para el
// signInWithPassword del login (equivalente a lo que haría el navegador,
// pero hecho acá para no tener que exponer lógica de sesión en el frontend).
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_ANON_KEY en las variables de entorno');
}

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

module.exports = supabaseAuth;
