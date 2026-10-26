#!/usr/bin/env sh
# Baut Sqritto (Markdoc-Engine, HTML5-Site, Oberfläche und Programm) und legt das
# fertige Programm unter dist/ ab, das Archiv unter dist/packages/:
#   dist/sqritto   App (macOS: eigenes Fenster, Linux: im Browser), Server und CLI
#
# Linux benötigt außer Rust und Node.js nur einen C-Compiler, make und perl
# (für das statisch eingebundene OpenSSL).
set -e
cd "$(dirname "$0")"
version=$(node scripts/version.mjs)

if [ "${SQRITTO_FRONTEND_READY:-}" = "1" ]; then
  for f in engine/dist/engine.js site/dist/site.js web/dist/index.html; do
    if [ ! -f "$f" ]; then
      echo "SQRITTO_FRONTEND_READY verlangt ein bereits gebautes Frontend ($f fehlt)." >&2
      exit 1
    fi
  done
  echo "[1-2/3] Vorbereitetes Frontend verwenden …"
else
  echo "[1/3] Frontend-Abhängigkeiten …"
  npm ci --no-audit --no-fund
  echo "[2/3] Engine, Site und Oberfläche bauen …"
  npm run build
fi

echo "[3/3] Programm bauen (Release) …"
cargo build --locked --release --bin sqritto
mkdir -p dist/packages
cp target/release/sqritto dist/sqritto
cp LICENSE dist/LICENSE.txt
cp LICENSE-MIT-0 dist/LICENSE-MIT-0.txt
node scripts/third-party-licenses.mjs dist/THIRD-PARTY-LICENSES.txt

case "$(uname -s)" in
  Darwin) platform=macos ;;
  *) platform=$(uname -s | tr '[:upper:]' '[:lower:]') ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) arch=$(uname -m) ;;
esac
# Nur ausdrücklich genannte Dateien verpacken, nie alte Pakete oder Arbeitsdaten.
tar -czf "dist/packages/Sqritto-$version-$platform-$arch.tar.gz" -C dist sqritto LICENSE.txt LICENSE-MIT-0.txt THIRD-PARTY-LICENSES.txt
echo
echo "Fertig: dist/sqritto und dist/packages/Sqritto-$version-$platform-$arch.tar.gz"
