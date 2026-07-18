#!/bin/bash
# Convertit l'extension web en app Safari, la compile (signature ad-hoc locale)
# et l'installe dans /Applications. Nécessite Xcode complet (gratuit, App Store).
set -euo pipefail
cd "$(dirname "$0")/.."

# Utilise Xcode même si xcode-select pointe encore sur les Command Line Tools
if [ -d /Applications/Xcode.app ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "❌ safari-web-extension-converter introuvable."
  echo "   Installe Xcode depuis l'App Store puis relance ce script."
  exit 1
fi

echo "→ Conversion de l'extension web en projet Xcode…"
# NB : majuscule cohérente (com.loogatoxx.Lysto) — l'app cible utilise le nom
# de l'app dans son identifiant, et la validation est sensible à la casse.
xcrun safari-web-extension-converter extension \
  --project-location safari \
  --app-name Lysto \
  --bundle-identifier com.loogatoxx.Lysto \
  --macos-only \
  --no-open \
  --force

echo "→ Compilation (signature ad-hoc locale)…"
xcodebuild -project safari/Lysto/Lysto.xcodeproj -scheme Lysto \
  -configuration Release build \
  CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual \
  AD_HOC_CODE_SIGNING_ALLOWED=YES DEVELOPMENT_TEAM="" | tail -1

APP=$(ls -d "$HOME"/Library/Developer/Xcode/DerivedData/Lysto-*/Build/Products/Release/Lysto.app | head -1)
echo "→ Installation dans /Applications…"
ditto "$APP" /Applications/Lysto.app
open /Applications/Lysto.app

echo ""
echo "✅ Lysto.app installée et lancée."
echo "Dans Safari, il reste à faire (une seule fois) :"
echo "  1. Réglages → Avancés → cocher « Afficher le menu Développement »"
echo "  2. Menu Développement → « Autoriser les extensions non signées »"
echo "     (à refaire après chaque redémarrage de Safari, signature ad-hoc oblige)"
echo "  3. Réglages → Extensions → activer Lysto"
