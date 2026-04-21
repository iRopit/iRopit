/**
 * Build script for Chrome extension
 * Bundles the extension and removes remotely-hosted code for Manifest V3 compliance
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function build() {
  console.log('Building Chrome extension...\n');

  // Check if Yarn PnP is interfering
  const pnpPath = path.join(__dirname, '..', '.pnp.cjs');
  const yarnrcPath = path.join(__dirname, '..', '.yarnrc.yml');
  let pnpDisabled = false;

  try {
    // Temporarily disable Yarn PnP if it exists
    if (fs.existsSync(pnpPath)) {
      console.log('⚠️  Yarn PnP detected, temporarily disabling for build...\n');
      fs.renameSync(pnpPath, pnpPath + '.bak');
      if (fs.existsSync(yarnrcPath)) {
        fs.renameSync(yarnrcPath, yarnrcPath + '.bak');
      }
      pnpDisabled = true;
    }

    // Build using esbuild CLI for better compatibility
    console.log('Building popup.bundle.js...');
    execSync(
      'npx esbuild src/popup.js --bundle --outfile=popup/popup.bundle.js --platform=browser --format=iife --tree-shaking=true',
      { cwd: __dirname, stdio: 'inherit' }
    );
    console.log('✅ popup.bundle.js built successfully\n');

    console.log('Building sms-window.bundle.js...');
    execSync(
      'npx esbuild src/sms-window.js --bundle --outfile=popup/sms-window.bundle.js --platform=browser --format=iife --tree-shaking=true',
      { cwd: __dirname, stdio: 'inherit' }
    );
    console.log('✅ sms-window.bundle.js built successfully\n');

    // Build service worker (replaces remote Firebase imports with bundled code)
    console.log('Building service-worker.js...');
    execSync(
      'npx esbuild src/service-worker.js --bundle --outfile=background/service-worker.js --platform=browser --format=esm --tree-shaking=true',
      { cwd: __dirname, stdio: 'inherit' }
    );
    console.log('✅ service-worker.js built successfully\n');

    // Run additional patching to ensure all remote URLs are removed
    console.log('Running post-build patch...');
    require('./patch-bundle');

    console.log('\n✅ Build completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Test the extension locally');
    console.log('2. Run: npm run zip to create the submission package');
    console.log('3. Submit to Chrome Web Store');
    
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  } finally {
    // Restore Yarn PnP if it was disabled
    if (pnpDisabled) {
      console.log('\n🔄 Restoring Yarn PnP configuration...');
      if (fs.existsSync(pnpPath + '.bak')) {
        fs.renameSync(pnpPath + '.bak', pnpPath);
      }
      if (fs.existsSync(yarnrcPath + '.bak')) {
        fs.renameSync(yarnrcPath + '.bak', yarnrcPath);
      }
      console.log('✅ Yarn PnP restored\n');
    }
  }
}

build();
