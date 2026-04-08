function createLlmAnalyzer(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const model = String(options.model || "gpt-5").trim();
  const baseUrl = String(options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const timeoutMs = Math.max(Number(options.timeoutMs || 45000), 5000);

  return {
    getStatus,
    analyzeContent
  };

  function getStatus() {
    return {
      ok: true,
      configured: !!apiKey,
      model
    };
  }

  async function analyzeContent(input = {}) {
    if (!apiKey) {
      throw new Error("AI analysis is not configured. Set OPENAI_API_KEY on the server.");
    }

    const prompt = buildPrompt(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          input: prompt,
          text: {
            format: {
              type: "json_schema",
              name: "content_insight",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["summary", "recommendation", "score", "confidence", "time_worth", "best_for", "skip_if", "reasons", "next_action"],
                properties: {
                  summary: { type: "string" },
                  recommendation: { type: "string" },
                  score: { type: "number" },
                  confidence: { type: "number" },
                  time_worth: { type: "string", enum: ["high", "medium", "low"] },
                  best_for: { type: "string" },
                  skip_if: { type: "string" },
                  reasons: {
                    type: "array",
                    items: { type: "string" }
                  },
                  next_action: { type: "string", enum: ["watch_now", "review_later", "skip", "open_first"] }
                }
              }
            }
          }
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`AI analysis timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || "OpenAI analysis request failed.";
      throw new Error(message);
    }

    const outputText = extractOutputText(payload);
    const parsed = parseJsonObject(outputText);
    if (!parsed) {
      throw new Error("AI analysis returned an unexpected format.");
    }

    return normalizeAiInsight(parsed, model);
  }
}

function buildPrompt(input) {
  const title = String(input.title || "").trim();
  const url = String(input.url || "").trim();
  const channelName = String(input.channelName || "").trim();
  const duration = Number(input.duration || 0);
  const uploadDate = String(input.uploadDate || "").trim();
  const tracking = input.tracking && typeof input.tracking === "object" ? input.tracking : {};
  const analysis = input.analysis && typeof input.analysis === "object" ? input.analysis : {};
  const preferences = input.preferences && typeof input.preferences === "object" ? input.preferences : {};

  return [
    "你在帮助用户判断一个视频或音频条目值不值得花时间。",
    "只能使用给定的元数据判断，不能虚构实际内容细节。",
    "请务实、简洁、诚实表达不确定性。",
    "所有字符串内容都用简体中文输出。",
    "Return JSON only with this exact shape:",
    '{"summary":"","recommendation":"","score":0,"confidence":0,"time_worth":"high|medium|low","best_for":"","skip_if":"","reasons":["",""],"next_action":""}',
    "",
    "Metadata:",
    `Title: ${title || "(unknown)"}`,
    `URL: ${url || "(unknown)"}`,
    `Channel: ${channelName || "(unknown)"}`,
    `Duration seconds: ${duration || 0}`,
    `Upload date: ${uploadDate || "(unknown)"}`,
    `Current tracker status: ${String(tracking.status || "new")}`,
    `User note: ${String(tracking.note || "") || "(none)"}`,
    `User rating: ${Number(tracking.rating || 0)}`,
    `Prior downloads: ${Number(tracking.downloadCount || 0)}`,
    `Existing heuristic recommendation: ${String(analysis.recommendation || "unknown")}`,
    `Existing heuristic score: ${Number(analysis.score || 0)}`,
    `Existing heuristic reasons: ${Array.isArray(analysis.reasons) ? analysis.reasons.join(", ") : ""}`,
    `Preferred length: ${String(preferences.lengthPreference || "any")}`,
    `Preferred style: ${String(preferences.stylePreference || "any")}`,
    `Preferred topics: ${Array.isArray(preferences.preferredTopics) ? preferences.preferredTopics.join(", ") : ""}`,
    `Avoid topics: ${Array.isArray(preferences.avoidedTopics) ? preferences.avoidedTopics.join(", ") : ""}`,
    "",
    "评分规则：",
    "- score 是 0-100 的综合价值分，表示这条内容此刻值不值得投入时间",
    "- confidence 是 0-100 的判断把握度；元数据弱、标题含糊、缺少发布日期时要降低",
    "- recommendation 必须是以下四个中文之一：建议现在看、值得一试、可选、暂时跳过",
    "- time_worth 反映时间价值高低：high / medium / low",
    "- reasons 要短、具体、最多 4 条，使用中文短语",
    "- next_action 必须是以下之一：watch_now, review_later, skip, open_first",
    "- 如果元数据很弱，要在 summary 中明确说出来",
    "- best_for 用一句中文说明这条内容最适合什么场景或人",
    "- skip_if 用一句中文说明什么情况下可以先不看"
  ].join("\n");
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function extractOutputText(payload) {
  const direct = String(payload?.output_text || "").trim();
  if (direct) {
    return direct;
  }

  const outputs = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of outputs) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = String(part?.text || "").trim();
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function normalizeAiInsight(input, model) {
  const timeWorth = ["high", "medium", "low"].includes(String(input.time_worth || "").toLowerCase())
    ? String(input.time_worth).toLowerCase()
    : "medium";

  const nextAction = ["watch_now", "review_later", "skip", "open_first"].includes(String(input.next_action || "").toLowerCase())
    ? String(input.next_action).toLowerCase()
    : "open_first";

  return {
    summary: String(input.summary || "").trim(),
    recommendation: String(input.recommendation || "").trim() || "值得一试",
    score: clampNumber(input.score, 0, 100, 50),
    confidence: clampNumber(input.confidence, 0, 100, 50),
    timeWorth,
    bestFor: String(input.best_for || "").trim(),
    skipIf: String(input.skip_if || "").trim(),
    reasons: Array.isArray(input.reasons)
      ? input.reasons.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
      : [],
    nextAction,
    model: String(model || ""),
    updatedAt: new Date().toISOString()
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

module.exports = {
  createLlmAnalyzer
};
