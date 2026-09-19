/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPACETIME_URI?: string;
  readonly VITE_SPACETIME_DB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
