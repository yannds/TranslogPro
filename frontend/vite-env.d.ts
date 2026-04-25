/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_PLATFORM_BASE_DOMAIN?: string;
  readonly VITE_DEV_TENANT_ID?: string;
  readonly VITE_DEV_AGENCY_ID?: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
