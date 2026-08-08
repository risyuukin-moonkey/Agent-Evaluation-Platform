"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

type ModuleKey =
  | "availability"
  | "intent"
  | "knowledge"
  | "context"
  | "tone"
  | "safety"
  | "fallback"
  | "workflow"
  | "tool";

type HttpMethod = "POST" | "GET";
type BodyMode = "json" | "query";

type AgentConfig = {
  name: string;
  username: string;
  endpoint: string;
  method: HttpMethod;
  bodyMode: BodyMode;
  headersText: string;
  requestTemplate: string;
  responseAnswerPath: string;
  responseIntentPath: string;
  responseKnowledgePath: string;
  conversationIdPath: string;
  timeoutSeconds: number;
};

type KnowledgeReferenceConfig = {
  enabled: boolean;
  endpoint: string;
  method: HttpMethod;
  headersText: string;
  requestTemplate: string;
  responseListPath: string;
  knowledgeNamePath: string;
  sectionPath: string;
  scorePath: string;
  datasetPath: string;
};

type Profile = {
  name: string;
  enabledModules: Record<ModuleKey, boolean>;
  weights: Record<ModuleKey, number>;
  thresholds: Record<ModuleKey, number>;
  rules: {
    requiredLanguage: string;
    maxResponseSeconds: number;
    forbiddenTerms: string;
    requiredTone: string;
    fallbackExpectedTerms: string;
    safetyNotes: string;
  };
};

type TestCase = {
  id: string;
  title: string;
  turns: string[];
  expectedIntent: string;
  expectedAnswer: string;
  modules: ModuleKey[];
  tags: string[];
};

type ModuleScore = {
  score: number;
  status: "pass" | "fail" | "review" | "skip";
  reason: string;
  manualScore?: number;
  manualNote?: string;
};

type KnowledgeReference = {
  knowledgeName: string;
  section: string;
  score: string;
  dataset: string;
};

type TestResult = {
  id: string;
  caseId: string;
  caseTitle: string;
  startedAt: string;
  durationMs: number;
  finalAnswer: string;
  actualIntent: string;
  knowledgeSource: string;
  knowledgeReferences: KnowledgeReference[];
  error: string;
  rawResponses: unknown[];
  moduleScores: Partial<Record<ModuleKey, ModuleScore>>;
  totalScore: number;
  status: "pass" | "fail" | "review";
};

type AgentCallResult = {
  raw: unknown;
  rawMessages?: unknown[];
  finalAnswer: string;
  actualIntent: string;
  knowledgeSource: string;
  conversationId: string;
  dialogId: string;
};

const moduleCatalog: { key: ModuleKey; label: string; description: string }[] = [
  { key: "availability", label: "基础可用性", description: "是否正常回复、是否超时、是否报错" },
  { key: "intent", label: "意图识别", description: "实际 intent 是否符合预期" },
  { key: "knowledge", label: "知识问答", description: "回答是否覆盖参考答案的核心意思" },
  { key: "context", label: "多轮上下文", description: "追问是否承接上一轮语境" },
  { key: "tone", label: "角色语气", description: "是否自然、专业、礼貌、符合语言要求" },
  { key: "safety", label: "安全合规", description: "是否避免编造和禁止内容" },
  { key: "fallback", label: "兜底处理", description: "不知道时是否按规则兜底" },
  { key: "workflow", label: "Workflow 流程", description: "是否进入正确分支并完成流程" },
  { key: "tool", label: "工具/API 调用", description: "是否正确调用外部工具或接口" },
];

const enabledDefault = Object.fromEntries(
  moduleCatalog.map((item) => [item.key, !["workflow", "tool"].includes(item.key)]),
) as Record<ModuleKey, boolean>;

const defaultWeights = Object.fromEntries(
  moduleCatalog.map((item) => [item.key, item.key === "knowledge" ? 24 : item.key === "availability" ? 18 : 12]),
) as Record<ModuleKey, number>;

const defaultThresholds = Object.fromEntries(moduleCatalog.map((item) => [item.key, 70])) as Record<ModuleKey, number>;

const defaultAgentConfig: AgentConfig = {
  name: "Ask R&C",
  username: "jp_randcins@dyna.ai",
  endpoint: "wss://agents.dyna.ai/openapi/v1/ws/dialog/",
  method: "POST",
  bodyMode: "json",
  headersText: '{\n  "Content-Type": "application/json"\n}',
  requestTemplate:
    '{\n  "username": "{{username}}",\n  "question": "{{message}}",\n  "segment_code": "{{conversationId}}",\n  "cybertron_robot_key": "YOUR_ROBOT_KEY",\n  "cybertron_robot_token": "YOUR_ROBOT_TOKEN"\n}',
  responseAnswerPath: "data.answer",
  responseIntentPath: "intent",
  responseKnowledgePath: "data.answer_source",
  conversationIdPath: "segment_code",
  timeoutSeconds: 30,
};

const defaultKnowledgeConfig: KnowledgeReferenceConfig = {
  enabled: false,
  endpoint: "https://agents.dyna.ai/openapi/v1/conversation/knowledge/",
  method: "POST",
  headersText:
    '{\n  "Content-Type": "application/json",\n  "cybertron-robot-key": "YOUR_ROBOT_KEY",\n  "cybertron-robot-token": "YOUR_ROBOT_TOKEN"\n}',
  requestTemplate: '{\n  "username": "{{username}}",\n  "dialog_id": "{{dialogId}}"\n}',
  responseListPath: "data",
  knowledgeNamePath: "knowledge_base_name",
  sectionPath: "section",
  scorePath: "rerank_score",
  datasetPath: "dataset_name",
};

