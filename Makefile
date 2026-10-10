.PHONY: build dependencies update-deps

dependencies:
	@sudo dnf install -y nodeenv || sudo apt install -y nodeenv || echo "Please install nodeenv manually"
	$(shell if [ ! -d node-env ]; then nodeenv node-env; fi)
	# The inklecate compiler binaries are stored with Git LFS (they exceed
	# GitHub's file size limits). Install git-lfs, register its filters/hooks,
	# then materialize the real executables into the working tree.
	@sudo dnf install -y git-lfs || sudo apt install -y git-lfs || echo "Please install git-lfs manually"
	@git lfs install
	@git lfs pull

update-deps: dependencies
	# Update node dependencies (to the latest versions within the declared ranges)
	(source node-env/bin/activate && cd app && npm update)
	# Update the inklecate compiler binaries from the latest inkle/ink release
	./build/update-inklecate.sh

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
