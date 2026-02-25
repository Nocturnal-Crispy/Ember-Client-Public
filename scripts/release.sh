#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

REPO="Nocturnal-Crispy/Ember-Client-Public"
RELEASE_DIR="$PROJECT_DIR/release"

echo "=== Ember Client Release Script ==="

if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

CURRENT_VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
echo "Current version: $CURRENT_VERSION"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
echo "New version: $NEW_VERSION"

echo "Updating package.json version..."
node -e "
const fs = require('fs');
const pkg = require('$PROJECT_DIR/package.json');
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$PROJECT_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "Installing dependencies..."
npm install

echo "Building release artifacts..."
npm run dist:linux
npm run dist:win

echo "Renaming artifacts..."
cd "$RELEASE_DIR"

PORTABLE_SRC="Ember ${NEW_VERSION}.exe"
SETUP_SRC="Ember Setup ${NEW_VERSION}.exe"
APPIMAGE_SRC="Ember-${NEW_VERSION}.AppImage"
DEB_SRC="ember-client_${NEW_VERSION}_amd64.deb"

if [ -f "$PORTABLE_SRC" ]; then
    cp "$PORTABLE_SRC" "Ember-Portable.exe"
    echo "  Created Ember-Portable.exe"
fi

if [ -f "$SETUP_SRC" ]; then
    cp "$SETUP_SRC" "EmberSetup.exe"
    echo "  Created EmberSetup.exe"
fi

if [ -f "$APPIMAGE_SRC" ]; then
    cp "$APPIMAGE_SRC" "Ember.AppImage"
    echo "  Created Ember.AppImage"
fi

if [ -f "$DEB_SRC" ]; then
    cp "$DEB_SRC" "Ember.deb"
    echo "  Created Ember.deb"
fi

echo "Creating GitHub pre-release v$NEW_VERSION..."
ASSETS=""
[ -f "Ember-Portable.exe" ] && ASSETS="$ASSETS Ember-Portable.exe"
[ -f "EmberSetup.exe" ] && ASSETS="$ASSETS EmberSetup.exe"
[ -f "Ember.AppImage" ] && ASSETS="$ASSETS Ember.AppImage"
[ -f "Ember.deb" ] && ASSETS="$ASSETS Ember.deb"

gh release create "v$NEW_VERSION" \
    --repo "$REPO" \
    --title "Pre-Release" \
    --notes "Ember Client v$NEW_VERSION" \
    --latest \
    $ASSETS

cd "$PROJECT_DIR"
echo "Committing version bump..."
git add package.json
git add package-lock.json
git commit -m "Bump version to $NEW_VERSION"
git push

echo ""
echo "=== Release v$NEW_VERSION published successfully! ==="
echo "View at: https://github.com/$REPO/releases/tag/v$NEW_VERSION"


echo "Cleaning up..."
rm -rf "$RELEASE_DIR/*"
