/**
 * Fix service-worker.js for bundling:
 * 1. Replace remote Firebase imports with local npm packages
 * 2. Fix broken console.log/error calls (missing function name before string args)
 */
const fs = require('fs');

let content = fs.readFileSync('src/service-worker.js', 'utf8');

// Step 1: Fix imports
content = content.replace(
  'from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"',
  'from "firebase/app"'
);
content = content.replace(
  'from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"',
  'from "firebase/auth/web-extension"'
);
content = content.replace(
  'from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js"',
  'from "firebase/firestore"'
);
content = content.replace(
  'from "../src/services/cryptoService.js"',
  'from "./services/cryptoService.js"'
);

// Step 2: Fix broken console.log/error calls
// The file has lines where console.log( was removed but the arguments remain.
// Pattern: orphaned string "ZyncIT:..." that should have been inside console.log()
//
// Strategy: Use regex to find patterns like:
//   <indent>"string",\n<indent>value,\n<indent>);
// And either:
//   a) If preceded by console.log( or console.error( on prev line, combine them  
//   b) If standalone, wrap with console.log(...)
//   c) If uncombineable, just remove them

// First approach: find all console.log(\n and console.error(\n patterns (split across lines)
// and merge them into single lines
content = content.replace(
  /console\.log\(\n\s+/g,
  'console.log('
);
content = content.replace(
  /console\.error\(\n\s+/g,
  'console.error('
);

// Now find orphaned string literals that are on their own line starting with "ZyncIT: or similar
// These patterns look like:
//   "string",\n  value,\n);
// preceded by various code
// 
// The safest approach: find blocks that start with an orphaned string 
// (a line that starts with just a string and has stuff after like , or );)
// and remove them along with the trailing );

const lines = content.split('\n');
const result = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];
  const trimmed = line.trim();
  const indent = line.match(/^(\s*)/)[1];
  
  // Check if this is an orphaned string arg from a removed console.log
  // Pattern: line starts with "ZyncIT: or "docId: or other debug strings
  // and is NOT inside a valid expression (not after = or inside an array/object)
  if (/^\s+"(ZyncIT:|docId:|users|devices|notifications|seenNotifications|lastNotificationTimestamp|- |seconds|\] -|:)/.test(line)) {
    const prevLine = result.length > 0 ? result[result.length - 1].trim() : '';
    
    // Check if it's a valid context (array element in chrome.storage.local.remove)
    if (prevLine.includes('remove([') || prevLine.includes('"seenNotifications"')) {
      result.push(line);
      i++;
      continue;
    }
    
    // This is an orphaned debug string - skip it and any following orphaned args + closing );
    while (i < lines.length) {
      const t = lines[i].trim();
      i++;
      if (t === ');' || t === '' ) break;
      // If next line is real code (not string args), stop
      if (i < lines.length) {
        const next = lines[i].trim();
        if (next.startsWith('if') || next.startsWith('const') || next.startsWith('let') || 
            next.startsWith('var') || next.startsWith('return') || next.startsWith('//') ||
            next.startsWith('for') || next.startsWith('}') || next.startsWith('chrome.') ||
            next.startsWith('show') || next.startsWith('await') || next.startsWith('seenNotif') ||
            next.startsWith('send') || next === '') {
          break;
        }
      }
    }
    continue;
  }
  
  // Also handle console.log("string", value, console.log("string", ... (nested broken)
  // Where console.log is on the line but arguments reference other console.log calls
  if (/^\s*console\.log\(".*",\s*$/.test(line)) {
    // Check if next line has console.log or another string (broken multi-line)
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (nextLine.startsWith('console.log(') || nextLine.startsWith('"')) {
      // Skip this entire broken console.log block
      let depth = 0;
      for (const ch of trimmed) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
      }
      i++;
      while (i < lines.length && depth > 0) {
        const t = lines[i].trim();
        for (const ch of t) {
          if (ch === '(') depth++;
          if (ch === ')') depth--;
        }
        i++;
      }
      continue;
    }
  }
  
  result.push(line);
  i++;
}

fs.writeFileSync('src/service-worker.js', result.join('\n'), 'utf8');
console.log(`Lines: ${lines.length} -> ${result.length}`);

// Verify no syntax issues by trying to parse
try {
  // Quick check for obvious issues
  const final = fs.readFileSync('src/service-worker.js', 'utf8');
  const orphanedStrings = final.split('\n').filter((l, idx) => {
    const t = l.trim();
    return /^"(ZyncIT|docId|users|devices|notif|- |seconds|\])/.test(t) && 
           !l.includes('remove([') && !l.includes('"seenNotifications"');
  });
  if (orphanedStrings.length > 0) {
    console.log('WARNING: Still has orphaned strings:');
    orphanedStrings.forEach(s => console.log('  ' + s.trim().substring(0, 60)));
  } else {
    console.log('No orphaned strings remaining!');
  }
} catch(e) {
  console.error('Error:', e.message);
}
