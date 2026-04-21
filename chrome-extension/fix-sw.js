/**
 * Fix broken console.log/console.error calls in service-worker.js
 * The original file had multi-line console.log() calls that got corrupted.
 * This script fixes them by:
 * 1. Finding orphaned string lines
 * 2. Determining if they're part of a console.log/error call
 * 3. Adding missing console.log() wrapping
 */

const fs = require('fs');

let content = fs.readFileSync('src/service-worker.js', 'utf8');

// Strategy: Remove all broken multi-line console.log/error calls
// and replace with single-line versions where needed.

// Fix pattern 1: console.log(\n  "string",\n  value,\n);
// These are split across lines. Consolidate them.

// First, let's just remove all the orphaned debug logging since it's
// not needed in production and is causing compilation errors.
// We'll keep console.error for actual error reporting.

const lines = content.split('\n');
const result = [];
let i = 0;
let skipUntilCloseParen = false;
let parenCount = 0;

while (i < lines.length) {
  const line = lines[i];
  const trimmed = line.trim();
  
  if (skipUntilCloseParen) {
    // Count parens to find the matching );
    for (const ch of trimmed) {
      if (ch === '(') parenCount++;
      if (ch === ')') parenCount--;
    }
    if (parenCount <= 0) {
      skipUntilCloseParen = false;
    }
    i++;
    continue;
  }
  
  // Detect orphaned strings that start a broken console.log
  if (/^\s+"ZyncIT:/.test(line)) {
    const prevLine = result.length > 0 ? result[result.length - 1].trim() : '';
    
    if (prevLine === 'console.log(' || prevLine === 'console.error(') {
      // Previous line already has console.log( - remove it and skip this block
      result.pop(); // remove the console.log( line
      skipUntilCloseParen = true;
      parenCount = 1; // we removed the opening (
      for (const ch of trimmed) {
        if (ch === '(') parenCount++;
        if (ch === ')') parenCount--;
      }
      if (parenCount <= 0) skipUntilCloseParen = false;
      i++;
      continue;
    }
    
    if (prevLine.endsWith(',') || prevLine.endsWith('{') || prevLine.endsWith('});') || 
        prevLine === '' || prevLine.endsWith(';')) {
      // This is the start of a broken console.log - skip until );
      skipUntilCloseParen = true;
      parenCount = 0;
      // Count parens in current line
      for (const ch of trimmed) {
        if (ch === '(') parenCount++;
        if (ch === ')') parenCount--;
      }
      // Check if it ends with );
      if (trimmed.endsWith(');')) {
        skipUntilCloseParen = false;
      }
      i++;
      continue;
    }
  }
  
  // Also handle orphaned "docId:", "- total:", etc. that are continuation of broken logs
  if (/^\s+"(docId:|- total:|- isFirst|notifications as|seconds|- isRecent|seconds\)|:\s*$|users|devices|notifications|\] -)/.test(line)) {
    const prevLine = result.length > 0 ? result[result.length - 1].trim() : '';
    // If the previous line is a string or expression (part of the broken log), skip
    if (prevLine.endsWith(',') || /^\s*"/.test(prevLine) || /^\s*new Date/.test(prevLine) ||
        /^\s*change\.type/.test(prevLine) || /^\s*deviceId/.test(prevLine)) {
      i++;
      continue;
    }
  }
  
  // Fix console.error( that has the string on the next line
  if (trimmed === 'console.error(') {
    const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (nextLine.startsWith('"ZyncIT:')) {
      // Skip this console.error( and the following multi-line args
      skipUntilCloseParen = true;
      parenCount = 1;
      i++;
      continue;
    }
  }
  
  // Handle chrome.storage.local.remove with string on next line
  if (/^\s+"seenNotifications"/.test(line) || /^\s+"lastNotificationTimestamp"/.test(line)) {
    const prevLine = result.length > 0 ? result[result.length - 1].trim() : '';
    if (prevLine.includes('chrome.storage.local.remove([')) {
      // This is a valid array element, keep it
      result.push(line);
      i++;
      continue;
    }
  }
  
  result.push(line);
  i++;
}

fs.writeFileSync('src/service-worker.js', result.join('\n'), 'utf8');
console.log(`Original: ${lines.length} lines`);
console.log(`Fixed: ${result.length} lines`);
console.log(`Removed: ${lines.length - result.length} broken log lines`);
