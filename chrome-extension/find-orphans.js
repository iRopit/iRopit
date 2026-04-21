// Find and fix all remaining orphaned string lines in service-worker.js
const fs = require('fs');
let content = fs.readFileSync('src/service-worker.js', 'utf8');
const lines = content.split('\n');

// Find orphaned strings (lines starting with a string literal that aren't part of an expression)
const orphanedLines = [];
for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  // Match lines starting with a string that aren't assignments, returns, imports, etc.
  if (/^"/.test(trimmed) && !trimmed.startsWith('"use strict"') && 
      !lines[i].includes('console.log') && !lines[i].includes('import') &&
      !lines[i].includes('=') && !lines[i].includes('from')) {
    orphanedLines.push({ line: i + 1, content: trimmed.substring(0, 80), prev: i > 0 ? lines[i-1].trim().substring(0, 80) : '' });
  }
}

console.log('Remaining orphaned string lines:', orphanedLines.length);
orphanedLines.forEach(o => {
  console.log(`  Line ${o.line}: ${o.content}`);
  console.log(`    prev: ${o.prev}`);
  console.log('');
});
