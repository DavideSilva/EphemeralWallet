/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FACTORY?: string;
  readonly VITE_REUSABLE_FACTORY?: string;
  readonly VITE_MERCHANTS?: string;
  readonly VITE_AGENT_URL?: string;
  readonly VITE_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
