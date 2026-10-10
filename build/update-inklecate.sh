#!/bin/sh
# Update the inklecate compiler binary for Linux from the latest inkle/ink
# release.
#
# Uses GitHub's 'latest release' download URLs, which redirect to the newest
# release's assets directly, e.g.:
#   https://github.com/inkle/ink/releases/latest/download/inklecate_linux.zip
#
# The binary lives in app/main-process/ink/ and is tracked with Git LFS (it
# exceeds GitHub's regular file limits), so after running this script you must
# re-add the file so Git LFS stores the new object, e.g.:
#
#   git add app/main-process/ink/
#   git commit -m "Update inklecate compiler binary"
#   git push
set -e

INKLEKATE_BASE="https://github.com/inkle/ink/releases/latest/download"
INKLE_DIR="app/main-process/ink"

if ! command -v curl >/dev/null 2>&1; then
    echo "error: curl is required" >&2
    exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
    echo "error: unzip is required" >&2
    exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Updating $INKLE_DIR/inklecate_linux from $INKLEKATE_BASE/inklecate_linux.zip ..."
curl -fsSL -o "$TMP_DIR/inklecate_linux.zip" "$INKLEKATE_BASE/inklecate_linux.zip"
unzip -o -q "$TMP_DIR/inklecate_linux.zip" inklecate -d "$TMP_DIR"
cp "$TMP_DIR/inklecate" "$INKLE_DIR/inklecate_linux"
chmod +x "$INKLE_DIR/inklecate_linux"

echo
echo "inklecate_linux updated from the latest inkle/ink release."
echo "Commit it with 'git add $INKLE_DIR/' (Git LFS will pick up the new object)."