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
            ],
            "why": "既存の監査の仕組みで、規準に照らした漏れを先に拾う"
          },
          {
            "text": "結果を見る前に Claude が全カードを読む",
            "from": [
              "goal",
              "C0",
              "C3",
              "C4"
            ],
            "why": "ルールで拾えない違和感を、ユーザーの代わりに見る（目的の中心）"
          },
          {
            "text": "直して再監査",
            "from": [
              "goal"
            ],
            "why": "見つけたものを直して納品できる状態にする"
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
      ],
      "why": "既存の監査の仕組みで、規準に照らした漏れを先に拾う"
    },
    {
      "text": "結果を見る前に Claude が全カードを読む",
      "from": [
        "goal",
        "C0",
        "C3",
        "C4"
      ],
      "why": "ルールで拾えない違和感を、ユーザーの代わりに見る（目的の中心）"
    },
    {
      "text": "直して再監査",
      "from": [
        "goal"
      ],
      "why": "見つけたものを直して納品できる状態にする"
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
  },
  "tasks": [
    {
      "id": "Q0",
      "question": "監査ジョブをどう組むか",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": null,
      "items": [
        {
          "id": "C0",
          "content": "最後にトップのエージェントが全カードを読む",
          "by": "user",
          "turn": 1,
          "parent": null,
          "rel": "answer"
        },
        {
          "id": "C1",
          "content": "監査はユーザーが指示したときだけ",
          "by": "user",
          "turn": 2,
          "parent": null,
          "rel": "answer"
        },
        {
          "id": "C5",
          "content": "実行は 10/5 5時ごろ（日付が変わっていたのを見落としていた）",
          "by": "user",
          "turn": 3,
          "parent": null,
          "rel": "answer",
          "replaces": "実行は 10/6 5時ごろ"
        }
      ]
    },
    {
      "id": "Q1",
      "question": "監査をどの範囲にかけるか",
      "owner": "claude",
      "closed": false,
      "parent": "Q0",
      "intent": null,
      "items": []
    }
  ]
}

