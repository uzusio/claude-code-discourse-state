// 監査役（#13）。ボードは本体が書く。監査役は書き換えず、指摘だけを返す。
// ターンの終わりに2つを確かめる：
//   出どころ（haiku）  … 本体が「ユーザーが言ったこと」（by=user）に入れた項目が、ユーザーの発言に書かれているか
//   食い違い（sonnet） … そのターンの本体の返信・作業が、本体の書いたボード（読み・決まったこと・流れ）と矛盾していないか
import type { State } from './state'

// relevance：返信がいまの問いに答えていない（QUD の関連性）／unclosed：答えの出た問いが開いたまま、または答えが無いのに閉じた
export type Flag = { kind: 'attribution' | 'deviation' | 'relevance' | 'unclosed'; text: string }
export type Audit = { turn: number; flags: Flag[] }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…（以下略）` : s)

// ---------------------------------------------------------------- 会話記録から1ターン分を取る

// prevAssistant：ユーザーの発言の直前の Claude の返信（「そうして」のような同意が、何への同意かを読むため）
export type Exchange = { user: string; recentUser: string[]; prevAssistant: string; assistant: string; tools: string[] }
type Msg = { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown> }[]; toolResults?: unknown }

const isUtterance = (m: Msg) => m.role === 'user' && !!m.text.trim() && !m.toolResults
const isCommand = (m: Msg) => /^\s*(\/|<command-)/.test(m.text)

// 最後のユーザーの発言と、その後の本体の返信・ツール呼び出し。直近の発言も数件（決定の根拠が前のターンにあることがある）
export const lastExchange = (messages: readonly Msg[], recent = 3): Exchange | null => {
  let i = messages.length - 1
  while (i >= 0 && !isUtterance(messages[i]!)) i--
  if (i < 0 || isCommand(messages[i]!)) return null
  const after = messages.slice(i + 1).filter(m => m.role === 'assistant')
  const recentUser = messages.slice(0, i + 1).filter(m => isUtterance(m) && !isCommand(m)).slice(-recent).map(m => m.text)
  const before = messages.slice(0, i).filter(m => m.role === 'assistant' && m.text.trim())
  return {
    user: messages[i]!.text,
    recentUser,
    prevAssistant: before.length ? before[before.length - 1]!.text : '',
    assistant: after.map(m => m.text).filter(Boolean).join('\n\n'),
    tools: after.flatMap(m => m.toolUses.map(t => `${t.tool} ${summarize(t.input)}`)),
  }
}

const summarize = (input: Record<string, unknown>) => {
  const v = input.description ?? input.file_path ?? input.command ?? input.pattern ?? input.title ?? ''
  return clip(String(v), 120)
}

// ---------------------------------------------------------------- 出どころ

export const ATTRIBUTION_SYSTEM = `あなたは監査係。ユーザーの直近の発言と、AI が「ユーザーが言ったこと」として記録した項目の一覧を受け取る。
各項目が、ユーザーの発言に書かれている（言い換えとして意味が足されていない）かを判定する。
発言から推測できるだけのもの、発言に無い区別・理由・範囲を足したものは「書かれていない」。
ユーザーが直前の AI の提案に同意した（「そうして」「それでいい」「OK」など）ときは、同意した提案の中身も「書かれている」とみなす。ただし提案に無いものを足していれば「書かれていない」。
出力は JSON だけ: {"verdicts": [{"id": "C..", "grounded": true|false, "why": "短い理由"}]}`

export const attributionTargets = (s: State, turn: number) =>
  s.commitments.filter(c => c.by === 'user' && c.turn === turn && !c.confirmed_by).map(c => ({ id: c.id, content: c.content }))

export const buildAttributionPrompt = (x: Exchange, items: { id: string; content: string }[]) =>
  [
    '## ユーザーの最後の発言の直前の AI の返信（ユーザーが同意した提案を読むため）', clip(x.prevAssistant, 3000) || '（なし）', '',
    '## ユーザーの直近の発言（古い順）', ...x.recentUser.map(u => `- ${clip(u, 1500)}`), '',
    '## 「ユーザーが言ったこと」として記録された項目', ...items.map(a => `- ${a.id}: ${a.content}`),
  ].join('\n')

export const parseAttribution = (text: string, items: { id: string; content: string }[]): Flag[] | null => {
  const v = parseJson(text)
  if (!Array.isArray(v?.verdicts)) return null
  const content = new Map(items.map(i => [i.id, i.content]))
  return v.verdicts
    .filter((x: any) => x && x.grounded === false && content.has(x.id))
    .map((x: any) => ({ kind: 'attribution' as const, text: `「${content.get(x.id)}」はユーザーの発言に書かれていない（${String(x.why ?? '')}）。文脈の補完では？` }))
}

// ---------------------------------------------------------------- 食い違い

export const DEVIATION_SYSTEM = `あなたは監査係。AI アシスタントが自分で書いた「理解のボード」（ユーザーの意図の読み・決まったこと・これからの流れ・問い）と、そのターンのユーザーの発言、AI の返信と作業を受け取る。
次の3種類だけを挙げる。どれも、ユーザーの意図を AI が読み違えている兆しとして挙げる。
1. deviation：AI の返信や作業が、ボードの読み・決まったこと・流れと矛盾している（決まったことに反するやり方、読みと違う方向の作業、流れに無い手順を断りなく進めた）
2. relevance：AI の返信が、ユーザーのこのターンの発言が求めたこと（問い・依頼）に答えていない。別の問いに答えている、または一部にしか答えていないのに答えた扱いにしている
3. unclosed：このターンで答えが出た問いがボードで開いたまま、または答えが出ていない問いが閉じられている
挙げないもの：矛盾しない細部、言い回しの違い、ボードを更新したうえでの変更。迷ったら挙げない。
各指摘は、ユーザーが読んで分かるように「意図の読みが〜かもしれない」の形で、何と何がずれているかを具体的に1〜2文で書く。
出力は JSON だけ: {"flags": [{"kind": "deviation" | "relevance" | "unclosed", "text": "..."}]}`

export const buildDeviationPrompt = (s: State, x: Exchange) => {
  const decided = s.commitments.filter(c => c.by === 'user').slice(-20)
  return [
    '## ボード：意図の読み',
    s.goal ? s.goal.reading : '（未設定）',
    '',
    '## ボード：決まったこと（ユーザーが言った・認めたもの、新しい順に最大20件）',
    ...[...decided].reverse().map(c => `- ${c.content}`),
    '',
    '## ボード：これからの流れ',
    ...(s.steps.length ? s.steps.map((st, i) => `${i + 1}. ${st.text}`) : ['（なし）']),
    '',
    '## ボード：開いている問い',
    ...(s.questions.filter(q => !q.closed).map(q => `- ${q.question}`)),
    '## ボード：最近閉じた問い',
    ...(s.questions.filter(q => q.closed).slice(-5).map(q => `- ${q.question}`)),
    '',
    '## このターンのユーザーの発言',
    clip(x.user, 3000),
    '',
    '## このターンの AI の返信',
    clip(x.assistant, 6000),
    '',
    '## このターンの AI の作業（ツール呼び出し）',
    ...(x.tools.length ? x.tools.slice(-30).map(t => `- ${t}`) : ['- なし']),
  ].join('\n')
}

export const parseDeviation = (text: string): Flag[] | null => {
  const v = parseJson(text)
  if (!Array.isArray(v?.flags)) return null
  const kinds = ['deviation', 'relevance', 'unclosed'] as const
  return v.flags
    .filter((f: any) => f && typeof f.text === 'string' && f.text.trim())
    .map((f: any) => ({ kind: kinds.includes(f.kind) ? (f.kind as Flag['kind']) : 'deviation', text: f.text }))
}

// 返答から JSON を取り出す。コードフェンスや前置きが付いていても拾う
const parseJson = (text: string): any => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
