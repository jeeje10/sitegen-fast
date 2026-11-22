// Fast drop-in for makefun-site 1.0.0 (make.fun site-generator-speed-01).
//
// run(input) returns exactly what makefun-site 1.0.0's build returns for the
// case's site: the output tree as a JSON object of path -> text. Same answers,
// faster: the Markdown lexer dispatches on the first character instead of
// running a battery of regular expressions on every line, the inline renderer
// escapes plain runs in bulk instead of one character at a time, front matter
// slices the body instead of splitting and rejoining the whole source, and
// slugs are cached. The template engine parses each template once (as the
// reference does) and renders into an array instead of concatenating strings.
//
// The semantics are makefun-site's own (README.md in the kit, code as the
// reference): its front-matter grammar, Markdown subset, template dialect,
// slug rule, link resolution and report. Nothing here reads the clock, the
// environment or a file: the output depends on the input alone.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_TEST = /[&<>"']/;

/**
 * `text` with & < > " and ' escaped. Most strings hold no escapable
 * character at all: a fast test returns those untouched, and only the rest
 * pay for the replace.
 */
function escapeHtml(text) {
  return ESCAPE_TEST.test(text) ? text.replace(ESCAPE_RE, (c) => ESCAPES[c]) : text;
}

const SLUG_MAX = 64;
const slugCache = new Map();

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run of
 * characters other than a-z and 0-9 one "-", none at either end, at most 64
 * characters (a "-" left at the cut dropped), and "untitled" when nothing is
 * left. Cached: the same titles and tag names recur across a site.
 */
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const code = plain.charCodeAt(i);
    let keep = -1;
    if (code >= 65 && code <= 90) keep = code + 32;
    else if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) keep = code;
    if (keep === -1) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  const result = out === '' ? 'untitled' : out;
  slugCache.set(text, result);
  return result;
}

/** `slug` made unique against `taken` (and added to it): slug, slug-2, ... */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** Whether `code` is a whitespace character, as JavaScript's \s reads it. */
function isWhitespace(code) {
  return code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 160 || code === 5760 || (code >= 8192 && code <= 8202) || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

/**
 * The words of a body: its runs of characters other than whitespace. Counted
 * by a scan, not by matching every word into an array first. ASCII whitespace
 * (every code at or below 32) takes the fast path; a character above 127 is
 * checked against JavaScript's full \s set.
 */
function wordsOf(text) {
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c <= 32 || (c > 127 && isWhitespace(c))) inWord = false;
    else if (!inWord) {
      inWord = true;
      words++;
    }
  }
  return words;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

/** The days of month `m` (1-12) of year `y`, by the Gregorian rule. */
function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** A string value: "..." with \" and \\ its only escapes, or bare (never opening on " or [). */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

const isKeyChar = (code) => (code >= 97 && code <= 122) || code === 95; // a-z _
const isSpaceTab = (code) => code === 32 || code === 9;

/**
 * A source's front matter and body: { data, body }, or { error } with the first
 * reason it is refused. `text` has "\n" line ends. The body is sliced, never
 * split and rejoined: only the front-matter region is split into lines.
 */
