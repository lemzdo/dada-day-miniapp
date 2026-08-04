# Recommendation Copy Contract v3 QA

## P0 回归：穿搭资格与文案资格解耦

### 31℃居家真实语义回归

```text
scene: home
weather.temp: 31
outfit PASS: true
eligibilityReasonCode: HOME_HOT_SLEEVELESS_SHORTS
todayReason: 今天31℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。
todayReasonSource: core_eligibility
legacyEvidenceOnly: true
coreReasonCoverageGapCount: 0
Today reason non-empty: true
```

输入只有无袖上衣、短裤和居家鞋的可见旧字段，没有 soft_material、flexible_fit、breathability 或 lightweight 可靠事实；结果不含“透气、柔软、弹性、速干、缓冲、抓地”。

### 旧衣服无强功能事实四场景 replay

```json
{
  "home": {
    "scene": "home",
    "weather": {
      "temp": 31,
      "weather": "晴"
    },
    "reliableOnlyFactsPresent": false,
    "outfitEligible": true,
    "eligibilityReasonCode": "HOME_HOT_SLEEVELESS_SHORTS",
    "coreEligibilityReason": "今天31℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。",
    "todayReason": "今天31℃，无袖上衣配短裤，宅家穿正合适，整身也不会显得厚重。",
    "todayReasonSource": "core_eligibility",
    "enhancedReason": null,
    "detailExplanation": null,
    "coreReasonAcceptedCount": 1,
    "enhancedReasonAcceptedCount": 0,
    "coreReasonCoverageGapCount": 0,
    "finalRecommendationCount": 1,
    "todayReasonNonEmpty": true,
    "legacyEvidenceOnly": true
  },
  "work": {
    "scene": "work",
    "weather": {
      "temp": 22,
      "weather": "晴"
    },
    "reliableOnlyFactsPresent": false,
    "outfitEligible": true,
    "eligibilityReasonCode": "WORK_SHIRT_STRAIGHT_PANTS",
    "coreEligibilityReason": "衬衫配直筒裤，穿去上班很利落。",
    "todayReason": "衬衫配直筒裤，上班穿比较利落。",
    "todayReasonSource": "enhanced_qualification_core",
    "enhancedReason": "衬衫配直筒裤，上班穿比较利落。",
    "detailExplanation": null,
    "coreReasonAcceptedCount": 1,
    "enhancedReasonAcceptedCount": 1,
    "coreReasonCoverageGapCount": 0,
    "finalRecommendationCount": 1,
    "todayReasonNonEmpty": true,
    "legacyEvidenceOnly": true
  },
  "date": {
    "scene": "date",
    "weather": {
      "temp": 22,
      "weather": "晴"
    },
    "reliableOnlyFactsPresent": false,
    "outfitEligible": false,
    "eligibilityReasonCode": null,
    "coreEligibilityReason": "",
    "todayReason": "",
    "todayReasonSource": "",
    "enhancedReason": null,
    "detailExplanation": null,
    "coreReasonAcceptedCount": 0,
    "enhancedReasonAcceptedCount": 0,
    "coreReasonCoverageGapCount": 0,
    "finalRecommendationCount": 0,
    "todayReasonNonEmpty": false,
    "legacyEvidenceOnly": true
  },
  "sport": {
    "scene": "sport",
    "weather": {
      "temp": 22,
      "weather": "晴"
    },
    "reliableOnlyFactsPresent": false,
    "outfitEligible": true,
    "eligibilityReasonCode": "SPORT_COMPLETE_SET",
    "coreEligibilityReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
    "todayReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
    "todayReasonSource": "core_eligibility",
    "enhancedReason": null,
    "detailExplanation": null,
    "coreReasonAcceptedCount": 1,
    "enhancedReasonAcceptedCount": 0,
    "coreReasonCoverageGapCount": 0,
    "finalRecommendationCount": 1,
    "todayReasonNonEmpty": true,
    "legacyEvidenceOnly": true
  }
}
```

eligibility reason coverage: 3/3；所有 final recommendation 的 Today reason 非空：false。

选择规则：qualification-core 增强 Claim 通过 Gate 时替代首页基础理由；没有增强 Claim 时使用 coreEligibilityReason；secondary value 与 detail helper 只进入详情补充。`COPY_EVIDENCE_INSUFFICIENT` 仅统计增强不足，不隐藏首页理由。

### 真正缺少必要品类

```text
limited: true
limitedReason: MISSING_REQUIRED_CATEGORY
missingRoles: ["bottom"]
finalRecommendationCount: 0
```

仅该状态引导补齐衣物；居家的 `missingRoles` 不要求 `shoes`。品类齐全但无合格搭配时使用中性空状态。

### 换一批耗尽

```text
limited: true
limitedReason: DIVERSITY_EXHAUSTED
finalRecommendationCount: 0
```

客户端保留当前卡片，不切换为空页，并提示“这一轮暂时没有更多新搭配了。”；请求序号继续阻止过期响应覆盖新页面。

### Today 与详情展示合同

- Today 仅接收 `new_recommendation` 且 core reason evidence PASS、`todayReason` 非空的卡片；顺序为图片 → 标签 → todayReason → 操作。
- 详情首先显示与 Today 完全一致的 `todayReason`；仅在存在独立 `detailExplanation` 或真实 AI 点评时显示补充区域。
- 收藏与历史继续走 `saved_snapshot`：记录保留，证据不足时旧默认文案隐藏，旧 128 条文案不复活。

## A. Synthetic Contract QA

本节使用定向合成数据验证 Claim、Gate、证据闭环和 finalizer；不是产品真实快照。

### 居家

- wardrobeId: `qa-wardrobe-home`
- weather: `{"temp":30,"weather":"晴"}`
- scene: `home`
- requestedCount: 4
- acceptedCount: 4
- 最终 API 返回数量: 4
- copyAcceptedCount: 4
- copyHiddenCount: 0
- coreReasonAcceptedCount: 4
- enhancedReasonAcceptedCount: 4
- coreReasonCoverageGapCount: 0
- coreReasonCodeCounts: `{"HOME_LOOSE_TWO_PIECE":1,"HOME_TOP_LONG_PANTS":2,"HOME_LOOSE_DRESS":1}`
- enhancementRejectReasonCounts: `{}`
- final Today reason 全部非空: true

