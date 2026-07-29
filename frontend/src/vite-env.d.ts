/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_AUTH_MODE?: string;
  readonly VITE_VISUAL_LAYER?: string;
  readonly VITE_MOTION_DEBUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
