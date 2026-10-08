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
      "intent_history": [],
      "steps": [],
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
      ],
      "refs": [],
      "local": false
    },
    {
      "id": "Q1",
      "question": "監査をどの範囲にかけるか",
      "owner": "claude",
      "closed": false,
      "parent": "Q0",
      "intent": null,
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": false
    }
  ],
  "unregistered": []
}

export const SELF_DIFFS = [
  {
    "turn": 1,
    "utterance_id": "π1",
    "text": "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい。細かい手順は任せる",
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
            "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい",
            "細かい手順は任せる"
          ],
          "reading": "作業を始める前に、Claude の読みを確かめられるようにする"
        }
      }
    ]
  },
  {
    "turn": 1,
    "utterance_id": "σ1",
    "text": "（Claude の作業）",
    "relation": "Continuation",
    "target": "Q0",
    "markers": [],
    "ops": [
      {
        "op": "add",
        "id": "C0",
        "content": "読みはボタンで開くボードに、要点は帯に出す",
        "by": "claude",
        "reason": "どこに出すかは言われていない。会話を邪魔しない場所を選んだ"
      },
      {
        "op": "answer",
        "question": "Q0",
        "by": "C0"
      },
      {
        "op": "open",
        "id": "Q1",
        "question": "帯に何を出すか",
        "parent": "Q0",
        "owner": "user",
        "intent": {
          "quote": [],
          "reading": "会話の邪魔をせずに、いまの読みが目に入るようにする"
        }
      },
      {
        "op": "add",
        "id": "C1",
        "content": "プロンプトの上に帯を常に出す",
        "by": "claude",
        "reason": "常に目に入る場所として選んだ"
      },
      {
        "op": "answer",
        "question": "Q1",
        "by": "C1"
      },
      {
        "op": "add",
        "id": "C2",
        "content": "帯は2行まで",
        "by": "claude",
        "reason": "長いと会話が隠れる",
        "depends_on": [
          "C1"
        ],
        "rel": "condition"
      },
      {
        "op": "plan",
        "question": "Q0",
        "steps": [
          {
            "text": "帯に意図の読みと次の一歩を出す",
            "why": "会話を止めずに読みのずれに気づける"
          },
          {
            "text": "ボードに作業ごとの意図・補完・流れを並べる",
            "why": "読みがどこから来たかを確かめられる"
          },
          {
            "text": "話しかけて読みを直せるようにする",
            "why": "ずれを見つけたらその場で直せる"
          }
        ]
      },
      {
        "op": "plan",
        "question": "Q1",
        "steps": [
          {
            "text": "1行目に意図の読み、2行目に次の一歩",
            "why": "2行で読みと行き先が分かる"
          }
        ]
      }
    ]
  },
  {
    "turn": 2,
    "utterance_id": "π2",
    "text": "作業の前か後かは関係ない。やりとりは非同期に進めたいから",
    "relation": "Correction",
    "target": "Q0",
    "markers": [
      "関係ない"
    ],
    "ops": [
      {
        "op": "intent",
        "question": "Q0",
        "quote": [
          "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい",
          "細かい手順は任せる",
          "作業の前か後かは関係ない。やりとりは非同期に進めたい"
        ],
        "reading": "非同期のやりとりの中で、Claude の読みとずれをいつでも見られるようにする"
      }
    ]
  }
] as const