```json
{
  "wardrobe": [
    {
      "itemId": "h-top-soft",
      "name": "柔软上衣",
      "category": "top",
      "color": "白色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "soft_material"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "h-top-thin",
      "name": "轻薄上衣",
      "category": "top",
      "color": "白色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "h-bottom-flex",
      "name": "弹力裤",
      "category": "bottom",
      "color": "黑色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "flexible_fit"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "h-bottom-loose",
      "name": "宽松裤",
      "category": "bottom",
      "color": "黑色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "h-dress",
      "name": "宽松连衣裙",
      "category": "onepiece",
      "color": "黑色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "h-tight-top",
      "name": "紧身上衣",
      "category": "top",
      "color": "白色",
      "fit": "紧身",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "soft_material"
      ],
      "confidence": 0.95
    }
  ],
  "selections": [
    {
      "outfitId": "qa-home-fixed-claim-v1-1",
      "scene": "home",
      "weather": {
        "temp": 30,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "h-top-soft",
        "h-bottom-flex"
      ],
      "selectedItems": [
        {
          "itemId": "h-top-soft",
          "name": "白色柔软上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:h-top-soft:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-soft:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-soft:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-soft:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-soft:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-soft:soft_material",
              "value": true,
              "source": "product_data",
              "confidence": 1
            }
          ]
        },
        {
          "itemId": "h-bottom-flex",
          "name": "黑色弹力裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:h-bottom-flex:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-flex:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-flex:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-flex:flexible_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:h-bottom-flex:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-flex:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-flex:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "H01-01",
      "subjectItemIds": [
        "h-top-soft",
        "h-bottom-flex"
      ],
      "requiredFactIds": [
        "item:h-top-soft:soft_material",
        "item:h-bottom-flex:pants",
        "item:h-bottom-flex:flexible_fit"
      ],
      "evidenceFactIds": [
        "item:h-top-soft:soft_material",
        "item:h-bottom-flex:pants",
        "item:h-bottom-flex:flexible_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:h-top-soft:soft_material",
          "itemId": "h-top-soft",
          "fact": "soft_material",
          "value": true,
          "source": "product_data",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "productFacts"
        },
        {
          "factId": "item:h-bottom-flex:pants",
          "itemId": "h-bottom-flex",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:h-bottom-flex:flexible_fit",
          "itemId": "h-bottom-flex",
          "fact": "flexible_fit",
          "value": true,
          "source": "product_data",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "productFacts"
        }
      ],
      "slotBindings": {
        "top": "h-top-soft",
        "bottom": "h-bottom-flex"
      },
      "todayReason": "上衣摸起来比较软，裤子也不紧，这身在家穿挺舒服，坐久一点也不容易勒。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "上衣和下装都比较宽松，宅家穿这身正合适，整身看着也不会紧绷。",
      "coreEligibilityReasonCode": "HOME_LOOSE_TWO_PIECE",
      "coreEligibilityEvidence": [
        {
          "factId": "item:h-top-soft:loose_fit",
          "itemId": "h-top-soft",
          "fact": "loose_fit",
          "value": "宽松",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:h-bottom-flex:loose_fit",
          "itemId": "h-bottom-flex",
          "fact": "loose_fit",
          "value": "宽松",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        }
      ],
      "enhancedReason": "上衣摸起来比较软，裤子也不紧，这身在家穿挺舒服，坐久一点也不容易勒。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-home-fixed-claim-v1-2",
      "scene": "home",
      "weather": {
        "temp": 30,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "h-top-thin",
        "h-bottom-loose"
      ],
      "selectedItems": [
        {
          "itemId": "h-top-thin",
          "name": "白色轻薄上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:h-top-thin:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-thin:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-thin:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-top-thin:lightweight",
              "value": "轻薄",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "h-bottom-loose",
          "name": "黑色宽松裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:h-bottom-loose:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "H01-03",
      "subjectItemIds": [
        "h-bottom-loose"
      ],
      "requiredFactIds": [
        "item:h-bottom-loose:pants",
        "item:h-bottom-loose:loose_fit"
      ],
      "evidenceFactIds": [
        "item:h-bottom-loose:pants",
        "item:h-bottom-loose:loose_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:h-bottom-loose:pants",
          "itemId": "h-bottom-loose",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:h-bottom-loose:loose_fit",
          "itemId": "h-bottom-loose",
          "fact": "loose_fit",
          "value": "宽松",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        }
      ],
      "slotBindings": {
        "bottom": "h-bottom-loose"
      },
      "todayReason": "这条裤子版型比较宽松，在家坐着不会觉得太紧。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "上衣配长裤，居家活动和临时出门都能自然衔接。",
      "coreEligibilityReasonCode": "HOME_TOP_LONG_PANTS",
      "coreEligibilityEvidence": [
        {
          "factId": "item:h-top-thin:category",
          "itemId": "h-top-thin",
          "fact": "category",
          "value": "top",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:h-bottom-loose:long_pants",
          "itemId": "h-bottom-loose",
          "fact": "long_pants",
          "value": "bottom 宽松裤 宽松裤",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        }
      ],
      "enhancedReason": "这条裤子版型比较宽松，在家坐着不会觉得太紧。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-home-fixed-claim-v1-3",
      "scene": "home",
      "weather": {
        "temp": 30,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "h-dress"
      ],
      "selectedItems": [
        {
          "itemId": "h-dress",
          "name": "黑色宽松连衣裙",
          "category": "onepiece",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:h-dress:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-dress:category",
              "value": "onepiece",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-dress:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-dress:dress",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-dress:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-dress:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "H01-05",
      "subjectItemIds": [
        "h-dress"
      ],
      "requiredFactIds": [
        "item:h-dress:dress",
        "item:h-dress:loose_fit"
      ],
      "evidenceFactIds": [
        "item:h-dress:dress",
        "item:h-dress:loose_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:h-dress:dress",
          "itemId": "h-dress",
          "fact": "dress",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:h-dress:loose_fit",
          "itemId": "h-dress",
          "fact": "loose_fit",
          "value": "宽松",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        }
      ],
      "slotBindings": {
        "onepiece": "h-dress"
      },
      "todayReason": "这条裙子版型比较宽松，在家坐着也不会觉得紧。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "这条连衣裙版型比较宽松，宅家穿正合适，整身看着也不会紧绷。",
      "coreEligibilityReasonCode": "HOME_LOOSE_DRESS",
      "coreEligibilityEvidence": [
        {
          "factId": "item:h-dress:dress",
          "itemId": "h-dress",
          "fact": "dress",
          "value": true,
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:h-dress:loose_fit",
          "itemId": "h-dress",
          "fact": "loose_fit",
          "value": "宽松",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        }
      ],
      "enhancedReason": "这条裙子版型比较宽松，在家坐着也不会觉得紧。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-home-fixed-claim-v1-4",
      "scene": "home",
      "weather": {
        "temp": 30,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "h-tight-top",
        "h-bottom-loose"
      ],
      "selectedItems": [
        {
          "itemId": "h-tight-top",
          "name": "白色紧身上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:h-tight-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-tight-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-tight-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-tight-top:soft_material",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:h-tight-top:tight_fit",
              "value": "紧身",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "h-bottom-loose",
          "name": "黑色宽松裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:h-bottom-loose:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:h-bottom-loose:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "H01-01",
      "subjectItemIds": [
        "h-tight-top",
        "h-bottom-loose"
      ],
      "requiredFactIds": [
        "item:h-tight-top:soft_material",
        "item:h-bottom-loose:pants",
        "item:h-bottom-loose:loose_fit"
      ],
      "evidenceFactIds": [
        "item:h-tight-top:soft_material",
        "item:h-bottom-loose:pants",
        "item:h-bottom-loose:loose_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:h-tight-top:soft_material",
          "itemId": "h-tight-top",
          "fact": "soft_material",
          "value": true,
          "source": "product_data",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "productFacts"
        },
        {
          "factId": "item:h-bottom-loose:pants",
          "itemId": "h-bottom-loose",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:h-bottom-loose:loose_fit",
          "itemId": "h-bottom-loose",
          "fact": "loose_fit",
          "value": "宽松",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        }
      ],
      "slotBindings": {
        "top": "h-tight-top",
        "bottom": "h-bottom-loose"
      },
      "todayReason": "上衣摸起来比较软，裤子也不紧，这身在家穿挺舒服，坐久一点也不容易勒。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "上衣配长裤，居家活动和临时出门都能自然衔接。",
      "coreEligibilityReasonCode": "HOME_TOP_LONG_PANTS",
      "coreEligibilityEvidence": [
        {
          "factId": "item:h-tight-top:category",
          "itemId": "h-tight-top",
          "fact": "category",
          "value": "top",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:h-bottom-loose:long_pants",
          "itemId": "h-bottom-loose",
          "fact": "long_pants",
          "value": "bottom 宽松裤 宽松裤",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        }
      ],
      "enhancedReason": "上衣摸起来比较软，裤子也不紧，这身在家穿挺舒服，坐久一点也不容易勒。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

### 通勤

- wardrobeId: `qa-wardrobe-work`
- weather: `{"temp":22,"weather":"晴"}`
- scene: `work`
- requestedCount: 4
- acceptedCount: 4
- 最终 API 返回数量: 4
- copyAcceptedCount: 4
- copyHiddenCount: 0
- coreReasonAcceptedCount: 4
- enhancedReasonAcceptedCount: 3
- coreReasonCoverageGapCount: 0
- coreReasonCodeCounts: `{"WORK_SHIRT_STRAIGHT_PANTS":1,"WORK_PATTERN_TOP_SOLID_BOTTOM":1,"WORK_SIMPLE_DRESS_SHOES":1,"WORK_BASELINE_PRESENTABLE":1}`
- enhancementRejectReasonCounts: `{"COPY_EVIDENCE_INSUFFICIENT":1}`
- final Today reason 全部非空: true

```json
{
  "wardrobe": [
    {
      "itemId": "w-shirt",
      "name": "衬衫",
      "category": "top",
      "color": "白色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "soft_material"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "w-pattern-top",
      "name": "图案上衣",
      "category": "top",
      "color": "白色",
      "fit": null,
      "patternType": "印花",
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "w-straight",
      "name": "直筒裤",
      "category": "bottom",
      "color": "黑色",
      "fit": "直筒",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "flexible_fit"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "w-solid",
      "name": "纯色裤子",
      "category": "bottom",
      "color": "黑色",
      "fit": null,
      "patternType": "纯色",
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "w-shoes",
      "name": "简洁乐福鞋",
      "category": "shoes",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "w-dress",
      "name": "简洁连衣裙",
      "category": "onepiece",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "w-hoodie",
      "name": "宽松卫衣",
      "category": "top",
      "color": "白色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    }
  ],
  "selections": [
    {
      "outfitId": "qa-work-fixed-claim-v1-1",
      "scene": "work",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "w-shirt",
        "w-straight",
        "w-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "w-shirt",
          "name": "白色衬衫",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:w-shirt:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shirt:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shirt:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shirt:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shirt:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shirt:shirt",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shirt:soft_material",
              "value": true,
              "source": "product_data",
              "confidence": 1
            }
          ]
        },
        {
          "itemId": "w-straight",
          "name": "黑色直筒裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-straight:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:flexible_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:w-straight:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:straight_cut",
              "value": "直筒",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "w-shoes",
          "name": "黑色简洁乐福鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "W01-01",
      "subjectItemIds": [
        "w-shirt",
        "w-straight"
      ],
      "requiredFactIds": [
        "item:w-shirt:shirt",
        "item:w-straight:pants",
        "item:w-straight:straight_cut"
      ],
      "evidenceFactIds": [
        "item:w-shirt:shirt",
        "item:w-straight:pants",
        "item:w-straight:straight_cut"
      ],
      "evidenceSources": [
        {
          "factId": "item:w-shirt:shirt",
          "itemId": "w-shirt",
          "fact": "shirt",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:w-straight:pants",
          "itemId": "w-straight",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:w-straight:straight_cut",
          "itemId": "w-straight",
          "fact": "straight_cut",
          "value": "直筒",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        }
      ],
      "slotBindings": {
        "top": "w-shirt",
        "bottom": "w-straight"
      },
      "todayReason": "衬衫配直筒裤，上班穿比较利落。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "衬衫配直筒裤，穿去上班很利落。",
      "coreEligibilityReasonCode": "WORK_SHIRT_STRAIGHT_PANTS",
      "coreEligibilityEvidence": [
        {
          "factId": "item:w-shirt:shirt",
          "itemId": "w-shirt",
          "fact": "shirt",
          "value": true,
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-straight:straight_cut",
          "itemId": "w-straight",
          "fact": "straight_cut",
          "value": "直筒",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "w-shirt",
            "w-straight"
          ],
          "supportingFactIds": [
            "item:w-shirt:shirt",
            "item:w-straight:straight_cut"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "confidence": 0.9,
          "authorized": true
        }
      ],
      "enhancedReason": "衬衫配直筒裤，上班穿比较利落。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-work-fixed-claim-v1-2",
      "scene": "work",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "w-pattern-top",
        "w-solid",
        "w-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "w-pattern-top",
          "name": "白色图案上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:w-pattern-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-pattern-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-pattern-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-pattern-top:pattern_visible",
              "value": "印花",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "w-solid",
          "name": "黑色纯色裤子",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-solid:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-solid:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-solid:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-solid:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-solid:solid_color",
              "value": "纯色",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "w-shoes",
          "name": "黑色简洁乐福鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "W01-02",
      "subjectItemIds": [
        "w-pattern-top",
        "w-solid",
        "w-shoes"
      ],
      "requiredFactIds": [
        "item:w-pattern-top:pattern_visible",
        "item:w-solid:pants",
        "item:w-solid:solid_color",
        "outfit:work_eligible"
      ],
      "evidenceFactIds": [
        "item:w-pattern-top:pattern_visible",
        "item:w-solid:pants",
        "item:w-solid:solid_color",
        "outfit:work_eligible"
      ],
      "evidenceSources": [
        {
          "factId": "item:w-pattern-top:pattern_visible",
          "itemId": "w-pattern-top",
          "fact": "pattern_visible",
          "value": "印花",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:w-solid:pants",
          "itemId": "w-solid",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:w-solid:solid_color",
          "itemId": "w-solid",
          "fact": "solid_color",
          "value": "纯色",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "w-pattern-top",
            "w-solid",
            "w-shoes"
          ],
          "supportingFactIds": [
            "item:w-pattern-top:category",
            "item:w-pattern-top:pattern_visible",
            "item:w-solid:category",
            "item:w-solid:pants",
            "item:w-solid:solid_color",
            "item:w-shoes:category",
            "item:w-shoes:simple_style"
          ],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "source": "scene_rule",
          "confidence": 0.9,
          "authorized": true,
          "relationRule": ""
        }
      ],
      "slotBindings": {
        "top": "w-pattern-top",
        "bottom": "w-solid"
      },
      "todayReason": "这件上衣图案比较明显，配纯色裤子就不会显得太花，上班穿也合适。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "有图案的上衣配纯色裤子，穿去上班也合适，整身看着不会太花。",
      "coreEligibilityReasonCode": "WORK_PATTERN_TOP_SOLID_BOTTOM",
      "coreEligibilityEvidence": [
        {
          "factId": "item:w-pattern-top:pattern_visible",
          "itemId": "w-pattern-top",
          "fact": "pattern_visible",
          "value": "印花",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-solid:solid_color",
          "itemId": "w-solid",
          "fact": "solid_color",
          "value": "纯色",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "w-pattern-top",
            "w-solid"
          ],
          "supportingFactIds": [
            "item:w-pattern-top:pattern_visible",
            "item:w-solid:solid_color"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "confidence": 0.9,
          "authorized": true
        }
      ],
      "enhancedReason": "这件上衣图案比较明显，配纯色裤子就不会显得太花，上班穿也合适。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-work-fixed-claim-v1-3",
      "scene": "work",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "w-dress",
        "w-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "w-dress",
          "name": "黑色简洁连衣裙",
          "category": "onepiece",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-dress:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-dress:category",
              "value": "onepiece",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-dress:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-dress:dress",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-dress:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "w-shoes",
          "name": "黑色简洁乐福鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "W01-03",
      "subjectItemIds": [
        "w-dress",
        "w-shoes"
      ],
      "requiredFactIds": [
        "item:w-dress:dress",
        "item:w-dress:simple_style",
        "outfit:work_eligible"
      ],
      "evidenceFactIds": [
        "item:w-dress:dress",
        "item:w-dress:simple_style",
        "outfit:work_eligible"
      ],
      "evidenceSources": [
        {
          "factId": "item:w-dress:dress",
          "itemId": "w-dress",
          "fact": "dress",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:w-dress:simple_style",
          "itemId": "w-dress",
          "fact": "simple_style",
          "value": "简洁",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "w-dress",
            "w-shoes"
          ],
          "supportingFactIds": [
            "item:w-dress:category",
            "item:w-dress:simple_style",
            "item:w-shoes:category",
            "item:w-shoes:simple_style"
          ],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "source": "scene_rule",
          "confidence": 0.9,
          "authorized": true,
          "relationRule": ""
        }
      ],
      "slotBindings": {
        "onepiece": "w-dress"
      },
      "todayReason": "这条连衣裙款式简洁，穿去上班很利落。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "简洁的连衣裙配这双鞋，穿去上班很利落。",
      "coreEligibilityReasonCode": "WORK_SIMPLE_DRESS_SHOES",
      "coreEligibilityEvidence": [
        {
          "factId": "item:w-dress:dress",
          "itemId": "w-dress",
          "fact": "dress",
          "value": true,
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-dress:simple_style",
          "itemId": "w-dress",
          "fact": "simple_style",
          "value": "onepiece 简洁连衣裙 简洁连衣裙 简洁",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-shoes:simple_style",
          "itemId": "w-shoes",
          "fact": "simple_style",
          "value": "shoes 简洁乐福鞋 简洁乐福鞋 简洁",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-shoes:outing_shoe",
          "itemId": "w-shoes",
          "fact": "outing_shoe",
          "value": "简洁乐福鞋 简洁乐福鞋",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "w-dress",
            "w-shoes"
          ],
          "supportingFactIds": [
            "item:w-dress:dress",
            "item:w-dress:simple_style",
            "item:w-shoes:simple_style",
            "item:w-shoes:outing_shoe"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "confidence": 0.9,
          "authorized": true
        }
      ],
      "enhancedReason": "这条连衣裙款式简洁，穿去上班很利落。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-work-fixed-claim-v1-4",
      "scene": "work",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "w-hoodie",
        "w-straight",
        "w-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "w-hoodie",
          "name": "白色宽松卫衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:w-hoodie:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-hoodie:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-hoodie:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-hoodie:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-hoodie:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "w-straight",
          "name": "黑色直筒裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-straight:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:flexible_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:w-straight:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-straight:straight_cut",
              "value": "直筒",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "w-shoes",
          "name": "黑色简洁乐福鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:w-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:w-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": null,
      "subjectItemIds": [],
      "requiredFactIds": [],
      "evidenceFactIds": [],
      "evidenceSources": [],
      "slotBindings": {},
      "todayReason": "这套衣物搭配完整，日常通勤比较稳妥。",
      "todayReasonSource": "core_eligibility",
      "coreEligibilityReason": "这套衣物搭配完整，日常通勤比较稳妥。",
      "coreEligibilityReasonCode": "WORK_BASELINE_PRESENTABLE",
      "coreEligibilityEvidence": [
        {
          "factId": "item:w-hoodie:category",
          "itemId": "w-hoodie",
          "fact": "category",
          "value": "top",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-straight:category",
          "itemId": "w-straight",
          "fact": "category",
          "value": "bottom",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:w-shoes:category",
          "itemId": "w-shoes",
          "fact": "category",
          "value": "shoes",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "w-hoodie",
            "w-straight",
            "w-shoes"
          ],
          "supportingFactIds": [
            "item:w-hoodie:category",
            "item:w-straight:category",
            "item:w-shoes:category"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "confidence": 0.9,
          "authorized": true
        }
      ],
      "enhancedReason": null,
      "enhancementRejectReasons": [
        "COPY_EVIDENCE_INSUFFICIENT"
      ],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

