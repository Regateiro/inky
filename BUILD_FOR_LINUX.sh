cd "`dirname "$0"`"

# Clean
rm -rf AppImage
rm -rf ReleaseUpload

# Install dependencies and build using build-package.js
( cd app && npm install && npm run build-package -- -zip linux )

# Prepare AppImage build structure
mkdir -p AppImage/opt/inky
mkdir -p AppImage/usr/share/pixmaps

cp resources/AppRun AppImage/
cp resources/com.inkle.inky.desktop AppImage/
cp resources/Icon1024.png AppImage/inky.png
cp resources/Icon1024.png AppImage/usr/share/pixmaps/inky.png
cp -r Inky-linux-x64/* AppImage/opt/inky/

# Build AppImage
ARCH=x86_64 ./build/appimagetool-x86_64.AppImage -n AppImage ReleaseUpload/Inky.AppImage
