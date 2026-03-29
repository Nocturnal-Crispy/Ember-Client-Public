#!/usr/bin/env node
/**
 * Cross-platform native module rebuild for electron-builder.
 *
 * electron-builder's built-in @electron/rebuild does not pass --platform to
 * prebuild-install, so cross-compilation (e.g. Linux → Windows) downloads the
 * host-platform binary instead of the target-platform binary.
 *
 * This script is called via electron-builder's "beforePack" lifecycle hook.
 * It uses prebuild-install to download the correct prebuilt binary for
 * better-sqlite3 matching the target platform, arch, and Electron ABI.
 */

const { execSync } = require('child_process');
const path = require('path');

/**
 * @param {object} context — electron-builder beforePack context
 * @param {object} context.electronPlatformName — 'linux', 'win32', 'darwin'
 * @param {object} context.arch — electron-builder arch index (1=x64, 3=arm64, etc.)
 * @param {object} context.appOutDir — output directory
 */
module.exports = async function beforePack(context) {
  const archMap = { 1: 'x64', 3: 'arm64', 0: 'ia32' };
  const platform = context.electronPlatformName;
  const arch = archMap[context.arch] || 'x64';
  const electronVersion = context.packager.config.electronVersion
    || require('electron/package.json').version;

  console.log(`  • rebuild-native  platform=${platform} arch=${arch} electron=${electronVersion}`);

  const betterSqlite3Dir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');

  try {
    execSync(
      `npx prebuild-install --runtime electron --target ${electronVersion} --platform ${platform} --arch ${arch}`,
      { cwd: betterSqlite3Dir, stdio: 'inherit' }
    );
    console.log(`  • rebuild-native  better-sqlite3 prebuild installed for ${platform}-${arch}`);
  } catch (err) {
    console.error(`  • rebuild-native  prebuild-install failed, falling back to node-gyp`);
    execSync(
      `npx node-gyp rebuild --target=${electronVersion} --arch=${arch} --dist-url=https://electronjs.org/headers`,
      { cwd: betterSqlite3Dir, stdio: 'inherit' }
    );
  }
};