### 约会

- wardrobeId: `qa-wardrobe-date`
- weather: `{"temp":22,"weather":"晴"}`
- scene: `date`
- requestedCount: 4
- acceptedCount: 1
- 最终 API 返回数量: 1
- copyAcceptedCount: 1
- copyHiddenCount: 0
- coreReasonAcceptedCount: 1
- enhancedReasonAcceptedCount: 1
- coreReasonCoverageGapCount: 0
- coreReasonCodeCounts: `{"DATE_PATTERN_DRESS_SIMPLE_SHOES":1}`
- enhancementRejectReasonCounts: `{}`
- final Today reason 全部非空: true

```json
{
  "wardrobe": [
    {
      "itemId": "d-pattern-top",
      "name": "图案上衣",
      "category": "top",
      "color": "白色",
      "fit": null,
      "patternType": "印花",
      "careLabelFacts": [],
      "productFacts": [
        "soft_material"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "d-simple-bottom",
      "name": "简洁裤子",
      "category": "bottom",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "d-simple-shoes",
      "name": "简洁单鞋",
      "category": "shoes",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "d-bright-top",
      "name": "亮色上衣",
      "category": "top",
      "color": "鲜红色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "d-basic-bottom",
      "name": "基础色裤子",
      "category": "bottom",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "d-pattern-dress",
      "name": "图案连衣裙",
      "category": "onepiece",
      "color": "黑色",
      "fit": null,
      "patternType": "印花",
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "d-soft-top",
      "name": "柔软上衣",
      "category": "top",
      "color": "绿色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "soft_material"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "d-flex-bottom",
      "name": "弹力裤",
      "category": "bottom",
      "color": "蓝色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "flexible_fit"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "d-plain-shoes",
      "name": "普通单鞋",
      "category": "shoes",
      "color": "棕色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    }
  ],
  "selections": [
    {
      "outfitId": "qa-date-fixed-claim-v1-1",
      "scene": "date",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "d-pattern-top",
        "d-simple-bottom",
        "d-simple-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "d-pattern-top",
          "name": "白色图案上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:d-pattern-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-top:pattern_visible",
              "value": "印花",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-top:soft_material",
              "value": true,
              "source": "product_data",
              "confidence": 1
            }
          ]
        },
        {
          "itemId": "d-simple-bottom",
          "name": "黑色简洁裤子",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:d-simple-bottom:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-bottom:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-bottom:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "d-simple-shoes",
          "name": "黑色简洁单鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:d-simple-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": null,
      "subjectItemIds": [],
      "requiredFactIds": [],
      "evidenceFactIds": [],
      "evidenceSources": [],
      "slotBindings": {},
      "todayReason": "",
      "todayReasonSource": "core_eligibility",
      "coreEligibilityReason": "",
      "coreEligibilityReasonCode": "",
      "coreEligibilityEvidence": [],
      "enhancedReason": null,
      "enhancementRejectReasons": [
        "COPY_EVIDENCE_INSUFFICIENT"
      ],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "REJECT",
      "riskFlags": [
        "CORE_REASON_COVERAGE_GAP"
      ],
      "copyDisplay": "hidden",
      "includedInFinalApiArray": false
    },
    {
      "outfitId": "qa-date-fixed-claim-v1-2",
      "scene": "date",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "d-bright-top",
        "d-basic-bottom",
        "d-simple-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "d-bright-top",
          "name": "鲜红色亮色上衣",
          "category": "top",
          "color": "鲜红色",
          "facts": [
            {
              "factId": "item:d-bright-top:bright_color",
              "value": "鲜红色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-bright-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-bright-top:color",
              "value": "鲜红色",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "d-basic-bottom",
          "name": "黑色基础色裤子",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:d-basic-bottom:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-basic-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-basic-bottom:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-basic-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "d-simple-shoes",
          "name": "黑色简洁单鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:d-simple-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": null,
      "subjectItemIds": [],
      "requiredFactIds": [],
      "evidenceFactIds": [],
      "evidenceSources": [],
      "slotBindings": {},
      "todayReason": "",
      "todayReasonSource": "core_eligibility",
      "coreEligibilityReason": "",
      "coreEligibilityReasonCode": "",
      "coreEligibilityEvidence": [],
      "enhancedReason": null,
      "enhancementRejectReasons": [
        "COPY_EVIDENCE_INSUFFICIENT"
      ],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "REJECT",
      "riskFlags": [
        "CORE_REASON_COVERAGE_GAP"
      ],
      "copyDisplay": "hidden",
      "includedInFinalApiArray": false
    },
    {
      "outfitId": "qa-date-fixed-claim-v1-3",
      "scene": "date",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "d-pattern-dress",
        "d-simple-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "d-pattern-dress",
          "name": "黑色图案连衣裙",
          "category": "onepiece",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:d-pattern-dress:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-dress:category",
              "value": "onepiece",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-dress:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-dress:dress",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-pattern-dress:pattern_visible",
              "value": "印花",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "d-simple-shoes",
          "name": "黑色简洁单鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:d-simple-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-simple-shoes:simple_style",
              "value": "简洁",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "D01-02",
      "subjectItemIds": [
        "d-pattern-dress",
        "d-simple-shoes"
      ],
      "requiredFactIds": [
        "item:d-pattern-dress:dress",
        "item:d-pattern-dress:pattern_visible",
        "item:d-simple-shoes:simple_style"
      ],
      "evidenceFactIds": [
        "item:d-pattern-dress:dress",
        "item:d-pattern-dress:pattern_visible",
        "item:d-simple-shoes:simple_style"
      ],
      "evidenceSources": [
        {
          "factId": "item:d-pattern-dress:dress",
          "itemId": "d-pattern-dress",
          "fact": "dress",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:d-pattern-dress:pattern_visible",
          "itemId": "d-pattern-dress",
          "fact": "pattern_visible",
          "value": "印花",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:d-simple-shoes:simple_style",
          "itemId": "d-simple-shoes",
          "fact": "simple_style",
          "value": "简洁",
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        }
      ],
      "slotBindings": {
        "onepiece": "d-pattern-dress",
        "shoes": "d-simple-shoes"
      },
      "todayReason": "这条裙子的图案已经够明显，鞋子和配饰简单一点就好。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "这条有图案的连衣裙配简洁鞋子，约会穿挺合适，整身看着也不会太花。",
      "coreEligibilityReasonCode": "DATE_PATTERN_DRESS_SIMPLE_SHOES",
      "coreEligibilityEvidence": [
        {
          "factId": "item:d-pattern-dress:dress",
          "itemId": "d-pattern-dress",
          "fact": "dress",
          "value": true,
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:d-pattern-dress:pattern_visible",
          "itemId": "d-pattern-dress",
          "fact": "pattern_visible",
          "value": "印花",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:d-simple-shoes:simple_style",
          "itemId": "d-simple-shoes",
          "fact": "simple_style",
          "value": "shoes 简洁单鞋 简洁单鞋 简洁",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:d-simple-shoes:outing_shoe",
          "itemId": "d-simple-shoes",
          "fact": "outing_shoe",
          "value": "简洁单鞋 简洁单鞋",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:date_eligible",
          "factId": "outfit:date_eligible",
          "fact": "date_eligible",
          "subjectItemIds": [
            "d-pattern-dress",
            "d-simple-shoes"
          ],
          "supportingFactIds": [
            "item:d-pattern-dress:dress",
            "item:d-pattern-dress:pattern_visible",
            "item:d-simple-shoes:simple_style",
            "item:d-simple-shoes:outing_shoe"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "DATE_FRIENDLY_SIGNAL",
            "DATE_CLEAN_COMPLETE"
          ],
          "confidence": 1,
          "authorized": true
        }
      ],
      "enhancedReason": "这条裙子的图案已经够明显，鞋子和配饰简单一点就好。",
      "enhancementRejectReasons": [],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-date-fixed-claim-v1-4",
      "scene": "date",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "d-soft-top",
        "d-flex-bottom",
        "d-plain-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "d-soft-top",
          "name": "绿色柔软上衣",
          "category": "top",
          "color": "绿色",
          "facts": [
            {
              "factId": "item:d-soft-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-soft-top:color",
              "value": "绿色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-soft-top:soft_material",
              "value": true,
              "source": "product_data",
              "confidence": 1
            }
          ]
        },
        {
          "itemId": "d-flex-bottom",
          "name": "蓝色弹力裤",
          "category": "bottom",
          "color": "蓝色",
          "facts": [
            {
              "factId": "item:d-flex-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-flex-bottom:color",
              "value": "蓝色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-flex-bottom:flexible_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:d-flex-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "d-plain-shoes",
          "name": "棕色普通单鞋",
          "category": "shoes",
          "color": "棕色",
          "facts": [
            {
              "factId": "item:d-plain-shoes:basic_color",
              "value": "棕色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-plain-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-plain-shoes:color",
              "value": "棕色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-plain-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:d-plain-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": null,
      "subjectItemIds": [],
      "requiredFactIds": [],
      "evidenceFactIds": [],
      "evidenceSources": [],
      "slotBindings": {},
      "todayReason": "",
      "todayReasonSource": "core_eligibility",
      "coreEligibilityReason": "",
      "coreEligibilityReasonCode": "",
      "coreEligibilityEvidence": [],
      "enhancedReason": null,
      "enhancementRejectReasons": [
        "COPY_EVIDENCE_INSUFFICIENT"
      ],
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "REJECT",
      "riskFlags": [
        "CORE_REASON_COVERAGE_GAP"
      ],
      "copyDisplay": "hidden",
      "includedInFinalApiArray": false
    }
  ]
}
```

