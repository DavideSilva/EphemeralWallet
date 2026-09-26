/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FACTORY?: string;
  readonly VITE_REUSABLE_FACTORY?: string;
  readonly VITE_APPROVAL_HOOK?: string;
  readonly VITE_ENROLL_URL?: string;
  readonly VITE_MERCHANTS?: string;
  readonly VITE_AGENT_URL?: string;
  readonly VITE_SERVICE_URL?: string;
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_FROM_BLOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
