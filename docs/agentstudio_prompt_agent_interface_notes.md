# AgentStudio Prompt Agent 接入经验记录

这份记录用于沉淀本次 Ask R&C 接入过程中的经验。适用对象是 AgentStudio 上这类 agent：

- 由 prompt 控制
- 外挂知识库
- 没有 Chatflow
- 没有 Workflow
- 目标是通过自动化测试平台批量发问并收集回答

## 结论

这类 agent 理论上应优先参考 Robot Dialog Openapi 文档。实际接入时，需要同时验证 HTTP 和 WebSocket 两种通信方式。

本次 Ask R&C 实测结果：

| 通信方式 | 接口 | 结果 |
| --- | --- | --- |
| HTTP | `https://agents.dyna.ai/openapi/v1/conversation/dialog/` | 能连通，但返回 `The system is busy, please try again later` |
| WebSocket | `wss://agents.dyna.ai/openapi/v1/ws/dialog/` | 可正常返回 agent 回答 |

因此，本次 Ask R&C 自动化测试采用 WebSocket。

## 推荐接入方式

### 主对话接口

```text
wss://agents.dyna.ai/openapi/v1/ws/dialog/
```

### WebSocket 请求体

```json
{
  "username": "{{username}}",
  "question": "{{message}}",
  "segment_code": "{{conversationId}}",
  "cybertron_robot_key": "YOUR_ROBOT_KEY",
  "cybertron_robot_token": "YOUR_ROBOT_TOKEN"
}
```

注意：WebSocket 请求体中不要手动写 `message_source`。

本次踩坑点是：第一次测试 WebSocket 时手动传了：

```json
{
  "message_source": "WS"
}
```

这样会导致接口返回：

```text
System exception (209), please try again later.
```

去掉 `message_source` 后，服务端会自动使用 `openapi-ws`，并进入正常回答链路。

## 参数来源

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `username` | 接口配置 | 本次 Ask R&C 使用 `jp_randcins@dyna.ai` |
| `question` | 测试集 | 从 CSV/JSON 中的用户问题提取 |
| `segment_code` | 测试平台生成 | 每条测试用例一个新会话编号；同一用例多轮共用 |
| `cybertron_robot_key` | AgentStudio OpenAPI 配置 | robot key / agent identifier |
| `cybertron_robot_token` | AgentStudio OpenAPI 配置 | robot token |

### question

`question` 是当前轮用户问题。

如果测试集是脚本格式：

```text
User:リーズ別のアプローチトークを知りたいです。
Agent:アプローチトークはリーズごとに...
```

平台会把 `User:` 后面的内容作为：

```json
{
  "question": "リーズ別のアプローチトークを知りたいです。"
}
```

### segment_code

`segment_code` 是会话编号。

推荐规则：

- 每条测试用例生成一个新的 `segment_code`
- 同一条测试用例里的多轮问题共用同一个 `segment_code`
- 不同测试用例之间不要共用 `segment_code`

这样可以避免测试用例之间上下文串扰。

## HTTP 接口排查结论

HTTP 文档要求：

```text
POST https://agents.dyna.ai/openapi/v1/conversation/dialog/
```

Headers：

```json
{
  "Content-Type": "application/json",
  "cybertron-robot-key": "YOUR_ROBOT_KEY",
  "cybertron-robot-token": "YOUR_ROBOT_TOKEN"
}
```

Body：

```json
{
  "username": "{{username}}",
  "question": "{{message}}",
  "segment_code": "{{conversationId}}"
}
```

本次验证过：

- key/token 放 header
- key/token 放 body
- key/token 同时放 header 和 body
- 不传 `segment_code`
- 先调用 `segment/create` 再传 `segment_code`
- 不传 `message_source`
- 传 `message_source: "openapi-http"`
- 使用小写 `question`
- 尝试大写 `Question`

结果：

- 小写 `question` 是正确字段
- 大写 `Question` 会被认为问题为空
- HTTP v1 能连通，但 Ask R&C 返回 busy
- HTTP v2 返回 404 类错误

因此，对 Ask R&C 来说，HTTP 暂时不作为本地自动化测试平台的主接入方式。

## WebSocket 接口排查结论

本次验证过：

- `wss://agents.dyna.ai/openapi/v1/ws/dialog/`
- `wss://agents.dyna.ai/openapi/v2/ws/dialog/`
- 手动传 `message_source: "WS"`
- 不传 `message_source`
- 传 `segment_code`

结果：

- v1 WebSocket 可正常返回
- v2 WebSocket 也可正常返回
- 正式建议使用 v1 WebSocket
- 手动传 `message_source: "WS"` 会失败
- 不传 `message_source` 会成功
- 建议传 `segment_code`，用于隔离测试用例上下文

## 返回字段

WebSocket 最终消息中，常用字段如下：

```text
回答字段路径：data.answer
知识来源字段路径：data.answer_source
dialog_id 字段路径：data.dialog_id 或 dialog_id
segment_code 字段路径：segment_code
```

本次 Ask R&C 成功返回中，`answer_source` 可能为：

```text
QA
```

可用于辅助判断是否命中 QA 知识。

## Knowledge Base Openapi 的定位

Robot Knowledge Base Openapi 不是对话入口。

它适合在主对话成功后，使用 `dialog_id` 查询知识引用或知识命中情况。

自动化测试中建议把它作为增强能力：

- 只测 agent 是否正常回答：不必接 Knowledge Base Openapi
- 要判断是否命中正确 QA/文档：再接 Knowledge Base Openapi

本次 busy / 209 问题发生在主对话接口阶段，和 Knowledge Base Openapi 无关。

## 下次接入同类 Agent 的建议流程

1. 确认 agent 类型：prompt 控制、知识库、无 Chatflow/Workflow。
2. 优先读取 Robot Dialog Openapi 文档。
3. 先用单条问题做 HTTP 冒烟测试。
4. 如果 HTTP 返回 busy 或异常，不要直接跑完整测试集。
5. 立即用 WebSocket 做同一问题测试。
6. WebSocket 请求体不要手动传 `message_source`。
7. 每条测试用例生成独立 `segment_code`。
8. 单条正常后，再跑 3 条冒烟测试。
9. 3 条正常后，再跑完整测试集。
10. 最后再考虑是否接 Knowledge Base Openapi 查知识引用。

## 本次有效配置

```text
Agent 名称：Ask R&C
通信方式：WebSocket
对话接口：wss://agents.dyna.ai/openapi/v1/ws/dialog/
测试用户名：jp_randcins@dyna.ai
回答字段路径：data.answer
知识来源字段路径：data.answer_source
会话字段路径：segment_code
```

请求体模板：

```json
{
  "username": "{{username}}",
  "question": "{{message}}",
  "segment_code": "{{conversationId}}",
  "cybertron_robot_key": "YOUR_ROBOT_KEY",
  "cybertron_robot_token": "YOUR_ROBOT_TOKEN"
}
```

不要加入：

```json
{
  "message_source": "WS"
}
```

## 经验总结

对 AgentStudio 上 prompt 控制、外挂知识库的 agent，接口文档层面 Robot Dialog Openapi 是正确方向。但实际接入时，HTTP 和 WebSocket 可能表现不同。

本次 Ask R&C 的最终经验是：

- HTTP 按文档能连通，但不一定能进入正常回答链路。
- WebSocket 更接近实际在线对话链路。
- WebSocket 请求体严格按文档，不额外添加 `message_source`。
- `question` 来自测试集。
- `segment_code` 由测试平台生成，用于隔离测试用例和承接多轮上下文。
- Knowledge Base Openapi 是辅助评测接口，不是主对话接口。
