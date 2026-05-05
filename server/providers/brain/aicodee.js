function buildChatEndpoint(baseUrl) {
  return `${String(baseUrl ?? "").replace(/\/+$/, "")}/v1/chat/completions`;
}

function isBrainConfigured(config = {}) {
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildToolDescriptions(tools) {
  return Object.entries(tools).map(([name, tool]) => {
    const params = tool.parameters || {};
    const paramDesc = Object.entries(params)
      .filter(([k, v]) => k !== "required")
      .map(([k, v]) => `  - ${k}${v.required ? "(必填)" : ""}: ${v.description}${v.default !== undefined ? `(默认: ${v.default})` : ""}`)
      .join("\n");
    return `### ${name}\n${tool.description}\n参数:\n${paramDesc || "  无参数"}`;
  }).join("\n\n");
}

function buildSystemPrompt(tools) {
  const toolDocs = buildToolDescriptions(tools);
  return `你是 Claudio，一个聪明贴心的 AI 音乐电台 DJ。你的任务是帮用户发现好音乐、管理播放、推荐适合当前场景的歌曲。

## 你的能力
你可以做以下事情：
1. 回答关于当前播放、歌单、音乐品味的问题
2. 根据天气、时间、用户情绪推荐歌曲
3. 控制播放（下一首、暂停、继续等）
4. 浏览用户的歌单并介绍内容
5. 查看播放历史和品味画像

## 可用工具
你可以通过调用以下工具来获取信息或执行操作：

${toolDocs}

## 回复规则
- 始终用中文回复，简洁自然
- 如果你需要信息来回答用户问题，调用对应的工具
- 你可以按顺序调用多个工具来完成任务（最多3轮）
- 调用工具时，在回复中包含 \`\`\`tool_calls\`\`\` 代码块，格式为 JSON
- 工具调用完成后，根据结果给用户最终回复
- 如果用户只是闲聊或打招呼，不需要调用工具
- 所有回复应该像电台 DJ 一样自然、有温度

## 工具调用格式
当你需要调用工具时，在回复末尾加上：
\`\`\`tool_calls
[{"name": "工具名", "arguments": {"参数名": "值"}}]
\`\`\`

你可以在同一条回复中调用多个工具（并行执行）。`;
}

function parseToolCalls(content) {
  if (!content) return [];

  // Try to extract tool_calls block
  const match = content.match(/```tool_calls\n([\s\S]*?)```/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) {
      return parsed.map((tc) => ({
        name: String(tc.name ?? tc.tool ?? ""),
        arguments: tc.arguments ?? tc.args ?? {},
      })).filter((tc) => tc.name);
    }
  } catch {
    // Try cleaning the JSON
    try {
      const cleaned = match[1].trim()
        .replace(/,\s*\]/g, "]")
        .replace(/,\s*\}/g, "}");
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.map((tc) => ({
          name: String(tc.name ?? tc.tool ?? ""),
          arguments: tc.arguments ?? tc.args ?? {},
        })).filter((tc) => tc.name);
      }
    } catch {}
  }
  return [];
}

function stripToolCallsBlock(content) {
  return content.replace(/```tool_calls\n[\s\S]*?```\n*/g, "").trim();
}

function buildContextPayload(context) {
  const now = context?.now;
  const scene = context?.scene;
  const weather = context?.weather;
  const time = context?.time;
  const taste = context?.taste;
  const playlists = context?.playlists ?? [];
  const queue = context?.queue ?? [];
  const plan = context?.plan;

  const parts = [];

  if (now?.title) {
    parts.push(`当前播放：《${now.title}》${now.artist ? `· ${now.artist}` : ""}，状态：${now.status}，进度：${Math.floor(now.position || 0)}s / ${Math.floor(now.duration || 0)}s`);
  } else {
    parts.push("当前没有播放歌曲");
  }

  if (scene) parts.push(`场景：${scene.summary ?? ""}`);
  if (time) parts.push(`时间：${time.isWeekend ? "周末" : "工作日"} · ${time.period}`);
  if (weather?.available !== false && weather) {
    parts.push(`天气：${weather.description ?? "未知"}${weather.city ? `(${weather.city})` : ""}`);
  }
  if (taste?.tags?.length) parts.push(`你的音乐标签：${taste.tags.join("、")}`);
  if (playlists.length) {
    parts.push(`歌单(${playlists.length}张)：${playlists.slice(0, 5).map(p => `《${p.title}》(${p.trackCount}首)`).join("、")}`);
  }
  if (queue.length) {
    const playable = queue.filter(q => q.canPlay);
    parts.push(`待播队列：${playable.length}首可播`);
  }
  if (plan?.items?.length) {
    parts.push(`今日电台计划：${plan.items.map(i => `${i.time} ${i.label}`).join(" | ")}`);
  }

  const userTaste = context?.userTaste;
  const userRoutines = context?.userRoutines;
  const userMoodRules = context?.userMoodRules;

  if (userTaste) {
    parts.push(`## 用户音乐品味\n${userTaste}`);
  }
  if (userRoutines) {
    parts.push(`## 用户听歌习惯\n${userRoutines}`);
  }
  if (userMoodRules) {
    parts.push(`## 心情-音乐映射\n${userMoodRules}`);
  }

  return parts.join("\n");
}

