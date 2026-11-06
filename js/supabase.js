/* Supabase クライアント（.env が未設定なら null → デモモード） */
import { createClient } from '@supabase/supabase-js';
import { CONFIG, DEMO } from './config.js';

export const supabase = DEMO
  ? null
  : createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'buu-auth' },
    });
