.PHONY: build

dev-install:
	(source node-env/bin/activate && cd app && npm install)

dev-test: dev-install
	(source node-env/bin/activate && cd app && npm test)

dev-run: dev-install
	(source node-env/bin/activate && cd app && npm start)

build:
	# Clean
	rm -rf AppImage
	rm -rf ReleaseUpload

	# Install dependencies and build using build-package.js
	(source node-env/bin/activate && cd app && npm install && npm run build-package -- -zip linux )

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

install:
	sudo mkdir -p /opt/inky
	sudo cp ReleaseUpload/Inky.AppImage /opt/inky/Inky
	sudo cp AppImage/com.inkle.inky.desktop /usr/share/applications/
