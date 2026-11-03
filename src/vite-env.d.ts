/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BEDROCK_ENDPOINT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
