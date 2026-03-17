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

# Create directories
mkdir -p "$RELEASE_DIR"

CURRENT_VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
echo "Current version: $CURRENT_VERSION"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"
echo "New version will be: $NEW_VERSION"

echo "Installing dependencies..."
npm install

echo "Running tests..."
npm test
echo "Tests passed."

# Generate release notes in memory
echo "Generating release notes..."
# Find the most recent version tag (excluding Pre-Release)
PREVIOUS_TAG=$(git tag --list "v*" --sort=-version:refname | grep -v "Pre-Release" | head -n1)
if [ -z "$PREVIOUS_TAG" ]; then
    PREVIOUS_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
fi
RELEASE_NOTES=""

# Build release notes string
RELEASE_NOTES="# Release v$NEW_VERSION - $(date +%Y-%m-%d)

## 🎉 New Features
"

if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "HEAD" ]; then
    RELEASE_NOTES+="$(git log --oneline "$PREVIOUS_TAG..HEAD" --grep="feat:" --pretty=format:"- %s" | sed 's/feat: //')
"
else
    RELEASE_NOTES+="- Initial release
"
fi

RELEASE_NOTES+="
## 🐛 Bug Fixes
"

if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "HEAD" ]; then
    RELEASE_NOTES+="$(git log --oneline "$PREVIOUS_TAG..HEAD" --grep="fix:" --pretty=format:"- %s" | sed 's/fix: //')
"
else
    RELEASE_NOTES+="- No bug fixes
"
fi

RELEASE_NOTES+="
## 🔧 Improvements
- Version bump to $NEW_VERSION

## 📦 Installation
\`\`\`bash
npm install
\`\`\`

## 🔄 Upgrade Instructions
- From v$CURRENT_VERSION: Download the new version from releases page

## 🏷️ Version Information
- Client Version: $NEW_VERSION
- Release Date: $(date +%Y-%m-%d)
- Git Tag: v$NEW_VERSION"

echo "Release notes generated for GitHub release"

echo "Bumping version to $NEW_VERSION..."
node -e "
const fs = require('fs');
const pkg = require('$PROJECT_DIR/package.json');
pkg.version = '$NEW_VERSION';
fs.writeFileSync('$PROJECT_DIR/package.json', JSON.stringify(pkg, null, 2) + '\n');
"

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

echo "Generating SHA-256 checksums..."
if ! command -v sha256sum &> /dev/null; then
    echo "Error: sha256sum is not available. Cannot generate checksums." >&2
    exit 1
fi
rm -f checksums.txt
for artifact in Ember-Portable.exe EmberSetup.exe Ember.AppImage Ember.deb; do
    if [ -f "$artifact" ]; then
        sha256sum "$artifact" >> checksums.txt
        echo "  Checksummed $artifact"
    fi
done
echo "checksums.txt created:"
cat checksums.txt

echo "Creating GitHub release v$NEW_VERSION..."
ASSETS=""
[ -f "Ember-Portable.exe" ] && ASSETS="$ASSETS Ember-Portable.exe"
[ -f "EmberSetup.exe" ] && ASSETS="$ASSETS EmberSetup.exe"
[ -f "Ember.AppImage" ] && ASSETS="$ASSETS Ember.AppImage"
[ -f "Ember.deb" ] && ASSETS="$ASSETS Ember.deb"
[ -f "checksums.txt" ] && ASSETS="$ASSETS checksums.txt"

# Use the generated release notes directly for GitHub release
gh release create "v$NEW_VERSION" \
    --repo "$REPO" \
    --title "Ember Client v$NEW_VERSION" \
    --notes "$RELEASE_NOTES" \
    --latest \
    $ASSETS

cd "$PROJECT_DIR"
echo "Committing version bump..."
git add package.json
git add package-lock.json
git commit -m "release: v$NEW_VERSION - $(git log --oneline $(git describe --tags --abbrev=0 2>/dev/null || echo '')..HEAD --grep="feat\|fix" | wc -l | tr -d ' ') commits"

echo "Creating and pushing git tag..."
git tag "v$NEW_VERSION"
git push origin "v$NEW_VERSION"
git push

echo ""
echo "=== Release v$NEW_VERSION published successfully! ==="
echo "View at: https://github.com/$REPO/releases/tag/v$NEW_VERSION"

echo "Cleaning up..."
rm -rf $RELEASE_DIR/*