const defaultProfile: Profile = {
  name: "R&C Knowledge Agent Profile",
  enabledModules: enabledDefault,
  weights: defaultWeights,
  thresholds: defaultThresholds,
  rules: {
    requiredLanguage: "ja",
    maxResponseSeconds: 30,
    forbiddenTerms: "I don't know,不知道,メール：,email:",
    requiredTone: "日语、礼貌、简洁、社内窓口感、音声友好",
    fallbackExpectedTerms: "確認いたします,担当者,ナレッジに記載がありません",
    safetyNotes: "不能编造制度、担当者或联系方式；只有明确询问联系方式时才给邮箱。",
  },
};

const sampleCases: TestCase[] = [
  {
    id: "qa-paid-leave",
    title: "QA 首问：有给休暇",
    turns: ["有給休暇の申請方法を教えてください。"],
    expectedIntent: "leave_policy",
    expectedAnswer: "有給休暇の申請方法、申請先、必要な事前手続きが説明されている。",
    modules: ["availability", "intent", "knowledge", "tone", "safety"],
    tags: ["QA优先", "单轮"],
  },
  {
    id: "followup-document",
    title: "多轮追问：制度细节",
    turns: ["出張精算の基本ルールを教えてください。", "領収書を紛失した場合はどうすればよいですか。"],
    expectedIntent: "expense_policy",
    expectedAnswer: "出張精算の基本ルールに続き、領収書紛失時の対応や確認先を案内する。",
    modules: ["availability", "intent", "knowledge", "context", "tone", "safety"],
    tags: ["文档追问", "多轮"],
  },
  {
    id: "fallback-unknown",
    title: "兜底：知识库外问题",
    turns: ["来年度の全社未公開人事方針を教えてください。"],
    expectedIntent: "unknown",
    expectedAnswer: "未公開情報は断定せず、ナレッジに記載がないことと確認先を案内する。",
    modules: ["availability", "fallback", "tone", "safety"],
    tags: ["兜底", "边界"],
  },
];

function getStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return fallback;
    const parsed = JSON.parse(value) as T;
    if (
      parsed &&
      fallback &&
      typeof parsed === "object" &&
      typeof fallback === "object" &&
      !Array.isArray(parsed) &&
      !Array.isArray(fallback)
    ) {
      return { ...fallback, ...parsed } as T;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function setStored<T>(key: string, value: T) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

function shouldReplaceOldAgentExample(config: AgentConfig) {
  return (
    !config.endpoint.trim() ||
    config.username === "testuser@example.com" ||
    config.headersText.includes("Bearer YOUR_TOKEN") ||
    config.responseAnswerPath === "answer" ||
    config.conversationIdPath === "conversationId"
  );
}

function getByPath(source: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  return path.split(".").reduce<unknown>((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[、。，.・:：]/g, "");
}

function keywordScore(answer: string, expected: string) {
  const words = expected
    .split(/[、。，,.；;：:\s]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
  if (!words.length) return 60;
  const target = normalizeText(answer);
  const matched = words.filter((word) => target.includes(normalizeText(word))).length;
  return Math.round((matched / words.length) * 100);
}

function looksJapanese(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text) && /です|ます|ください|いたします|ございます/.test(text);
}

function parseJsonObject(text: string) {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function extractAgentFields(raw: unknown, agentConfig: AgentConfig, streamedText = ""): AgentCallResult {
  const answerFromPath = getByPath(raw, agentConfig.responseAnswerPath);
  const fallbackAnswer =
    getByPath(raw, "data.answer") ?? getByPath(raw, "data.Answer") ?? getByPath(raw, "answer") ?? getByPath(raw, "Answer");
  const finalAnswer = String(answerFromPath ?? fallbackAnswer ?? streamedText ?? "");
  return {
    raw,
    finalAnswer,
    actualIntent: String(getByPath(raw, agentConfig.responseIntentPath) ?? ""),
    knowledgeSource: String(
      getByPath(raw, agentConfig.responseKnowledgePath) ?? getByPath(raw, "data.answer_source") ?? "",
    ),
    conversationId: String(getByPath(raw, agentConfig.conversationIdPath) ?? getByPath(raw, "segment_code") ?? ""),
    dialogId: String(getByPath(raw, "data.dialog_id") ?? getByPath(raw, "dialog_id") ?? ""),
  };
}

function callWebSocketAgent(endpoint: string, payloadText: string, timeoutSeconds: number, agentConfig: AgentConfig) {
  return new Promise<AgentCallResult>((resolve, reject) => {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      reject(new Error("WebSocket 请求 Body 必须是合法 JSON。"));
      return;
    }

    const socket = new WebSocket(endpoint);
    const rawMessages: unknown[] = [];
    let streamedText = "";
    let finalRaw: unknown = null;
    const timeoutId = window.setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket 调用超时。"));
    }, timeoutSeconds * 1000);

    socket.onopen = () => socket.send(JSON.stringify(payload));
    socket.onerror = () => {
      window.clearTimeout(timeoutId);
      reject(new Error("WebSocket 连接失败。"));
    };
    socket.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        parsed = String(event.data);
      }
      rawMessages.push(parsed);
      if (parsed && typeof parsed === "object") {
        const message = parsed as Record<string, unknown>;
        if (typeof message.data === "string") streamedText += message.data;
        if (message.finish === "y") {
          finalRaw = parsed;
          window.clearTimeout(timeoutId);
          socket.close();
          const fields = extractAgentFields(finalRaw, agentConfig, streamedText);
          resolve({ ...fields, rawMessages });
        }
      }
    };
    socket.onclose = () => {
      window.clearTimeout(timeoutId);
      if (!finalRaw && rawMessages.length) {
        const fields = extractAgentFields(rawMessages.at(-1), agentConfig, streamedText);
        resolve({ ...fields, rawMessages });
      }
    };
  });
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const headers = rows.shift()?.map((item) => item.trim()) ?? [];
  return rows
    .filter((items) => items.some(Boolean))
    .map((items) =>
      Object.fromEntries(headers.map((header, index) => [header, (items[index] ?? "").trim()])),
    );
}

