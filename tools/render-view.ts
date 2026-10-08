// ダッシュボードが読む見え方の写し（view.json）の見本を書き出す。
// 中身は mod と同じ関数（view）から作るので、mod が書くものとずれない。
// 中身は自己言及の例（poc/examples/self.jsonl）。会話の実データは使わない。
//
// 使い方（リポジトリの直下で）: npx tsx tools/render-view.ts
// 出力: docs/view.example.json
// --check を付けると書かずに、今の docs/view.example.json が view() の出力と一致するかだけ確かめる（tools/test.py が回す。ずれていれば終了コード 1）
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { view } from '../mod/discourse-state/hooks/board'
import { board, replay } from '../mod/discourse-state/hooks/state'
import type { Diff } from '../mod/discourse-state/hooks/state'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const diffs = readFileSync(join(root, 'poc/examples/self.jsonl'), 'utf-8')
  .split(/\r?\n/).filter(l => l.trim()).map(l => JSON.parse(l) as Diff)
const b = board(replay(diffs, 'example'))
const v = view(b, { updatedAt: '2026-10-08T00:00:00.000Z', session: 'example', cwd: 'C:/work/example', turn: b.turn, note: null })

const out = join(root, 'docs', 'view.example.json')
const text = `${JSON.stringify(v, null, 2)}\n`
if (process.argv.includes('--check')) {
  const now = existsSync(out) ? readFileSync(out, 'utf-8') : null
  if (now === text) {
    console.log('docs/view.example.json は今の view() の出力と一致している')
  } else {
    const a = (now ?? '').split('\n')
    const e = text.split('\n')
    const i = e.findIndex((l, k) => l !== a[k])
    console.error(`docs/view.example.json が view() の出力とずれている（${now === null ? 'ファイルが無い' : `${i + 1} 行目から`}）`)
    if (now !== null) console.error(`  見本: ${a[i] ?? '（行が無い）'}\n  出力: ${e[i] ?? '（行が無い）'}`)
    console.error('npx tsx tools/render-view.ts で書き直すこと')
    process.exit(1)
  }
} else {
  mkdirSync(join(root, 'docs'), { recursive: true })
  writeFileSync(out, text)
  console.log(out)
}
