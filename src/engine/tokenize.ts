/**
 * Step 1 + 2 of the pipeline: tokenize the sentence and normalise each word to
 * a canonical schedule vocabulary, using the tiny on-device model for words the
 * exact lexicon does not know (typos, odd spellings).
 */
import LEX from './lexicon.json';
import { predictToken, MODEL_INFO } from './model/tinyModel';

export type Role = 'interval' | 'time' | 'day' | 'month' | 'except' | 'connector' | 'filler';

export type Tok =
  | { k: 'num'; v: number; src: number }
  | { k: 'ord'; v: number; src: number }
  | { k: 'time'; h: number; m: number; src: number }
  | { k: 'minmark'; v: number; src: number }
  | { k: 'w'; v: string; src: number }
  | { k: 'dash'; src: number }
  | { k: 'comma'; src: number }
  | { k: 'unk'; raw: string; stop: boolean; src: number };

export interface Piece {
  text: string;
  role: Role;
  corrected?: string;
  prob?: number;
}

export interface Correction {
  from: string;
  to: string;
  prob: number;
}

export interface Tokenized {
  toks: Tok[];
  pieces: Piece[];
  corrections: Correction[];
}

const ALIAS = new Map<string, string>();
for (const [canon, aliases] of Object.entries(LEX.words as Record<string, string[]>)) {
  for (const a of aliases) ALIAS.set(a, canon);
  ALIAS.set(canon, canon);
}
const EXPANSIONS = LEX.expansions as Record<string, string[]>;
const NUMBERS = LEX.numbers as Record<string, number>;
const ORDINALS = LEX.ordinals as Record<string, number>;
const STOP = new Set(LEX.stopwords as string[]);

/** Minimum model probability to accept a correction. */
export const MODEL_THRESHOLD = 0.6;

/** Levenshtein distance (small strings only). */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Second opinion on a model correction: the typed word must look like the label. */
function plausible(raw: string, label: string): boolean {
  const forms = [label, ...((LEX.words as Record<string, string[]>)[label] ?? [])].filter((f) => f.length >= 4);
  const best = Math.min(...forms.map((f) => editDistance(raw, f)));
  const isPrefix = label.startsWith(raw.slice(0, Math.max(4, raw.length - 1)));
  return best <= Math.max(2, Math.floor(0.4 * label.length)) || isPrefix;
}

function preprocess(text: string): string {
  return text
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\b([ap])\.\s?m\.?/g, '$1m')
    .replace(/\bo['’]?\s?clock\b/g, ' oclock')
    .replace(/['’]s\b/g, 's')
    .replace(/(\d{1,2})h(\d{2})\b/g, '$1:$2')
    .replace(/\b(twenty|thirty|forty|fifty)-(?=[a-z])/g, '$1 ')
    .replace(/\bnoon\b/g, ' noon ');
}

const TOKEN_RE = /(?<!\d):\d{2}(?!\d)|\d{1,2}[:.]\d{2}(?!\d)|\d+(?:st|nd|rd|th)\b|\d+|[a-z]+|[-,&@]/g;

type NoSrc<T> = T extends unknown ? Omit<T, 'src'> : never;
type Resolved = { toks: NoSrc<Tok>[] } | null;

function resolveWord(w: string): Resolved {
  if (EXPANSIONS[w]) {
    return {
      toks: EXPANSIONS[w].map((x) => (/^\d+$/.test(x) ? { k: 'num', v: parseInt(x, 10) } : { k: 'w', v: x })) as NoSrc<Tok>[],
    };
  }
  if (w in NUMBERS) return { toks: [{ k: 'num', v: NUMBERS[w] }] };
  if (w in ORDINALS) return { toks: [{ k: 'ord', v: ORDINALS[w] }] };
  const c = ALIAS.get(w);
  if (c) return { toks: [{ k: 'w', v: c }] };
  return null;
}

export function tokenize(text: string, opts: { useModel?: boolean } = {}): Tokenized {
  const pre = preprocess(text);
  const raws = pre.match(TOKEN_RE) ?? [];
  const toks: Tok[] = [];
  const pieces: Piece[] = [];
  const corrections: Correction[] = [];

  raws.forEach((raw, src) => {
    pieces.push({ text: raw, role: 'filler' });
    let m: RegExpExecArray | null;
    if ((m = /^:(\d{2})$/.exec(raw))) {
      toks.push({ k: 'minmark', v: parseInt(m[1], 10), src });
    } else if ((m = /^(\d{1,2})[:.](\d{2})$/.exec(raw))) {
      toks.push({ k: 'time', h: parseInt(m[1], 10), m: parseInt(m[2], 10), src });
    } else if ((m = /^(\d+)(st|nd|rd|th)$/.exec(raw))) {
      toks.push({ k: 'ord', v: parseInt(m[1], 10), src });
    } else if (/^\d+$/.test(raw)) {
      toks.push({ k: 'num', v: parseInt(raw, 10), src });
    } else if (raw === '-') {
      toks.push({ k: 'dash', src });
    } else if (raw === ',') {
      toks.push({ k: 'comma', src });
    } else if (raw === '&') {
      toks.push({ k: 'w', v: 'and', src });
    } else if (raw === '@') {
      toks.push({ k: 'w', v: 'at', src });
    } else {
      let res = resolveWord(raw);
      if (!res && STOP.has(raw)) {
        toks.push({ k: 'unk', raw, stop: true, src });
        return;
      }
      // plural / possessive fallback ("mondays", "15ths")
      if (!res && raw.endsWith('s')) res = resolveWord(raw.slice(0, -1));
      if (!res && opts.useModel !== false && raw.length >= MODEL_INFO.minLen) {
        const p = predictToken(raw);
        if (p.label !== '__other__' && p.prob >= MODEL_THRESHOLD && plausible(raw, p.label)) {
          res = resolveWord(p.label);
          if (res) {
            corrections.push({ from: raw, to: p.label, prob: p.prob });
            pieces[src].corrected = p.label;
            pieces[src].prob = p.prob;
          }
        }
      }
      if (res) for (const t of res.toks) toks.push({ ...(t as Tok), src });
      else toks.push({ k: 'unk', raw, stop: false, src });
    }
  });

  // Compose number words: "twenty five" -> 25, "twenty first" -> 21st
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = toks[i + 1];
    const fromTensWord = t.k === 'num' && [20, 30, 40, 50].includes(t.v) && /^[a-z]+$/.test(pieces[t.src].text);
    if (t.k === 'num' && fromTensWord && n) {
      if (n.k === 'num' && n.v > 0 && n.v < 10) {
        out.push({ k: 'num', v: t.v + n.v, src: t.src });
        i++;
        continue;
      }
      if (n.k === 'ord' && n.v > 0 && n.v < 10) {
        out.push({ k: 'ord', v: t.v + n.v, src: t.src });
        i++;
        continue;
      }
      if (n.k === 'w' && n.v === 'second') {
        out.push({ k: 'ord', v: t.v + 2, src: t.src });
        i++;
        continue;
      }
    }
    out.push(t);
  }
  return { toks: out, pieces, corrections };
}