function getRowValue(row: Record<string, string>, names: string[]) {
  const normalizedEntries = Object.entries(row).map(([key, value]) => ({
    key,
    normalizedKey: normalizeText(key),
    value,
  }));
  for (const name of names) {
    const direct = row[name];
    if (direct) return direct;
    const normalizedName = normalizeText(name);
    const match = normalizedEntries.find((entry) => entry.normalizedKey === normalizedName);
    if (match?.value) return match.value;
  }
  return "";
}

function parseConversationScript(script: string) {
  const turns: string[] = [];
  const agentAnswers: string[] = [];
  const matches = [...script.matchAll(/(?:^|\n|\r|\s)(User|Agent)\s*[:：]\s*([\s\S]*?)(?=(?:\n|\r|\s)(?:User|Agent)\s*[:：]|$)/gi)];
  for (const match of matches) {
    const role = match[1].toLowerCase();
    const content = (match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!content) continue;
    if (role === "user") turns.push(content);
    if (role === "agent") agentAnswers.push(content);
  }
  return {
    turns,
    expectedAnswer: agentAnswers.at(-1) ?? "",
    fullAgentAnswer: agentAnswers.join("\n"),
  };
}

function modulesFromEvaluationText(text: string): ModuleKey[] {
  const modules = new Set<ModuleKey>();
  const lower = text.toLowerCase();
  if (/正常|応答|回复|response|可用/.test(text)) modules.add("availability");
  if (/意図|intent|意图/.test(lower)) modules.add("intent");
  if (/qa|回答一致|核心|要点|意味|意味一致|標準|标准|知識|知识|source|ソース/.test(lower)) modules.add("knowledge");
  if (/多輪|追問|文脈|context|上下文/.test(lower)) modules.add("context");
  if (/日本語|自然|丁寧|礼貌|語気|语气|tone/.test(lower)) modules.add("tone");
  if (/ハルシネーション|hallucination|安全|禁止|合規|合规/.test(lower)) modules.add("safety");
  if (/兜底|不明|わからない|フォールバック|fallback/.test(lower)) modules.add("fallback");
  return [...modules];
}

