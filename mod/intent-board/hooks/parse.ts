// 1ターン分のやり取りから、状態の差分を LLM に書かせる。
// 書くのは2つ：ユーザーの発言の読み（user）と、Claude がそのターンで補った前提・手順（claude）。
// 検証と適用はコード（state.ts）がやる。LLM は差分を出すだけ。
import type { Diff, State } from './state'
// Diff.ops の各要素は Op（{ op: string; [k]: any }）
import { nextIds, render } from './state'

export const SYSTEM = `あなたは会話の構造を記録する係。会話そのものには参加しない。
ユーザーと AI アシスタント（Claude）の1ターン分のやり取りを読み、会話の状態に対する差分を JSON で出す。

状態は「目的」「有効なコミットメント（決まったこと）」「開いている問い」「手順」でできている。
- コミットメントには by がある。user はユーザーが言ったこと・認めたこと。claude はユーザーが言っていないのに Claude が補った前提・理由・区別（accommodation）
- 目的は、ユーザーの言葉の引用（quote）と、その読み（reading）を分けて持つ

出す JSON の形（他の文字は出さない）:
{"user": 差分 | null, "claude": 差分 | null}

差分の形:
{"relation": 関係, "target": 対象の id か null, "markers": [談話標識], "ops": [操作, ...]}

関係（ユーザーの発言が、それまでの会話にどう繋がるか）:
Correction（前の決定を取り消す・置き換える。「でも」「やっぱ」「そうじゃなくて」「なんで〜」など）／Elaboration（前の決定を詳しくする）／Continuation（並べて足す）／Result／Condition／Answer（開いている問いに答える）／Open（新しい問いを開く）／Acknowledge（受け取るだけ。「OK」「うん」）

操作:
- {"op":"add","id":"C番号","content":"...","depends_on":[...],"by":"user"|"claude","reason":"by=claude のとき必須。なぜ補ったか"}
- {"op":"confirm","id":"..."}  ユーザーが、Claude の補った前提を認めた（例：Claude が確認し「OK」と返した）
- {"op":"retract","id":"...","replaced_by":"置き換え先の id か省略"}  取り消した決定に依存する決定は recheck か retract も出す
- {"op":"amend","id":"...","content":"書き直し後の全文"}
- {"op":"recheck","id":"...","note":"..."}
- {"op":"open","id":"Q番号","question":"...","parent":"親の問いの id か省略","owner":"user"|"claude"}  owner は決める人
- {"op":"answer","question":"Q...","by":"C...","complete":true|false}
- {"op":"goal","quote":["ユーザーの言葉そのまま"],"reading":"その読み（40字以内の1文）"}  目的が新しく示された・変わったときだけ
- {"op":"plan","steps":[{"text":"...","from":["goal" か C の id]}]}  Claude がいま進めている手順。全体を置き換える
- {"op":"none"}

規則:
- user の差分には by=user の add しか入れない。ユーザーが言っていないことを user に入れない
- claude の差分には、Claude の返信や作業から読み取れる「ユーザーが言っていない前提」を by=claude で入れる。ユーザーの言葉で裏付けられるものは入れない。無ければ null
  - 入れるのは、ユーザーの望み・範囲・順番・理由・言葉の意味について Claude が置いた前提と、Claude が自分で決めた設計・やり方
  - 入れないもの：Claude の説明・謝罪・自己評価・作業の報告（「〜した」「〜だった」）。これらは前提ではない
- plan はまだ終わっていない手順だけ。このターンで終わった手順は外す。手順に変化が無ければ plan を出さない
- 状態に既にあることを繰り返さない。変化が無ければ {"relation":"Acknowledge","ops":[{"op":"none"}]}
- id は「次の ID」から順に振る。user の差分で使った番号の続きを claude の差分で使う
- 内容は短い日本語の1文。ユーザーの言葉の言い換えで意味を足さない`

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…（以下略）` : s)

export type Exchange = { user: string; assistant: string; tools: string[] }

export const buildPrompt = (s: State, x: Exchange) => {
  const nx = nextIds(s)
  return [
    render(s),
    '',
    `次の ID: コミットメント ${nx.C}〜、問い ${nx.Q}〜`,
    '',
    '## このターンのユーザーの発言',
    clip(x.user, 4000),
    '',
    '## このターンの Claude の返信',
    clip(x.assistant, 6000),
    '',
    '## このターンの Claude の作業（ツール呼び出し）',
    x.tools.length ? x.tools.slice(-30).map(t => `- ${t}`).join('\n') : '- なし',
  ].join('\n')
}

// 返答から JSON を取り出す。コードフェンスや前置きが付いていても拾う
export const parseReply = (text: string): { user: Diff | null; claude: Diff | null } | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    if (!v || typeof v !== 'object' || !('user' in v || 'claude' in v)) return null
    return { user: v.user ?? null, claude: v.claude ?? null }
  } catch {
    return null
  }
}

// 1ターン分：最後のユーザーの発言と、その後の Claude の返信・ツール呼び出し
type Msg = { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown> }[]; toolResults?: unknown }
export const lastExchange = (messages: readonly Msg[]): Exchange | null => {
  let i = messages.length - 1
  // ツールの結果だけを運ぶ user メッセージは発言ではない
  while (i >= 0 && !(messages[i]!.role === 'user' && messages[i]!.text.trim() && !messages[i]!.toolResults)) i--
  if (i < 0) return null
  // スラッシュコマンド（/loop の再開を含む）は発言として読まない
  if (/^\s*(\/|<command-)/.test(messages[i]!.text)) return null
  const after = messages.slice(i + 1).filter(m => m.role === 'assistant')
  return {
    user: messages[i]!.text,
    assistant: after.map(m => m.text).filter(Boolean).join('\n\n'),
    tools: after.flatMap(m => m.toolUses.map(t => `${t.tool} ${summarize(t.input)}`)),
  }
}

// ---------------------------------------------------------------- 判定機
// 読み取り役が by=user にした決定が、本当にユーザーの発言に書かれているかを別の呼び出しで確かめる。
// 書かれていなければ by=claude（補った前提）に回す。逆向き（claude を user に上げる）はしない——認めるのはユーザー。

export const JUDGE_SYSTEM = `あなたは判定係。ユーザーの発言と、そこから読み取られた「決まったこと」の一覧を受け取る。
各項目が、ユーザーの発言に書かれている（言い換えとして意味が足されていない）かを判定する。
発言から推測できるだけのもの、発言に無い区別・理由・範囲を足したものは「書かれていない」。
出力は JSON だけ: {"verdicts": [{"id": "C..", "grounded": true|false, "why": "短い理由"}]}`

export const userAdds = (d: Diff | null) =>
  (d?.ops ?? []).filter(o => o.op === 'add' && (o.by ?? 'user') === 'user').map(o => ({ id: String(o.id), content: String(o.content) }))

export const buildJudgePrompt = (utterance: string, adds: { id: string; content: string }[]) =>
  ['## ユーザーの発言', clip(utterance, 4000), '', '## 読み取られた「決まったこと」', ...adds.map(a => `- ${a.id}: ${a.content}`)].join('\n')

export const parseVerdicts = (text: string): Map<string, string> | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(v?.verdicts)) return null
    const ungrounded = new Map<string, string>()
    for (const x of v.verdicts) if (x && x.grounded === false && typeof x.id === 'string') ungrounded.set(x.id, String(x.why ?? ''))
    return ungrounded
  } catch {
    return null
  }
}

// 書かれていなかった項目を補った前提に回す
export const demote = (d: Diff, ungrounded: Map<string, string>): Diff => ({
  ...d,
  ops: (d.ops ?? []).map(o =>
    o.op === 'add' && ungrounded.has(o.id) ? { ...o, by: 'claude', reason: `判定機：発言に書かれていない（${ungrounded.get(o.id)}）` } : o,
  ),
})

const summarize = (input: Record<string, unknown>) => {
  const v = input.description ?? input.file_path ?? input.command ?? input.pattern ?? input.title ?? ''
  return clip(String(v), 120)
}