export const SELF_BOARD = {
  "turn": 2,
  "goal": null,
  "decided": [],
  "replaced": [],
  "supplemented": [
    {
      "id": "C0",
      "content": "読みはボタンで開くボードに、要点は帯に出す",
      "source": "σ1",
      "turn": 1,
      "reason": "どこに出すかは言われていない。会話を邪魔しない場所を選んだ"
    },
    {
      "id": "C1",
      "content": "プロンプトの上に帯を常に出す",
      "source": "σ1",
      "turn": 1,
      "reason": "常に目に入る場所として選んだ"
    },
    {
      "id": "C2",
      "content": "帯は2行まで",
      "source": "σ1",
      "turn": 1,
      "reason": "長いと会話が隠れる"
    }
  ],
  "steps": [],
  "open": [
    {
      "id": "Q1",
      "question": "帯に何を出すか",
      "owner": "user",
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
          "C0"
        ]
      },
      {
        "id": "Q1",
        "question": "帯に何を出すか",
        "owner": "user",
        "closed": false,
        "parent": "Q0",
        "items": [
          "C1",
          "C2"
        ]
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
          "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい",
          "細かい手順は任せる",
          "作業の前か後かは関係ない。やりとりは非同期に進めたい"
        ],
        "reading": "非同期のやりとりの中で、Claude の読みとずれをいつでも見られるようにする",
        "source": "π2"
      },
      "intent_history": [
        {
          "quote": [
            "Claude が自分の意図をどう汲み取っているのか、会話しながら見たい",
            "細かい手順は任せる"
          ],
          "reading": "作業を始める前に、Claude の読みを確かめられるようにする",
          "source": "π1"
        }
      ],
      "steps": [
        {
          "text": "帯に意図の読みと次の一歩を出す",
          "from": [],
          "why": "会話を止めずに読みのずれに気づける"
        },
        {
          "text": "ボードに作業ごとの意図・補完・流れを並べる",
          "from": [],
          "why": "読みがどこから来たかを確かめられる"
        },
        {
          "text": "話しかけて読みを直せるようにする",
          "from": [],
          "why": "ずれを見つけたらその場で直せる"
        }
      ],
      "items": [
        {
          "id": "C0",
          "content": "読みはボタンで開くボードに、要点は帯に出す",
          "by": "claude",
          "turn": 1,
          "parent": null,
          "rel": "answer",
          "reason": "どこに出すかは言われていない。会話を邪魔しない場所を選んだ"
        }
      ],
      "refs": [],
      "local": false
    },
    {
      "id": "Q1",
      "question": "帯に何を出すか",
      "owner": "user",
      "closed": false,
      "parent": "Q0",
      "intent": {
        "quote": [],
        "reading": "会話の邪魔をせずに、いまの読みが目に入るようにする",
        "source": "σ1"
      },
      "intent_history": [],
      "steps": [
        {
          "text": "1行目に意図の読み、2行目に次の一歩",
          "from": [],
          "why": "2行で読みと行き先が分かる"
        }
      ],
      "items": [
        {
          "id": "C1",
          "content": "プロンプトの上に帯を常に出す",
          "by": "claude",
          "turn": 1,
          "parent": null,
          "rel": "answer",
          "reason": "常に目に入る場所として選んだ"
        },
        {
          "id": "C2",
          "content": "帯は2行まで",
          "by": "claude",
          "turn": 1,
          "parent": "C1",
          "rel": "condition",
          "reason": "長いと会話が隠れる"
        }
      ],
      "refs": [],
      "local": false
    }
  ],
  "unregistered": []
}

export const REFS_DEFS = [
  {
    "name": "Issue",
    "pattern": "^#\\d+$",
    "url": "https://github.com/owner/repo/issues/{n}",
    "track": true
  },
  {
    "name": "文書",
    "pattern": "^docs/.+\\.md$",
    "url": "https://github.com/owner/repo/blob/main/{ref}"
  }
]

export const REFS_DIFFS = [
  {
    "turn": 1,
    "utterance_id": "π1",
    "text": "ログインできない不具合を直して（#12）。あと、なんでビルドが遅いのかちょっと気になる",
    "relation": "Open",
    "target": null,
    "markers": [],
    "ops": [
      {
        "op": "open",
        "id": "Q0",
        "question": "ログインできない不具合を直す",
        "refs": [
          "#12"
        ],
        "intent": {
          "quote": [
            "ログインできない不具合を直して（#12）"
          ],
          "reading": "#12 の手順でログインが通るようにする"
        }
      },
      {
        "op": "open",
        "id": "Q1",
        "question": "ビルドが遅い理由を調べる",
        "local": true,
        "intent": {
          "quote": [
            "なんでビルドが遅いのかちょっと気になる"
          ],
          "reading": "理由が分かれば足りる。直すのは別の話"
        }
      }
    ]
  },
  {
    "turn": 2,
    "utterance_id": "π2",
    "text": "設定画面も作りたい。セットアップの手順も古くなってるから書き直して",
    "relation": "Open",
    "target": null,
    "markers": [],
    "ops": [
      {
        "op": "open",
        "id": "Q2",
        "question": "設定画面を作る",
        "intent": {
          "quote": [
            "設定画面も作りたい"
          ],
          "reading": "いまは設定ファイルを手で書く。画面から変えられるようにする"
        }
      },
      {
        "op": "open",
        "id": "Q3",
        "question": "セットアップの手順を書き直す",
        "refs": [
          "docs/setup.md"
        ],
        "intent": {
          "quote": [
            "セットアップの手順も古くなってるから書き直して"
          ],
          "reading": "今の手順で動くように直す"
        }
      }
    ]
  },
  {
    "turn": 3,
    "utterance_id": "σ3",
    "text": "（Claude の作業）",
    "relation": "Elaboration",
    "target": "Q0",
    "markers": [],
    "ops": [
      {
        "op": "ref",
        "question": "Q0",
        "refs": [
          "#12",
          "docs/login.md"
        ]
      },
      {
        "op": "open",
        "id": "Q4",
        "question": "ログの形を確かめる",
        "parent": "Q0",
        "owner": "claude"
      },
      {
        "op": "answer",
        "question": "Q4",
        "complete": true
      }
    ]
  },
  {
    "turn": 4,
    "utterance_id": "π4",
    "text": "手順の書き直しは #15 で管理してる",
    "relation": "Elaboration",
    "target": "Q3",
    "markers": [],
    "ops": [
      {
        "op": "ref",
        "question": "Q3",
        "refs": [
          "#15",
          "docs/setup.md"
        ]
      }
    ]
  }
] as const

