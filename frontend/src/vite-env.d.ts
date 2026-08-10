/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DAO_NETWORK_ID?: string;
  readonly VITE_DAO_CONTRACT_ADDRESS?: string;
  readonly VITE_DAO_INDEXER_URL?: string;
  readonly VITE_DAO_INDEXER_WS_URL?: string;
  readonly VITE_DAO_PROOF_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}