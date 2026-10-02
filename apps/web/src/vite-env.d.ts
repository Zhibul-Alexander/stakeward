/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set by vite.config.ts from the VITE_CLUSTER environment variable (validated there). */
  readonly VITE_CLUSTER: 'devnet' | 'mainnet';
}
