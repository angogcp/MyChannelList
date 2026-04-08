const fsp = require("fs/promises");
const path = require("path");

function createContentTracker(options = {}) {
  const appRoot = options.appRoot || process.cwd();
  const dataDir = options.dataDir || path.join(appRoot, "data");
  const storePath = path.join(dataDir, "content-tracker.json");

  return {
    enrichVideos,
    updateRecord,
    listHistory,
    getPreferences,
    updatePreferences,
    markQueued,
    markDownloaded,
    markFailed
  };

  async function ensureDataDir() {
    await fsp.mkdir(dataDir, { recursive: true });
  }

  async function loadStore() {
    try {
      await ensureDataDir();
      const raw = await fsp.readFile(storePath, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && parsed.records
        ? {
            records: parsed.records || {},
            preferences: parsed.preferences || { global: {}, channels: {} }
          }
        : { records: {}, preferences: { global: {}, channels: {} } };
    } catch {
      return { records: {}, preferences: { global: {}, channels: {} } };
    }
  }

  async function saveStore(store) {
    await ensureDataDir();
    await fsp.writeFile(storePath, JSON.stringify(store, null, 2), "utf8");
  }

  async function enrichVideos({ channelName = "", channelUrl = "", videos = [] } = {}) {
    const store = await loadStore();
    const preferences = getMergedPreferences(store.preferences, channelUrl);
    const learningProfile = buildLearningProfile(store.records, channelUrl, preferences);
    const enrichedVideos = videos.map((video) => {
      const key = buildKey(video);
      const record = store.records[key] || null;
      return {
        ...video,
        trackerKey: key,
        analysis: analyzeVideo(video, record, learningProfile),
        tracking: normalizeRecord(record)
      };
    });

    const history = buildHistoryList(store.records, {
      channelUrl,
      limit: 20
    });

    return {
      ok: true,
      videos: enrichedVideos,
      history,
      preferences
    };
  }

  async function updateRecord(input = {}) {
    const key = buildKey(input);
    if (!key) {
      throw new Error("A video id or URL is required.");
    }

    const store = await loadStore();
    const next = upsertRecord(store.records[key], input);
    store.records[key] = next;
    await saveStore(store);
    return {
      ok: true,
      record: normalizeRecord(next),
      analysis: analyzeVideo(
        next,
        next,
        buildLearningProfile(
          store.records,
          next.channelUrl || "",
          getMergedPreferences(store.preferences, next.channelUrl || "")
        )
      )
    };
  }

  async function listHistory({ channelUrl = "", limit = 30 } = {}) {
    const store = await loadStore();
    return {
      ok: true,
      history: buildHistoryList(store.records, { channelUrl, limit })
    };
  }

  async function getPreferences({ channelUrl = "" } = {}) {
    const store = await loadStore();
    return {
      ok: true,
      preferences: getMergedPreferences(store.preferences, channelUrl)
    };
  }

  async function updatePreferences({
    channelUrl = "",
    lengthPreference,
    stylePreference,
    preferredTopics,
    avoidedTopics
  } = {}) {
    const store = await loadStore();
    const normalized = normalizePreferences({
      lengthPreference,
      stylePreference,
      preferredTopics,
      avoidedTopics
    });
    if (!store.preferences || typeof store.preferences !== "object") {
      store.preferences = { global: {}, channels: {} };
    }
    if (!store.preferences.channels || typeof store.preferences.channels !== "object") {
      store.preferences.channels = {};
    }

    if (channelUrl) {
      store.preferences.channels[channelUrl] = {
        ...(store.preferences.channels[channelUrl] || {}),
        ...normalized
      };
    } else {
      store.preferences.global = {
        ...(store.preferences.global || {}),
        ...normalized
      };
    }

    await saveStore(store);
    return {
      ok: true,
      preferences: getMergedPreferences(store.preferences, channelUrl)
    };
  }

  async function markQueued(item = {}) {
    return updateRecord({
      ...item,
      status: "queued",
      queuedIncrement: 1
    });
  }

  async function markDownloaded(item = {}) {
    return updateRecord({
      ...item,
      status: "downloaded",
      downloadIncrement: 1
    });
  }

  async function markFailed(item = {}, errorMessage = "") {
    return updateRecord({
      ...item,
      status: "queued",
      lastError: String(errorMessage || ""),
      keepStatusIfFurtherAlong: true
    });
  }
}

function buildKey(item = {}) {
  const id = String(item.id || "").trim();
  if (id) return `yt:${id}`;
  const url = String(item.url || "").trim();
  if (url) return `url:${url}`;
  return "";
}

function upsertRecord(existing, input) {
  const now = new Date().toISOString();
  const next = {
    key: buildKey(input) || existing?.key || "",
    id: pick(input.id, existing?.id),
    url: pick(input.url, existing?.url),
    title: pick(input.title, existing?.title),
    channelName: pick(input.channelName, existing?.channelName),
    channelUrl: pick(input.channelUrl, existing?.channelUrl),
    duration: toNumber(pick(input.duration, existing?.duration), 0),
    uploadDate: pick(input.uploadDate, existing?.uploadDate),
    thumbnail: pick(input.thumbnail, existing?.thumbnail),
    status: normalizeStatus(existing?.status || "new"),
    note: pickDefined(input.note, existing?.note || ""),
    rating: toNumber(pickDefined(input.rating, existing?.rating), 0),
    queueCount: toNumber(existing?.queueCount, 0),
    downloadCount: toNumber(existing?.downloadCount, 0),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastQueuedAt: existing?.lastQueuedAt || "",
    lastDownloadedAt: existing?.lastDownloadedAt || "",
    lastStartedAt: existing?.lastStartedAt || "",
    lastCompletedAt: existing?.lastCompletedAt || "",
    lastSkippedAt: existing?.lastSkippedAt || "",
    lastError: pickDefined(input.lastError, existing?.lastError || ""),
    aiInsight: input.aiInsight !== undefined
      ? normalizeAiInsight(input.aiInsight)
      : normalizeAiInsight(existing?.aiInsight)
  };

  if (input.status) {
    const requestedStatus = normalizeStatus(input.status);
    if (!input.keepStatusIfFurtherAlong || statusRank(requestedStatus) >= statusRank(next.status)) {
      next.status = requestedStatus;
    }
  }

  if (toNumber(input.queuedIncrement, 0) > 0) {
    next.queueCount += toNumber(input.queuedIncrement, 0);
    next.lastQueuedAt = now;
    if (statusRank(next.status) < statusRank("queued")) next.status = "queued";
  }

  if (toNumber(input.downloadIncrement, 0) > 0) {
    next.downloadCount += toNumber(input.downloadIncrement, 0);
    next.lastDownloadedAt = now;
    if (statusRank(next.status) < statusRank("downloaded")) next.status = "downloaded";
  }

  if (input.status === "in_progress") {
    next.lastStartedAt = now;
  }
  if (input.status === "completed") {
    next.lastCompletedAt = now;
  }
  if (input.status === "skipped") {
    next.lastSkippedAt = now;
  }
  if (input.status === "new") {
    next.lastError = "";
  }

  return next;
}

function normalizeRecord(record) {
  if (!record) {
    return {
      status: "new",
      note: "",
      rating: 0,
      queueCount: 0,
      downloadCount: 0,
      lastQueuedAt: "",
      lastDownloadedAt: "",
      lastStartedAt: "",
      lastCompletedAt: "",
      lastSkippedAt: "",
      updatedAt: "",
      aiInsight: null,
      hasHistory: false
    };
  }

  return {
    key: record.key || "",
    status: normalizeStatus(record.status || "new"),
    note: record.note || "",
    rating: toNumber(record.rating, 0),
    queueCount: toNumber(record.queueCount, 0),
    downloadCount: toNumber(record.downloadCount, 0),
    lastQueuedAt: record.lastQueuedAt || "",
    lastDownloadedAt: record.lastDownloadedAt || "",
    lastStartedAt: record.lastStartedAt || "",
    lastCompletedAt: record.lastCompletedAt || "",
    lastSkippedAt: record.lastSkippedAt || "",
    updatedAt: record.updatedAt || "",
    aiInsight: normalizeAiInsight(record.aiInsight),
    hasHistory: true
  };
}

function normalizeAiInsight(value) {
  if (!value || typeof value !== "object") return null;
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
    : [];
  return {
    summary: localizeEnglishText(String(value.summary || "").trim()),
    recommendation: localizeRecommendation(String(value.recommendation || "").trim()),
    score: clampNumber(value.score, 0, 100, 50),
    confidence: clampNumber(value.confidence, 0, 100, 50),
    timeWorth: ["high", "medium", "low"].includes(String(value.timeWorth || "").toLowerCase())
      ? String(value.timeWorth).toLowerCase()
      : "medium",
    bestFor: localizeEnglishText(String(value.bestFor || "").trim()),
    skipIf: localizeEnglishText(String(value.skipIf || "").trim()),
    reasons: reasons.map(localizeEnglishText),
    nextAction: String(value.nextAction || "").trim(),
    model: String(value.model || "").trim(),
    updatedAt: String(value.updatedAt || "").trim()
  };
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function analyzeVideo(video = {}, record = null, learningProfile = null) {
  const reasons = [];
  let score = 50;
  const breakdown = [{ label: "基础分", delta: 50 }];
  const title = String(video.title || "").trim();
  const lowerTitle = title.toLowerCase();
  const duration = toNumber(video.duration, 0);
  const ageDays = getAgeDays(video.uploadDate);

  if (ageDays >= 0) {
    if (ageDays <= 2) {
      score += 12;
      reasons.push("刚发布，时效性高");
      breakdown.push({ label: "新近发布", delta: 12 });
    } else if (ageDays <= 7) {
      score += 7;
      reasons.push("近期发布");
      breakdown.push({ label: "近期发布", delta: 7 });
    } else if (ageDays > 45) {
      score -= 6;
      reasons.push("内容较旧");
      breakdown.push({ label: "发布时间较久", delta: -6 });
    }
  }

  if (duration > 0) {
    if (duration <= 900) {
      score += 9;
      reasons.push("时长短，容易快速看完");
      breakdown.push({ label: "观看成本低", delta: 9 });
    } else if (duration <= 2400) {
      score += 4;
      reasons.push("时长适中");
      breakdown.push({ label: "时长适中", delta: 4 });
    } else if (duration >= 5400) {
      score -= 10;
      reasons.push("耗时较高");
      breakdown.push({ label: "时间投入较大", delta: -10 });
    } else if (duration >= 3600) {
      score -= 5;
      reasons.push("时长偏长");
      breakdown.push({ label: "时长偏长", delta: -5 });
    }
  }

  const strongSignals = ["review", "guide", "explained", "tutorial", "walkthrough", "tips", "best", "update", "news", "summary"];
  const weakSignals = ["live", "stream", "podcast", "mix", "sleep", "asmr", "reaction", "q&a"];

  const strongMatch = strongSignals.find((token) => lowerTitle.includes(token));
  const weakMatch = weakSignals.find((token) => lowerTitle.includes(token));

  if (strongMatch) {
    score += 10;
    reasons.push("标题像是信息密度较高的内容");
    breakdown.push({ label: `标题信息信号：${strongMatch}`, delta: 10 });
  }
  if (weakMatch) {
    score -= 8;
    reasons.push("标题更像陪伴型或低信息密度内容");
    breakdown.push({ label: `低信息信号标题：${weakMatch}`, delta: -8 });
  }

  const preferenceAdjustment = applyPreferenceAdjustment({ title: lowerTitle, duration }, learningProfile?.preferences || {});
  if (preferenceAdjustment.scoreDelta !== 0) {
    score += preferenceAdjustment.scoreDelta;
    if (preferenceAdjustment.reason) {
      reasons.push(preferenceAdjustment.reason);
    }
    breakdown.push(...preferenceAdjustment.breakdown);
  }

  const learningAdjustment = applyLearningAdjustment({ title: lowerTitle, duration }, learningProfile);
  if (learningAdjustment.scoreDelta !== 0) {
    score += learningAdjustment.scoreDelta;
    if (learningAdjustment.reason) {
      reasons.push(learningAdjustment.reason);
    }
    breakdown.push(...learningAdjustment.breakdown);
  }

  if (record?.status === "completed") {
    score -= 25;
    reasons.push("你已经处理完成");
    breakdown.push({ label: "已完成", delta: -25 });
  } else if (record?.status === "downloaded" || record?.status === "in_progress") {
    score += 3;
    reasons.push("已经进入你的处理流程");
    breakdown.push({ label: "已在处理流程中", delta: 3 });
  } else if (record?.status === "review_later") {
    score -= 6;
    reasons.push("你已暂存到稍后再看");
    breakdown.push({ label: "已暂存稍后再看", delta: -6 });
  } else if (record?.status === "skipped") {
    score -= 12;
    reasons.push("你之前跳过过");
    breakdown.push({ label: "此前已跳过", delta: -12 });
  }

  score = Math.max(5, Math.min(95, score));

  let recommendation = "可选";
  if (record?.status === "completed") {
    recommendation = "已完成";
  } else if (score >= 72) {
    recommendation = "高价值";
  } else if (score >= 58) {
    recommendation = "值得一看";
  } else if (score >= 42) {
    recommendation = "可选";
  } else {
    recommendation = "优先级较低";
  }

  const summaryParts = [];
  if (duration > 0) summaryParts.push(formatDuration(duration));
  if (ageDays >= 0) summaryParts.push(formatFreshness(ageDays));
  if (record?.downloadCount) summaryParts.push(`已下载 ${record.downloadCount} 次`);

  const summary = summaryParts.length
    ? `${recommendation}。${summaryParts.join("，")}。`
    : `${recommendation}。目前仅基于元数据估计。`;

  const confidence = computeConfidence({
    ageDays,
    duration,
    breakdown,
    hasHistory: !!record,
    hasPreferences: !!(
      learningProfile?.preferences?.lengthPreference && learningProfile.preferences.lengthPreference !== "any"
      || learningProfile?.preferences?.stylePreference && learningProfile.preferences.stylePreference !== "any"
      || (learningProfile?.preferences?.preferredTopics || []).length
      || (learningProfile?.preferences?.avoidedTopics || []).length
    ),
    hasLearnedSignals: !!(
      learningProfile
      && ((learningProfile.strongTokens && learningProfile.strongTokens.size > 0)
      || (learningProfile.weakTokens && learningProfile.weakTokens.size > 0)
      || learningProfile.prefersShort
      || learningProfile.prefersLong)
    )
  });

  return {
    score,
    confidence: confidence.value,
    confidenceLabel: confidence.label,
    confidenceSummary: confidence.summary,
    recommendation,
    summary,
    reasons: reasons.slice(0, 3),
    breakdown,
    timeLabel: duration > 0 ? formatDuration(duration) : "时长未知",
    freshnessLabel: ageDays >= 0 ? formatFreshness(ageDays) : "发布日期未知",
    method: (learningAdjustment.scoreDelta !== 0 || preferenceAdjustment.scoreDelta !== 0) ? "metadata+history" : "metadata"
  };
}

function buildHistoryList(records, { channelUrl = "", limit = 30 } = {}) {
  return Object.values(records)
    .filter((record) => {
      if (!record) return false;
      if (channelUrl && record.channelUrl !== channelUrl) return false;
      return !!(record.downloadCount || record.queueCount || record.status !== "new" || record.note);
    })
    .sort((a, b) => getRecordSortTime(b) - getRecordSortTime(a))
    .slice(0, Math.max(1, Number(limit) || 30))
    .map((record) => ({
      key: record.key,
      title: record.title || record.url || "(untitled)",
      url: record.url || "",
      channelName: record.channelName || "",
      status: normalizeStatus(record.status || "new"),
      note: record.note || "",
      rating: toNumber(record.rating, 0),
      queueCount: toNumber(record.queueCount, 0),
      downloadCount: toNumber(record.downloadCount, 0),
      lastQueuedAt: record.lastQueuedAt || "",
      lastDownloadedAt: record.lastDownloadedAt || "",
      lastStartedAt: record.lastStartedAt || "",
      lastCompletedAt: record.lastCompletedAt || "",
      lastSkippedAt: record.lastSkippedAt || "",
      updatedAt: record.updatedAt || "",
      analysis: analyzeVideo(
        record,
        record,
        buildLearningProfile(records, channelUrl, getMergedPreferences({ global: {}, channels: {} }, channelUrl))
      )
    }));
}

function buildLearningProfile(records, channelUrl = "", preferences = {}) {
  const profile = {
    strongTokens: new Map(),
    weakTokens: new Map(),
    prefersShort: 0,
    prefersLong: 0,
    preferences: normalizePreferences(preferences)
  };

  for (const record of Object.values(records)) {
    if (!record) continue;
    if (channelUrl && record.channelUrl && record.channelUrl !== channelUrl) continue;

    const title = String(record.title || "").toLowerCase();
    const tokens = extractMeaningfulTokens(title);
    const rating = toNumber(record.rating, 0);
    const status = normalizeStatus(record.status || "new");
    const duration = toNumber(record.duration, 0);

    const positive = status === "completed" || rating >= 4;
    const negative = status === "skipped" || rating <= 2;

    if (positive) {
      for (const token of tokens) {
        profile.strongTokens.set(token, (profile.strongTokens.get(token) || 0) + 1);
      }
      if (duration > 0 && duration <= 1800) profile.prefersShort += 1;
      if (duration >= 3600) profile.prefersLong += 1;
    }

    if (negative) {
      for (const token of tokens) {
        profile.weakTokens.set(token, (profile.weakTokens.get(token) || 0) + 1);
      }
      if (duration > 0 && duration <= 1800) profile.prefersShort -= 1;
      if (duration >= 3600) profile.prefersLong -= 1;
    }
  }

  return profile;
}

function getMergedPreferences(preferences, channelUrl = "") {
  const global = normalizePreferences(preferences?.global || {});
  const channel = channelUrl ? normalizePreferences(preferences?.channels?.[channelUrl] || {}) : {};
  return {
    ...global,
    ...channel
  };
}

function normalizePreferences(input = {}) {
  const lengthPreference = ["any", "short", "medium", "long"].includes(String(input.lengthPreference || ""))
    ? String(input.lengthPreference)
    : "any";
  const stylePreference = ["any", "informational", "ambient"].includes(String(input.stylePreference || ""))
    ? String(input.stylePreference)
    : "any";
  const preferredTopics = normalizeTopicList(input.preferredTopics);
  const avoidedTopics = normalizeTopicList(input.avoidedTopics);
  return { lengthPreference, stylePreference, preferredTopics, avoidedTopics };
}

function applyPreferenceAdjustment(video, preferences) {
  let scoreDelta = 0;
  let reason = "";
  const breakdown = [];
  const title = String(video.title || "");
  const duration = Number(video.duration || 0);
  const titleTokens = extractMeaningfulTokens(title);

  if (preferences.lengthPreference === "short") {
    if (duration > 0 && duration <= 1200) {
      scoreDelta += 8;
      reason = "符合你偏好的短内容";
      breakdown.push({ label: "偏好匹配：短内容", delta: 8 });
    } else if (duration >= 3600) {
      scoreDelta -= 6;
      reason = "时长偏长，不符合你的偏好";
      breakdown.push({ label: "偏好冲突：短内容", delta: -6 });
    }
  } else if (preferences.lengthPreference === "medium") {
    if (duration >= 900 && duration <= 2700) {
      scoreDelta += 6;
      reason = "符合你偏好的中等时长";
      breakdown.push({ label: "偏好匹配：中等时长", delta: 6 });
    }
  } else if (preferences.lengthPreference === "long") {
    if (duration >= 3600) {
      scoreDelta += 6;
      reason = "符合你偏好的长内容";
      breakdown.push({ label: "偏好匹配：长内容", delta: 6 });
    }
  }

  const informationalTokens = ["review", "guide", "explained", "tutorial", "walkthrough", "tips", "update", "news", "summary"];
  const ambientTokens = ["live", "stream", "podcast", "mix", "sleep", "asmr", "reaction", "beats"];

  if (preferences.stylePreference === "informational") {
    const infoMatch = informationalTokens.find((token) => title.includes(token));
    const ambientConflict = ambientTokens.find((token) => title.includes(token));
    if (infoMatch) {
      scoreDelta += 8;
      reason = reason || "符合你偏好的信息型内容";
      breakdown.push({ label: `风格匹配：信息型（${infoMatch}）`, delta: 8 });
    }
    if (ambientConflict) {
      scoreDelta -= 6;
      reason = reason || "与您偏好的内容风格不太一致";
      breakdown.push({ label: `风格冲突：陪伴型（${ambientConflict}）`, delta: -6 });
    }
  } else if (preferences.stylePreference === "ambient") {
    const ambientMatch = ambientTokens.find((token) => title.includes(token));
    const infoConflict = informationalTokens.find((token) => title.includes(token));
    if (ambientMatch) {
      scoreDelta += 8;
      reason = reason || "符合你偏好的陪伴型或聊天型内容";
      breakdown.push({ label: `风格匹配：陪伴型（${ambientMatch}）`, delta: 8 });
    }
    if (infoConflict) {
      scoreDelta -= 4;
      reason = reason || "比你设定的偏好更偏信息型";
      breakdown.push({ label: `风格冲突：信息型（${infoConflict}）`, delta: -4 });
    }
  }

  const preferredHits = (preferences.preferredTopics || []).filter((topic) => titleTokens.includes(topic) || title.includes(topic));
  const avoidedHits = (preferences.avoidedTopics || []).filter((topic) => titleTokens.includes(topic) || title.includes(topic));
  if (preferredHits.length > 0) {
    const preferredDelta = Math.min(10, preferredHits.length * 4);
    scoreDelta += preferredDelta;
    reason = reason || "命中了你明确偏好的主题";
    breakdown.push({ label: `命中偏好主题：${preferredHits.slice(0, 2).join(", ")}`, delta: preferredDelta });
  }
  if (avoidedHits.length > 0) {
    const avoidedDelta = Math.min(12, avoidedHits.length * 5);
    scoreDelta -= avoidedDelta;
    reason = avoidedHits.length >= preferredHits.length
      ? "命中了你希望避开的主题"
      : reason;
    breakdown.push({ label: `命中避开主题：${avoidedHits.slice(0, 2).join(", ")}`, delta: -avoidedDelta });
  }

  return { scoreDelta, reason, breakdown };
}

function normalizeTopicList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function applyLearningAdjustment(video, profile) {
  if (!profile) {
    return { scoreDelta: 0, reason: "", breakdown: [] };
  }

  let scoreDelta = 0;
  let reason = "";
  const tokens = extractMeaningfulTokens(video.title || "");
  const breakdown = [];

  const positiveMatches = [];
  const negativeMatches = [];

  for (const token of tokens) {
    if ((profile.strongTokens.get(token) || 0) > 0) positiveMatches.push(token);
    if ((profile.weakTokens.get(token) || 0) > 0) negativeMatches.push(token);
  }

  if (positiveMatches.length > 0) {
    const positiveDelta = Math.min(12, positiveMatches.length * 3);
    scoreDelta += positiveDelta;
    reason = "和你完成过或高评分的内容相似";
    breakdown.push({ label: `历史匹配：你偏好的主题（${positiveMatches.slice(0, 2).join(", ")})`, delta: positiveDelta });
  }
  if (negativeMatches.length > 0) {
    const negativeDelta = Math.min(12, negativeMatches.length * 3);
    scoreDelta -= negativeDelta;
    reason = negativeMatches.length > positiveMatches.length
      ? "和你常跳过或低评分的内容相似"
      : reason;
    breakdown.push({ label: `历史冲突：你常跳过的主题（${negativeMatches.slice(0, 2).join(", ")})`, delta: -negativeDelta });
  }

  if (video.duration > 0 && video.duration <= 1800 && profile.prefersShort >= 2) {
    scoreDelta += 4;
    reason = reason || "符合你最近更常看完短内容的习惯";
    breakdown.push({ label: "历史匹配：你更容易看完短内容", delta: 4 });
  }
  if (video.duration >= 3600 && profile.prefersLong <= -2) {
    scoreDelta -= 4;
    reason = reason || "较长时长不符合你最近的完成习惯";
    breakdown.push({ label: "历史冲突：长内容更难看完", delta: -4 });
  }

  return { scoreDelta, reason, breakdown };
}

function computeConfidence({
  ageDays,
  duration,
  breakdown,
  hasHistory,
  hasPreferences,
  hasLearnedSignals
}) {
  let value = 20;

  if (ageDays >= 0) value += 18;
  if (duration > 0) value += 18;
  if (Array.isArray(breakdown)) value += Math.min(24, Math.max(0, breakdown.length - 1) * 4);
  if (hasPreferences) value += 10;
  if (hasLearnedSignals) value += 14;
  if (hasHistory) value += 8;

  value = Math.max(15, Math.min(95, value));

  if (value >= 78) {
    return {
      value,
      label: "高把握",
      summary: "这条判断有多项明确信号支持。"
    };
  }
  if (value >= 56) {
    return {
      value,
      label: "中等把握",
      summary: "这条判断已有一些有效信号，但还不算非常个性化。"
    };
  }
  return {
    value,
    label: "低把握",
    summary: "当前主要基于有限元数据或少量历史记录估计。"
  };
}

function extractMeaningfulTokens(title) {
  const stopWords = new Set(["the", "and", "for", "with", "from", "that", "this", "your", "about", "into", "after", "before", "when", "what", "how"]);
  return String(title || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token))
    .slice(0, 12);
}

function getRecordSortTime(record) {
  const candidates = [
    record.updatedAt,
    record.lastCompletedAt,
    record.lastDownloadedAt,
    record.lastQueuedAt,
    record.createdAt
  ].map((value) => Date.parse(value || "") || 0);

  return Math.max(...candidates, 0);
}

function normalizeStatus(status) {
  const value = String(status || "new").trim().toLowerCase();
  if (["new", "queued", "downloaded", "in_progress", "completed", "review_later", "skipped"].includes(value)) {
    return value;
  }
  return "new";
}

function statusRank(status) {
  switch (normalizeStatus(status)) {
    case "queued":
      return 1;
    case "downloaded":
      return 2;
    case "in_progress":
      return 3;
    case "completed":
      return 4;
    case "review_later":
      return 1;
    case "skipped":
      return 1;
    default:
      return 0;
  }
}

function getAgeDays(uploadDate) {
  const value = String(uploadDate || "").trim();
  if (!/^\d{8}$/.test(value)) return -1;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(date.getTime())) return -1;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function formatFreshness(ageDays) {
  if (ageDays <= 0) return "今天";
  if (ageDays === 1) return "1 天前";
  if (ageDays <= 7) return `${ageDays} 天前`;
  if (ageDays <= 30) return `${Math.round(ageDays / 7)} 周前`;
  return `${Math.round(ageDays / 30)} 个月前`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${total} 秒`;
}

function localizeRecommendation(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "recommend now":
    case "watch now":
    case "建议现在看":
      return "建议现在看";
    case "worth a look":
    case "worth trying":
    case "high value":
    case "值得一试":
    case "值得一看":
      return "值得一试";
    case "optional":
    case "maybe":
    case "可选":
      return "可选";
    case "low priority":
    case "skip for now":
    case "暂时跳过":
      return "暂时跳过";
    case "done":
    case "已完成":
      return "已完成";
    default:
      return String(value || "").trim();
  }
}

function localizeEnglishText(value) {
  return String(value || "")
    .replace(/Metadata is limited, but/gi, "当前元数据有限，但")
    .replace(/metadata is limited, but/gi, "当前元数据有限，但")
    .replace(/the title suggests/gi, "标题看起来像是")
    .replace(/an AI\/agent-focused discussion about/gi, "一条围绕以下主题的 AI/Agent 讨论：")
    .replace(/and product architecture/gi, "以及产品架构")
    .replace(/With no upload date, transcript, or user preferences, this is only a moderate-confidence pick\./gi, "由于缺少发布日期、字幕或用户偏好，这只是一个中等把握的判断。")
    .replace(/No metadata to confirm depth, quality, or exact scope/gi, "缺少足够元数据来确认内容深度、质量或准确范围")
    .replace(/Topic appears relevant to/gi, "主题看起来与以下方向相关：")
    .replace(/Short runtime at about/gi, "时长较短，大约")
    .replace(/quick to consume/gi, "观看成本低")
    .replace(/manageable runtime/gi, "时长适中")
    .replace(/fresh upload/gi, "新近发布")
    .replace(/recent upload/gi, "近期发布")
    .replace(/older item/gi, "内容较旧")
    .replace(/high time commitment/gi, "耗时较高")
    .replace(/long runtime/gi, "时长偏长")
    .replace(/already completed/gi, "你已经完成")
    .replace(/already in your workflow/gi, "已经进入你的处理流程")
    .replace(/saved for later review/gi, "已保存到稍后再看")
    .replace(/previously skipped/gi, "你之前跳过过")
    .replace(/Metadata-based estimate only\./gi, "目前仅基于元数据估计。")
    .trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(nextValue, previousValue) {
  return String(nextValue || "").trim() ? nextValue : (previousValue || "");
}

function pickDefined(nextValue, previousValue) {
  return nextValue === undefined ? previousValue : nextValue;
}

module.exports = {
  createContentTracker
};
