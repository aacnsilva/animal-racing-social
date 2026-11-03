import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Hit = { file: string; line: number };

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
  return Math.max(i + 1, start + 1);
}

function skipRustRawString(source: string, start: number): number {
  let i = start + 1;
  let hashes = 0;
  while (source[i] === '#') {
    hashes++;
    i++;
  }
  const terminator = '"' + '#'.repeat(hashes);
  const end = source.indexOf(terminator, i + 1);
  return end === -1 ? source.length : end + terminator.length;
}

function skipRustCharOrLifetime(source: string, start: number): number {
  const charLiteral = /^'(\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]{1,6}\}|.)|[^\\'])'/su.exec(source.slice(start, start + 12));
  return charLiteral ? start + charLiteral[0].length : start + 1;
}

function skipBlockComment(source: string, start: number, nested: boolean): number {
  let depth = 1;
  let i = start + 2;
  while (i < source.length && depth > 0) {
    if (nested && source.startsWith('/*', i)) {
      depth++;
      i += 2;
    } else if (source.startsWith('*/', i)) {
      depth--;
      i += 2;
    } else i++;
  }
  return i;
}

function rustComments(file: string, source: string): Hit[] {
  const hits: Hit[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i, i + 3);
    if (rest.startsWith('//')) {
      hits.push({ file, line: lineAt(source, i) });
      i = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
    } else if (rest.startsWith('/*')) {
      hits.push({ file, line: lineAt(source, i) });
      i = skipBlockComment(source, i, true);
    } else if (/^b?r#*"/.test(source.slice(i, i + 8)) && !/\w/.test(source[i - 1] ?? '')) {
      i = skipRustRawString(source, i + rest.indexOf('r'));
    } else if (source[i] === '"') {
      i = skipQuoted(source, i, '"');
    } else if (source[i] === "'") {
      i = skipRustCharOrLifetime(source, i);
    } else i++;
  }
  return hits;
}

function cssComments(file: string, source: string): Hit[] {
  const hits: Hit[] = [];
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('/*', i)) {
      hits.push({ file, line: lineAt(source, i) });
      i = skipBlockComment(source, i, false);
    } else if (source[i] === '"' || source[i] === "'") {
      i = skipQuoted(source, i, source[i]);
    } else i++;
  }
  return hits;
}

const files = execFileSync('git', ['ls-files', '*.rs', '*.css'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const hits = files.flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return file.endsWith('.rs') ? rustComments(file, source) : cssComments(file, source);
});

for (const hit of hits) console.error(`${hit.file}:${hit.line}: code comments are not allowed`);
if (hits.length > 0) process.exit(1);
