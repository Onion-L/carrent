/**
 * fetch-issues.ts — snapshot GitHub issues for the current repo via the gh CLI.
 *
 * Read-only by design: uses only `gh issue list`, `gh issue view`, and a
 * `gh pr view` fallback for the shared issue/PR number space. Never edits,
 * closes, relabels, or comments.
 *
 * Usage (from the repository root):
 *   bun .agents/skills/issue-planner/scripts/fetch-issues.ts [options]
 *
 * Options:
 *   --state open|closed|all   default: open
 *   --limit N                 default: 100 (max issues to list)
 *   --numbers 19,18           fetch exact numbers instead of listing
 *   --out <path>              default: .scratch/gh-issues.json
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

interface Label {
  name: string
  description?: string
}

interface User {
  login: string
}

interface Comment {
  author: User
  createdAt: string
  body: string
}

interface Issue {
  number: number
  title: string
  state: string
  body: string
  url: string
  labels: Label[]
  createdAt: string
  updatedAt: string
  closedAt: string | null
  author: User
  milestone: { title: string } | null
  assignees: User[]
  comments: Comment[]
  isPullRequest: boolean
}

function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() }
}

function fail(msg: string): never {
  console.error(`[fetch-issues] ${msg}`)
  process.exit(1)
}

function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const state = argValue('--state', 'open')
const limit = Number(argValue('--limit', '100'))
const numbersArg = argValue('--numbers', '')
const outPath = resolve(argValue('--out', '.scratch/gh-issues.json'))

// Infer owner/repo from the origin remote (docs/agents/issue-tracker.md).
const remote = run('git', ['remote', 'get-url', 'origin'])
if (!remote.ok) {
  fail(`no "origin" remote — run inside the target repo. git said: ${remote.stderr}`)
}
const m = remote.stdout.match(/github\.com[:/](.+)/)
if (!m) {
  fail(`cannot parse a GitHub repo from origin "${remote.stdout}" — only github.com remotes are supported`)
}
const repo = m[1].replace(/\.git$/, '').replace(/\/+$/, '')
if (!/^[^/]+\/.+/.test(repo)) {
  fail(`cannot parse owner/repo from origin "${remote.stdout}"`)
}

const JSON_FIELDS =
  'number,title,state,body,url,labels,createdAt,updatedAt,closedAt,author,milestone,assignees,comments'

let numbers: number[]
if (numbersArg) {
  numbers = numbersArg
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  if (numbers.length === 0) fail(`--numbers "${numbersArg}" contained no valid issue numbers`)
} else {
  const list = run('gh', ['issue', 'list', '--repo', repo, '--state', state, '--limit', String(limit), '--json', 'number'])
  if (!list.ok) {
    fail(`gh issue list failed — is gh authenticated? Run "gh auth login". gh said: ${list.stderr}`)
  }
  numbers = (JSON.parse(list.stdout) as { number: number }[]).map((e) => e.number)
}

const issues: Issue[] = []
for (const n of numbers) {
  let v = run('gh', ['issue', 'view', String(n), '--repo', repo, '--json', JSON_FIELDS])
  let isPullRequest = false
  if (!v.ok) {
    const pr = run('gh', ['pr', 'view', String(n), '--repo', repo, '--json', JSON_FIELDS])
    if (!pr.ok) {
      console.warn(`[fetch-issues] #${n} is not viewable as issue or PR; skipped (${v.stderr || pr.stderr})`)
      continue
    }
    v = pr
    isPullRequest = true
  }
  const raw = JSON.parse(v.stdout) as Omit<Issue, 'isPullRequest'>
  issues.push({ ...raw, isPullRequest })
}
issues.sort((a, b) => a.number - b.number)

mkdirSync(dirname(outPath), { recursive: true })
const snapshot = { repo, fetchedAt: new Date().toISOString(), state, issues }
writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n')

const summary = issues
  .map((i) => `  #${i.number}${i.isPullRequest ? ' (PR)' : ''} ${i.title}  [${i.labels.map((l) => l.name).join(', ')}]`)
  .join('\n')
console.log(`repo: ${repo} | state: ${state} | ${issues.length} item(s) -> ${outPath}`)
console.log(summary || '  (no issues)')
