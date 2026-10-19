#!/bin/sh
# tasks.md F17.1: writes the runtime config (src/config/env.ts reads it as
# window.__T_GNN_CONFIG__) from container environment variables, so one
# image serves any environment. Runs from /docker-entrypoint.d/ before nginx
# starts.
#
#   API_BASE_URL       empty (default) = same origin, via this container's
#                      /api proxy (F17.3); or an absolute URL to call an API
#                      directly (that API must then allow this origin --
#                      API_CORS_ORIGINS on the API side).
#   MOCK_AUTH_ENABLED  "false" shows the honest auth-unavailable login page.
set -eu

target=/usr/share/nginx/html/config.js
api_base_url="${API_BASE_URL:-}"

# The value is written into a JS string literal. A URL never legitimately
# contains these characters, so refusing them is simpler (and safer) than
# escaping: a quote, backslash, angle bracket or newline here is a
# misconfiguration, not a URL.
case "$api_base_url" in
  *'"'* | *\\* | *'<'* | *'>'* | *"
"*)
    echo "t-gnn: API_BASE_URL contains a character a URL cannot (quote, backslash, <, > or newline): refusing to start" >&2
    exit 1
    ;;
esac

case "${MOCK_AUTH_ENABLED:-true}" in
  false | FALSE | False | 0 | no) mock_auth=false ;;
  *) mock_auth=true ;;
esac

printf 'window.__T_GNN_CONFIG__ = {"apiBaseUrl":"%s","mockAuthEnabled":%s}\n' \
  "$api_base_url" "$mock_auth" >"$target"
echo "t-gnn: wrote $target (apiBaseUrl=\"$api_base_url\" [empty = same origin], mockAuthEnabled=$mock_auth)"
