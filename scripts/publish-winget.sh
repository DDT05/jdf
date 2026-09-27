#!/usr/bin/env bash
# Submit a new version to the WinGet community repository.
#
# Usage:
#   bash scripts/publish-winget.sh
#
# This script:
#   1. Reads the current version from tauri.conf.json
#   2. Downloads the NSIS installer from the GitHub release
#   3. Computes SHA256
#   4. Updates the local winget/ manifests
#   5. Submits to microsoft/winget-pkgs via wingetcreate (if available)
#      OR prints instructions for manual submission
#
# Requires: GITHUB_TOKEN in /.env

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

VERSION=$(node -p "require('./apps/reader/src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
PACKAGE_ID="UurTech.JDFReader"
GH_OWNER="uurtech"
GH_REPO="jdf"

# Expected installer filename (Tauri NSIS output format)
INSTALLER_NAME="JDF.Reader_${VERSION}_x64-setup.exe"
INSTALLER_URL="https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/${TAG}/${INSTALLER_NAME}"

echo "═══════════════════════════════════════════════════════"
echo "WinGet package submission: ${PACKAGE_ID} v${VERSION}"
echo "═══════════════════════════════════════════════════════"
echo "Installer URL: ${INSTALLER_URL}"

# Download installer and compute SHA256
TMPDIR=$(mktemp -d)
INSTALLER_PATH="${TMPDIR}/${INSTALLER_NAME}"

echo "→ Downloading installer..."
if command -v curl &>/dev/null; then
  HTTP_CODE=$(curl -sL -o "$INSTALLER_PATH" -w "%{http_code}" "$INSTALLER_URL")
  if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "302" ]]; then
    echo "✗ Download failed (HTTP $HTTP_CODE). Is the release published?"
    echo "  URL: $INSTALLER_URL"
    rm -rf "$TMPDIR"
    exit 1
  fi
else
  echo "✗ curl not found"
  exit 1
fi

SHA256=$(sha256sum "$INSTALLER_PATH" | awk '{print $1}')
echo "→ SHA256: ${SHA256}"
echo "→ Size: $(stat -c%s "$INSTALLER_PATH" 2>/dev/null || stat -f%z "$INSTALLER_PATH") bytes"

# Update local manifests
echo "→ Updating local winget/ manifests..."

MANIFEST_DIR="$REPO_ROOT/winget"

# Version manifest
cat > "$MANIFEST_DIR/${PACKAGE_ID}.yaml" <<EOF
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${VERSION}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
EOF

# Installer manifest
cat > "$MANIFEST_DIR/${PACKAGE_ID}.installer.yaml" <<EOF
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json
PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${VERSION}
Platform:
  - Windows.Desktop
MinimumOSVersion: 10.0.17763.0
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
  - silentWithProgress
InstallerSwitches:
  Silent: /S
  SilentWithProgress: /S
UpgradeBehavior: install
FileExtensions:
  - jdf
  - jdfx
Installers:
  - Architecture: x64
    InstallerUrl: ${INSTALLER_URL}
    InstallerSha256: ${SHA256}
ManifestType: installer
ManifestVersion: 1.6.0
EOF

# Locale manifest (version bump only)
sed -i.bak "s/^PackageVersion:.*/PackageVersion: ${VERSION}/" "$MANIFEST_DIR/${PACKAGE_ID}.locale.en-US.yaml"
rm -f "$MANIFEST_DIR/${PACKAGE_ID}.locale.en-US.yaml.bak"

echo "  ✓ Manifests updated"

# Try automated submission via wingetcreate
if command -v wingetcreate &>/dev/null || command -v wingetcreate.exe &>/dev/null; then
  echo "→ Submitting via wingetcreate..."
  wingetcreate update "${PACKAGE_ID}" \
    --version "${VERSION}" \
    --urls "${INSTALLER_URL}" \
    --submit \
    --token "${GITHUB_TOKEN:-}" \
    2>&1 || echo "  ⚠ wingetcreate submission failed (may need manual PR)"
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  # Use GitHub API to fork + create PR on microsoft/winget-pkgs
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "Manual submission required"
  echo "═══════════════════════════════════════════════════════"
  echo ""
  echo "wingetcreate not found. To submit manually:"
  echo ""
  echo "  1. Fork https://github.com/microsoft/winget-pkgs"
  echo "  2. Create directory: manifests/u/${PACKAGE_ID}/${VERSION}/"
  echo "  3. Copy these files into it:"
  echo "     - winget/${PACKAGE_ID}.yaml"
  echo "     - winget/${PACKAGE_ID}.installer.yaml"
  echo "     - winget/${PACKAGE_ID}.locale.en-US.yaml"
  echo "  4. Open a PR to microsoft/winget-pkgs"
  echo ""
  echo "  Or install wingetcreate:"
  echo "    winget install Microsoft.WinGetCreate"
  echo "    wingetcreate update ${PACKAGE_ID} --version ${VERSION} --urls '${INSTALLER_URL}' --submit --token \$GITHUB_TOKEN"
fi

rm -rf "$TMPDIR"

echo ""
echo "✓ Done. After merge, users can install via:"
echo "  winget install ${PACKAGE_ID}"
echo "  winget install --id ${PACKAGE_ID} --source winget"