export const SELF_DIFFS = [
  {
    "turn": 1,
    "utterance_id": "π1",
    "text": "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい",
    "relation": "Open",
    "target": null,
    "markers": [],
    "ops": [
      {
        "op": "open",
        "id": "Q0",
        "question": "Claude の意図の読みをどう見せるか",
        "intent": {
          "quote": [
            "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい"
          ],
          "reading": "会話を止めずに、Claude の読みとそのずれが見えるようにする"
        }
      },
      {
        "op": "add",
        "id": "C0",
        "content": "読みは会話を止めずに見られるようにする"
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
    "text": "細かい手順は任せる。意図が合っていればいい",
    "relation": "Elaboration",
    "target": "Q0",
    "markers": [],
    "ops": [
      {
        "op": "add",
        "id": "C1",
        "content": "細かい手順は任せる。意図が合っていればいい"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C1"
      }
    ]
  },
  {
    "turn": 2,
    "utterance_id": "σ2",
    "text": "（Claude の作業）",
    "relation": "Continuation",
    "target": "Q0",
    "markers": [],
    "ops": [
      {
        "op": "open",
        "id": "Q1",
        "question": "帯に何を出すか",
        "parent": "Q0",
        "owner": "claude",
        "intent": {
          "quote": [],
          "reading": "会話の邪魔をせずに、いまの読みが目に入るようにする"
        }
      },
      {
        "op": "add",
        "id": "C2",
        "content": "プロンプトの上に帯を常に出す",
        "by": "claude",
        "reason": "どこに出すかは言われていない。常に目に入る場所を選んだ"
      },
      {
        "op": "answer",
        "question": "Q1",
        "by": "C2"
      },
      {
        "op": "add",
        "id": "C3",
        "content": "帯は2行まで",
        "by": "claude",
        "reason": "長いと会話が隠れる",
        "depends_on": [
          "C2"
        ],
        "rel": "elaboration"
      },
      {
        "op": "add",
        "id": "C4",
        "content": "作業を始める前に読みを確認してもらう",
        "by": "claude",
        "reason": "ずれを止めるには作業の前がよいと考えた"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C4"
      },
      {
        "op": "open",
        "id": "Q2",
        "question": "帯を常に出してうるさくないか",
        "parent": "Q1",
        "owner": "user"
      },
      {
        "op": "plan",
        "steps": [
          {
            "text": "帯に意図の読みと次の一歩を出す",
            "from": [
              "C0",
              "C2"
            ],
            "why": "会話を止めずに、読みのずれに気づける"
          },
          {
            "text": "ボードに作業ごとの意図と決まったことを木で並べる",
            "from": [
              "C0"
            ],
            "why": "読みがどこから来たかを確かめられる"
          },
          {
            "text": "話しかけて読みを直せるようにする",
            "from": [
              "C1"
            ],
            "why": "ずれを見つけたらその場で直せる"
          }
        ]
      }
    ]
  },
  {
    "turn": 3,
    "utterance_id": "π3",
    "text": "作業の前か後かは関係ない。やりとりは非同期に進めたいから",
    "relation": "Correction",
    "target": "C4",
    "markers": [
      "関係ない"
    ],
    "ops": [
      {
        "op": "retract",
        "id": "C4",
        "replaced_by": "C5"
      },
      {
        "op": "add",
        "id": "C5",
        "content": "読みは非同期に見られればよい（作業の前後は問わない）"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C5"
      },
      {
        "op": "add",
        "id": "C6",
        "content": "やりとりは非同期に進めたい",
        "depends_on": [
          "C5"
        ],
        "rel": "explanation"
      }
    ]
  }
] as const

export const SELF_BOARD = {
  "turn": 3,
  "goal": null,
  "decided": [
    {
      "id": "C0",
      "content": "読みは会話を止めずに見られるようにする",
      "source": "π1",
      "turn": 1
    },
    {
      "id": "C1",
      "content": "細かい手順は任せる。意図が合っていればいい",
      "source": "π2",
      "turn": 2
    },
    {
      "id": "C5",
      "content": "読みは非同期に見られればよい（作業の前後は問わない）",
      "source": "π3",
      "turn": 3
    },
    {
      "id": "C6",
      "content": "やりとりは非同期に進めたい",
      "source": "π3",
      "turn": 3
    }
  ],
  "replaced": [
    {
      "id": "C4",
      "content": "作業を始める前に読みを確認してもらう",
      "turn": 3,
      "source": "π3",
      "replaced_by": "C5"
    }
  ],
  "supplemented": [
    {
      "id": "C2",
      "content": "プロンプトの上に帯を常に出す",
      "source": "σ2",
      "turn": 2,
      "reason": "どこに出すかは言われていない。常に目に入る場所を選んだ"
    },
    {
      "id": "C3",
      "content": "帯は2行まで",
      "source": "σ2",
      "turn": 2,
      "reason": "長いと会話が隠れる"
    }
  ],
  "steps": [
    {
      "text": "帯に意図の読みと次の一歩を出す",
      "from": [
        "C0",
        "C2"
      ],
      "why": "会話を止めずに、読みのずれに気づける"
    },
    {
      "text": "ボードに作業ごとの意図と決まったことを木で並べる",
      "from": [
        "C0"
      ],
      "why": "読みがどこから来たかを確かめられる"
    },
    {
      "text": "話しかけて読みを直せるようにする",
      "from": [
        "C1"
      ],
      "why": "ずれを見つけたらその場で直せる"
    }
  ],
  "open": [
    {
      "id": "Q2",
      "question": "帯を常に出してうるさくないか",
      "owner": "user",
      "parent": "Q1"
    },
    {
      "id": "Q1",
      "question": "帯に何を出すか",
      "owner": "claude",
      "parent": "Q0"
    },
    {
      "id": "Q0",
      "question": "Claude の意図の読みをどう見せるか",
      "owner": "user",
      "parent": null
    }
  ],
  "tree": {
    "nodes": [
      {
        "id": "Q0",
        "question": "Claude の意図の読みをどう見せるか",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": [
          "C0",
          "C1",
          "C5",
          "C6"
        ]
      },
      {
        "id": "Q1",
        "question": "帯に何を出すか",
        "owner": "claude",
        "closed": false,
        "parent": "Q0",
        "items": [
          "C2",
          "C3"
        ]
      },
      {
        "id": "Q2",
        "question": "帯を常に出してうるさくないか",
        "owner": "user",
        "closed": false,
        "parent": "Q1",
        "items": []
      }
    ],
    "loose": []
  },
  "tasks": [
    {
      "id": "Q0",
      "question": "Claude の意図の読みをどう見せるか",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい"
        ],
        "reading": "会話を止めずに、Claude の読みとそのずれが見えるようにする",
        "source": "π1"
      },
      "items": [
        {
          "id": "C0",
          "content": "読みは会話を止めずに見られるようにする",
          "by": "user",
          "turn": 1,
          "parent": null,
          "rel": "answer"
        },
        {
          "id": "C1",
          "content": "細かい手順は任せる。意図が合っていればいい",
          "by": "user",
          "turn": 2,
          "parent": null,
          "rel": "answer"
        },
        {
          "id": "C5",
          "content": "読みは非同期に見られればよい（作業の前後は問わない）",
          "by": "user",
          "turn": 3,
          "parent": null,
          "rel": "answer",
          "replaces": "作業を始める前に読みを確認してもらう"
        },
        {
          "id": "C6",
          "content": "やりとりは非同期に進めたい",
          "by": "user",
          "turn": 3,
          "parent": "C5",
          "rel": "explanation"
        }
      ]
    },
    {
      "id": "Q1",
      "question": "帯に何を出すか",
      "owner": "claude",
      "closed": false,
      "parent": "Q0",
      "intent": {
        "quote": [],
        "reading": "会話の邪魔をせずに、いまの読みが目に入るようにする",
        "source": "σ2"
      },
      "items": [
        {
          "id": "C2",
          "content": "プロンプトの上に帯を常に出す",
          "by": "claude",
          "turn": 2,
          "parent": null,
          "rel": "answer",
          "reason": "どこに出すかは言われていない。常に目に入る場所を選んだ"
        },
        {
          "id": "C3",
          "content": "帯は2行まで",
          "by": "claude",
          "turn": 2,
          "parent": "C2",
          "rel": "elaboration",
          "reason": "長いと会話が隠れる"
        }
      ]
    },
    {
      "id": "Q2",
      "question": "帯を常に出してうるさくないか",
      "owner": "user",
      "closed": false,
      "parent": "Q1",
      "intent": null,
      "items": []
    }
  ]
}
