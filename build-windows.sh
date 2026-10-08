#!/bin/bash
# Builds dist/Dude-for-Windows.zip from web/dude.html + app/ (works on Linux or macOS).
# Needs: curl, unzip, zip, node (for the icon step: npm i resedit).
set -e
cd "$(dirname "$0")"
V=${ELECTRON_VERSION:-v44.7.0}
mkdir -p dist && cd dist
[ -f electron-win32-x64.zip ] || curl -L -o electron-win32-x64.zip "https://github.com/electron/electron/releases/download/$V/electron-$V-win32-x64.zip"
rm -rf Dude && mkdir Dude && cd Dude && unzip -q ../electron-win32-x64.zip
mv electron.exe Dude.exe && rm -f resources/default_app.asar LICENSES.chromium.html
(cd locales && ls | grep -v -E "^(en-US|en-GB|fr)\.pak$" | xargs rm -f)
cp -r ../../app resources/app && mv "resources/app/START HERE.txt" .
{ printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="stylesheet" href="fonts/fonts.css">\n</head>\n<body>\n'
  grep -v "fonts.googleapis.com\|fonts.gstatic.com" ../../web/dude.html
  printf '\n</body>\n</html>\n'; } > resources/app/index.html
cd .. && (node ../seticon.mjs Dude/Dude.exe ../app/icon.ico || echo "icon step skipped (npm i resedit to enable)")
rm -f Dude-for-Windows.zip && zip -r -9 -q Dude-for-Windows.zip Dude && ls -la Dude-for-Windows.zip
