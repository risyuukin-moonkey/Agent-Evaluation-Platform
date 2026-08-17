# Agent 自动化测试平台需求文档

## 1. 项目背景与目标

Agent 自动化测试平台用于批量测试不同 AgentStudio agent 的实际表现。平台的核心目标不是单纯比较 `expected answer` 和 `actual answer` 是否一致，而是提供一个可配置的自动化测试底座，让不同类型的被测 agent 可以按自身特点选择重点测试能力。

平台采用：

```text
通用测试底座 + Agent Profile + 能力评测模块 + 报告复核
```

每个被测 agent 可以通过 Agent Profile 勾选需要关注的能力模块，例如：

- 基础可用性
- 意图识别
- 知识问答
- 多轮上下文
- 角色语气
- 安全合规
- 兜底处理
- Workflow 流程
- 工具/API 调用

其中，`expected answer` 与 `actual answer` 的核心语义一致性判断，属于 `knowledge` 知识问答模块中的重要评估能力。

本次需求重点是：在当前平台基础上，引入 AgentStudio 上的固定 Judge Agent，用于增强 `knowledge` 模块的语义一致性判断能力。

## 2. 当前平台现状

当前平台是一个以前端为主的配置型测试平台，同时带有轻量后端接口。

前端负责：

- 导入 CSV/JSON 测试集
- 配置被测 agent 的接口地址、请求头、请求体模板
- 配置响应字段路径，例如回答字段、intent 字段、知识来源字段
- 配置 Agent Profile 和启用的能力模块
- 批量运行测试用例
- 展示测试报告、评分结果、失败原因和人工复核入口
- 导出 CSV/JSON 测试报告

轻量后端当前已有：

```text
/api/agent-proxy
```

该接口负责中转调用被测 AgentStudio agent。前端将页面中配置好的接口信息传给 `/api/agent-proxy`，后端再代替浏览器调用 AgentStudio，并把返回结果交还给前端。

当前 `knowledge` 模块已有一个粗粒度自动评分方式：`keywordScore`。

`keywordScore` 的逻辑是：

```text
expectedAnswer
  -> 按标点、空格、换行切成若干短语
  -> 检查这些短语在 actualAnswer 中命中了多少
  -> 得到一个覆盖率分数
```

该机制不是真正的语义判断，不理解同义表达、日语语义、关键事实权重等。但它可以作为 Judge Agent 不可用时的 fallback 参考。

## 3. Judge Agent 方案

本次不采用 OpenAI API key 直连方案，也不在自动化测试平台里直接接入大模型 SDK。

语义判断通过 AgentStudio 上的固定 Judge Agent 实现。该 Judge Agent 底层仍然是 LLM，但对自动化测试平台来说，它只是一个可通过 API 调用的专用裁判 agent。

Judge Agent 的职责只有一项：

```text
比较 expectedAnswer 和 actualAnswer 的核心意思是否一致，并返回结构化判断结果。
```

Judge Agent v1 采用 Prompt 控制型 Agent，不采用 Workflow Agent。

原因是 v1 任务非常单一：

```text
输入：expectedAnswer + actualAnswer
处理：判断核心语义是否一致
输出：固定 JSON
```

暂时不需要多节点编排、分支、工具调用或复杂异常处理。

## 4. 数据流设计

整体调用链如下：

```text
1. 前端导入测试集，读取 expectedAnswer
2. 前端通过 /api/agent-proxy 调用被测 agent
3. 被测 agent 返回 actualAnswer
4. /api/agent-proxy 将 actualAnswer 返回前端
5. 前端将 expectedAnswer + actualAnswer 发送给 /api/judge-proxy
6. /api/judge-proxy 将二者包装为 JSON 字符串，作为 question 调用 Judge Agent
7. Judge Agent 完成语义判断
8. /api/judge-proxy 将 Judge Agent 判断结果返回前端
9. 前端在报告页展示自动判断结果
10. 必要时进入人工复核
```

接口职责划分：

```text
/api/agent-proxy
  只负责调用被测 agent

/api/judge-proxy
  只负责调用固定的 Judge Agent

Judge Agent
  真正完成 expectedAnswer 和 actualAnswer 的语义比较
```

## 5. Judge Agent 输入输出协议

前端传给 `/api/judge-proxy` 的核心字段：

```json
{
  "expectedAnswer": "...",
  "actualAnswer": "..."
}
```

后端 `/api/judge-proxy` 调用 Judge Agent 前，将输入包装为 JSON 字符串，并放入 AgentStudio API 的 `question` 字段中：

```json
{
  "task": "compare_expected_and_actual_answer",
  "expectedAnswer": "...",
  "actualAnswer": "..."
}
```

Judge Agent 的回答内容必须是可解析 JSON：

```json
{
  "sameMeaning": true,
  "confidence": 0.92,
  "decision": "pass",
  "reason": "actual answer 覆盖了 expected answer 的核心事实和处理方式，表达方式不同但语义一致。"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sameMeaning` | boolean | 两个回答的核心意思是否一致 |
| `confidence` | number | 置信度，范围 0 到 1 |
| `decision` | string | 判断结果，只允许 `pass`、`review`、`fail` |
| `reason` | string | 判断理由，用于报告展示和人工复核参考 |

`decision` 规则：

| decision | 含义 |
| --- | --- |
| `pass` | 核心意思一致，关键事实、处理方向、联系人/部门/动作没有明显缺失 |
| `review` | 大体接近但存在不确定、缺少部分关键点、表达含混，需要人工确认 |
| `fail` | 核心意思不一致、答非所问、关键事实错误或关键事实缺失 |

