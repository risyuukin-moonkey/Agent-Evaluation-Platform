type JudgeDecision = "pass" | "review" | "fail";

type JudgeProxyPayload = {
  expectedAnswer?: string;
  actualAnswer?: string;
  question?: string;
  caseId?: string;
  timeoutSeconds?: number;
};

type JudgeResult = {
  sameMeaning: boolean;
  confidence: number;
  decision: JudgeDecision;
  reason: string;
};

type AgentStudioMessage = Record<string, unknown>;
type AgentStudioWebSocketResult = {
  finalMessage: AgentStudioMessage | null;
  messages: AgentStudioMessage[];
  streamedText: string;
};

const defaultEndpoint = "wss://agents.dyna.ai/openapi/v1/ws/dialog/";
const defaultTimeoutSeconds = 45;
const defaultAnswerPath = "data.answer";

function getByPath(source: unknown, path: string) {
  if (!path.trim()) return undefined;
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function buildJudgeQuestion(payload: Required<Pick<JudgeProxyPayload, "expectedAnswer" | "actualAnswer">> & Pick<JudgeProxyPayload, "question" | "caseId">) {
  return JSON.stringify({
    task: "compare_expected_and_actual_answer",
    caseId: payload.caseId ?? "",
    question: payload.question ?? "",
    expectedAnswer: payload.expectedAnswer,
    actualAnswer: payload.actualAnswer,
  });
}

function stripJsonFence(value: string) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function decodeConfigValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeEndpoint(value: string) {
  const trimmed = value.trim();
  return !trimmed || trimmed.toLowerCase() === "false" ? defaultEndpoint : trimmed;
}

function stringifyAnswerValue(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

function extractAnswerText(rawResponse: unknown, answerPath: string) {
  const webSocketResult = rawResponse as Partial<AgentStudioWebSocketResult>;
  const finalMessage = webSocketResult.finalMessage ?? rawResponse;
  const configuredAnswer = getByPath(finalMessage, answerPath);
  const fallbackAnswer =
    getByPath(finalMessage, "data.answer") ??
    getByPath(finalMessage, "data.Answer") ??
    getByPath(finalMessage, "data.answer.data") ??
    getByPath(finalMessage, "data.answer.description") ??
    getByPath(finalMessage, "answer") ??
    getByPath(finalMessage, "Answer") ??
    webSocketResult.streamedText;

  return stringifyAnswerValue(configuredAnswer ?? fallbackAnswer);
}

function summarizeRawResponse(rawResponse: unknown) {
  const webSocketResult = rawResponse as Partial<AgentStudioWebSocketResult>;
  if (Array.isArray(webSocketResult.messages)) {
    const finalMessage = webSocketResult.finalMessage
      ? Object.fromEntries(Object.entries(webSocketResult.finalMessage).filter(([key]) => key !== "headers"))
      : null;
    return {
      finalMessage,
      messageCount: webSocketResult.messages.length,
    };
  }
  return rawResponse;
}

function parseJudgeResult(answerText: string): JudgeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(answerText));
  } catch {
    throw new Error("Judge Agent 返回内容不是合法 JSON。");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Judge Agent 返回 JSON 必须是对象。");
  }

  const result = parsed as Partial<JudgeResult>;
  if (!["pass", "review", "fail"].includes(String(result.decision))) {
    throw new Error("Judge Agent 返回的 decision 必须是 pass、review 或 fail。");
  }
  if (typeof result.sameMeaning !== "boolean") {
    throw new Error("Judge Agent 返回的 sameMeaning 必须是 boolean。");
  }
  if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) {
    throw new Error("Judge Agent 返回的 confidence 必须是 0 到 1 之间的数字。");
  }
  if (typeof result.reason !== "string" || !result.reason.trim()) {
    throw new Error("Judge Agent 返回的 reason 不能为空。");
  }

  return {
    sameMeaning: result.sameMeaning,
    confidence: result.confidence,
    decision: result.decision as JudgeDecision,
    reason: result.reason,
  };
}

function getConfig() {
  return {
    endpoint: normalizeEndpoint(process.env.JUDGE_AGENT_ENDPOINT ?? ""),
    username: process.env.JUDGE_AGENT_USERNAME ?? "judge-agent-autotest@dyna.ai",
    robotKey: decodeConfigValue(process.env.JUDGE_AGENT_ROBOT_KEY ?? ""),
    robotToken: decodeConfigValue(process.env.JUDGE_AGENT_ROBOT_TOKEN ?? ""),
    answerPath: process.env.JUDGE_AGENT_RESPONSE_ANSWER_PATH ?? defaultAnswerPath,
    timeoutSeconds: Number(process.env.JUDGE_AGENT_TIMEOUT_SECONDS ?? defaultTimeoutSeconds),
  };
}

