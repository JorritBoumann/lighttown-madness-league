#!/bin/sh
# Starts the server as the unprivileged `node` user.
#
# A Fly volume is mounted owned by root, so a server that starts as `node`
# cannot write its recordings there. This runs as root just long enough to
# hand the recordings folder over, then becomes `node` for good.
set -e
if [ "$(id -u)" = "0" ]; then
  if [ -n "$RECORD_DIR" ]; then
    mkdir -p "$RECORD_DIR"
    chown node:node "$RECORD_DIR"
  fi
  exec setpriv --reuid=node --regid=node --init-groups node main.js
fi
exec node main.js
