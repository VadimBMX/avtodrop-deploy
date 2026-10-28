// Comments out of the CSS and JS the browser downloads (src/static.js; the files on disk keep them).
// The game's sources are commented for people, and the comments were ~15% of style.css and app.js and ~30% of
// shared.js even after brotli. Nothing else is touched: no renaming, no whitespace inside lines, no reordering.
// Both strippers walk the text with a small tokenizer (strings, template literals, regex literals, url()) and give
// back the original text whenever something doesn't add up (an unterminated string, template or comment), so a
// tokenizer mistake costs bytes, never a broken game.

const IDENT = /[\w\-\u0080-￿]/;

// CSS: every /* … */ goes. A comment between two characters that would otherwise join into one token stays as '/**/'.
export function stripCss(src) {
  const n = src.length;
  let out = '', i = 0, last = 0;
  const flush = (to) => { out += src.slice(last, to); };
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') return src;
        i++;
      }
      if (i >= n) return src;
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) return src;
      flush(i);
      const prev = out[out.length - 1], next = src[e + 2];
      if (prev && next && IDENT.test(prev) && IDENT.test(next)) out += '/**/';
      i = last = e + 2;
      continue;
    }
    if ((c === 'u' || c === 'U') && /^url\(\s*[^\s"')]/i.test(src.slice(i, i + 6)) && !IDENT.test(src[i - 1] || ' ')) {
      const e = src.indexOf(')', i);
      if (e < 0) return src;
      i = e + 1;
      continue;
    }
    i++;
  }
  flush(n);
  // Lines left empty by a removed comment go (whitespace elsewhere is kept as it is: a custom property's value
  // keeps its spacing in the CSSOM, so even a collapsed run would be a visible difference to scripts reading it).
  return out.replace(/\n[ \t]*(?=\n)/g, '').replace(/^[ \t]*\n/, '');
}

// JS: whole-line comments (// … and /* … */ alone on their lines) and comments at the end of a line of code go;
// a comment between code on the same line (a /* … */ inside an expression) stays. Line breaks of code lines stay,
// so automatic semicolon insertion sees the same program.
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
export function stripJs(src) {
  const n = src.length;
  const cut = []; // [from, to) ranges to drop
  const stack = []; // template literal nesting: brace depth at each `${`
  let depth = 0;
  let prev = ''; // last significant token kind: '' (start) | 'word:<w>' | 'num' | 'str' | 'regex' | punctuator
  let i = 0;
  const lineStart = (k) => { let j = k; while (j > 0 && (src[j - 1] === ' ' || src[j - 1] === '\t')) j--; return j === 0 || src[j - 1] === '\n' ? j : -1; };
  // Drop a comment [a, b): the whole line(s) when nothing else is on them, else the comment and the spaces before it.
  const drop = (a, b) => {
    let e = b;
    while (e < n && (src[e] === ' ' || src[e] === '\t' || src[e] === '\r')) e++;
    const atEol = e >= n || src[e] === '\n';
    const ls = lineStart(a);
    if (ls >= 0 && atEol) return cut.push([ls, e < n ? e + 1 : e]); // the line goes, with its line break
    if (atEol) {
      let s = a;
      while (s > 0 && (src[s - 1] === ' ' || src[s - 1] === '\t')) s--;
      return cut.push([s, e]);
    }
    // a comment in the middle of a line stays as it is
  };
  // Template literal body from i (just after ` or }); returns the index after the closing ` or after `${`.
  const template = () => {
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; return 'end'; }
      if (c === '$' && src[i + 1] === '{') { i += 2; return 'expr'; }
      i++;
    }
    return null;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      drop(i, end);
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) return src;
      drop(i, e + 2);
      i = e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') i++;
        else if (src[i] === '\n') return src;
        i++;
      }
      if (i >= n) return src;
      i++;
      prev = 'str';
      continue;
    }
    if (c === '`') {
      i++;
      const r = template();
      if (r === null) return src;
      if (r === 'expr') { stack.push(depth); depth = 0; prev = '('; } else prev = 'str';
      continue;
    }
    if (c === '/') {
      const word = prev.startsWith('word:') ? prev.slice(5) : null;
      const isRegex = prev === '' || (word ? REGEX_AFTER_WORD.has(word) : prev !== 'num' && prev !== 'str' && prev !== 'regex' && prev !== ')' && prev !== ']' && prev !== '}');
      if (isRegex) {
        i++;
        let cls = false;
        while (i < n) {
          const d = src[i];
          if (d === '\\') { i += 2; continue; }
          if (d === '\n') return src;
          if (cls) { if (d === ']') cls = false; }
          else if (d === '[') cls = true;
          else if (d === '/') break;
          i++;
        }
        if (i >= n) return src;
        i++;
        while (i < n && /[a-z]/i.test(src[i])) i++;
        prev = 'regex';
        continue;
      }
      i++;
      prev = '/';
      continue;
    }
    if (/[A-Za-z_$\u0080-￿]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$\u0080-￿]/.test(src[j])) j++;
      prev = 'word:' + src.slice(i, j);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      prev = 'num';
      i = j;
      continue;
    }
    if (c === '{') { depth++; prev = '{'; i++; continue; }
    if (c === '}') {
      if (depth === 0 && stack.length) {
        depth = stack.pop();
        i++;
        const r = template();
        if (r === null) return src;
        if (r === 'expr') { stack.push(depth); depth = 0; prev = '('; } else prev = 'str';
        continue;
      }
      depth--;
      prev = '}';
      i++;
      continue;
    }
    prev = c;
    i++;
  }
  if (stack.length || depth !== 0) return src;
  if (!cut.length) return src;
  let out = '', last = 0;
  for (const [a, b] of cut) {
    if (a < last) return src;
    out += src.slice(last, a);
    last = b;
  }
  return out + src.slice(last);
}
