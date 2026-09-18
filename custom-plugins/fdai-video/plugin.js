const SUPPORTED_ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];

export const meta = {
  apiVersion: 1,
  key: "fdai-video",
  name: "FDAI Video",
  icon: "text:FD",
  description: {
    en: "Video generation through the FDAI task API",
    zh: "通过 FDAI 任务接口生成视频",
  },
  version: "1.2.0",
  author: { name: "Duomi API" },
  baseUrl: "https://api.fdai.xyz",
  models: ["sd2.0_mini-720p-zr-903-12s", "sd2.0_mini-480p-zr-903-15s"],
  modelScope: "channel",
  fetchMode: "per_task",
  protocols: ["openai_video"],
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
    aspect_ratio: {
      enum: SUPPORTED_ASPECT_RATIOS,
      description: { en: "Output video aspect ratio", zh: "输出视频宽高比" },
    },
  },
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHTTPURL(value) {
  return /^https?:\/\/[^\s]+$/i.test(trimmed(value));
}

function upstreamError(body) {
  if (!isObject(body) || !isObject(body.error)) return "";
  const code = trimmed(body.error.code);
  const message = trimmed(body.error.message) || "upstream request failed";
  return code ? code + ": " + message : message;
}

function mappedAspectRatio(size) {
  const ratios = {
    "1920x1080": "16:9",
    "1280x720": "16:9",
    "1080x1920": "9:16",
    "720x1280": "9:16",
    "1024x1024": "1:1",
    "720x720": "1:1",
    "1440x1080": "4:3",
    "960x720": "4:3",
    "1080x1440": "3:4",
    "720x960": "3:4",
  };
  return ratios[trimmed(size).toLowerCase()] || "";
}

function normalizedImages(req) {
  const values = [];
  if (Array.isArray(req.images)) values.push(...req.images);
  else if (req.images !== undefined) throw new Error("images must be an array");
  if (req.input_reference !== undefined) {
    if (typeof req.input_reference !== "string") throw new Error("input_reference must be a string");
    values.push(...req.input_reference.split("|"));
  } else if (req.image !== undefined) values.push(req.image);
  if (values.length > 15) throw new Error("images must contain at most 15 media URLs");
  return values.map(function (value) {
    const url = trimmed(value);
    if (!isHTTPURL(url)) throw new Error("each images item must be an HTTP or HTTPS URL");
    return url;
  });
}

function usesV1Submit(model) {
  const name = trimmed(model).toLowerCase();
  return name.includes("veo") || name.includes("omni");
}

function normalizeRequest(req, model) {
  const prompt = trimmed(req.prompt);
  if (!prompt) throw new Error("field prompt is required");

  const rawDuration = req.duration === undefined ? (req.seconds === undefined ? 5 : req.seconds) : req.duration;
  const duration = Number(rawDuration);
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw new Error("duration must be an integer between 4 and 15");

  const aspectRatio = trimmed(req.aspect_ratio) || mappedAspectRatio(req.size) || "16:9";
  if (!SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) throw new Error("aspect_ratio is not supported");

  const body = {
    model: model,
    prompt: prompt,
    duration: duration,
    aspect_ratio: aspectRatio,
  };
  const images = normalizedImages(req);
  if (images.length) body.images = images;
  return body;
}

function statusOf(value) {
  const status = trimmed(value).toLowerCase();
  const statuses = {
    pending: "QUEUED",
    queued: "QUEUED",
    submitted: "QUEUED",
    waiting: "QUEUED",
    processing: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    running: "IN_PROGRESS",
    generating: "IN_PROGRESS",
    completed: "SUCCESS",
    succeeded: "SUCCESS",
    success: "SUCCESS",
    finished: "SUCCESS",
    done: "SUCCESS",
    failed: "FAILURE",
    failure: "FAILURE",
    cancelled: "FAILURE",
    canceled: "FAILURE",
    error: "FAILURE",
  };
  return statuses[status] || "UNKNOWN";
}

function findVideoURL(value, depth) {
  if (!isObject(value) || depth > 6) return "";
  for (const key of ["video_url", "videoUrl", "download_url", "downloadUrl", "output_url", "outputUrl", "content_url", "contentUrl"]) {
    if (isHTTPURL(value[key])) return trimmed(value[key]);
  }
  if (isHTTPURL(value.url)) return trimmed(value.url);
  for (const key of ["video", "data", "output", "result", "videos", "results", "outputs", "items"]) {
    const child = value[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const url = findVideoURL(item, depth + 1);
        if (url) return url;
      }
      continue;
    }
    const url = findVideoURL(child, depth + 1);
    if (url) return url;
  }
  return "";
}

function artifactData(ctx) {
  const data = (ctx && ctx.data) || {};
  if (isObject(data.data) && data.data.task_id && Object.prototype.hasOwnProperty.call(data.data, "data")) return data.data.data || {};
  return data;
}

function artifactVideoURL(ctx) {
  return findVideoURL(artifactData(ctx), 0);
}

export function buildSubmitRequest(ctx) {
  const body = normalizeRequest(ctx.requestBody || {}, ctx.upstreamModel || ctx.model);
  const upstreamBody = usesV1Submit(body.model)
    ? {
        model: body.model,
        prompt: body.prompt,
        input_reference: (body.images || []).join("|"),
        size: body.aspect_ratio,
      }
    : body;
  return {
    url: ctx.baseUrl + "/v1/videos",
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: upstreamBody,
  };
}

