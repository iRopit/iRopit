/**
 * Patch script to remove ALL remotely-hosted code references from Firebase bundles
 * This is required for Chrome Web Store Manifest V3 compliance
 * 
 * Firebase Auth SDK includes code for reCAPTCHA and Google APIs even in the
 * web-extension variant. This script strips ALL traces of external script
 * loading to satisfy Chrome Web Store automated review tools.
 */

const fs = require('fs');
const path = require('path');

const bundleFiles = [
  path.join(__dirname, 'popup', 'popup.bundle.js'),
  path.join(__dirname, 'popup', 'sms-window.bundle.js'),
  path.join(__dirname, 'background', 'service-worker.js')
];

function patchBundle(filePath) {
  console.log(`Patching ${filePath}...`);
  
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} does not exist, skipping...`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Remove ANY external URL strings (catch-all for Google hosted scripts)
  const urlPatterns = [
    /["']https:\/\/apis\.google\.com\/js\/api\.js["']/g,
    /["']https:\/\/www\.google\.com\/recaptcha\/api\.js["']/g,
    /["']https:\/\/www\.google\.com\/recaptcha\/enterprise\.js\?render=["']/g,
  ];
  urlPatterns.forEach((pattern, i) => {
    if (pattern.test(content)) {
      content = content.replace(pattern, '""');
      modified = true;
      console.log(`  ✓ Removed external URL pattern #${i + 1}`);
    }
  });

  // 2. Replace _loadJS function - no external script loading allowed
  content = content.replace(
    /function _loadJS\(url\) \{\s*return externalJSProvider\.loadJS\(url\);\s*\}/g,
    'function _loadJS(url) { return Promise.reject(new Error("disabled")); }'
  );

  // 3. Replace _recaptchaEnterpriseScriptUrl to return empty
  content = content.replace(
    /function _recaptchaEnterpriseScriptUrl\(\) \{\s*return externalJSProvider\.recaptchaEnterpriseScript;\s*\}/g,
    'function _recaptchaEnterpriseScriptUrl() { return ""; }'
  );

  // 4. Replace recaptcha verifier's verify method to use mock token
  // This prevents any attempt to load the recaptcha enterprise script
  content = content.replace(
    /let url = _recaptchaEnterpriseScriptUrl\(\);[\s\S]*?_loadJS\(url\)\.then\(\(\) => \{[\s\S]*?\}\)\.catch\(\(error\) => \{[\s\S]*?reject\(error\);[\s\S]*?\}\);/g,
    'reject(new Error("RecaptchaVerifier not available in extension"));'
  );

  // 5. Strip any remaining createElement("script") patterns
  content = content.replace(
    /document\.createElement\(["']script["']\)/g,
    'document.createElement("span") /* script disabled */'
  );

  // 6. Replace the entire externalJSProvider config block (minified version)  
  content = content.replace(
    /loadJS\(n\)\{return new Promise\(\(e,t\)=>\{let s=document\.createElement\("script"\);[^}]+\}\)\}/g,
    'loadJS(){return Promise.reject(new Error("disabled"))}'
  );

  // 7. Replace config object with Google URLs (minified version)
  content = content.replace(
    /gapiScript:"https:\/\/apis\.google\.com\/js\/api\.js"/g,
    'gapiScript:""'
  );
  content = content.replace(
    /recaptchaV2Script:"https:\/\/www\.google\.com\/recaptcha\/api\.js"/g,
    'recaptchaV2Script:""'
  );
  content = content.replace(
    /recaptchaEnterpriseScript:"https:\/\/www\.google\.com\/recaptcha\/enterprise\.js\?render="/g,
    'recaptchaEnterpriseScript:""'
  );

  // Final verification
  const violations = [];
  if (/https:\/\/apis\.google\.com/.test(content)) violations.push('apis.google.com');
  if (/https:\/\/www\.google\.com\/recaptcha/.test(content)) violations.push('google.com/recaptcha');
  if (/createElement\(["']script["']\)/.test(content)) violations.push('createElement("script")');

  if (violations.length > 0) {
    console.error(`  ❌ WARNING: Still found violations: ${violations.join(', ')}`);
  } else {
    console.log('  ✓ All remote code references removed');
    console.log('  ✓ No createElement("script") found');
    console.log('  ✓ Compliance verification PASSED');
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Patched ${filePath}\n`);
}

// Patch all bundle files
console.log('Starting bundle patching process...\n');
bundleFiles.forEach(patchBundle);
console.log('Bundle patching complete!');