### 运动

- wardrobeId: `qa-wardrobe-sport`
- weather: `{"temp":22,"weather":"晴"}`
- scene: `sport`
- requestedCount: 4
- acceptedCount: 4
- 最终 API 返回数量: 4
- copyAcceptedCount: 4
- copyHiddenCount: 0
- coreReasonAcceptedCount: 4
- enhancedReasonAcceptedCount: 3
- coreReasonCoverageGapCount: 0
- coreReasonCodeCounts: `{"SPORT_COMPLETE_SET":4}`
- enhancementRejectReasonCounts: `{"COPY_EVIDENCE_INSUFFICIENT":1}`
- final Today reason 全部非空: true

```json
{
  "wardrobe": [
    {
      "itemId": "s-shoulder-top",
      "name": "宽肩运动上衣",
      "category": "top",
      "color": "白色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [
        "shoulder_mobility",
        "quick_dry"
      ],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "s-loose-top",
      "name": "宽松运动上衣",
      "category": "top",
      "color": "白色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [
        "shoulder_mobility"
      ],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "s-flex-bottom",
      "name": "弹力运动裤",
      "category": "bottom",
      "color": "黑色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "flexible_fit"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "s-loose-bottom",
      "name": "宽松运动裤",
      "category": "bottom",
      "color": "黑色",
      "fit": "宽松",
      "patternType": null,
      "careLabelFacts": [
        "flexible_fit"
      ],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "s-shoes",
      "name": "运动鞋",
      "category": "shoes",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [
        "secure_fit"
      ],
      "confidence": 0.95
    },
    {
      "itemId": "s-rigid-top",
      "name": "普通运动上衣",
      "category": "top",
      "color": "白色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    },
    {
      "itemId": "s-rigid-bottom",
      "name": "普通运动裤",
      "category": "bottom",
      "color": "黑色",
      "fit": null,
      "patternType": null,
      "careLabelFacts": [],
      "productFacts": [],
      "confidence": 0.95
    }
  ],
  "selections": [
    {
      "outfitId": "qa-sport-fixed-claim-v1-1",
      "scene": "sport",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "s-shoulder-top",
        "s-flex-bottom",
        "s-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "s-shoulder-top",
          "name": "白色宽肩运动上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:s-shoulder-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoulder-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoulder-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoulder-top:quick_dry",
              "value": true,
              "source": "care_label",
              "confidence": 1
            },
            {
              "factId": "item:s-shoulder-top:shoulder_mobility",
              "value": true,
              "source": "care_label",
              "confidence": 1
            },
            {
              "factId": "item:s-shoulder-top:shoulder_relaxed",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-flex-bottom",
          "name": "黑色弹力运动裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-flex-bottom:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-flex-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-flex-bottom:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-flex-bottom:flexible_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:s-flex-bottom:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-flex-bottom:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-flex-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-shoes",
          "name": "黑色运动鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:secure_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:s-shoes:shoe_laces",
              "value": "鞋带",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:sport_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "S01-01",
      "subjectItemIds": [
        "s-shoulder-top",
        "s-flex-bottom"
      ],
      "requiredFactIds": [
        "item:s-shoulder-top:shoulder_mobility",
        "item:s-flex-bottom:pants",
        "item:s-flex-bottom:flexible_fit"
      ],
      "evidenceFactIds": [
        "item:s-shoulder-top:shoulder_mobility",
        "item:s-flex-bottom:pants",
        "item:s-flex-bottom:flexible_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:s-shoulder-top:shoulder_mobility",
          "itemId": "s-shoulder-top",
          "fact": "shoulder_mobility",
          "value": true,
          "source": "care_label",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "careLabelFacts"
        },
        {
          "factId": "item:s-flex-bottom:pants",
          "itemId": "s-flex-bottom",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:s-flex-bottom:flexible_fit",
          "itemId": "s-flex-bottom",
          "fact": "flexible_fit",
          "value": true,
          "source": "product_data",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "productFacts"
        }
      ],
      "slotBindings": {
        "top": "s-shoulder-top",
        "bottom": "s-flex-bottom"
      },
      "todayReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
      "coreEligibilityReasonCode": "SPORT_COMPLETE_SET",
      "coreEligibilityEvidence": [
        {
          "factId": "item:s-shoulder-top:sport_top",
          "itemId": "s-shoulder-top",
          "fact": "sport_top",
          "value": "top 宽肩运动上衣 宽肩运动上衣",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-flex-bottom:sport_bottom",
          "itemId": "s-flex-bottom",
          "fact": "sport_bottom",
          "value": "bottom 弹力运动裤 弹力运动裤",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-shoes:sport_shoe",
          "itemId": "s-shoes",
          "fact": "sport_shoe",
          "value": "运动鞋 运动鞋",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:sport_eligible",
          "factId": "outfit:sport_eligible",
          "fact": "sport_eligible",
          "subjectItemIds": [
            "s-shoulder-top",
            "s-flex-bottom",
            "s-shoes"
          ],
          "supportingFactIds": [
            "item:s-shoulder-top:sport_top",
            "item:s-flex-bottom:sport_bottom",
            "item:s-shoes:sport_shoe"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "SPORT_SHOE",
            "SPORT_APPAREL"
          ],
          "confidence": 1,
          "authorized": true
        }
      ],
      "enhancedReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "enhancementRejectReasons": [],
      "detailExplanation": "这双鞋固定得比较稳，运动时不容易松。",
      "detailDisplay": "visible",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-sport-fixed-claim-v1-2",
      "scene": "sport",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "s-loose-top",
        "s-loose-bottom",
        "s-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "s-loose-top",
          "name": "白色宽松运动上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:s-loose-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-top:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-top:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-top:shoulder_mobility",
              "value": true,
              "source": "care_label",
              "confidence": 1
            }
          ]
        },
        {
          "itemId": "s-loose-bottom",
          "name": "黑色宽松运动裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-loose-bottom:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:flexible_fit",
              "value": true,
              "source": "care_label",
              "confidence": 1
            },
            {
              "factId": "item:s-loose-bottom:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-shoes",
          "name": "黑色运动鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:secure_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:s-shoes:shoe_laces",
              "value": "鞋带",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:sport_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "S01-01",
      "subjectItemIds": [
        "s-loose-top",
        "s-loose-bottom"
      ],
      "requiredFactIds": [
        "item:s-loose-top:shoulder_mobility",
        "item:s-loose-bottom:pants",
        "item:s-loose-bottom:flexible_fit"
      ],
      "evidenceFactIds": [
        "item:s-loose-top:shoulder_mobility",
        "item:s-loose-bottom:pants",
        "item:s-loose-bottom:flexible_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:s-loose-top:shoulder_mobility",
          "itemId": "s-loose-top",
          "fact": "shoulder_mobility",
          "value": true,
          "source": "care_label",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "careLabelFacts"
        },
        {
          "factId": "item:s-loose-bottom:pants",
          "itemId": "s-loose-bottom",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:s-loose-bottom:flexible_fit",
          "itemId": "s-loose-bottom",
          "fact": "flexible_fit",
          "value": true,
          "source": "care_label",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "careLabelFacts"
        }
      ],
      "slotBindings": {
        "top": "s-loose-top",
        "bottom": "s-loose-bottom"
      },
      "todayReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
      "coreEligibilityReasonCode": "SPORT_COMPLETE_SET",
      "coreEligibilityEvidence": [
        {
          "factId": "item:s-loose-top:sport_top",
          "itemId": "s-loose-top",
          "fact": "sport_top",
          "value": "top 宽松运动上衣 宽松运动上衣",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-loose-bottom:sport_bottom",
          "itemId": "s-loose-bottom",
          "fact": "sport_bottom",
          "value": "bottom 宽松运动裤 宽松运动裤",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-shoes:sport_shoe",
          "itemId": "s-shoes",
          "fact": "sport_shoe",
          "value": "运动鞋 运动鞋",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:sport_eligible",
          "factId": "outfit:sport_eligible",
          "fact": "sport_eligible",
          "subjectItemIds": [
            "s-loose-top",
            "s-loose-bottom",
            "s-shoes"
          ],
          "supportingFactIds": [
            "item:s-loose-top:sport_top",
            "item:s-loose-bottom:sport_bottom",
            "item:s-shoes:sport_shoe"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "SPORT_SHOE",
            "SPORT_APPAREL"
          ],
          "confidence": 1,
          "authorized": true
        }
      ],
      "enhancedReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "enhancementRejectReasons": [],
      "detailExplanation": "这双鞋固定得比较稳，运动时不容易松。",
      "detailDisplay": "visible",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-sport-fixed-claim-v1-3",
      "scene": "sport",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "s-shoulder-top",
        "s-loose-bottom",
        "s-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "s-shoulder-top",
          "name": "白色宽肩运动上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:s-shoulder-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoulder-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoulder-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoulder-top:quick_dry",
              "value": true,
              "source": "care_label",
              "confidence": 1
            },
            {
              "factId": "item:s-shoulder-top:shoulder_mobility",
              "value": true,
              "source": "care_label",
              "confidence": 1
            },
            {
              "factId": "item:s-shoulder-top:shoulder_relaxed",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-loose-bottom",
          "name": "黑色宽松运动裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-loose-bottom:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:flexible_fit",
              "value": true,
              "source": "care_label",
              "confidence": 1
            },
            {
              "factId": "item:s-loose-bottom:loose_fit",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:not_fitted",
              "value": "宽松",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-loose-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-shoes",
          "name": "黑色运动鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:secure_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:s-shoes:shoe_laces",
              "value": "鞋带",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:sport_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": "S01-01",
      "subjectItemIds": [
        "s-shoulder-top",
        "s-loose-bottom"
      ],
      "requiredFactIds": [
        "item:s-shoulder-top:shoulder_mobility",
        "item:s-loose-bottom:pants",
        "item:s-loose-bottom:flexible_fit"
      ],
      "evidenceFactIds": [
        "item:s-shoulder-top:shoulder_mobility",
        "item:s-loose-bottom:pants",
        "item:s-loose-bottom:flexible_fit"
      ],
      "evidenceSources": [
        {
          "factId": "item:s-shoulder-top:shoulder_mobility",
          "itemId": "s-shoulder-top",
          "fact": "shoulder_mobility",
          "value": true,
          "source": "care_label",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "careLabelFacts"
        },
        {
          "factId": "item:s-loose-bottom:pants",
          "itemId": "s-loose-bottom",
          "fact": "pants",
          "value": true,
          "source": "visual_inference",
          "confidence": 0.95,
          "authorized": true
        },
        {
          "factId": "item:s-loose-bottom:flexible_fit",
          "itemId": "s-loose-bottom",
          "fact": "flexible_fit",
          "value": true,
          "source": "care_label",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "careLabelFacts"
        }
      ],
      "slotBindings": {
        "top": "s-shoulder-top",
        "bottom": "s-loose-bottom"
      },
      "todayReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "todayReasonSource": "enhanced_qualification_core",
      "coreEligibilityReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
      "coreEligibilityReasonCode": "SPORT_COMPLETE_SET",
      "coreEligibilityEvidence": [
        {
          "factId": "item:s-shoulder-top:sport_top",
          "itemId": "s-shoulder-top",
          "fact": "sport_top",
          "value": "top 宽肩运动上衣 宽肩运动上衣",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-loose-bottom:sport_bottom",
          "itemId": "s-loose-bottom",
          "fact": "sport_bottom",
          "value": "bottom 宽松运动裤 宽松运动裤",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-shoes:sport_shoe",
          "itemId": "s-shoes",
          "fact": "sport_shoe",
          "value": "运动鞋 运动鞋",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:sport_eligible",
          "factId": "outfit:sport_eligible",
          "fact": "sport_eligible",
          "subjectItemIds": [
            "s-shoulder-top",
            "s-loose-bottom",
            "s-shoes"
          ],
          "supportingFactIds": [
            "item:s-shoulder-top:sport_top",
            "item:s-loose-bottom:sport_bottom",
            "item:s-shoes:sport_shoe"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "SPORT_SHOE",
            "SPORT_APPAREL"
          ],
          "confidence": 1,
          "authorized": true
        }
      ],
      "enhancedReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "enhancementRejectReasons": [],
      "detailExplanation": "这双鞋固定得比较稳，运动时不容易松。",
      "detailDisplay": "visible",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    },
    {
      "outfitId": "qa-sport-fixed-claim-v1-4",
      "scene": "sport",
      "weather": {
        "temp": 22,
        "weather": "晴"
      },
      "selectedOutfitItemIds": [
        "s-rigid-top",
        "s-rigid-bottom",
        "s-shoes"
      ],
      "selectedItems": [
        {
          "itemId": "s-rigid-top",
          "name": "白色普通运动上衣",
          "category": "top",
          "color": "白色",
          "facts": [
            {
              "factId": "item:s-rigid-top:basic_color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-rigid-top:category",
              "value": "top",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-rigid-top:color",
              "value": "白色",
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-rigid-bottom",
          "name": "黑色普通运动裤",
          "category": "bottom",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-rigid-bottom:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-rigid-bottom:category",
              "value": "bottom",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-rigid-bottom:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-rigid-bottom:pants",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        },
        {
          "itemId": "s-shoes",
          "name": "黑色运动鞋",
          "category": "shoes",
          "color": "黑色",
          "facts": [
            {
              "factId": "item:s-shoes:basic_color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:category",
              "value": "shoes",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:color",
              "value": "黑色",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:outing_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:secure_fit",
              "value": true,
              "source": "product_data",
              "confidence": 1
            },
            {
              "factId": "item:s-shoes:shoe_laces",
              "value": "鞋带",
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:shoe_role",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            },
            {
              "factId": "item:s-shoes:sport_shoe",
              "value": true,
              "source": "visual_inference",
              "confidence": 0.95
            }
          ]
        }
      ],
      "claimId": null,
      "subjectItemIds": [],
      "requiredFactIds": [],
      "evidenceFactIds": [],
      "evidenceSources": [],
      "slotBindings": {},
      "todayReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
      "todayReasonSource": "core_eligibility",
      "coreEligibilityReason": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
      "coreEligibilityReasonCode": "SPORT_COMPLETE_SET",
      "coreEligibilityEvidence": [
        {
          "factId": "item:s-rigid-top:sport_top",
          "itemId": "s-rigid-top",
          "fact": "sport_top",
          "value": "top 普通运动上衣 普通运动上衣",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-rigid-bottom:sport_bottom",
          "itemId": "s-rigid-bottom",
          "fact": "sport_bottom",
          "value": "bottom 普通运动裤 普通运动裤",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "factId": "item:s-shoes:sport_shoe",
          "itemId": "s-shoes",
          "fact": "sport_shoe",
          "value": "运动鞋 运动鞋",
          "source": "legacy_snapshot",
          "confidence": 1,
          "authorized": true,
          "sourceDetail": "legacy-visible-fact-adapter"
        },
        {
          "relationFactId": "outfit:sport_eligible",
          "factId": "outfit:sport_eligible",
          "fact": "sport_eligible",
          "subjectItemIds": [
            "s-rigid-top",
            "s-rigid-bottom",
            "s-shoes"
          ],
          "supportingFactIds": [
            "item:s-rigid-top:sport_top",
            "item:s-rigid-bottom:sport_bottom",
            "item:s-shoes:sport_shoe"
          ],
          "source": "scene_rule",
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "SPORT_SHOE",
            "SPORT_APPAREL"
          ],
          "confidence": 1,
          "authorized": true
        }
      ],
      "enhancedReason": null,
      "enhancementRejectReasons": [
        "COPY_EVIDENCE_INSUFFICIENT"
      ],
      "detailExplanation": "这双鞋固定得比较稳，运动时不容易松。",
      "detailDisplay": "visible",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

## B. Real-schema Replay

fixture 沿用仓库识别与组合测试的原始 wardrobe schema；不是生产数据，未访问生产数据库。路径为 raw wardrobe → fact extraction → scene eligibility → Planner → Gate → new finalizer。

### 居家

- requestedCount: 1
- acceptedCount: 1
- finalApiCount: 1
- copyAcceptedCount: 1
- copyHiddenCount: 0

```json
{
  "fixtureKind": "real-schema replay",
  "fixtureOrigin": "repository recognition/composition test schema; not production data",
  "weather": {
    "temp": 24,
    "weather": "多云"
  },
  "rawWardrobe": [
    {
      "_id": "raw-home-top",
      "_openid": "qa-anonymous-openid",
      "category": "top",
      "subcategory": "宽松家居上衣",
      "customName": "宽松家居上衣",
      "imageUrl": "cloud://qa/raw-home-top.jpg",
      "styleTags": [
        "休闲"
      ],
      "sceneTags": [
        "居家"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "宽松",
      "structuredAiFacts": [
        "breathability"
      ]
    },
    {
      "_id": "raw-home-bottom",
      "_openid": "qa-anonymous-openid",
      "category": "bottom",
      "subcategory": "宽松家居长裤",
      "customName": "宽松家居长裤",
      "imageUrl": "cloud://qa/raw-home-bottom.jpg",
      "styleTags": [
        "休闲"
      ],
      "sceneTags": [
        "居家"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "宽松"
    },
    {
      "_id": "raw-home-shoes",
      "_openid": "qa-anonymous-openid",
      "category": "shoes",
      "subcategory": "室内拖鞋",
      "customName": "室内拖鞋",
      "imageUrl": "cloud://qa/raw-home-shoes.jpg",
      "styleTags": [
        "居家"
      ],
      "sceneTags": [
        "居家"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z"
    }
  ],
  "candidates": [
    {
      "outfitId": "real-schema-home-1",
      "selectedOutfitItemIds": [
        "raw-home-top",
        "raw-home-bottom"
      ],
      "rawItemFields": [
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "structuredAiFacts",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ]
      ],
      "extractedFacts": [
        {
          "factId": "item:raw-home-top:breathability",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-home-top:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-home-top:loose_fit",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-home-top:not_fitted",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-home-bottom:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-home-bottom:loose_fit",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-home-bottom:not_fitted",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-home-bottom:pants",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        }
      ],
      "rejectedWeakFunctionalFacts": [
        "item:raw-home-top:breathability"
      ],
      "sceneEligibility": {
        "eligible": true,
        "hardRejected": false,
        "penalty": 0,
        "acceptReasons": [
          "HOME_RELAXED_ALLOWED"
        ],
        "rejectReasons": [],
        "warnings": [],
        "sceneStrength": "medium",
        "evidence": [
          {
            "itemId": "raw-home-top",
            "category": "top",
            "normalizedType": "宽松家居上衣 宽松家居上衣 top",
            "evidence": [
              "customName:宽松家居上衣",
              "subcategory:宽松家居上衣",
              "category:top",
              "fit:宽松",
              "styleTags:休闲",
              "sceneTags:居家",
              "seasonTags:春秋"
            ]
          },
          {
            "itemId": "raw-home-bottom",
            "category": "bottom",
            "normalizedType": "宽松家居长裤 宽松家居长裤 bottom",
            "evidence": [
              "customName:宽松家居长裤",
              "subcategory:宽松家居长裤",
              "category:bottom",
              "fit:宽松",
              "styleTags:休闲",
              "sceneTags:居家",
              "seasonTags:春秋"
            ]
          }
        ],
        "itemFacts": [
          {
            "itemId": "raw-home-top",
            "category": "top",
            "subcategory": "宽松家居上衣",
            "itemType": "宽松家居上衣",
            "normalizedType": "宽松家居上衣 宽松家居上衣 top",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [],
            "dateSignals": [],
            "homeSignals": [
              "宽松家居上衣",
              "宽松",
              "居家"
            ],
            "confidence": 0.88,
            "evidence": [
              "customName:宽松家居上衣",
              "subcategory:宽松家居上衣",
              "category:top",
              "fit:宽松",
              "styleTags:休闲",
              "sceneTags:居家",
              "seasonTags:春秋"
            ]
          },
          {
            "itemId": "raw-home-bottom",
            "category": "bottom",
            "subcategory": "宽松家居长裤",
            "itemType": "宽松家居长裤",
            "normalizedType": "宽松家居长裤 宽松家居长裤 bottom",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": true,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [],
            "dateSignals": [],
            "homeSignals": [
              "宽松家居长裤",
              "宽松",
              "居家"
            ],
            "confidence": 0.88,
            "evidence": [
              "customName:宽松家居长裤",
              "subcategory:宽松家居长裤",
              "category:bottom",
              "fit:宽松",
              "styleTags:休闲",
              "sceneTags:居家",
              "seasonTags:春秋"
            ]
          }
        ],
        "eligibilityReason": {
          "code": "HOME_LOOSE_TWO_PIECE",
          "family": "fit",
          "qualityTier": 4,
          "isGenericFallback": false,
          "subjectItemIds": [
            "raw-home-top",
            "raw-home-bottom"
          ],
          "supportingFactIds": [
            "item:raw-home-top:loose_fit",
            "item:raw-home-bottom:loose_fit"
          ],
          "relationFactIds": [],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "HOME_RELAXED_ALLOWED",
            "WEATHER_BAND_MILD",
            "ELIGIBILITY_REASON_HOME_LOOSE_TWO_PIECE"
          ],
          "evidence": [
            {
              "factId": "item:raw-home-top:loose_fit",
              "itemId": "raw-home-top",
              "fact": "loose_fit",
              "value": "宽松",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-home-bottom:loose_fit",
              "itemId": "raw-home-bottom",
              "fact": "loose_fit",
              "value": "宽松",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            }
          ],
          "text": "上衣和下装都比较宽松，宅家穿这身正合适，整身看着也不会紧绷。",
          "patternLabel": "",
          "catalogOrder": 5,
          "catalogVersion": "eligibility-reason-v6"
        }
      },
      "relationFacts": [],
      "claimId": "H01-03",
      "todayReason": "这条裤子版型比较宽松，在家坐着不会觉得太紧。",
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

### 通勤

- requestedCount: 1
- acceptedCount: 1
- finalApiCount: 1
- copyAcceptedCount: 1
- copyHiddenCount: 0

```json
{
  "fixtureKind": "real-schema replay",
  "fixtureOrigin": "repository recognition/composition test schema; not production data",
  "weather": {
    "temp": 22,
    "weather": "晴"
  },
  "rawWardrobe": [
    {
      "_id": "raw-work-shirt",
      "_openid": "qa-anonymous-openid",
      "category": "top",
      "subcategory": "白色衬衫",
      "customName": "白色衬衫",
      "imageUrl": "cloud://qa/raw-work-shirt.jpg",
      "styleTags": [
        "简约"
      ],
      "sceneTags": [
        "通勤",
        "上班"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "白色",
          "hex": "#F5F5F2",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "常规",
      "patternType": "纯色",
      "styleComplexity": "简洁",
      "structuredAiFacts": [
        "wrinkle_risk"
      ]
    },
    {
      "_id": "raw-work-bottom",
      "_openid": "qa-anonymous-openid",
      "category": "bottom",
      "subcategory": "黑色直筒裤",
      "customName": "黑色直筒裤",
      "imageUrl": "cloud://qa/raw-work-bottom.jpg",
      "styleTags": [
        "简约"
      ],
      "sceneTags": [
        "通勤",
        "上班"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "直筒",
      "patternType": "纯色",
      "styleComplexity": "简洁"
    },
    {
      "_id": "raw-work-shoes",
      "_openid": "qa-anonymous-openid",
      "category": "shoes",
      "subcategory": "黑色乐福鞋",
      "customName": "黑色乐福鞋",
      "imageUrl": "cloud://qa/raw-work-shoes.jpg",
      "styleTags": [
        "简约"
      ],
      "sceneTags": [
        "通勤",
        "上班"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "styleComplexity": "简洁"
    }
  ],
  "candidates": [
    {
      "outfitId": "real-schema-work-1",
      "selectedOutfitItemIds": [
        "raw-work-shirt",
        "raw-work-bottom",
        "raw-work-shoes"
      ],
      "rawItemFields": [
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "patternType",
          "sceneTags",
          "seasonTags",
          "status",
          "structuredAiFacts",
          "styleComplexity",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "patternType",
          "sceneTags",
          "seasonTags",
          "status",
          "styleComplexity",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "styleComplexity",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ]
      ],
      "extractedFacts": [
        {
          "factId": "item:raw-work-shirt:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shirt:shirt",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shirt:simple_style",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shirt:solid_color",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shirt:wrinkle_risk",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-work-bottom:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-bottom:pants",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-bottom:simple_style",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-bottom:solid_color",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-bottom:straight_cut",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shoes:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shoes:outing_shoe",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-work-shoes:shoe_role",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-work-shoes:simple_style",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        }
      ],
      "rejectedWeakFunctionalFacts": [
        "item:raw-work-shirt:wrinkle_risk"
      ],
      "sceneEligibility": {
        "eligible": true,
        "hardRejected": false,
        "penalty": 0,
        "acceptReasons": [
          "WORK_QUALIFIED_SHOE",
          "WORK_POLISHED_SIGNAL"
        ],
        "rejectReasons": [],
        "warnings": [],
        "sceneStrength": "high",
        "evidence": [
          {
            "itemId": "raw-work-shirt",
            "category": "top",
            "normalizedType": "白色衬衫 白色衬衫 top",
            "evidence": [
              "customName:白色衬衫",
              "subcategory:白色衬衫",
              "category:top",
              "fit:常规",
              "patternType:纯色",
              "styleTags:简约",
              "sceneTags:通勤",
              "sceneTags:上班",
              "seasonTags:春秋",
              "work:白色衬衫/通勤/上班"
            ]
          },
          {
            "itemId": "raw-work-bottom",
            "category": "bottom",
            "normalizedType": "黑色直筒裤 黑色直筒裤 bottom",
            "evidence": [
              "customName:黑色直筒裤",
              "subcategory:黑色直筒裤",
              "category:bottom",
              "fit:直筒",
              "patternType:纯色",
              "styleTags:简约",
              "sceneTags:通勤",
              "sceneTags:上班",
              "seasonTags:春秋",
              "work:通勤/上班"
            ]
          },
          {
            "itemId": "raw-work-shoes",
            "category": "shoes",
            "normalizedType": "黑色乐福鞋 黑色乐福鞋 shoes",
            "evidence": [
              "customName:黑色乐福鞋",
              "subcategory:黑色乐福鞋",
              "category:shoes",
              "styleTags:简约",
              "sceneTags:通勤",
              "sceneTags:上班",
              "seasonTags:春秋",
              "work:黑色乐福鞋/通勤/上班"
            ]
          }
        ],
        "itemFacts": [
          {
            "itemId": "raw-work-shirt",
            "category": "top",
            "subcategory": "白色衬衫",
            "itemType": "白色衬衫",
            "normalizedType": "白色衬衫 白色衬衫 top",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": true,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [
              "白色衬衫",
              "通勤",
              "上班"
            ],
            "dateSignals": [],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:白色衬衫",
              "subcategory:白色衬衫",
              "category:top",
              "fit:常规",
              "patternType:纯色",
              "styleTags:简约",
              "sceneTags:通勤",
              "sceneTags:上班",
              "seasonTags:春秋",
              "work:白色衬衫/通勤/上班"
            ]
          },
          {
            "itemId": "raw-work-bottom",
            "category": "bottom",
            "subcategory": "黑色直筒裤",
            "itemType": "黑色直筒裤",
            "normalizedType": "黑色直筒裤 黑色直筒裤 bottom",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": true,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [
              "通勤",
              "上班"
            ],
            "dateSignals": [],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:黑色直筒裤",
              "subcategory:黑色直筒裤",
              "category:bottom",
              "fit:直筒",
              "patternType:纯色",
              "styleTags:简约",
              "sceneTags:通勤",
              "sceneTags:上班",
              "seasonTags:春秋",
              "work:通勤/上班"
            ]
          },
          {
            "itemId": "raw-work-shoes",
            "category": "shoes",
            "subcategory": "黑色乐福鞋",
            "itemType": "黑色乐福鞋",
            "normalizedType": "黑色乐福鞋 黑色乐福鞋 shoes",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": true,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [
              "黑色乐福鞋",
              "通勤",
              "上班"
            ],
            "dateSignals": [],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:黑色乐福鞋",
              "subcategory:黑色乐福鞋",
              "category:shoes",
              "styleTags:简约",
              "sceneTags:通勤",
              "sceneTags:上班",
              "seasonTags:春秋",
              "work:黑色乐福鞋/通勤/上班"
            ]
          }
        ],
        "sceneConfidence": "high",
        "eligibilityReason": {
          "code": "WORK_SHIRT_STRAIGHT_PANTS",
          "family": "category",
          "qualityTier": 2,
          "isGenericFallback": false,
          "subjectItemIds": [
            "raw-work-shirt",
            "raw-work-bottom"
          ],
          "supportingFactIds": [
            "item:raw-work-shirt:shirt",
            "item:raw-work-bottom:straight_cut"
          ],
          "relationFactIds": [
            "outfit:work_eligible"
          ],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL",
            "WEATHER_BAND_MILD",
            "ELIGIBILITY_REASON_WORK_SHIRT_STRAIGHT_PANTS"
          ],
          "evidence": [
            {
              "factId": "item:raw-work-shirt:shirt",
              "itemId": "raw-work-shirt",
              "fact": "shirt",
              "value": true,
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-work-bottom:straight_cut",
              "itemId": "raw-work-bottom",
              "fact": "straight_cut",
              "value": "直筒",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "relationFactId": "outfit:work_eligible",
              "factId": "outfit:work_eligible",
              "fact": "work_eligible",
              "subjectItemIds": [
                "raw-work-shirt",
                "raw-work-bottom"
              ],
              "supportingFactIds": [
                "item:raw-work-shirt:shirt",
                "item:raw-work-bottom:straight_cut"
              ],
              "source": "scene_rule",
              "sourceRule": "sceneEligibilityV3",
              "sourceRuleReasons": [
                "WORK_QUALIFIED_SHOE",
                "WORK_POLISHED_SIGNAL"
              ],
              "confidence": 0.9,
              "authorized": true
            }
          ],
          "text": "衬衫配直筒裤，穿去上班很利落。",
          "patternLabel": "",
          "catalogOrder": 13,
          "catalogVersion": "eligibility-reason-v6"
        }
      },
      "relationFacts": [
        {
          "relationFactId": "outfit:work_eligible",
          "factId": "outfit:work_eligible",
          "fact": "work_eligible",
          "subjectItemIds": [
            "raw-work-shirt",
            "raw-work-bottom",
            "raw-work-shoes"
          ],
          "supportingFactIds": [
            "item:raw-work-shirt:category",
            "item:raw-work-shirt:shirt",
            "item:raw-work-shirt:simple_style",
            "item:raw-work-shirt:solid_color",
            "item:raw-work-bottom:category",
            "item:raw-work-bottom:pants",
            "item:raw-work-bottom:simple_style",
            "item:raw-work-bottom:solid_color",
            "item:raw-work-bottom:straight_cut",
            "item:raw-work-shoes:category",
            "item:raw-work-shoes:simple_style"
          ],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "WORK_QUALIFIED_SHOE",
            "WORK_POLISHED_SIGNAL"
          ],
          "source": "scene_rule",
          "confidence": 0.9,
          "authorized": true
        }
      ],
      "claimId": "W01-01",
      "todayReason": "衬衫配直筒裤，上班穿比较利落。",
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

### 约会

- requestedCount: 1
- acceptedCount: 1
- finalApiCount: 1
- copyAcceptedCount: 1
- copyHiddenCount: 0

```json
{
  "fixtureKind": "real-schema replay",
  "fixtureOrigin": "repository recognition/composition test schema; not production data",
  "weather": {
    "temp": 22,
    "weather": "晴"
  },
  "rawWardrobe": [
    {
      "_id": "raw-date-top",
      "_openid": "qa-anonymous-openid",
      "category": "top",
      "subcategory": "印花上衣",
      "customName": "印花上衣",
      "imageUrl": "cloud://qa/raw-date-top.jpg",
      "styleTags": [
        "甜美"
      ],
      "sceneTags": [
        "约会"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "红色",
          "hex": "#B64043",
          "ratio": 0.65
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "patternType": "印花",
      "styleComplexity": "明显图案",
      "structuredAiFacts": [
        "soft_material"
      ]
    },
    {
      "_id": "raw-date-bottom",
      "_openid": "qa-anonymous-openid",
      "category": "bottom",
      "subcategory": "黑色直筒裤",
      "customName": "黑色直筒裤",
      "imageUrl": "cloud://qa/raw-date-bottom.jpg",
      "styleTags": [
        "简约"
      ],
      "sceneTags": [
        "约会"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "直筒",
      "patternType": "纯色",
      "styleComplexity": "简洁"
    },
    {
      "_id": "raw-date-shoes",
      "_openid": "qa-anonymous-openid",
      "category": "shoes",
      "subcategory": "黑色单鞋",
      "customName": "黑色单鞋",
      "imageUrl": "cloud://qa/raw-date-shoes.jpg",
      "styleTags": [
        "简约"
      ],
      "sceneTags": [
        "约会"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "styleComplexity": "简洁"
    }
  ],
  "candidates": [
    {
      "outfitId": "real-schema-date-1",
      "selectedOutfitItemIds": [
        "raw-date-top",
        "raw-date-bottom",
        "raw-date-shoes"
      ],
      "rawItemFields": [
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "patternType",
          "sceneTags",
          "seasonTags",
          "status",
          "structuredAiFacts",
          "styleComplexity",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "patternType",
          "sceneTags",
          "seasonTags",
          "status",
          "styleComplexity",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "styleComplexity",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ]
      ],
      "extractedFacts": [
        {
          "factId": "item:raw-date-top:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-top:pattern_visible",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-top:soft_material",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-date-bottom:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-bottom:pants",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-bottom:simple_style",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-bottom:solid_color",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-bottom:straight_cut",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-shoes:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-shoes:outing_shoe",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-date-shoes:shoe_role",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-date-shoes:simple_style",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        }
      ],
      "rejectedWeakFunctionalFacts": [
        "item:raw-date-top:soft_material"
      ],
      "sceneEligibility": {
        "eligible": true,
        "hardRejected": false,
        "penalty": 0,
        "acceptReasons": [
          "DATE_FRIENDLY_SIGNAL",
          "DATE_CLEAN_COMPLETE"
        ],
        "rejectReasons": [],
        "warnings": [],
        "sceneStrength": "strong",
        "evidence": [
          {
            "itemId": "raw-date-top",
            "category": "top",
            "normalizedType": "印花上衣 印花上衣 top",
            "evidence": [
              "customName:印花上衣",
              "subcategory:印花上衣",
              "category:top",
              "patternType:印花",
              "styleTags:甜美",
              "sceneTags:约会",
              "seasonTags:春秋",
              "date:甜美/约会"
            ]
          },
          {
            "itemId": "raw-date-bottom",
            "category": "bottom",
            "normalizedType": "黑色直筒裤 黑色直筒裤 bottom",
            "evidence": [
              "customName:黑色直筒裤",
              "subcategory:黑色直筒裤",
              "category:bottom",
              "fit:直筒",
              "patternType:纯色",
              "styleTags:简约",
              "sceneTags:约会",
              "seasonTags:春秋",
              "date:约会"
            ]
          },
          {
            "itemId": "raw-date-shoes",
            "category": "shoes",
            "normalizedType": "黑色单鞋 黑色单鞋 shoes",
            "evidence": [
              "customName:黑色单鞋",
              "subcategory:黑色单鞋",
              "category:shoes",
              "styleTags:简约",
              "sceneTags:约会",
              "seasonTags:春秋",
              "work:黑色单鞋",
              "date:黑色单鞋/约会"
            ]
          }
        ],
        "itemFacts": [
          {
            "itemId": "raw-date-top",
            "category": "top",
            "subcategory": "印花上衣",
            "itemType": "印花上衣",
            "normalizedType": "印花上衣 印花上衣 top",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [],
            "dateSignals": [
              "甜美",
              "约会"
            ],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:印花上衣",
              "subcategory:印花上衣",
              "category:top",
              "patternType:印花",
              "styleTags:甜美",
              "sceneTags:约会",
              "seasonTags:春秋",
              "date:甜美/约会"
            ]
          },
          {
            "itemId": "raw-date-bottom",
            "category": "bottom",
            "subcategory": "黑色直筒裤",
            "itemType": "黑色直筒裤",
            "normalizedType": "黑色直筒裤 黑色直筒裤 bottom",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": true,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [],
            "dateSignals": [
              "约会"
            ],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:黑色直筒裤",
              "subcategory:黑色直筒裤",
              "category:bottom",
              "fit:直筒",
              "patternType:纯色",
              "styleTags:简约",
              "sceneTags:约会",
              "seasonTags:春秋",
              "date:约会"
            ]
          },
          {
            "itemId": "raw-date-shoes",
            "category": "shoes",
            "subcategory": "黑色单鞋",
            "itemType": "黑色单鞋",
            "normalizedType": "黑色单鞋 黑色单鞋 shoes",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [],
            "workSignals": [
              "黑色单鞋"
            ],
            "dateSignals": [
              "黑色单鞋",
              "约会"
            ],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:黑色单鞋",
              "subcategory:黑色单鞋",
              "category:shoes",
              "styleTags:简约",
              "sceneTags:约会",
              "seasonTags:春秋",
              "work:黑色单鞋",
              "date:黑色单鞋/约会"
            ]
          }
        ],
        "eligibilityReason": {
          "code": "DATE_PATTERN_TOP_SIMPLE_SUPPORT",
          "family": "pattern",
          "qualityTier": 3,
          "isGenericFallback": false,
          "subjectItemIds": [
            "raw-date-top",
            "raw-date-bottom",
            "raw-date-shoes"
          ],
          "supportingFactIds": [
            "item:raw-date-top:pattern_visible",
            "item:raw-date-bottom:solid_color",
            "item:raw-date-bottom:simple_style",
            "item:raw-date-shoes:simple_style",
            "item:raw-date-shoes:outing_shoe"
          ],
          "relationFactIds": [
            "outfit:date_eligible"
          ],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "DATE_FRIENDLY_SIGNAL",
            "DATE_CLEAN_COMPLETE",
            "WEATHER_BAND_MILD",
            "ELIGIBILITY_REASON_DATE_PATTERN_TOP_SIMPLE_SUPPORT"
          ],
          "evidence": [
            {
              "factId": "item:raw-date-top:pattern_visible",
              "itemId": "raw-date-top",
              "fact": "pattern_visible",
              "value": "印花",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-date-bottom:solid_color",
              "itemId": "raw-date-bottom",
              "fact": "solid_color",
              "value": "纯色",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-date-bottom:simple_style",
              "itemId": "raw-date-bottom",
              "fact": "simple_style",
              "value": "bottom 黑色直筒裤 黑色直筒裤 简约 约会 简洁",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-date-shoes:simple_style",
              "itemId": "raw-date-shoes",
              "fact": "simple_style",
              "value": "shoes 黑色单鞋 黑色单鞋 简约 约会 简洁",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-date-shoes:outing_shoe",
              "itemId": "raw-date-shoes",
              "fact": "outing_shoe",
              "value": "黑色单鞋 黑色单鞋",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "relationFactId": "outfit:date_eligible",
              "factId": "outfit:date_eligible",
              "fact": "date_eligible",
              "subjectItemIds": [
                "raw-date-top",
                "raw-date-bottom",
                "raw-date-shoes"
              ],
              "supportingFactIds": [
                "item:raw-date-top:pattern_visible",
                "item:raw-date-bottom:solid_color",
                "item:raw-date-bottom:simple_style",
                "item:raw-date-shoes:simple_style",
                "item:raw-date-shoes:outing_shoe"
              ],
              "source": "scene_rule",
              "sourceRule": "sceneEligibilityV3",
              "sourceRuleReasons": [
                "DATE_FRIENDLY_SIGNAL",
                "DATE_CLEAN_COMPLETE"
              ],
              "confidence": 1,
              "authorized": true
            }
          ],
          "text": "有图案的上衣配纯色裤子和简洁鞋子，约会穿挺合适，整身看着也不会太花。",
          "patternLabel": "有图案的",
          "catalogOrder": 20,
          "catalogVersion": "eligibility-reason-v6"
        }
      },
      "relationFacts": [],
      "claimId": "D01-01",
      "todayReason": "这件上衣图案比较抢眼，裤子和鞋子简单一点就好，不会显得太花。",
      "detailExplanation": null,
      "detailDisplay": "hidden",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

### 运动

- requestedCount: 1
- acceptedCount: 1
- finalApiCount: 1
- copyAcceptedCount: 1
- copyHiddenCount: 0

```json
{
  "fixtureKind": "real-schema replay",
  "fixtureOrigin": "repository recognition/composition test schema; not production data",
  "weather": {
    "temp": 22,
    "weather": "晴"
  },
  "rawWardrobe": [
    {
      "_id": "raw-sport-top",
      "_openid": "qa-anonymous-openid",
      "category": "top",
      "subcategory": "运动训练上衣",
      "customName": "运动训练上衣",
      "imageUrl": "cloud://qa/raw-sport-top.jpg",
      "styleTags": [
        "运动"
      ],
      "sceneTags": [
        "运动",
        "训练"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "常规",
      "careLabelFacts": [
        {
          "fact": "shoulder_mobility",
          "confidence": 0.91,
          "parsedFrom": "care_label_ocr"
        }
      ],
      "structuredAiFacts": [
        "breathability",
        "quick_dry"
      ]
    },
    {
      "_id": "raw-sport-bottom",
      "_openid": "qa-anonymous-openid",
      "category": "bottom",
      "subcategory": "运动长裤",
      "customName": "运动长裤",
      "imageUrl": "cloud://qa/raw-sport-bottom.jpg",
      "styleTags": [
        "运动"
      ],
      "sceneTags": [
        "运动",
        "训练"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "fit": "常规",
      "careLabelFacts": [
        {
          "fact": "flexible_fit",
          "confidence": 0.9,
          "parsedFrom": "care_label_ocr"
        }
      ]
    },
    {
      "_id": "raw-sport-shoes",
      "_openid": "qa-anonymous-openid",
      "category": "shoes",
      "subcategory": "系带运动鞋",
      "customName": "系带运动鞋",
      "imageUrl": "cloud://qa/raw-sport-shoes.jpg",
      "styleTags": [
        "运动"
      ],
      "sceneTags": [
        "运动",
        "训练"
      ],
      "seasonTags": [
        "春秋"
      ],
      "colorPalette": [
        {
          "name": "黑色",
          "hex": "#111111",
          "ratio": 1
        }
      ],
      "confidence": 0.88,
      "aiConfidence": 0.88,
      "status": "active",
      "usageCount": 0,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "updatedAt": "2026-06-01T00:00:00.000Z",
      "closure": "鞋带",
      "structuredAiFacts": [
        "cushioning",
        "grip"
      ]
    }
  ],
  "candidates": [
    {
      "outfitId": "real-schema-sport-1",
      "selectedOutfitItemIds": [
        "raw-sport-top",
        "raw-sport-bottom",
        "raw-sport-shoes"
      ],
      "rawItemFields": [
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "careLabelFacts",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "structuredAiFacts",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "careLabelFacts",
          "category",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "fit",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ],
        [
          "_id",
          "_openid",
          "aiConfidence",
          "capabilities",
          "category",
          "closure",
          "colorPalette",
          "confidence",
          "createdAt",
          "customName",
          "imageUrl",
          "outfitRole",
          "outfitSlot",
          "sceneTags",
          "seasonTags",
          "status",
          "structuredAiFacts",
          "styleTags",
          "subcategory",
          "updatedAt",
          "usageCount"
        ]
      ],
      "extractedFacts": [
        {
          "factId": "item:raw-sport-top:breathability",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-sport-top:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-sport-top:quick_dry",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-sport-top:shoulder_mobility",
          "source": "care_label",
          "confidence": 0.91,
          "evidenceLevel": "A"
        },
        {
          "factId": "item:raw-sport-bottom:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-sport-bottom:flexible_fit",
          "source": "care_label",
          "confidence": 0.9,
          "evidenceLevel": "A"
        },
        {
          "factId": "item:raw-sport-bottom:pants",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-sport-shoes:category",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-sport-shoes:cushioning",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-sport-shoes:grip",
          "source": "structured_ai",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-sport-shoes:outing_shoe",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-sport-shoes:shoe_laces",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        },
        {
          "factId": "item:raw-sport-shoes:shoe_role",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "C"
        },
        {
          "factId": "item:raw-sport-shoes:sport_shoe",
          "source": "visual_inference",
          "confidence": 0.88,
          "evidenceLevel": "B"
        }
      ],
      "rejectedWeakFunctionalFacts": [
        "item:raw-sport-top:breathability",
        "item:raw-sport-top:quick_dry",
        "item:raw-sport-shoes:cushioning",
        "item:raw-sport-shoes:grip"
      ],
      "sceneEligibility": {
        "eligible": true,
        "hardRejected": false,
        "penalty": 0,
        "acceptReasons": [
          "SPORT_SHOE",
          "SPORT_APPAREL"
        ],
        "rejectReasons": [],
        "warnings": [],
        "sceneStrength": "strong",
        "evidence": [
          {
            "itemId": "raw-sport-top",
            "category": "top",
            "normalizedType": "运动训练上衣 运动训练上衣 top",
            "evidence": [
              "customName:运动训练上衣",
              "subcategory:运动训练上衣",
              "category:top",
              "fit:常规",
              "styleTags:运动",
              "sceneTags:运动",
              "sceneTags:训练",
              "seasonTags:春秋",
              "sport:运动训练上衣/运动/训练"
            ]
          },
          {
            "itemId": "raw-sport-bottom",
            "category": "bottom",
            "normalizedType": "运动长裤 运动长裤 bottom",
            "evidence": [
              "customName:运动长裤",
              "subcategory:运动长裤",
              "category:bottom",
              "fit:常规",
              "styleTags:运动",
              "sceneTags:运动",
              "sceneTags:训练",
              "seasonTags:春秋",
              "sport:运动长裤/运动/训练"
            ]
          },
          {
            "itemId": "raw-sport-shoes",
            "category": "shoes",
            "normalizedType": "系带运动鞋 系带运动鞋 shoes",
            "evidence": [
              "customName:系带运动鞋",
              "subcategory:系带运动鞋",
              "category:shoes",
              "styleTags:运动",
              "sceneTags:运动",
              "sceneTags:训练",
              "seasonTags:春秋",
              "sport:系带运动鞋/运动/训练"
            ]
          }
        ],
        "itemFacts": [
          {
            "itemId": "raw-sport-top",
            "category": "top",
            "subcategory": "运动训练上衣",
            "itemType": "运动训练上衣",
            "normalizedType": "运动训练上衣 运动训练上衣 top",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [
              "运动训练上衣",
              "运动",
              "训练"
            ],
            "workSignals": [],
            "dateSignals": [],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:运动训练上衣",
              "subcategory:运动训练上衣",
              "category:top",
              "fit:常规",
              "styleTags:运动",
              "sceneTags:运动",
              "sceneTags:训练",
              "seasonTags:春秋",
              "sport:运动训练上衣/运动/训练"
            ]
          },
          {
            "itemId": "raw-sport-bottom",
            "category": "bottom",
            "subcategory": "运动长裤",
            "itemType": "运动长裤",
            "normalizedType": "运动长裤 运动长裤 bottom",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": false,
            "isBootLike": false,
            "isLongPants": true,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [
              "运动长裤",
              "运动",
              "训练"
            ],
            "workSignals": [],
            "dateSignals": [],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:运动长裤",
              "subcategory:运动长裤",
              "category:bottom",
              "fit:常规",
              "styleTags:运动",
              "sceneTags:运动",
              "sceneTags:训练",
              "seasonTags:春秋",
              "sport:运动长裤/运动/训练"
            ]
          },
          {
            "itemId": "raw-sport-shoes",
            "category": "shoes",
            "subcategory": "系带运动鞋",
            "itemType": "系带运动鞋",
            "normalizedType": "系带运动鞋 系带运动鞋 shoes",
            "isSweaterLike": false,
            "isWarmTop": false,
            "isWarmOuterwear": false,
            "isWarmBottom": false,
            "isDressLike": false,
            "isNormalDress": false,
            "isSportDress": false,
            "isSkirtLike": false,
            "isFormalLike": false,
            "isShorts": false,
            "isTshirtLike": false,
            "isSlipperLike": false,
            "isCrocsLike": false,
            "isHomeShoe": false,
            "isCleanSneaker": false,
            "isSportShoe": true,
            "isBootLike": false,
            "isLongPants": false,
            "warmthLevel": 2,
            "lightnessSignals": [],
            "sportSignals": [
              "系带运动鞋",
              "运动",
              "训练"
            ],
            "workSignals": [],
            "dateSignals": [],
            "homeSignals": [],
            "confidence": 0.88,
            "evidence": [
              "customName:系带运动鞋",
              "subcategory:系带运动鞋",
              "category:shoes",
              "styleTags:运动",
              "sceneTags:运动",
              "sceneTags:训练",
              "seasonTags:春秋",
              "sport:系带运动鞋/运动/训练"
            ]
          }
        ],
        "eligibilityReason": {
          "code": "SPORT_COMPLETE_SET",
          "family": "category",
          "qualityTier": 2,
          "isGenericFallback": false,
          "subjectItemIds": [
            "raw-sport-top",
            "raw-sport-bottom",
            "raw-sport-shoes"
          ],
          "supportingFactIds": [
            "item:raw-sport-top:sport_top",
            "item:raw-sport-bottom:sport_bottom",
            "item:raw-sport-shoes:sport_shoe"
          ],
          "relationFactIds": [
            "outfit:sport_eligible"
          ],
          "sourceRule": "sceneEligibilityV3",
          "sourceRuleReasons": [
            "SPORT_SHOE",
            "SPORT_APPAREL",
            "WEATHER_BAND_MILD",
            "ELIGIBILITY_REASON_SPORT_COMPLETE_SET"
          ],
          "evidence": [
            {
              "factId": "item:raw-sport-top:sport_top",
              "itemId": "raw-sport-top",
              "fact": "sport_top",
              "value": "top 运动训练上衣 运动训练上衣 运动 运动 训练",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-sport-bottom:sport_bottom",
              "itemId": "raw-sport-bottom",
              "fact": "sport_bottom",
              "value": "bottom 运动长裤 运动长裤 运动 运动 训练",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "factId": "item:raw-sport-shoes:sport_shoe",
              "itemId": "raw-sport-shoes",
              "fact": "sport_shoe",
              "value": "系带运动鞋 系带运动鞋",
              "source": "legacy_snapshot",
              "confidence": 1,
              "authorized": true,
              "sourceDetail": "legacy-visible-fact-adapter"
            },
            {
              "relationFactId": "outfit:sport_eligible",
              "factId": "outfit:sport_eligible",
              "fact": "sport_eligible",
              "subjectItemIds": [
                "raw-sport-top",
                "raw-sport-bottom",
                "raw-sport-shoes"
              ],
              "supportingFactIds": [
                "item:raw-sport-top:sport_top",
                "item:raw-sport-bottom:sport_bottom",
                "item:raw-sport-shoes:sport_shoe"
              ],
              "source": "scene_rule",
              "sourceRule": "sceneEligibilityV3",
              "sourceRuleReasons": [
                "SPORT_SHOE",
                "SPORT_APPAREL"
              ],
              "confidence": 1,
              "authorized": true
            }
          ],
          "text": "运动上衣、运动裤和运动鞋都配齐了，穿这身去运动正合适。",
          "patternLabel": "",
          "catalogOrder": 27,
          "catalogVersion": "eligibility-reason-v6"
        }
      },
      "relationFacts": [],
      "claimId": "S01-01",
      "todayReason": "上衣肩部不紧，裤子也有弹性，运动时抬手、转身都不会觉得紧。",
      "detailExplanation": "这双鞋有鞋带，运动前系紧一点，做动作时会更稳。",
      "detailDisplay": "visible",
      "gateResult": "PASS",
      "riskFlags": [],
      "copyDisplay": "visible",
      "includedInFinalApiArray": true
    }
  ]
}
```

## C. Saved Snapshot Compatibility

| case | recordPreserved | snapshotItemsPreserved | todayReasonVisible | detailVisible | legacyCopyUsed | Gate |
| --- | --- | --- | --- | --- | --- | --- |
| 旧收藏 | true | true | false | false | false | REJECT |
| 旧历史 | true | true | false | false | false | REJECT |
| 旧详情 | true | true | false | false | false | REJECT |
| 软删衣物历史 snapshot | true | true | false | false | false | REJECT |

## D. 376 → 285 → 当前测试迁移

上一轮 376 条基线在旧运行时测试删除后变为 285 条（净减 91）；本轮恢复关键风险，并新增逐事实授权、real-schema replay、基础资格理由覆盖与 P0 非空理由回归。

| 旧测试文件 / 测试组 | 删除原因 | 新覆盖位置 | 同一风险 |
| --- | --- | --- | --- |
| xiaodaVoiceBankV2 128-row keep/rewrite/remove | 旧运行时句库退役 | xiaodaVoiceBankV2 catalog digest、52 条逐项 QA | 是，改为固定 allowlist |
| recommendationLanguageV3 persona/golden/fallback | 生成式默认文案退役 | Catalog + Planner + Contract + Gate tests | 是 |
| copyQualityGate / pageCopyComposer rewrite tests | Gate 禁止局部修复 | binary Gate、no fallback source audits | 是 |
| outfitReplayFixtures 人工 contractFacts “真实快照” | 夹具命名不准确 | synthetic Contract fixtures + recommendationCopyRealSchemaReplay | 是，覆盖更强 |
| recommendationBatchSnapshot 旧宽快照 | 旧句库字段失效 | 四场景 synthetic batch finalizer assertions | 是 |
| batch diversity hard quota / reject | 产品规则改为软排序 | planner tie-break + repeated Claim PASS tests | 行为按新方案改变 |
| 收藏/历史/详情旧文案 fallback | 旧 128 条禁止重水合 | rehydration saved_snapshot + page source tests | 是 |
