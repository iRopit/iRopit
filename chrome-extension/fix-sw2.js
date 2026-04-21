/**
 * Aggressively fix all broken console.log/error calls in service-worker.js
 * by removing them entirely (they're debug logging that doesn't affect functionality)
 */
const fs = require('fs');

let content = fs.readFileSync('src/service-worker.js', 'utf8');

// Remove all broken console.log( lines that span multiple lines incorrectly
// Pattern: console.log("...", followed by more stuff on next lines ending with );
// These are NOT valid JS because they're missing closing parens or have nested console.log

const lines = content.split('\n');
const result = [];
let skip = false;
let brokenLogDepth = 0;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  
  if (skip) {
    // Look for the line that closes this broken block
    // Count parens
    for (const ch of trimmed) {
      if (ch === '(') brokenLogDepth++;
      if (ch === ')') brokenLogDepth--;
    }
    if (brokenLogDepth <= 0) {
      skip = false;
    }
    continue;
  }
  
  // Detect broken console.log patterns:
  // 1. console.log("string",  (without closing paren on same line or valid expression)
  if (/^\s*console\.log\("[^"]*",?\s*$/.test(lines[i])) {
    skip = true;
    brokenLogDepth = 0;
    // Count parens in this line
    for (const ch of trimmed) {
      if (ch === '(') brokenLogDepth++;
      if (ch === ')') brokenLogDepth--;
    }
    if (brokenLogDepth <= 0) skip = false;
    continue;
  }
  
  // 2. console.log("string", value, ... with nested console.log (always broken)
  if (/^\s*console\.log\("/.test(lines[i]) && i + 1 < lines.length) {
    const nextTrimmed = lines[i + 1].trim();
    if (nextTrimmed.startsWith('console.log(') || /^[a-zA-Z]/.test(nextTrimmed)) {
      // Check if this is a valid single-line console.log
      const openParens = (trimmed.match(/\(/g) || []).length;
      const closeParens = (trimmed.match(/\)/g) || []).length;
      if (openParens > closeParens) {
        // Unclosed - broken multi-line
        skip = true;
        brokenLogDepth = openParens - closeParens;
        continue;
      }
    }
  }
  
  result.push(lines[i]);
}

fs.writeFileSync('src/service-worker.js', result.join('\n'), 'utf8');
console.log(`Lines: ${lines.length} -> ${result.length} (removed ${lines.length - result.length} broken log lines)`);
