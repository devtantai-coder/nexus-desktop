import { runProcess } from '../util.ts'
import type { CommandResult } from './types.ts'

const MAX_OUTPUT = 200_000

/** Chạy lệnh domain trong cwd đã validate; output bị chặn để tránh tràn context. */
export async function runCommand(
  command: string,
  cwd: string,
  timeoutMs = 300_000,
): Promise<CommandResult> {
  const started = Date.now()
  const result = await runProcess(['/bin/bash', '-lc', command], cwd, timeoutMs)
  const output = `${result.out}${result.err === '' ? '' : `\n${result.err}`}`.slice(0, MAX_OUTPUT)
  return {
    ok: result.code === 0 && !result.timedOut,
    command,
    exitCode: result.code,
    output,
    durationMs: Date.now() - started,
    timedOut: result.timedOut,
  }
}

export function countTests(output: string): { passed: number; failed: number } {
  const ctest = /tests passed, ([0-9]+) tests failed out of ([0-9]+)/i.exec(output)
  if (ctest !== null) {
    return { passed: Number(ctest[2]) - Number(ctest[1]), failed: Number(ctest[1]) }
  }
  const summary = output
    .split('\n')
    .reverse()
    .find((line) => {
      // "Test Suites: 1 failed" là số suite, không phải số test — bỏ qua.
      if (/Test Suites?:|Suites:/i.test(line)) return false
      return /\b\d+\s+(?:passed|failed)\b/i.test(line)
    })
  if (summary !== undefined) {
    const passed = /(\d+)\s+passed/i.exec(summary)
    const failed = /(\d+)\s+failed/i.exec(summary)
    return {
      passed: passed !== null ? Number(passed[1]) : 0,
      failed: failed !== null ? Number(failed[1]) : 0,
    }
  }
  const passedMatch = /(?:# pass|PASS)\s*:?\s*([0-9]+)/i.exec(output)
  const failedMatch = /(?:# fail|FAIL)\s*:?\s*([0-9]+)/i.exec(output)
  return {
    passed: passedMatch ? Number(passedMatch[1]) : 0,
    failed: failedMatch ? Number(failedMatch[1]) : 0,
  }
}