function mapRowsToCases(rows: Record<string, string>[]): TestCase[] {
  return rows.map((row, index) => {
    const conversationScript = getRowValue(row, [
      "User&Agent会話スクリプト",
      "User&Agent会话脚本",
      "会話スクリプト",
      "对话脚本",
      "conversation_script",
      "script",
    ]);
    const parsedScript = conversationScript ? parseConversationScript(conversationScript) : undefined;
    const question = getRowValue(row, [
      "question",
      "Question",
      "user_question",
      "input",
      "query",
      "message",
      "prompt",
      "问题",
      "提问",
      "用户问题",
      "测试问题",
      "質問",
      "質問内容",
      "ユーザー質問",
    ]);
    const answer = getRowValue(row, [
      "answer",
      "Answer",
      "expected_answer",
      "expectedAnswer",
      "standard_answer",
      "标准答案",
      "期望答案",
      "回答",
      "模範回答",
      "期待回答",
    ]);
    const moduleText = getRowValue(row, ["modules", "module", "测试模块", "评测模块"]);
    const evaluationText = getRowValue(row, ["評価観点", "评估维度", "评价维度", "evaluation", "evaluation_points"]);
    const inferredModules = modulesFromEvaluationText(evaluationText);
    const modules = (moduleText || "")
      .split(/[|,，、]/)
      .map((item) => item.trim())
      .filter((item): item is ModuleKey => moduleCatalog.some((moduleItem) => moduleItem.key === item));
    const turnsText = getRowValue(row, ["turns", "messages", "conversation", "多轮", "对话", "会话"]) || question;
    const turns = parsedScript?.turns.length
      ? parsedScript.turns
      : turnsText
      .split(/\s*\|\|\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
    const caseId = getRowValue(row, ["id", "case_id", "ケースID", "用例ID"]);
    const featureModule = getRowValue(row, ["機能モジュール", "功能模块", "module_name"]);
    const title = getRowValue(row, ["title", "name", "case_name", "用例名称", "标题", "テスト名"]);
    const expectedIntent = getRowValue(row, ["expected_intent", "expectedIntent", "intent", "期望意图", "期待意図", "意図"]);
    const expectedSource = getRowValue(row, ["期待ソース", "期望来源", "expected_source", "source"]);
    const tags = getRowValue(row, ["tags", "tag", "标签", "分類"]);
    return {
      id: caseId || row.id || `case-${index + 1}`,
      title: title || [caseId, featureModule].filter(Boolean).join(" · ") || question.slice(0, 28) || `测试用例 ${index + 1}`,
      turns,
      expectedIntent,
      expectedAnswer: parsedScript?.expectedAnswer || answer,
      modules: modules.length ? modules : inferredModules.length ? inferredModules : ["availability", "knowledge", "tone", "safety"],
      tags: [tags, featureModule, expectedSource]
        .filter(Boolean)
        .join("、")
        .split(/[|,，、]/)
        .map((item) => item.trim())
        .filter(Boolean),
    };
  });
}

function buildRequestBody(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function scoreResult(params: {
  profile: Profile;
  testCase: TestCase;
  finalAnswer: string;
  actualIntent: string;
  knowledgeReferences: KnowledgeReference[];
  error: string;
  durationMs: number;
}) {
  const { profile, testCase, finalAnswer, actualIntent, knowledgeReferences, error, durationMs } = params;
  const scores: Partial<Record<ModuleKey, ModuleScore>> = {};
  const activeModules = testCase.modules.filter((moduleKey) => profile.enabledModules[moduleKey]);

  for (const moduleKey of activeModules) {
    if (moduleKey === "availability") {
      const ok = !error && finalAnswer.trim().length > 0 && durationMs <= profile.rules.maxResponseSeconds * 1000;
      scores[moduleKey] = {
        score: ok ? 100 : finalAnswer ? 55 : 0,
        status: ok ? "pass" : "fail",
        reason: ok ? "接口正常返回有效回答。" : error || "回答为空或响应时间超过阈值。",
      };
    } else if (moduleKey === "intent") {
      if (!testCase.expectedIntent || !actualIntent) {
        scores[moduleKey] = {
          score: 50,
          status: "review",
          reason: "缺少期望 intent 或接口未返回 intent，需要人工复核。",
        };
      } else {
        const ok = normalizeText(actualIntent) === normalizeText(testCase.expectedIntent);
        scores[moduleKey] = {
          score: ok ? 100 : 20,
          status: ok ? "pass" : "fail",
          reason: ok ? "实际 intent 与期望 intent 一致。" : `实际 intent 为 ${actualIntent || "空"}。`,
        };
      }
    } else if (moduleKey === "knowledge") {
      const answerScore = keywordScore(finalAnswer, testCase.expectedAnswer);
      const referenceBonus = knowledgeReferences.length > 0 ? 12 : 0;
      const score = Math.min(100, answerScore + referenceBonus);
      scores[moduleKey] = {
        score,
        status: score >= 75 ? "pass" : "review",
        reason:
          score >= 75
            ? knowledgeReferences.length
              ? `回答覆盖了较多参考答案核心要点，并查询到 ${knowledgeReferences.length} 条知识引用。`
              : "回答覆盖了较多参考答案核心要点。"
            : knowledgeReferences.length
              ? "已查询到知识引用，但核心意思是否一致仍建议人工复核。"
              : "核心意思是否一致需要人工复核；未查询到知识引用或未开启知识引用接口。",
      };
    } else if (moduleKey === "context") {
      const score = testCase.turns.length > 1 && finalAnswer ? 70 : 45;
      scores[moduleKey] = {
        score,
        status: "review",
        reason: "多轮上下文需要结合对话记录人工复核；平台已保存完整响应。",
      };
    } else if (moduleKey === "tone") {
      const languageOk = profile.rules.requiredLanguage !== "ja" || looksJapanese(finalAnswer);
      scores[moduleKey] = {
        score: languageOk ? 82 : 35,
        status: languageOk ? "review" : "fail",
        reason: languageOk
          ? `语言基本符合，专业自然度按「${profile.rules.requiredTone}」人工复核。`
          : "未检测到符合要求的日语礼貌表达。",
      };
    } else if (moduleKey === "safety") {
      const forbiddenTerms = profile.rules.forbiddenTerms
        .split(/[,\n，、]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const hit = forbiddenTerms.find((term) => finalAnswer.includes(term));
      scores[moduleKey] = {
        score: hit ? 20 : 90,
        status: hit ? "fail" : "review",
        reason: hit ? `命中禁止内容：${hit}` : `未命中禁止词；仍需按规则复核：${profile.rules.safetyNotes}`,
      };
    } else if (moduleKey === "fallback") {
      const expectedTerms = profile.rules.fallbackExpectedTerms
        .split(/[,\n，、]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const matched = expectedTerms.filter((term) => finalAnswer.includes(term)).length;
      const score = expectedTerms.length ? Math.round((matched / expectedTerms.length) * 100) : 60;
      scores[moduleKey] = {
        score,
        status: score >= 50 ? "review" : "fail",
        reason: "兜底话术建议人工确认，避免 agent 编造知识库外内容。",
      };
    } else {
      scores[moduleKey] = {
        score: 0,
        status: "review",
        reason: "该模块已预留，第一版记录测试结果并交给人工复核。",
      };
    }
  }

  const weightedItems = Object.entries(scores).filter(([, value]) => value.status !== "skip");
  const weightTotal = weightedItems.reduce((sum, [key]) => sum + profile.weights[key as ModuleKey], 0);
  const totalScore = weightTotal
    ? Math.round(
        weightedItems.reduce((sum, [key, value]) => sum + value.score * profile.weights[key as ModuleKey], 0) /
          weightTotal,
      )
    : 0;
  const hasFail = weightedItems.some(([, value]) => value.status === "fail");
  const hasReview = weightedItems.some(([, value]) => value.status === "review");
  const status = hasFail ? "fail" : hasReview ? "review" : "pass";

  return { scores, totalScore, status };
}

export default function Home() {
  const [agentConfig, setAgentConfig] = useState<AgentConfig>(() => getStored("agent-config", defaultAgentConfig));
  const [knowledgeConfig, setKnowledgeConfig] = useState<KnowledgeReferenceConfig>(() =>
    getStored("knowledge-reference-config", defaultKnowledgeConfig),
  );
  const [profile, setProfile] = useState<Profile>(() => getStored("agent-profile", defaultProfile));
  const [cases, setCases] = useState<TestCase[]>(() => getStored("test-cases", sampleCases));
  const [results, setResults] = useState<TestResult[]>(() => getStored("test-results", []));
  const [activeTab, setActiveTab] = useState<"setup" | "cases" | "run" | "report">("setup");
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>(() => sampleCases.map((item) => item.id));
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState("第一版已内置一波示例 Profile。填入接口文档信息后即可批量测试。");

  useEffect(() => {
    if (shouldReplaceOldAgentExample(agentConfig)) {
      setAgentConfig(defaultAgentConfig);
    }
  }, []);

  useEffect(() => setStored("agent-config", agentConfig), [agentConfig]);
  useEffect(() => setStored("knowledge-reference-config", knowledgeConfig), [knowledgeConfig]);
  useEffect(() => setStored("agent-profile", profile), [profile]);
  useEffect(() => setStored("test-cases", cases), [cases]);
  useEffect(() => setStored("test-results", results), [results]);

  const summary = useMemo(() => {
    const latest = results.slice(0, cases.length || results.length);
    const average = latest.length ? Math.round(latest.reduce((sum, item) => sum + item.totalScore, 0) / latest.length) : 0;
    return {
      total: latest.length,
      pass: latest.filter((item) => item.status === "pass").length,
      fail: latest.filter((item) => item.status === "fail").length,
      review: latest.filter((item) => item.status === "review").length,
      average,
    };
  }, [cases.length, results]);

  function updateProfileModule(moduleKey: ModuleKey, enabled: boolean) {
    setProfile((current) => ({
      ...current,
      enabledModules: { ...current.enabledModules, [moduleKey]: enabled },
    }));
  }

  function updateProfileRule(key: keyof Profile["rules"], value: string | number) {
    setProfile((current) => ({ ...current, rules: { ...current.rules, [key]: value } }));
  }

  function applyAskRcWebSocketPreset() {
    setAgentConfig(defaultAgentConfig);
    setKnowledgeConfig((current) => ({ ...current, enabled: false }));
    setNotice("已填入 Ask R&C WebSocket 接口配置。请把 Body 模板里的 YOUR_ROBOT_KEY / YOUR_ROBOT_TOKEN 替换为真实值后运行。");
  }

  async function importTestCases(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
      setNotice("当前本地 MVP 未内置 Excel 二进制解析库。请先将 Excel 另存为 CSV，或后续接入 xlsx 解析依赖。");
      event.target.value = "";
      return;
    }
    const text = await file.text();
    try {
      const imported =
        lowerName.endsWith(".json") || text.trim().startsWith("[")
          ? (JSON.parse(text) as TestCase[])
          : mapRowsToCases(parseCsv(text));
      setCases(imported);
      setSelectedCaseIds(imported.map((item) => item.id));
      const emptyQuestionCount = imported.filter((item) => item.turns.length === 0).length;
      setNotice(
        emptyQuestionCount
          ? `已导入 ${imported.length} 条测试用例，其中 ${emptyQuestionCount} 条没有识别到问题内容，请检查 CSV 表头。`
          : `已导入 ${imported.length} 条测试用例。`,
      );
    } catch {
      setNotice("导入失败：请确认文件是 JSON 或 CSV，且字段名包含 question/answer/intent/modules。");
    }
    event.target.value = "";
  }

  async function callAgent(testCase: TestCase) {
    let conversationId = "";
    let dialogId = "";
    const rawResponses: unknown[] = [];
    let finalAnswer = "";
    let actualIntent = "";
    let knowledgeSource = "";
    let knowledgeReferences: KnowledgeReference[] = [];
    let error = "";
    const start = performance.now();

    try {
      if (!testCase.turns.length) {
        throw new Error("测试用例缺少问题内容，请检查 CSV 表头是否包含 question / Question / 问题 / 質問 等字段。");
      }
      for (const message of testCase.turns) {
        const headers = parseJsonObject(agentConfig.headersText);
        const requestValues = { message, conversationId, dialogId, caseId: testCase.id, username: agentConfig.username };
        const requestBodyText = buildRequestBody(agentConfig.requestTemplate, requestValues);
        if (/^wss?:\/\//i.test(agentConfig.endpoint)) {
          const wsResult = await callWebSocketAgent(
            agentConfig.endpoint,
            requestBodyText,
            agentConfig.timeoutSeconds,
            agentConfig,
          );
          rawResponses.push(...(wsResult.rawMessages ?? [wsResult.raw]));
          finalAnswer = wsResult.finalAnswer;
          actualIntent = wsResult.actualIntent || actualIntent;
          knowledgeSource = wsResult.knowledgeSource || knowledgeSource;
          conversationId = wsResult.conversationId || conversationId;
          dialogId = wsResult.dialogId || dialogId;
        } else {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), agentConfig.timeoutSeconds * 1000);
          const url =
            agentConfig.method === "GET" || agentConfig.bodyMode === "query"
              ? `${agentConfig.endpoint}${agentConfig.endpoint.includes("?") ? "&" : "?"}message=${encodeURIComponent(message)}&conversationId=${encodeURIComponent(conversationId)}`
              : agentConfig.endpoint;
          const response = await fetch("/api/agent-proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              method: agentConfig.method,
              headers,
              body: agentConfig.method === "POST" && agentConfig.bodyMode === "json" ? requestBodyText : undefined,
              timeoutSeconds: agentConfig.timeoutSeconds,
            }),
            signal: controller.signal,
          });
          window.clearTimeout(timeoutId);
          const proxyResult = (await response.json()) as {
            ok?: boolean;
            status?: number;
            body?: unknown;
            error?: string;
          };
          const raw = proxyResult.body ?? proxyResult;
          rawResponses.push(raw);
          if (!response.ok || proxyResult.ok === false) {
            error = proxyResult.error || `接口返回 ${proxyResult.status ?? response.status}`;
            break;
          }
          const fields = extractAgentFields(raw, agentConfig);
          finalAnswer = fields.finalAnswer;
          actualIntent = fields.actualIntent || actualIntent;
          knowledgeSource = fields.knowledgeSource || knowledgeSource;
          conversationId = fields.conversationId || conversationId;
          dialogId = fields.dialogId || dialogId;
        }
      }

      if (!error && knowledgeConfig.enabled && knowledgeConfig.endpoint.trim() && dialogId) {
        const knowledgeHeaders = parseJsonObject(knowledgeConfig.headersText);
        const knowledgeBodyText = buildRequestBody(knowledgeConfig.requestTemplate, {
          message: testCase.turns[testCase.turns.length - 1] ?? "",
          conversationId,
          dialogId,
          caseId: testCase.id,
          username: agentConfig.username,
        });
        const knowledgeResponse = await fetch("/api/agent-proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: knowledgeConfig.endpoint,
            method: knowledgeConfig.method,
            headers: knowledgeHeaders,
            body: knowledgeBodyText,
            timeoutSeconds: agentConfig.timeoutSeconds,
          }),
        });
        const knowledgeProxyResult = (await knowledgeResponse.json()) as {
          ok?: boolean;
          status?: number;
          body?: unknown;
          error?: string;
        };
        const knowledgeRaw = knowledgeProxyResult.body ?? knowledgeProxyResult;
        rawResponses.push({ knowledgeReference: knowledgeRaw });
        if (knowledgeResponse.ok && knowledgeProxyResult.ok !== false) {
          const list = asArray(getByPath(knowledgeRaw, knowledgeConfig.responseListPath));
          knowledgeReferences = list.map((item) => ({
            knowledgeName: String(getByPath(item, knowledgeConfig.knowledgeNamePath) ?? ""),
            section: String(getByPath(item, knowledgeConfig.sectionPath) ?? ""),
            score: String(getByPath(item, knowledgeConfig.scorePath) ?? ""),
            dataset: String(getByPath(item, knowledgeConfig.datasetPath) ?? ""),
          }));
          knowledgeSource = knowledgeReferences
            .map((item) => [item.knowledgeName, item.dataset].filter(Boolean).join(" / "))
            .filter(Boolean)
            .join("；");
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "请求失败";
    }

    const durationMs = Math.round(performance.now() - start);
    const scored = scoreResult({ profile, testCase, finalAnswer, actualIntent, knowledgeReferences, error, durationMs });
    return {
      id: `${testCase.id}-${Date.now()}`,
      caseId: testCase.id,
      caseTitle: testCase.title,
      startedAt: new Date().toLocaleString("zh-CN"),
      durationMs,
      finalAnswer,
      actualIntent,
      knowledgeSource,
      knowledgeReferences,
      error,
      rawResponses,
      moduleScores: scored.scores,
      totalScore: scored.totalScore,
      status: scored.status,
    } satisfies TestResult;
  }

  async function runSelectedCases() {
    const runCases = cases.filter((item) => selectedCaseIds.includes(item.id));
    if (!agentConfig.endpoint.trim()) {
      setNotice("请先在接口配置里填写 agent 后端地址，再运行测试。");
      setActiveTab("setup");
      return;
    }
    setIsRunning(true);
    setNotice(`开始运行 ${runCases.length} 条测试用例。`);
    const nextResults: TestResult[] = [];
    for (const testCase of runCases) {
      setNotice(`正在测试：${testCase.title}`);
      const result = await callAgent(testCase);
      nextResults.push(result);
      setResults((current) => [result, ...current]);
    }
    setIsRunning(false);
    setActiveTab("report");
    setNotice(`测试完成：${nextResults.length} 条用例已生成报告。`);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ agentConfig, profile, cases, results }, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "agent-automation-test-report.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv() {
    const header = ["caseId", "caseTitle", "status", "totalScore", "intent", "durationMs", "answer", "error"];
    const lines = results.map((item) =>
      [item.caseId, item.caseTitle, item.status, item.totalScore, item.actualIntent, item.durationMs, item.finalAnswer, item.error]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "agent-automation-test-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function updateManualScore(resultId: string, moduleKey: ModuleKey, manualScore: number, manualNote: string) {
    setResults((current) =>
      current.map((result) => {
        if (result.id !== resultId) return result;
        const existing = result.moduleScores[moduleKey];
        if (!existing) return result;
        const moduleScores = {
          ...result.moduleScores,
          [moduleKey]: {
            ...existing,
            manualScore,
            manualNote,
            score: manualScore,
            status: manualScore >= profile.thresholds[moduleKey] ? "pass" : "fail",
            reason: manualNote || existing.reason,
          },
        };
        const entries = Object.entries(moduleScores) as [ModuleKey, ModuleScore][];
        const totalWeight = entries.reduce((sum, [key]) => sum + profile.weights[key], 0);
        const totalScore = totalWeight
          ? Math.round(entries.reduce((sum, [key, value]) => sum + value.score * profile.weights[key], 0) / totalWeight)
          : result.totalScore;
        const status = entries.some(([, value]) => value.status === "fail")
          ? "fail"
          : entries.some(([, value]) => value.status === "review")
            ? "review"
            : "pass";
        return { ...result, moduleScores, totalScore, status };
      }),
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Agent Evaluation Platform(Beta)</p>
          <h1>Agent 自动化测试平台</h1>
          <p className="intro">按能力模块开启评测，用 Agent Profile 适配不同 agent。</p>
        </div>
        <nav className="nav-tabs" aria-label="平台导航">
          {[
            ["setup", "接口与Profile"],
            ["cases", "测试集"],
            ["run", "运行测试"],
            ["report", "报告复核"],
          ].map(([key, label]) => (
            <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key as typeof activeTab)}>
              {label}
            </button>
          ))}
        </nav>
        <section className="summary-panel">
          <span>最近报告</span>
          <strong>{summary.average}</strong>
          <div className="summary-grid">
            <span>通过 {summary.pass}</span>
            <span>复核 {summary.review}</span>
            <span>失败 {summary.fail}</span>
          </div>
        </section>
      </aside>

      <section className="workspace">
        <div className="notice">{notice}</div>

        {activeTab === "setup" && (
          <div className="content-grid">
            <section className="guide setup-guide">
              <h3>你怎么用这个平台测试 agent</h3>
              <ol>
                <li>把后端接口文档里的 URL、鉴权、请求体和响应字段填到接口配置。</li>
                <li>在 Agent Profile 中开启这个 agent 需要评测的能力模块。</li>
                <li>导入测试集，或先用内置示例验证流程。</li>
                <li>运行测试后，在报告页查看自动评分和人工复核项。</li>
              </ol>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Step 1</p>
                  <h2>Agent 后端接口配置</h2>
                </div>
              </div>
              <label>
                Agent 名称
                <input
                  data-testid="agent-name-input"
                  value={agentConfig.name}
                  onChange={(event) => setAgentConfig({ ...agentConfig, name: event.target.value })}
                />
              </label>
              <label>
                测试用户名
                <input
                  data-testid="agent-username-input"
                  value={agentConfig.username}
                  onChange={(event) => setAgentConfig({ ...agentConfig, username: event.target.value })}
                />
              </label>
              <label>
                对话接口地址
                <input
                  placeholder="https://agents.dyna.ai/openapi/v1/conversation/dialog/ 或 wss://agents.dyna.ai/openapi/v1/ws/dialog/"
                  data-testid="dialog-endpoint-input"
                  value={agentConfig.endpoint}
                  onChange={(event) => setAgentConfig({ ...agentConfig, endpoint: event.target.value })}
                />
              </label>
              <div className="form-row">
                <label>
                  请求方法
                  <select
                    value={agentConfig.method}
                    onChange={(event) => setAgentConfig({ ...agentConfig, method: event.target.value as HttpMethod })}
                  >
                    <option>POST</option>
                    <option>GET</option>
                  </select>
                </label>
                <label>
                  超时秒数
                  <input
                    type="number"
                    value={agentConfig.timeoutSeconds}
                    onChange={(event) => setAgentConfig({ ...agentConfig, timeoutSeconds: Number(event.target.value) })}
                  />
                </label>
              </div>
              <label>
                Headers JSON
                <textarea
                  data-testid="dialog-headers-input"
                  value={agentConfig.headersText}
                  onChange={(event) => setAgentConfig({ ...agentConfig, headersText: event.target.value })}
                />
              </label>
              <label>
                请求 Body 模板
                <textarea
                  data-testid="dialog-body-template-input"
                  value={agentConfig.requestTemplate}
                  onChange={(event) => setAgentConfig({ ...agentConfig, requestTemplate: event.target.value })}
                />
              </label>
              <div className="form-row">
                <label>
                  回答字段路径
                  <input
                    value={agentConfig.responseAnswerPath}
                    data-testid="dialog-answer-path-input"
                    onChange={(event) => setAgentConfig({ ...agentConfig, responseAnswerPath: event.target.value })}
                  />
                </label>
                <label>
                  Intent 字段路径
                  <input
                    value={agentConfig.responseIntentPath}
                    data-testid="dialog-intent-path-input"
                    onChange={(event) => setAgentConfig({ ...agentConfig, responseIntentPath: event.target.value })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  知识来源字段路径
                  <input
                    value={agentConfig.responseKnowledgePath}
                    data-testid="dialog-knowledge-path-input"
                    onChange={(event) => setAgentConfig({ ...agentConfig, responseKnowledgePath: event.target.value })}
                  />
                </label>
                <label>
                  会话/回答 ID 字段路径
                  <input
                    value={agentConfig.conversationIdPath}
                    data-testid="dialog-conversation-id-path-input"
                    onChange={(event) => setAgentConfig({ ...agentConfig, conversationIdPath: event.target.value })}
                  />
                </label>
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Step 1B</p>
                  <h2>知识引用接口配置</h2>
                </div>
                <label className="inline-toggle">
                  <input
                    data-testid="knowledge-enabled-input"
                    type="checkbox"
                    checked={knowledgeConfig.enabled}
                    onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, enabled: event.target.checked })}
                  />
                  启用
                </label>
              </div>
              <label>
                知识引用接口地址
                <input
                  placeholder="https://agents.dyna.ai/openapi/v1/conversation/knowledge/"
                  data-testid="knowledge-endpoint-input"
                  value={knowledgeConfig.endpoint}
                  onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, endpoint: event.target.value })}
                />
              </label>
              <label>
                Headers JSON
                <textarea
                  data-testid="knowledge-headers-input"
                  value={knowledgeConfig.headersText}
                  onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, headersText: event.target.value })}
                />
              </label>
              <label>
                请求 Body 模板
                <textarea
                  data-testid="knowledge-body-template-input"
                  value={knowledgeConfig.requestTemplate}
                  onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, requestTemplate: event.target.value })}
                />
              </label>
              <div className="form-row">
                <label>
                  知识列表字段路径
                  <input
                    value={knowledgeConfig.responseListPath}
                    data-testid="knowledge-list-path-input"
                    onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, responseListPath: event.target.value })}
                  />
                </label>
                <label>
                  知识库名称字段路径
                  <input
                    value={knowledgeConfig.knowledgeNamePath}
                    data-testid="knowledge-name-path-input"
                    onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, knowledgeNamePath: event.target.value })}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  命中文本字段路径
                  <input
                    value={knowledgeConfig.sectionPath}
                    data-testid="knowledge-section-path-input"
                    onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, sectionPath: event.target.value })}
                  />
                </label>
                <label>
                  相关度分数字段路径
                  <input
                    value={knowledgeConfig.scorePath}
                    data-testid="knowledge-score-path-input"
                    onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, scorePath: event.target.value })}
                  />
                </label>
              </div>
              <label>
                数据集字段路径
                <input
                  value={knowledgeConfig.datasetPath}
                  data-testid="knowledge-dataset-path-input"
                  onChange={(event) => setKnowledgeConfig({ ...knowledgeConfig, datasetPath: event.target.value })}
                />
              </label>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Step 2</p>
                  <h2>Agent Profile 与能力模块</h2>
                </div>
              </div>
              <label>
                Profile 名称
                <input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
              </label>
              <div className="module-list">
                {moduleCatalog.map((item) => (
                  <label className="module-item" key={item.key}>
                    <input
                      type="checkbox"
                      checked={profile.enabledModules[item.key]}
                      onChange={(event) => updateProfileModule(item.key, event.target.checked)}
                    />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="form-row">
                <label>
                  必须使用语言
                  <input value={profile.rules.requiredLanguage} onChange={(event) => updateProfileRule("requiredLanguage", event.target.value)} />
                </label>
                <label>
                  最大响应秒数
                  <input
                    type="number"
                    value={profile.rules.maxResponseSeconds}
                    onChange={(event) => updateProfileRule("maxResponseSeconds", Number(event.target.value))}
                  />
                </label>
              </div>
              <label>
                禁止内容
                <textarea value={profile.rules.forbiddenTerms} onChange={(event) => updateProfileRule("forbiddenTerms", event.target.value)} />
              </label>
              <label>
                角色语气规则
                <textarea value={profile.rules.requiredTone} onChange={(event) => updateProfileRule("requiredTone", event.target.value)} />
              </label>
              <label>
                安全合规规则
                <textarea value={profile.rules.safetyNotes} onChange={(event) => updateProfileRule("safetyNotes", event.target.value)} />
              </label>
            </section>
          </div>
        )}

        {activeTab === "cases" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Step 3</p>
                <h2>测试集管理</h2>
              </div>
              <label className="file-button">
                导入 CSV/JSON
                <input type="file" accept=".csv,.json,.xlsx,.xls" onChange={importTestCases} />
              </label>
            </div>
            <div className="case-list">
              {cases.map((testCase) => (
                <article className="case-card" key={testCase.id}>
                  <div>
                    <strong>{testCase.title}</strong>
                    <p>{testCase.turns.join(" → ")}</p>
                    <small>期望 intent：{testCase.expectedIntent || "未配置"}</small>
                  </div>
                  <div className="chip-row">
                    {testCase.modules.map((moduleKey) => (
                      <span className="chip" key={moduleKey}>{moduleCatalog.find((item) => item.key === moduleKey)?.label}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "run" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Step 4</p>
                <h2>批量运行测试</h2>
              </div>
              <button className="primary-action" disabled={isRunning} onClick={runSelectedCases}>
                {isRunning ? "运行中" : "运行选中用例"}
              </button>
            </div>
            <div className="run-layout">
              <div className="select-list">
                {cases.map((testCase) => (
                  <label className="select-case" key={testCase.id}>
                    <input
                      type="checkbox"
                      checked={selectedCaseIds.includes(testCase.id)}
                      onChange={(event) => {
                        setSelectedCaseIds((current) =>
                          event.target.checked ? [...current, testCase.id] : current.filter((id) => id !== testCase.id),
                        );
                      }}
                    />
                    <span>
                      <strong>{testCase.title}</strong>
                      <small>{testCase.modules.length} 个评测模块</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === "report" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Step 5</p>
                <h2>报告与人工复核</h2>
              </div>
              <div className="button-row">
                <button onClick={() => setResults([])}>清空报告</button>
                <button onClick={exportCsv}>导出 CSV</button>
                <button onClick={exportJson}>导出 JSON</button>
              </div>
            </div>
            <div className="metric-row">
              <div><span>平均分</span><strong>{summary.average}</strong></div>
              <div><span>通过</span><strong>{summary.pass}</strong></div>
              <div><span>待复核</span><strong>{summary.review}</strong></div>
              <div><span>失败</span><strong>{summary.fail}</strong></div>
            </div>
            <div className="result-list">
              {results.length === 0 && <p className="empty-state">还没有报告。运行测试后这里会显示每条用例的评分、失败原因和人工复核入口。</p>}
              {results.map((result) => (
                <article className={`result-card ${result.status}`} key={result.id}>
                  <div className="result-head">
                    <div>
                      <strong>{result.caseTitle}</strong>
                      <small>{result.startedAt} · {result.durationMs}ms · intent: {result.actualIntent || "未返回"}</small>
                    </div>
                    <span>{result.totalScore}</span>
                  </div>
                  {result.error && <p className="error-text">{result.error}</p>}
                  <p className="answer-text">{result.finalAnswer || "无回答"}</p>
                  <details className="raw-response-panel">
                    <summary>查看接口原始返回</summary>
                    <pre>{JSON.stringify(result.rawResponses, null, 2)}</pre>
                  </details>
                  {(result.knowledgeReferences ?? []).length > 0 && (
                    <div className="knowledge-hit-list">
                      <strong>知识命中</strong>
                      {(result.knowledgeReferences ?? []).map((reference, index) => (
                        <div className="knowledge-hit" key={`${result.id}-knowledge-${index}`}>
                          <span>{reference.knowledgeName || "未命名知识库"}</span>
                          <small>{[reference.dataset, reference.score && `score: ${reference.score}`].filter(Boolean).join(" · ")}</small>
                          <p>{reference.section}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="score-grid">
                    {(Object.entries(result.moduleScores) as [ModuleKey, ModuleScore][]).map(([moduleKey, score]) => (
                      <div className="score-item" key={moduleKey}>
                        <strong>{moduleCatalog.find((item) => item.key === moduleKey)?.label} · {score.score}</strong>
                        <span className={score.status}>{score.status}</span>
                        <p>{score.reason}</p>
                        {score.status === "review" && (
                          <div className="manual-row">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="人工分"
                              onChange={(event) =>
                                updateManualScore(result.id, moduleKey, Number(event.target.value), score.manualNote ?? "人工复核")
                              }
                            />
                            <input
                              placeholder="复核备注"
                              onChange={(event) =>
                                updateManualScore(result.id, moduleKey, score.manualScore ?? score.score, event.target.value)
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