async function callHttpJudgeAgent(config: ReturnType<typeof getConfig>, judgeQuestion: string, timeoutSeconds: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cybertron-robot-key": config.robotKey,
        "cybertron-robot-token": config.robotToken,
      },
      body: JSON.stringify({
        username: config.username,
        question: judgeQuestion,
        segment_code: `judge-${Date.now()}`,
      }),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(`Judge Agent HTTP 返回 ${response.status}。`);
    }
    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

function callWebSocketJudgeAgent(config: ReturnType<typeof getConfig>, judgeQuestion: string, timeoutSeconds: number) {
  return new Promise<AgentStudioWebSocketResult>((resolve, reject) => {
    const socket = new WebSocket(config.endpoint);
    const messages: AgentStudioMessage[] = [];
    let finalMessage: AgentStudioMessage | null = null;
    let streamedText = "";
    const timeoutId = setTimeout(() => {
      socket.close();
      reject(new Error("Judge Agent WebSocket 调用超时。"));
    }, timeoutSeconds * 1000);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          username: config.username,
          question: judgeQuestion,
          segment_code: `judge-${Date.now()}`,
          cybertron_robot_key: config.robotKey,
          cybertron_robot_token: config.robotToken,
        }),
      );
    };

    socket.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("Judge Agent WebSocket 连接失败。"));
    };

    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        parsed = { data: String(event.data) };
      }

      if (parsed && typeof parsed === "object") {
        const message = parsed as AgentStudioMessage;
        messages.push(message);
        if (message.type === "string" && typeof message.data === "string") {
          streamedText += message.data;
        }
        if (message.finish === "y") {
          finalMessage = message;
          clearTimeout(timeoutId);
          socket.close();
          resolve({ finalMessage, messages, streamedText });
        }
      }
    };

    socket.onclose = () => {
      clearTimeout(timeoutId);
      if (!finalMessage && messages.length) {
        finalMessage = messages.at(-1) ?? null;
        resolve({ finalMessage, messages, streamedText });
      }
    };
  });
}

async function callJudgeAgent(config: ReturnType<typeof getConfig>, judgeQuestion: string, timeoutSeconds: number) {
  if (/^wss?:\/\//i.test(config.endpoint)) {
    return callWebSocketJudgeAgent(config, judgeQuestion, timeoutSeconds);
  }
  if (/^https?:\/\//i.test(config.endpoint)) {
    return callHttpJudgeAgent(config, judgeQuestion, timeoutSeconds);
  }
  throw new Error("JUDGE_AGENT_ENDPOINT 必须是 http(s) 或 ws(s) 地址。");
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as JudgeProxyPayload;
    const expectedAnswer = payload.expectedAnswer?.trim() ?? "";
    const actualAnswer = payload.actualAnswer?.trim() ?? "";

    if (!expectedAnswer || !actualAnswer) {
      return Response.json(
        {
          ok: false,
          judgeSource: "judge-agent",
          fallbackRequired: true,
          error: "expectedAnswer 和 actualAnswer 不能为空。",
          fallbackReason: "缺少待比较回答，需进入人工复核。",
        },
        { status: 400 },
      );
    }

    const config = getConfig();
    if (!config.endpoint || !config.robotKey || !config.robotToken) {
      return Response.json(
        {
          ok: false,
          configured: false,
          judgeSource: "judge-agent",
          fallbackRequired: true,
          error: "Judge Agent 尚未配置。",
          fallbackReason: "缺少 Judge Agent endpoint、robot key 或 robot token，需使用 keywordScore 作为参考并进入人工复核。",
        },
        { status: 503 },
      );
    }

    const timeoutSeconds = payload.timeoutSeconds ?? config.timeoutSeconds;
    const judgeQuestion = buildJudgeQuestion({
      expectedAnswer,
      actualAnswer,
      question: payload.question,
      caseId: payload.caseId,
    });
    const rawResponse = await callJudgeAgent(config, judgeQuestion, timeoutSeconds);
    const answerText = extractAnswerText(rawResponse, config.answerPath);
    const judgeResult = parseJudgeResult(answerText);

    return Response.json({
      ok: true,
      configured: true,
      judgeSource: "judge-agent",
      judgeQuestion,
      result: judgeResult,
      rawAnswer: answerText,
      rawResponse: summarizeRawResponse(rawResponse),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        configured: true,
        judgeSource: "judge-agent",
        fallbackRequired: true,
        error: error instanceof Error ? error.message : "Judge Agent 调用失败。",
        fallbackReason: "Judge Agent 调用或解析失败，需使用 keywordScore 作为参考并进入人工复核。",
      },
      { status: 502 },
    );
  }
}
