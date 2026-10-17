#!/bin/bash
# Update the chat on the server after changing the code:  bash deploy/update.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
[ -d .git ] && git pull --ff-only
"$DIR/.venv/bin/pip" install -q --disable-pip-version-check -r server/requirements.txt
sudo systemctl restart afra-relay
echo "Updated. Phones pick up the new app the next time it opens."