## 6. 评分与人工复核规则

接入 Judge Agent 后，`knowledge` 模块优先使用 Judge Agent 的判断结果。

规则如下：

```text
Judge Agent 成功返回：
  decision = pass   -> knowledge 模块自动通过
  decision = review -> knowledge 模块进入人工复核
  decision = fail   -> knowledge 模块标记失败或进入人工复核，报告中必须展示 reason

Judge Agent 调用失败：
  使用现有 keywordScore 作为 fallback 参考
  但最终状态仍标记为 review
  即使 keywordScore 很高，也不自动 pass
```

原因是 `keywordScore` 只是粗粒度关键词覆盖率，不具备可靠语义判断能力。它可以帮助人工审核，但不能在 Judge Agent 失败时替代 Judge Agent 自动放行。

报告中必须同时体现：

- 最终 `status`
- 判断来源
- 判断原因

即使最终都是 `review`，也需要区分进入 review 的原因。例如：

```text
judge_low_confidence
judge_semantic_mismatch
judge_failed_keyword_fallback
manual_required
```

示例：Judge Agent 判断需要人工确认

```json
{
  "status": "review",
  "judgeSource": "judge-agent",
  "judgeDecision": "review",
  "sameMeaning": null,
  "confidence": 0.61,
  "reason": "两个回答大体接近，但缺少关键联系人信息，建议人工确认。"
}
```

示例：Judge Agent 调用失败，使用 keyword fallback

```json
{
  "status": "review",
  "judgeSource": "keyword-fallback",
  "judgeDecision": "review",
  "keywordScore": 82,
  "reason": "Judge Agent 调用失败，已使用 keyword score 作为参考，仍需人工复核。"
}
```

## 7. 报告页需求

报告页需要展示被测 agent 的原始结果，也需要展示 Judge Agent 的语义判断结果。

每条测试结果建议展示：

- case ID / case title
- 测试问题
- expected answer
- actual answer
- 被测 agent 原始返回
- Judge Agent 判断结果
- `sameMeaning`
- `confidence`
- `decision`
- `reason`
- 最终 `status`
- 人工复核入口
- 人工覆盖后的分数和备注

报告状态需要能解释“为什么进入 review”，避免所有 review 看起来没有区别。

## 8. 后续开发事项

后端需要新增：

```text
/api/judge-proxy
```

该接口负责：

- 接收前端传来的 `expectedAnswer` 和 `actualAnswer`
- 将二者包装成 JSON 字符串
- 调用固定的 AgentStudio Judge Agent
- 解析 Judge Agent 返回的 JSON
- 返回结构化 judge result 给前端
- 在调用失败或解析失败时，返回明确错误信息，供前端进入 keyword fallback 和人工复核

前端需要调整：

- 被测 agent 返回 `actualAnswer` 后，继续调用 `/api/judge-proxy`
- `knowledge` 模块优先使用 Judge Agent 判断
- Judge Agent 失败时使用现有 `keywordScore` 作为 fallback 参考
- 报告页展示 Judge Agent 判断结果和 fallback reason
- 导出 CSV/JSON 时包含 Judge Agent 相关字段

Judge Agent 需要在 AgentStudio 中搭建：

- 使用 Prompt 控制型 Agent
- Prompt 中要求只输出 JSON
- Prompt 中明确不要求逐字一致，只判断核心事实、处理方向、关键联系人/部门/动作是否一致
- Prompt 中明确语气、措辞、敬语差异不应直接判 fail
- Prompt 中明确输出字段和 `decision` 取值范围

## 9. 验收标准

功能验收：

- 平台可以继续通过 `/api/agent-proxy` 调用被测 agent
- 平台可以通过 `/api/judge-proxy` 调用 Judge Agent
- 前端可以把 `expectedAnswer` 和 `actualAnswer` 传入 Judge Agent
- Judge Agent 可以稳定返回可解析 JSON
- `knowledge` 模块可以根据 Judge Agent 的 `decision` 更新评分状态
- Judge Agent 调用失败时不会阻断整条测试流程
- Judge Agent 调用失败时，报告标记为 `review`，并展示 keyword fallback reason

报告验收：

- 报告中能看到 expected answer 和 actual answer
- 报告中能看到 Judge Agent 的判断结果
- 报告中能区分不同 review 原因
- 人工可以覆盖自动判断结果
- 导出报告中包含 Judge Agent 相关字段

测试场景：

- 两个回答核心语义一致，Judge Agent 返回 `pass`
- 两个回答部分一致但缺少关键事实，Judge Agent 返回 `review`
- 两个回答核心语义不一致，Judge Agent 返回 `fail`
- Judge Agent 返回格式异常，平台进入 `review`
- Judge Agent 调用失败，平台使用 keyword score 作为参考，但不自动 `pass`
- expectedAnswer 或 actualAnswer 为空，平台进入 `review` 并展示明确原因

## 10. Assumptions

- 语义判断不直接接 OpenAI API key，而是通过 AgentStudio 上的固定 Judge Agent 实现。
- Judge Agent 的接口鉴权信息后续放在服务端配置或环境变量中，不暴露在前端。
- Judge Agent v1 使用 Prompt 控制型 Agent。
- `keywordScore` 仅作为 fallback 参考，不作为 Judge Agent 失败时的自动通过依据。
- 本文档描述的是当前平台现状和下一步 Judge Agent 接入需求，不代表所有功能已经完成。
