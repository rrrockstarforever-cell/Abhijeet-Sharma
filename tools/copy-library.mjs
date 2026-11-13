// Copies the study library database into build/library so the installer can ship it inside the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const source = process.env.PULSE_LIBRARY_DB || path.join(os.homedir(), '.pulse-med', 'books', 'pulse-library.db');
const target = path.join('build', 'library', 'pulse-library.db');

if (!fs.existsSync(source)) {
  console.error(`Library database not found at ${source}. Set PULSE_LIBRARY_DB to its location and try again.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied library database (${(fs.statSync(target).size / 1048576).toFixed(0)} MB) to ${target}`);

// The learner's own rebuilt books ("My books" in Practice Builder). Shipped when present; the build goes on without them.
const booksSource = process.env.PULSE_MYBOOKS_DB || path.join(os.homedir(), '.pulse-med', 'books', 'pulse-mybooks.db');
const booksTarget = path.join('build', 'library', 'pulse-mybooks.db');
if (fs.existsSync(booksSource)) {
  fs.copyFileSync(booksSource, booksTarget);
  console.log(`Copied my-books database (${(fs.statSync(booksTarget).size / 1048576).toFixed(0)} MB) to ${booksTarget}`);
} else {
  console.warn(`My-books database not found at ${booksSource}; the installer will not include it.`);
}
