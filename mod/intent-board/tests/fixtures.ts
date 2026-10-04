// poc/export_fixture.py が書き出す。手で編集しない
export const AUDIT_DIFFS = [
  {
    "turn": 1,
    "utterance_id": "π1",
    "text": "委任したトップのエージェントが最後に責任をもって全カードを読むべき。これまで俺がずっと指摘してきたことを、最後にヒューリスティック診断でチェックしてほしい。俺の代わりになってほしい",
    "relation": "Open",
    "target": null,
    "markers": [],
    "ops": [
      {
        "op": "goal",
        "quote": [
          "委任したトップのエージェントが最後に責任をもって全カードを読むべき",
          "これまで俺がずっと指摘してきたことを、最後にヒューリスティック診断でチェックしてほしい。俺の代わりになってほしい"
        ],
        "reading": "ルールでは拾えない「これおかしいだろ」を、ユーザーの代わりに拾って、責任をもって納品判断する"
      },
      {
        "op": "open",
        "id": "Q0",
        "question": "監査ジョブをどう組むか"
      },
      {
        "op": "add",
        "id": "C0",
        "content": "最後にトップのエージェントが全カードを読む"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C0"
      }
    ]
  },
  {
    "turn": 2,
    "utterance_id": "π2",
    "text": "監査は俺が指示したときだけ。寝てる間の5時ごろに回して",
    "relation": "Elaboration",
    "target": "Q0",
    "markers": [],
    "ops": [
      {
        "op": "add",
        "id": "C1",
        "content": "監査はユーザーが指示したときだけ"
      },
      {
        "op": "add",
        "id": "C2",
        "content": "実行は 10/6 5時ごろ"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C1"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C2"
      }
    ]
  },
  {
    "turn": 2,
    "utterance_id": "σ2",
    "text": "（Claude の作業：ジョブを組む）",
    "relation": "Continuation",
    "target": "Q0",
    "markers": [],
    "ops": [
      {
        "op": "add",
        "id": "C3",
        "content": "規準監査の結果を見る前に読む",
        "by": "claude",
        "reason": "結果に判断を引っぱられないため"
      },
      {
        "op": "add",
        "id": "C4",
        "content": "読むのは Claude 本人",
        "by": "claude",
        "reason": "「トップのエージェント」から。別エージェントの可能性は検討していない"
      },
      {
        "op": "open",
        "id": "Q1",
        "question": "監査をどの範囲にかけるか",
        "parent": "Q0",
        "owner": "claude"
      },
      {
        "op": "plan",
        "steps": [
          {
            "text": "規準監査（sonnet）",
            "from": [
              "C1"
            ]
          },
          {
            "text": "結果を見る前に Claude が全カードを読む",
            "from": [
              "goal",
              "C0",
              "C3",
              "C4"
            ]
          },
          {
            "text": "直して再監査",
            "from": [
              "goal"
            ]
          }
        ]
      }
    ]
  },
  {
    "turn": 3,
    "utterance_id": "π3",
    "text": "なんで明日なの",
    "relation": "Correction",
    "target": "C2",
    "markers": [
      "なんで"
    ],
    "ops": [
      {
        "op": "retract",
        "id": "C2",
        "replaced_by": "C5"
      },
      {
        "op": "add",
        "id": "C5",
        "content": "実行は 10/5 5時ごろ（日付が変わっていたのを見落としていた）"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C5"
      }
    ]
  }
] as const

export const AUDIT_BOARD = {
  "turn": 3,
  "goal": {
    "quote": [
      "委任したトップのエージェントが最後に責任をもって全カードを読むべき",
      "これまで俺がずっと指摘してきたことを、最後にヒューリスティック診断でチェックしてほしい。俺の代わりになってほしい"
    ],
    "reading": "ルールでは拾えない「これおかしいだろ」を、ユーザーの代わりに拾って、責任をもって納品判断する",
    "source": "π1"
  },
  "decided": [
    {
      "id": "C0",
      "content": "最後にトップのエージェントが全カードを読む",
      "source": "π1",
      "turn": 1
    },
    {
      "id": "C1",
      "content": "監査はユーザーが指示したときだけ",
      "source": "π2",
      "turn": 2
    },
    {
      "id": "C5",
      "content": "実行は 10/5 5時ごろ（日付が変わっていたのを見落としていた）",
      "source": "π3",
      "turn": 3
    }
  ],
  "replaced": [
    {
      "id": "C2",
      "content": "実行は 10/6 5時ごろ",
      "turn": 3,
      "source": "π3",
      "replaced_by": "C5"
    }
  ],
  "supplemented": [
    {
      "id": "C3",
      "content": "規準監査の結果を見る前に読む",
      "source": "σ2",
      "turn": 2,
      "reason": "結果に判断を引っぱられないため"
    },
    {
      "id": "C4",
      "content": "読むのは Claude 本人",
      "source": "σ2",
      "turn": 2,
      "reason": "「トップのエージェント」から。別エージェントの可能性は検討していない"
    }
  ],
  "steps": [
    {
      "text": "規準監査（sonnet）",
      "from": [
        "C1"
      ]
    },
    {
      "text": "結果を見る前に Claude が全カードを読む",
      "from": [
        "goal",
        "C0",
        "C3",
        "C4"
      ]
    },
    {
      "text": "直して再監査",
      "from": [
        "goal"
      ]
    }
  ],
  "open": [
    {
      "id": "Q1",
      "question": "監査をどの範囲にかけるか",
      "owner": "claude",
      "parent": "Q0"
    },
    {
      "id": "Q0",
      "question": "監査ジョブをどう組むか",
      "owner": "user",
      "parent": null
    }
  ],
  "tree": {
    "nodes": [
      {
        "id": "Q0",
        "question": "監査ジョブをどう組むか",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": [
          "C0",
          "C1",
          "C5"
        ]
      },
      {
        "id": "Q1",
        "question": "監査をどの範囲にかけるか",
        "owner": "claude",
        "closed": false,
        "parent": "Q0",
        "items": []
      }
    ],
    "loose": [
      "C3",
      "C4"
    ]
  }
}
