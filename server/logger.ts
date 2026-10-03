/**
 * Tiny size-capped rotating file logger (no dependencies).
 * Writes to stdout (for journalctl) and to <dir>/cronai.log, rotating to
 * cronai.log.1 … cronai.log.<maxFiles-1> when the file exceeds maxBytes.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'INFO' | 'WARN' | 'ERROR';

export function createLogger({ dir, maxBytes = 1_000_000, maxFiles = 3, name = 'cronai.log' }: { dir: string; maxBytes?: number; maxFiles?: number; name?: string }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);

  const rotate = () => {
    try {
      if (!existsSync(file) || statSync(file).size < maxBytes) return;
      const oldest = `${file}.${maxFiles - 1}`;
      if (existsSync(oldest)) unlinkSync(oldest);
      for (let i = maxFiles - 2; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
      renameSync(file, `${file}.1`);
    } catch {
      /* never let logging crash the server */
    }
  };

  const write = (level: Level, msg: string) => {
    const line = `${new Date().toISOString()} [${level}] ${msg}`;
    (level === 'ERROR' ? console.error : console.log)(line);
    try {
      rotate();
      appendFileSync(file, line + '\n');
    } catch {
      /* ignore */
    }
  };

  return {
    file,
    info: (m: string) => write('INFO', m),
    warn: (m: string) => write('WARN', m),
    error: (m: string) => write('ERROR', m),
  };
}
