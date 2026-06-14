/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional build-time override for the multiplayer match-server endpoint
   *  (e.g. wss://203-0-113-5.sslip.io). Unset → derived from the page origin. */
  readonly VITE_MP_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
