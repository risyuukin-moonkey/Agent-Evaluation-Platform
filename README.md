# Agent 自动化测试平台本地 MVP

这是一个本地运行的 Agent 自动化测试平台，用于批量测试不同 agent。平台设计原则是：

**通用测试底座 + 能力评测模块 + Agent Profile 配置**

你可以根据不同 agent 的能力，在 Profile 中开启或关闭评测模块，而不是为每个 agent 重写测试逻辑。

## 核心能力

- 配置 agent 后端接口、鉴权、请求体模板和响应字段路径
- 配置知识引用接口，用对话返回的 dialog_id 查询知识命中
- 创建 Agent Profile，并按需开启/关闭能力模块
- 导入 CSV/JSON 测试集
- 执行单轮和多轮测试
- 自动记录原始响应、回答、intent、知识来源、耗时和错误
- 自动评分基础可用性、intent、知识问答、语气、安全合规、兜底等模块
- 对核心意思一致性、自然专业度、多轮上下文等指标提供人工复核入口
- 导出 CSV/JSON 测试报告
- 预留 Workflow、工具/API 调用、LLM 裁判模型扩展位置

## 如何使用

1. 打开本地平台页面。
2. 进入「接口与Profile」。
3. 根据 agent 后端接口文档填写对话接口：
   - 请求地址
   - 请求方法
   - Headers
   - 请求 Body 模板
   - 回答字段路径
   - intent 字段路径
   - 知识来源字段路径
   - 会话 ID 字段路径
4. 如果需要验证知识命中，开启「知识引用接口配置」。
5. 在 Profile 中开启这个 agent 需要测试的能力模块。
6. 进入「测试集」，导入 CSV 或 JSON 测试集。
7. 进入「运行测试」，选择用例并批量运行。
8. 进入「报告复核」，查看自动评分、失败原因、知识命中记录，并人工复核主观指标。
9. 导出报告，用于回归对比或交付。

## AgentStudio Ask R&C 推荐接口配置

Ask R&C 是 prompt 控制、外挂知识库的 LLM Mode Agent，没有 Chatflow/Workflow。当前实测 HTTP 能连通但返回 busy，WebSocket 能进入正常回答链路，因此推荐先使用 WebSocket：

详细排查过程和复用经验见：`docs/agentstudio_prompt_agent_interface_notes.md`

主对话接口：

```text
wss://agents.dyna.ai/openapi/v1/ws/dialog/
```

请求 Body 中不要手动写 `message_source: "WS"`，让 AgentStudio 自动使用 `openapi-ws`。

知识引用接口：

```text
POST https://agents.dyna.ai/openapi/v1/conversation/knowledge/
```

主对话接口字段建议：

```text
回答字段路径：data.answer
会话/回答 ID 字段路径：segment_code
```

知识引用接口字段建议：

```text
知识列表字段路径：data
知识库名称字段路径：knowledge_base_name
命中文本字段路径：section
相关度分数字段路径：rerank_score
数据集字段路径：dataset_name
```

## 后端接口文档需要提供什么

只给接口文档可以开始搭建，但为了测试准确，最好同时提供：

- agent 请求地址
- 请求方法
- 鉴权方式和测试 token
- 请求参数示例
- 响应示例
- 是否支持多轮会话
- 会话 ID 字段
- 回答字段
- intent 字段
- 知识来源字段
- 工具/API 调用信息字段

如果接口不返回 intent 或知识命中信息，平台仍然可以测试，但只能通过回答内容间接判断，准确性会低一些。

## 测试集格式

CSV 建议字段：

```csv
id,title,question,expected_intent,answer,modules,tags
qa-paid-leave,QA 首问：有给休暇,有給休暇の申請方法を教えてください。,leave_policy,需要覆盖有给休假申请方式和申请路径,"availability,intent,knowledge,tone,safety","QA优先,单轮"
```

问题列可使用 `question`、`Question`、`问题`、`测试问题`、`質問`、`質問内容` 等表头。参考答案列可使用 `answer`、`Answer`、`expected_answer`、`标准答案`、`期望答案`、`回答` 等表头。

如果 CSV 使用 `User&Agent会話スクリプト` 这类脚本列，平台会把所有 `User:` 拆成测试输入，把最后一个 `Agent:` 拆成参考答案。这里的 Agent 回复只表示**核心意思和关键事实**，不要求被测 agent 逐字一致。

多轮测试可以用 `turns` 字段，并用 `||` 分隔每一轮：

```csv
id,title,turns,expected_intent,answer,modules,tags
followup-document,多轮追问,出張精算の基本ルールを教えてください。||領収書を紛失した場合はどうすればよいですか。,expense_policy,需要承接上一轮并回答追问,"availability,intent,knowledge,context,tone,safety","文档追问,多轮"
```

JSON 格式：

```json
[
  {
    "id": "qa-paid-leave",
    "title": "QA 首问：有给休暇",
    "turns": ["有給休暇の申請方法を教えてください。"],
    "expectedIntent": "leave_policy",
    "expectedAnswer": "需要覆盖有给休假申请方式和申请路径",
    "modules": ["availability", "intent", "knowledge", "tone", "safety"],
    "tags": ["QA优先", "单轮"]
  }
]
```

## 支持的能力模块

- `availability`：基础可用性
- `intent`：意图识别
- `knowledge`：知识问答
- `context`：多轮上下文
- `tone`：角色语气
- `safety`：安全合规
- `fallback`：兜底处理
- `workflow`：Workflow 流程，第一版预留
- `tool`：工具/API 调用，第一版预留

## R&C Agent 默认 Profile

内置的 R&C 示例 Profile 默认开启：

- 基础可用性
- 意图识别
- 知识问答
- 多轮上下文
- 角色语气
- 安全合规
- 兜底处理

默认关闭：

- Workflow 流程
- 工具/API 调用

## 第一版限制

- 当前本地 MVP 不强制接入 LLM 裁判模型，主观指标优先人工复核。
- 当前界面支持 CSV/JSON 导入；Excel 文件请先另存为 CSV。后续可以接入 xlsx 解析库。
- 平台前端直接请求 agent 后端接口。如果 agent 后端没有开放浏览器跨域访问，需要后续增加本地代理接口。
