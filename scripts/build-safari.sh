#!/bin/bash
# Convertit l'extension web en app Safari (nécessite Xcode complet, gratuit sur l'App Store).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "❌ safari-web-extension-converter introuvable."
  echo "   Installe Xcode depuis l'App Store, ouvre-le une fois, puis relance :"
  echo "   sudo xcode-select -s /Applications/Xcode.app"
  exit 1
fi

xcrun safari-web-extension-converter extension \
  --project-location safari \
  --app-name Lysto \
  --bundle-identifier com.loogatoxx.lysto \
  --macos-only \
  --no-open \
  --force

echo ""
echo "✅ Projet Xcode généré dans safari/Lysto"
echo "Étapes suivantes :"
echo "  1. open safari/Lysto/Lysto.xcodeproj puis ⌘R pour compiler et lancer l'app."
echo "  2. Safari → Réglages → Avancés → cocher « Afficher le menu Développement »."
echo "  3. Menu Développement → « Autoriser les extensions non signées »."
echo "  4. Safari → Réglages → Extensions → activer Lysto."