export const REFS_BOARD = {
  "turn": 4,
  "goal": null,
  "decided": [],
  "replaced": [],
  "supplemented": [],
  "steps": [],
  "open": [
    {
      "id": "Q3",
      "question": "セットアップの手順を書き直す",
      "owner": "user",
      "parent": null
    },
    {
      "id": "Q2",
      "question": "設定画面を作る",
      "owner": "user",
      "parent": null
    },
    {
      "id": "Q1",
      "question": "ビルドが遅い理由を調べる",
      "owner": "user",
      "parent": null
    },
    {
      "id": "Q0",
      "question": "ログインできない不具合を直す",
      "owner": "user",
      "parent": null
    }
  ],
  "tree": {
    "nodes": [
      {
        "id": "Q0",
        "question": "ログインできない不具合を直す",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q1",
        "question": "ビルドが遅い理由を調べる",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q2",
        "question": "設定画面を作る",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q3",
        "question": "セットアップの手順を書き直す",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q4",
        "question": "ログの形を確かめる",
        "owner": "claude",
        "closed": true,
        "parent": "Q0",
        "items": []
      }
    ],
    "loose": []
  },
  "tasks": [
    {
      "id": "Q0",
      "question": "ログインできない不具合を直す",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "ログインできない不具合を直して（#12）"
        ],
        "reading": "#12 の手順でログインが通るようにする",
        "source": "π1"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [
        {
          "ref": "#12",
          "name": "Issue",
          "url": "https://github.com/owner/repo/issues/12"
        },
        {
          "ref": "docs/login.md",
          "name": "文書",
          "url": "https://github.com/owner/repo/blob/main/docs/login.md"
        }
      ],
      "local": false
    },
    {
      "id": "Q1",
      "question": "ビルドが遅い理由を調べる",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "なんでビルドが遅いのかちょっと気になる"
        ],
        "reading": "理由が分かれば足りる。直すのは別の話",
        "source": "π1"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": true
    },
    {
      "id": "Q2",
      "question": "設定画面を作る",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "設定画面も作りたい"
        ],
        "reading": "いまは設定ファイルを手で書く。画面から変えられるようにする",
        "source": "π2"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": false
    },
    {
      "id": "Q3",
      "question": "セットアップの手順を書き直す",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "セットアップの手順も古くなってるから書き直して"
        ],
        "reading": "今の手順で動くように直す",
        "source": "π2"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [
        {
          "ref": "#15",
          "name": "Issue",
          "url": "https://github.com/owner/repo/issues/15"
        },
        {
          "ref": "docs/setup.md",
          "name": "文書",
          "url": "https://github.com/owner/repo/blob/main/docs/setup.md"
        }
      ],
      "local": false
    },
    {
      "id": "Q4",
      "question": "ログの形を確かめる",
      "owner": "claude",
      "closed": true,
      "parent": "Q0",
      "intent": null,
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": false
    }
  ],
  "unregistered": [
    "Q2"
  ]
}

