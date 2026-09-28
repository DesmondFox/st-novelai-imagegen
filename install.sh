#!/usr/bin/env bash
# Enables server plugins in SillyTavern's config.yaml.
# Run from the clone inside <SillyTavern>/plugins/nai-imagegen, or pass the SillyTavern path.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
ST="${1:-$(cd "$SRC/../.." && pwd)}"

if [ ! -f "$ST/server.js" ] || [ ! -d "$ST/public/scripts" ]; then
    echo "SillyTavern не найден в '$ST'." >&2
    echo "Склонируйте репозиторий в <SillyTavern>/plugins/nai-imagegen или укажите путь: bash install.sh /путь/к/SillyTavern" >&2
    exit 1
fi

# Cloned elsewhere: copy the server plugin into ST.
if [ "$(dirname "$SRC")" != "$ST/plugins" ]; then
    mkdir -p "$ST/plugins/nai-imagegen"
    cp "$SRC/plugin.mjs" "$SRC/package.json" "$ST/plugins/nai-imagegen/"
    echo "Серверный плагин скопирован в $ST/plugins/nai-imagegen"
fi

CONFIG="$ST/config.yaml"
if [ ! -f "$CONFIG" ]; then
    echo "config.yaml ещё не создан — запустите SillyTavern один раз, затем снова этот скрипт." >&2
    exit 1
fi

if grep -qE '^enableServerPlugins:\s*true' "$CONFIG"; then
    echo "enableServerPlugins уже включён."
elif grep -qE '^enableServerPlugins:' "$CONFIG"; then
    sed -i -E 's/^enableServerPlugins:.*/enableServerPlugins: true/' "$CONFIG"
    echo "enableServerPlugins включён в config.yaml."
else
    printf '\nenableServerPlugins: true\n' >> "$CONFIG"
    echo "enableServerPlugins добавлен в config.yaml."
fi

echo "Готово. Перезапустите SillyTavern и установите расширение через Extensions → Install extension."
