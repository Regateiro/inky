#!/bin/sh
# Update the inklecate compiler binary for Linux from the latest inkle/ink
# release.
#
# Uses GitHub's 'latest release' download URLs, which redirect to the newest
# release's assets directly, e.g.:
#   https://github.com/inkle/ink/releases/latest/download/inklecate_linux.zip
#
# The binary lives in app/main-process/ink/ and is tracked with Git LFS (it
# exceeds GitHub's regular file limits). The release tag (from the GitHub
# API) is also written to app/main-process/ink/version.txt, which the About
# dialog displays. After running this script you must re-add the files so Git
# LFS stores the new object, e.g.:
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

# Keep version.txt (read by the About dialog) in sync with the release tag.
# This can fail (no network, API shape change), so don't abort the script.
if RELEASE_TAG="$(curl -fsSL --max-time 30 https://api.github.com/repos/inkle/ink/releases/latest 2>/dev/null \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' \
    | sed -E 's/^v//')"; then
    printf '%s' "$RELEASE_TAG" > "$INKLE_DIR/version.txt"
    echo "version.txt updated to $RELEASE_TAG"
else
    echo "warning: could not determine the release version; leaving version.txt unchanged" >&2
fi

echo
echo "inklecate_linux updated from the latest inkle/ink release."
echo "Commit it with 'git add $INKLE_DIR/' (Git LFS will pick up the new object)."