function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  // Find the closing line: "\n---" followed by "\n" or the end of the text.
  // The search starts at 3: the closing line may sit right under the opening
  // one ("---\n---\n..."), its "\n" at index 3.
  let close = -1;
  let closeEnd = -1;
  for (let p = text.indexOf('\n---', 3); p !== -1; p = text.indexOf('\n---', p + 1)) {
    if (p + 4 === text.length || text.charCodeAt(p + 4) === 10) {
      close = p;
      closeEnd = p + 4 === text.length ? text.length : p + 5;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  const fmLines = text.slice(4, close).split('\n');
  for (let k = 0; k < fmLines.length; k++) {
    const line = fmLines[k];
    // Blank lines (spaces and tabs only) and comments ("#" first) are skipped.
    let blank = true;
    for (let j = 0; j < line.length; j++) {
      if (!isSpaceTab(line.charCodeAt(j))) {
        blank = false;
        break;
      }
    }
    if (blank || line.charCodeAt(0) === 35) continue;
    // "key: value": a key of a-z and _, a colon, then either the end of the
    // line or one space and the value (its trailing spaces/tabs dropped).
    let ki = 0;
    while (ki < line.length && isKeyChar(line.charCodeAt(ki))) ki++;
    if (ki === 0 || line.charCodeAt(ki) !== 58) return { error: `line ${k + 2} is not "key: value"` };
    const key = line.slice(0, ki);
    let raw;
    if (ki + 1 === line.length) raw = '';
    else if (line.charCodeAt(ki + 1) === 32) raw = line.slice(ki + 2);
    else return { error: `line ${k + 2} is not "key: value"` };
    let end = raw.length;
    while (end > 0 && isSpaceTab(raw.charCodeAt(end - 1))) end--;
    raw = raw.slice(0, end);
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: text.slice(closeEnd) };
}

// ---------------------------------------------------------------- markdown

const isLangChar = (code) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95 || code === 43 || code === 45;
const isDigit = (code) => code >= 48 && code <= 57;

/** Whether `line` is blank: empty, or spaces and tabs only. */
function isBlankLine(line) {
  for (let j = 0; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Whether `line` is spaces and tabs only from `from` to its end. */
function restIsSpaceTab(line, from) {
  for (let j = from; j < line.length; j++) {
    const c = line.charCodeAt(j);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A fence-open line's language, or null: "```" + a language + spaces/tabs only. */
function fenceLang(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let j = 3;
  while (j < line.length && isLangChar(line.charCodeAt(j))) j++;
  return restIsSpaceTab(line, j) ? line.slice(3, j) : null;
}

/** Whether `line` closes a fence: "```" + spaces/tabs only. */
function isFenceClose(line) {
  return line.charCodeAt(0) === 96 && line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96 && restIsSpaceTab(line, 3);
}

/** A heading line's { depth, text }, or null: 1-6 "#", spaces/tabs, non-empty text. */
function headingOf(line) {
  if (line.charCodeAt(0) !== 35) return null;
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === 35) n++;
  if (n === 0 || n > 6 || n >= line.length || !isSpaceTab(line.charCodeAt(n))) return null;
  let start = n;
  while (start < line.length && isSpaceTab(line.charCodeAt(start))) start++;
  let end = line.length;
  while (end > start && isSpaceTab(line.charCodeAt(end - 1))) end--;
  if (end === start) return null;
  return { depth: n, text: line.slice(start, end) };
}

/** Whether `line` is a thematic break: "---" or "***" + spaces/tabs only. */
function isHr(line) {
  const c = line.charCodeAt(0);
  if (c !== 45 && c !== 42) return false;
  return line.charCodeAt(1) === c && line.charCodeAt(2) === c && restIsSpaceTab(line, 3);
}

/** Whether `line` ends a paragraph: blank, a fence, a heading or a break. */
function endsParagraph(line) {
  if (line.length === 0) return true;
  const c = line.charCodeAt(0);
  if (c === 32 || c === 9) return isBlankLine(line);
  if (c === 96) return fenceLang(line) !== null;
  if (c === 35) return headingOf(line) !== null;
  if (c === 45 || c === 42) return isHr(line);
  return false;
}

/** A line trimmed of spaces and tabs at both ends. */
function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && isSpaceTab(line.charCodeAt(a))) a++;
  while (b > a && isSpaceTab(line.charCodeAt(b - 1))) b--;
  return line.slice(a, b);
}

/** Whether `line` is a bullet item: "- " or "* " + anything. */
function isBullet(line) {
  const c = line.charCodeAt(0);
  return (c === 45 || c === 42) && line.charCodeAt(1) === 32;
}

/** An ordered item's number, or -1: 1-9 digits, ". ", anything. */
function orderedNumber(line) {
  let j = 0;
  while (j < line.length && isDigit(line.charCodeAt(j))) j++;
  if (j === 0 || j > 9) return -1;
  if (line.charCodeAt(j) !== 46 || line.charCodeAt(j + 1) !== 32) return -1;
  return Number(line.slice(0, j));
}

/** Whether `line` continues a list item: two or more spaces, then a non-space. */
function isContinued(line) {
  return line.charCodeAt(0) === 32 && line.charCodeAt(1) === 32 && line.length > 2 && !/\s/.test(line[2]);
}

/** `src`'s block tokens, in order. */
function lex(src) {
  const lines = src.split('\n');
  const tokens = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length === 0) {
      i++;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      if (isBlankLine(line)) {
        i++;
        continue;
      }
      // An indented line that is not blank is paragraph text.
    } else if (c0 === 96) {
      const lang = fenceLang(line);
      if (lang !== null) {
        const body = [];
        i++;
        while (i < lines.length && !isFenceClose(lines[i])) body.push(lines[i++]);
        i++;
        tokens.push({ type: 'code', lang, lines: body });
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        tokens.push({ type: 'heading', depth: heading.depth, text: heading.text });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHr(line)) {
        tokens.push({ type: 'hr' });
        i++;
        continue;
      }
      if (isBullet(line)) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          if (isBullet(l)) {
            items.push([trimLine(l.slice(2))]);
            i++;
          } else if (isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
          } else break;
        }
        tokens.push({ type: 'list', ordered: false, start: 1, items: items.map((parts) => parts.join('\n')) });
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < lines.length && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') kept.push(t);
      }
      tokens.push({ type: 'blockquote', lines: kept });
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const start = orderedNumber(line);
      if (start !== -1) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const num = orderedNumber(l);
          if (num !== -1) {
            const dot = l.indexOf('. ');
            items.push([trimLine(l.slice(dot + 2))]);
            i++;
          } else if (isContinued(l)) {
            items[items.length - 1].push(trimLine(l));
            i++;
          } else break;
        }
        tokens.push({ type: 'list', ordered: true, start, items: items.map((parts) => parts.join('\n')) });
        continue;
      }
    }
    // A paragraph: this line and the lines after it up to a blank line, a
    // fence, a heading or a thematic break.
    const body = [trimLine(line)];
    i++;
    while (i < lines.length && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    tokens.push({ type: 'paragraph', text: body.join('\n') });
  }
  return tokens;
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