export const REFS_BOARD_NO_DEFS = {
  "turn": 4,
  "goal": null,
  "decided": [],
  "replaced": [],
  "supplemented": [],
  "steps": [],
  "open": [
    {
      "id": "Q3",
      "question": "セットアップの手順を書き直す",
      "owner": "user",
      "parent": null
    },
    {
      "id": "Q2",
      "question": "設定画面を作る",
      "owner": "user",
      "parent": null
    },
    {
      "id": "Q1",
      "question": "ビルドが遅い理由を調べる",
      "owner": "user",
      "parent": null
    },
    {
      "id": "Q0",
      "question": "ログインできない不具合を直す",
      "owner": "user",
      "parent": null
    }
  ],
  "tree": {
    "nodes": [
      {
        "id": "Q0",
        "question": "ログインできない不具合を直す",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q1",
        "question": "ビルドが遅い理由を調べる",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q2",
        "question": "設定画面を作る",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q3",
        "question": "セットアップの手順を書き直す",
        "owner": "user",
        "closed": false,
        "parent": null,
        "items": []
      },
      {
        "id": "Q4",
        "question": "ログの形を確かめる",
        "owner": "claude",
        "closed": true,
        "parent": "Q0",
        "items": []
      }
    ],
    "loose": []
  },
  "tasks": [
    {
      "id": "Q0",
      "question": "ログインできない不具合を直す",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "ログインできない不具合を直して（#12）"
        ],
        "reading": "#12 の手順でログインが通るようにする",
        "source": "π1"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [
        {
          "ref": "#12"
        },
        {
          "ref": "docs/login.md"
        }
      ],
      "local": false
    },
    {
      "id": "Q1",
      "question": "ビルドが遅い理由を調べる",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "なんでビルドが遅いのかちょっと気になる"
        ],
        "reading": "理由が分かれば足りる。直すのは別の話",
        "source": "π1"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": true
    },
    {
      "id": "Q2",
      "question": "設定画面を作る",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "設定画面も作りたい"
        ],
        "reading": "いまは設定ファイルを手で書く。画面から変えられるようにする",
        "source": "π2"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": false
    },
    {
      "id": "Q3",
      "question": "セットアップの手順を書き直す",
      "owner": "user",
      "closed": false,
      "parent": null,
      "intent": {
        "quote": [
          "セットアップの手順も古くなってるから書き直して"
        ],
        "reading": "今の手順で動くように直す",
        "source": "π2"
      },
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [
        {
          "ref": "#15"
        },
        {
          "ref": "docs/setup.md"
        }
      ],
      "local": false
    },
    {
      "id": "Q4",
      "question": "ログの形を確かめる",
      "owner": "claude",
      "closed": true,
      "parent": "Q0",
      "intent": null,
      "intent_history": [],
      "steps": [],
      "items": [],
      "refs": [],
      "local": false
    }
  ],
  "unregistered": []
}

export const REFS_UNREGISTERED = ["Q2"]

export const REFS_VALIDATION = [
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q2",
          "refs": [
            "#20"
          ]
        }
      ]
    },
    "withDefs": true,
    "problems": []
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q2",
          "refs": [
            "PROJ-1",
            "#20"
          ]
        }
      ]
    },
    "withDefs": true,
    "problems": [
      "ops[0]: 参照 \"PROJ-1\" はこのプロジェクトの参照の形に合わない。使える参照：Issue（^#\\d+$） ／ 文書（^docs/.+\\.md$）"
    ]
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q2",
          "refs": [
            "PROJ-1"
          ]
        }
      ]
    },
    "withDefs": false,
    "problems": []
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q2"
        }
      ]
    },
    "withDefs": true,
    "problems": [
      "ops[0]: ref には refs か local が要る"
    ]
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q9",
          "local": true
        }
      ]
    },
    "withDefs": true,
    "problems": [
      "ops[0]: ref の対象 \"Q9\" が存在しない"
    ]
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q2",
          "refs": [
            "#20",
            "#20"
          ],
          "local": "yes"
        }
      ]
    },
    "withDefs": true,
    "problems": [
      "ops[0]: refs が重複している: #20",
      "ops[0]: local は真偽値: \"yes\""
    ]
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "ref",
          "question": "Q2",
          "refs": [
            "",
            3
          ]
        }
      ]
    },
    "withDefs": true,
    "problems": [
      "ops[0]: refs は空でない文字列の配列: [\"\",3]"
    ]
  },
  {
    "diff": {
      "turn": 5,
      "utterance_id": "π5",
      "relation": "Elaboration",
      "ops": [
        {
          "op": "open",
          "id": "Q5",
          "question": "x",
          "refs": [
            "docs/x.md",
            "x"
          ],
          "local": false
        }
      ]
    },
    "withDefs": true,
    "problems": [
      "ops[0]: 参照 \"x\" はこのプロジェクトの参照の形に合わない。使える参照：Issue（^#\\d+$） ／ 文書（^docs/.+\\.md$）"
    ]
  }
]
