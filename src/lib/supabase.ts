import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true, // salva la sessione nel localStorage
      autoRefreshToken: true, // rinnova il token automaticamente
      detectSessionInUrl: true, // ⚠️ legge la sessione dopo redirect Google
    },
  },
);