export function parseSubmitResponse(_ctx, resp) {
  const body = resp.body;
  const error = upstreamError(body);
  if (error) throw new Error(error);
  if (!isObject(body)) throw new Error("upstream response must be a JSON object");
  const taskId = trimmed(body.task_id) || trimmed(body.id);
  if (!taskId) throw new Error("upstream response is missing task_id");
  return { taskId: taskId, taskData: body };
}

export function extractUsage(ctx) {
  const req = ctx.requestBody || {};
  return {
    seconds: Number(req.duration),
    aspect_ratio: req.aspect_ratio,
  };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + ctx.apiKey },
  };
}

export function parseTaskResult(_ctx, body) {
  const error = upstreamError(body);
  if (error) return { status: "FAILURE", progress: "100%", reason: error };
  if (!isObject(body)) return { status: "UNKNOWN", reason: "upstream response must be a JSON object" };

  let status = statusOf(body.status || body.state);
  if (status === "UNKNOWN" && findVideoURL(body, 0)) status = "SUCCESS";
  const result = { status: status };
  const progress = Number(body.progress);
  if (Number.isFinite(progress) && progress >= 0 && progress <= 100) result.progress = progress + "%";
  else if (status === "SUCCESS" || status === "FAILURE") result.progress = "100%";
  if (status === "FAILURE") {
    result.reason = trimmed(body.message) || trimmed(body.reason) || trimmed(body.error_message) || "video generation failed";
  } else if (status === "UNKNOWN") {
    result.reason = "unrecognized task status: " + String(body.status || body.state || "");
  }
  return result;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const remoteURL = artifactVideoURL(ctx);
  if (remoteURL) return { url: remoteURL, method: ctx.clientRequest.method, credentialless: true };
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method,
    headers: { Authorization: "Bearer " + ctx.apiKey },
  };
}

export function buildPerformanceRequest(ctx) {
  const requestedHours = Number(ctx.hours);
  const hours = Number.isInteger(requestedHours) && requestedHours > 0 ? requestedHours : 24;
  return {
    url: ctx.baseUrl + "/api/perf-metrics/summary?hours=" + encodeURIComponent(String(hours)),
    method: "GET",
    headers: { Accept: "application/json" },
  };
}

export function parsePerformanceResponse(_ctx, body, response) {
  if (!response || response.status < 200 || response.status >= 300) {
    throw new Error("performance metrics request failed with HTTP " + String((response && response.status) || 0));
  }
  if (!isObject(body) || body.success === false || !isObject(body.data) || !Array.isArray(body.data.models)) {
    throw new Error("upstream performance response is invalid");
  }
  return body.data.models.map(function (item) {
    if (!isObject(item)) throw new Error("upstream performance model is invalid");
    const modelName = trimmed(item.model_name);
    const avgLatencyMs = Number(item.avg_latency_ms);
    const successRate = Number(item.success_rate);
    const avgTps = item.avg_tps === undefined ? 0 : Number(item.avg_tps);
    if (!modelName || !Number.isFinite(avgLatencyMs) || avgLatencyMs < 0 ||
        !Number.isFinite(successRate) || successRate < 0 || successRate > 100 ||
        !Number.isFinite(avgTps) || avgTps < 0) {
      throw new Error("upstream performance model is invalid");
    }
    const periods = Array.isArray(item.recent_periods) ? item.recent_periods : [];
    const recentIntervals = [];
    for (const period of periods) {
      if (!isObject(period)) continue;
      const ts = Number(period.ts);
      const periodLatency = Number(period.avg_latency_ms);
      const periodSuccessRate = Number(period.success_rate);
      const periodTps = period.avg_tps === undefined ? 0 : Number(period.avg_tps);
      const requestCount = period.request_count === undefined ? 0 : Number(period.request_count);
      if (!Number.isInteger(ts) || ts <= 0 || !Number.isFinite(periodLatency) || periodLatency < 0 ||
          !Number.isFinite(periodSuccessRate) || periodSuccessRate < 0 || periodSuccessRate > 100 ||
          !Number.isFinite(periodTps) || periodTps < 0 || !Number.isInteger(requestCount) || requestCount < 0) {
        continue;
      }
      recentIntervals.push({
        ts: ts,
        avgLatencyMs: Math.round(periodLatency),
        successRate: periodSuccessRate,
        avgTps: periodTps,
        requestCount: requestCount,
      });
    }
    return {
      modelName: modelName,
      avgLatencyMs: Math.round(avgLatencyMs),
      successRate: successRate,
      avgTps: avgTps,
      recentIntervals: recentIntervals,
    };
  });
}

export const protocols = {
  openai_video: {
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!isObject(req)) throw new Error("JSON object required");
      const model = trimmed(ctx.model) || trimmed(req.model);
      if (!model) throw new Error("model is required");
      const requestBody = normalizeRequest(req, model);
      return {
        kind: "submit",
        model: model,
        action: requestBody.images && requestBody.images.length ? "image_to_video" : "text_to_video",
        requestBody: requestBody,
      };
    },
    render: function (_ctx, task) {
      const statuses = {
        NOT_START: "queued",
        SUBMITTED: "queued",
        QUEUED: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      };
      const output = {
        id: task.task_id,
        object: "video",
        model: (task.properties || {}).origin_model_name || "",
        status: statuses[task.status] || "unknown",
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: Number(task.created_at || 0),
      };
      const completedAt = Number(task.finished_at || task.updated_at || 0);
      if (completedAt > 0) output.completed_at = completedAt;
      if (task.status === "FAILURE") {
        output.error = { code: "video_generation_failed", message: task.fail_reason || "The video generation task failed." };
      }
      return output;
    },
  },
};
