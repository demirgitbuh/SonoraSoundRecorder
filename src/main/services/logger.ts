import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 5
const MAX_MESSAGE_CHARS = 2000

/**
 * Small rotating file logger. Only technical messages are written; callers must never pass
 * audio content or transcript text. Messages are truncated and stripped of control characters.
 */
export class Logger {
  private readonly file: string

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'sonora.log')
  }

  get directory(): string {
    return this.dir
  }

  debug(scope: string, message: string): void {
    if (process.env.SONORA_DEBUG) this.write('debug', scope, message)
  }

  info(scope: string, message: string): void {
    this.write('info', scope, message)
  }

  warn(scope: string, message: string): void {
    this.write('warn', scope, message)
  }

  error(scope: string, message: string, err?: unknown): void {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : err !== undefined ? String(err) : ''
    this.write('error', scope, detail ? `${message} | ${detail}` : message)
  }

  write(level: LogLevel, scope: string, message: string): void {
    const clean = String(message)
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
      .slice(0, MAX_MESSAGE_CHARS)
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope.slice(0, 40)}] ${clean}\n`
    try {
      this.rotateIfNeeded()
      appendFileSync(this.file, line, 'utf8')
    } catch {
      // Logging must never break the app.
    }
    if (process.env.NODE_ENV === 'development' || process.env.SONORA_DEBUG) {
      process.stdout.write(line)
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.file)) return
    if (statSync(this.file).size < MAX_FILE_BYTES) return
    const oldest = join(this.dir, `sonora.${MAX_FILES - 1}.log`)
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let i = MAX_FILES - 2; i >= 1; i--) {
      const from = join(this.dir, `sonora.${i}.log`)
      if (existsSync(from)) renameSync(from, join(this.dir, `sonora.${i + 1}.log`))
    }
    renameSync(this.file, join(this.dir, 'sonora.1.log'))
  }

  /** Files from oldest to newest. */
  files(): string[] {
    const list: string[] = []
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const f = join(this.dir, `sonora.${i}.log`)
      if (existsSync(f)) list.push(f)
    }
    if (existsSync(this.file)) list.push(this.file)
    return list
  }

  /** Writes every log file into a single text file. */
  exportTo(target: string, header: string): void {
    const parts = [header, '']
    for (const f of this.files()) {
      parts.push(`===== ${f} =====`)
      parts.push(readFileSync(f, 'utf8'))
    }
    writeFileSync(target, parts.join('\n'), 'utf8')
  }
}
