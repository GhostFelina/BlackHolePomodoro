#!/bin/bash
# Kara Delik Odak — derleme + .app paketi oluşturma
# Kullanım: ./build.sh          (derle + paketle)
#           ./build.sh install  (+ /Applications'a kopyala)
set -euo pipefail
cd "$(dirname "$0")"

echo "▸ Swift derleniyor (release)…"
swift build -c release

APP="build/Kara Delik Odak.app"
BIN=".build/release/KaraDelikOdak"

echo "▸ Uygulama paketi oluşturuluyor…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/KaraDelikOdak"
cp Support/Info.plist "$APP/Contents/Info.plist"

# Ad-hoc imza: Ekran Kaydı izninin (TCC) uygulamayı tanıması için gerekli.
codesign --force --sign - "$APP"

echo "✅ Hazır: $APP"

if [[ "${1:-}" == "install" ]]; then
  echo "▸ /Applications'a kopyalanıyor…"
  rm -rf "/Applications/Kara Delik Odak.app"
  cp -R "$APP" "/Applications/Kara Delik Odak.app"
  echo "✅ Kuruldu: /Applications/Kara Delik Odak.app"
fi
