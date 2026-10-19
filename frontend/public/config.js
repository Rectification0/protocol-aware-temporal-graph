// F17.1: runtime configuration, loaded by index.html before the app bundle.
// Empty here on purpose -- dev (`npm run dev`) and plain static builds use
// build-time VITE_* variables instead (see src/config/env.ts). The container
// image overwrites this file at start from environment variables
// (docker/frontend-entrypoint.sh), e.g.:
//   window.__T_GNN_CONFIG__ = { apiBaseUrl: '' }   // '' = same origin (proxied)
window.__T_GNN_CONFIG__ = {}
