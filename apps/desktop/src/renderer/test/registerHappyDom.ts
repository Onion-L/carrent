import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeFetch = globalThis.fetch;

// Must run before react-dom evaluates: React computes its DOM capability
// flags (canUseDOM, isInputEventSupported) once at module scope, so the
// globals have to exist first. Import this module before any react-dom
// import; the top-level await holds up dependent module evaluation.
await GlobalRegistrator.register();
// Electron tests share this process and need Bun's native, CORS-free fetch.
globalThis.fetch = nativeFetch;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
