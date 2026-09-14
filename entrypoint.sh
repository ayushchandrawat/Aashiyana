#!/bin/sh


#

# gosu zum unprivilegierten node-User wechseln.



set -e
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data /backups /app/modules


  docs_dir="${DOCUMENT_STORAGE_LOCAL_PATH:-/documents}"
  [ -d "$docs_dir" ] && chown -R node:node "$docs_dir"
  exec gosu node "$@"
fi
exec "$@"
