/**
 * Custom esbuild plugin to remove remotely-hosted code for Chrome Extension compliance
 */

const fs = require('fs');
const path = require('path');

const removeRemoteCodePlugin = {
  name: 'remove-remote-code',
  setup(build) {
    // Intercept Firebase auth dependencies that contain remote script URLs
    build.onLoad({ filter: /@firebase\/auth.*\.js$/ }, async (args) => {
      let contents = await fs.promises.readFile(args.path, 'utf8');
      
      // Replace the problematic URLs in Firebase auth code
      contents = contents.replace(
        /"https:\/\/apis\.google\.com\/js\/api\.js"/g,
        '""'
      );
      contents = contents.replace(
        /"https:\/\/www\.google\.com\/recaptcha\/api\.js"/g,
        '""'
      );
      contents = contents.replace(
        /"https:\/\/www\.google\.com\/recaptcha\/enterprise\.js\?render="/g,
        '""'
      );
      
      // Disable the loadJS function that would load external scripts
      contents = contents.replace(
        /loadJS\s*\([^)]+\)\s*\{[^}]+createElement\(['"']script['"']\)[^}]+\}/g,
        'loadJS(_) { return Promise.reject(new Error("External scripts disabled in extension")); }'
      );
      
      return {
        contents,
        loader: 'js',
      };
    });
  },
};

module.exports = { removeRemoteCodePlugin };