async function askWithTools({ config, message, context, tools, executeTool, signal }) {
  const messages = [];
  const systemPrompt = buildSystemPrompt(tools);
  const contextStr = buildContextPayload(context);

  messages.push(
    { role: "system", content: `${systemPrompt}\n\n## 当前上下文\n${contextStr}` }
  );
  messages.push({ role: "user", content: message });

  let toolRound = 0;
  const maxRounds = 3;
  let capturedRecommendation = null;

  while (toolRound < maxRounds) {
    const response = await fetch(buildChatEndpoint(config.baseUrl), {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.6,
        messages,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `Aicodee request failed: ${response.status}`);
    }

    const content = payload?.choices?.[0]?.message?.content ?? "";
    const toolCalls = parseToolCalls(content);
    console.log(`[askWithTools] round=${toolRound}, content=${content?.length}chars, tools=${toolCalls.length}`);

    if (!toolCalls.length) {
      // No more tool calls, this is the final reply
      const plainContent = stripToolCallsBlock(content);
      const parsed = safeJsonParse(plainContent);
      if (parsed && typeof parsed === "object" && parsed.reply) {
        return {
          reply: String(parsed.reply),
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
          reason: parsed.reason ? String(parsed.reason) : "",
          recommendation: parsed.recommendation ?? capturedRecommendation,
        };
      }
      return {
        reply: plainContent || "我没有收到模型回复。",
        actions: [],
        recommendation: capturedRecommendation,
      };
    }

    // Execute tool calls and add results
    const cleanReply = stripToolCallsBlock(content);
    if (cleanReply) {
      messages.push({ role: "assistant", content: cleanReply });
    } else {
      messages.push({ role: "assistant", content: `[调用工具: ${toolCalls.map(t => t.name).join(", ")}]` });
    }

    const toolResults = [];
    for (const tc of toolCalls) {
      const result = await executeTool(tc.name, tc.arguments, { fullContext: context });
      console.log(`[askWithTools] tool=${tc.name}, result=${JSON.stringify(result).length}chars`);
      toolResults.push(result);
      if (tc.name === "recommend" && result?.result?.title) {
        capturedRecommendation = result.result;
      }
      messages.push({
        role: "user",
        content: `工具 ${tc.name} 返回: ${JSON.stringify(result, null, 2)}`,
      });
    }

    toolRound++;
  }

  // Max rounds reached, get final response
  const response = await fetch(buildChatEndpoint(config.baseUrl), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.6,
      messages: [
        ...messages,
        { role: "user", content: "根据已有信息给我最终回复。" },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const content = payload?.choices?.[0]?.message?.content ?? stripToolCallsBlock(content ?? "");
  return {
    reply: content || "处理超时，请重试。",
    actions: [],
    recommendation: capturedRecommendation,
  };
}

async function askWithoutTools({ config, message, context }) {
  const contextStr = buildContextPayload(context);
  const systemPrompt =
    "You are Claudio, a concise Chinese music-player assistant. " +
    "Reply in Chinese. You can explain current playback state, playlists, lyrics, and copyright limits. " +
    "If the user asks for safe player control, you may return JSON with reply and actions. " +
    "Allowed actions are next, prev, pause, play, resume, and toggle. " +
    "Never invent playable URLs, never claim locked songs can be bypassed, and keep replies short. " +
    "Prefer this JSON shape when taking action: {\"reply\":\"...\",\"actions\":[\"next\"],\"reason\":\"...\"}. " +
    "For normal chat, plain text is fine.";

  const messages = [
    { role: "system", content: `${systemPrompt}\n\nCurrent context:\n${contextStr}` },
    { role: "user", content: message },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 20000);

  try {
    const response = await fetch(buildChatEndpoint(config.baseUrl), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        messages,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `Aicodee request failed: ${response.status}`);
    }

    return normalizeBrainReply(payload);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBrainReply(payload) {
  const content = payload?.choices?.[0]?.message?.content ?? "";
  const parsed = safeJsonParse(content);
  if (parsed && typeof parsed === "object") {
    return {
      reply: String(parsed.reply ?? parsed.message ?? content),
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      reason: parsed.reason ? String(parsed.reason) : "",
      recommendation: parsed.recommendation ?? null,
    };
  }

  return {
    reply: String(content || "我没有收到模型回复。"),
    actions: [],
  };
}

async function askAicodeeBrain(config, { message, context = null, tools = null, executeTool = null } = {}) {
  if (!isBrainConfigured(config)) return null;

  if (tools && executeTool && context) {
    const signal = new AbortController().signal;
    return askWithTools({ config, message, context, tools, executeTool, signal }).catch((error) => {
      // Fallback to basic mode on tool-calling failure
      return askWithoutTools({ config, message, context }).catch(() => null);
    });
  }

  return askWithoutTools({ config, message, context }).catch(() => null);
}

module.exports = {
  askAicodeeBrain,
  buildChatEndpoint,
  isBrainConfigured,
  normalizeBrainReply,
};
