/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_ENABLE_MAP_FREE_SPIN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
