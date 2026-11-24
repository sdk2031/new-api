// The host also validates this billing quantity (MaxTaskDurationSeconds).
const MAX_DURATION_SECONDS = 3600;
const MEDIA_FIELDS = {
  input_reference: "images",
  images: "images",
  videos: "videos",
  audios: "audios",
};

export const meta = {
  apiVersion: 1,
  key: "foke-video",
  name: "Foke",
  version: "1.0.0",
  author: { name: "Duomi API" },
  icon: "text:FK",
  description: { en: "Video generation via Foke", zh: "通过 Foke 生成视频" },
  baseUrl: "https://ai.fanke2026.xyz",
  models: ["ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746"],
  modelScope: "channel",
  fetchMode: "per_task",
  protocols: ["openai_video"],
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
    tokens: {
      type: "number",
      unit: "token",
      description: { en: "Video generation token unit price", zh: "视频生成 Token 单价" },
    },
    has_video_reference: {
      type: "boolean",
      description: { en: "Reference video present", zh: "存在参考视频" },
    },
    token_settled: {
      type: "boolean",
      description: { en: "Token settlement complete", zh: "Token 结算已完成" },
    },
  },
  usageExamples: [
    { label: "10s", facts: { seconds: 10, tokens: 0, has_video_reference: false, token_settled: false } },
    { label: "10s · reference video", facts: { seconds: 10, tokens: 180000, has_video_reference: true, token_settled: true } },
  ],
};

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function httpsURL(value) {
  const url = text(value);
  return /^https:\/\/[^/\s?#@\\]+(?:[/?][^\s#\\]*)?$/i.test(url) ? url : "";
}

function urlList(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(name + " must be an array");
  return value.map(function (item) {
    const url = httpsURL(item);
    if (!url) throw new Error(name + " must contain public HTTPS URLs");
    return url;
  });
}

function decodeVideo(ctx) {
  const src = ctx.body || {};
  const form = src.kind === "multipart";
  if (src.kind !== "json" && !form) throw new Error("Foke requires JSON or multipart data");
  if (!form && !object(src.value)) throw new Error("Foke requires a JSON object");
  const req = form ? src.fields || {} : src.value;
  const field = (name) => form ? (req[name] || [])[0] : req[name];
  const model = text(ctx.model) || text(field("model"));
  const prompt = text(field("prompt"));
  if (!model || !prompt) throw new Error("model and prompt are required");

  const rawDuration = field("duration") ?? field("seconds");
  const duration = typeof rawDuration === "number" || /^\d+$/.test(text(rawDuration)) ? Number(rawDuration) : 0;
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_SECONDS) {
    throw new Error("duration or seconds must be a positive integer no greater than " + MAX_DURATION_SECONDS);
  }
  const ratio = text(field("ratio")) || text(field("aspect_ratio")) || text(field("size"));
  const resolution = text(field("resolution"));
  if (!/^\d+:\d+$/.test(ratio) || !resolution) {
    throw new Error("Foke requires ratio (for example 16:9) and resolution from the selected model's specifications");
  }

  const imageUrls = urlList(req.imageUrls, "imageUrls");
  const ref = field("input_reference");
  if (ref !== undefined) {
    imageUrls.push(...urlList([ref], "input_reference"));
  }
  const videoUrls = urlList(req.videoUrls, "videoUrls");
  const audioUrls = urlList(req.audioUrls, "audioUrls");
  const fileParts = [];
  const refs = new Set();
  for (const file of (form && src.files) || []) {
    if (!Object.prototype.hasOwnProperty.call(MEDIA_FIELDS, file.field)) {
      throw new Error("Use input_reference, images, videos or audios to upload reference media");
    }
    // The host resolves each opaque reference to the first file on that field.
    if (refs.has(file.ref)) throw new Error("Use HTTPS URLs for multiple references of the same file field");
    refs.add(file.ref);
    fileParts.push({ name: MEDIA_FIELDS[file.field], fileRef: file.ref });
  }
  if (fileParts.length && (imageUrls.length || videoUrls.length || audioUrls.length)) {
    throw new Error("Send reference files or HTTPS URLs, not both");
  }

  const requestBody = { prompt, duration, ratio, resolution, imageUrls, videoUrls, audioUrls, fileParts };
  const extend = field("prompt_extend");
  if (extend !== undefined) {
    if (extend === true || (form && extend === "true")) requestBody.prompt_extend = true;
    else if (extend === false || (form && extend === "false")) requestBody.prompt_extend = false;
    else throw new Error("prompt_extend must be a boolean");
  }
  const action = videoUrls.length || audioUrls.length || fileParts.some((part) => part.name !== "images")
    ? "reference_to_video"
    : imageUrls.length || fileParts.length ? "image_to_video" : "text_to_video";
  return { kind: "submit", model, action, requestBody };
}

function upstreamHeaders(ctx) {
  return {
    Authorization: "Bearer " + ctx.apiKey,
    Accept: "application/json",
    "X-Public-Model-Ids": "1",
  };
}

export function buildSubmitRequest(ctx) {
  const model = ctx.upstreamModel || ctx.model;
  if (!/^ft-video-v1-[a-zA-Z0-9_-]+$/.test(model)) throw new Error("Map the model to a Foke ft-video-v1 public model ID");

  const req = ctx.requestBody;
  const body = { model, prompt: req.prompt, ratio: req.ratio, duration: req.duration, resolution: req.resolution };
  if (req.prompt_extend !== undefined) body.prompt_extend = req.prompt_extend;
  const request = {
    url: ctx.baseUrl + "/api/open/v1/video/generate",
    method: "POST",
    headers: upstreamHeaders(ctx),
  };
  if (req.fileParts.length) {
    request.bodyType = "multipart";
    request.parts = Object.keys(body).map((name) => ({ name, value: body[name] })).concat(req.fileParts);
  } else {
    request.headers["Content-Type"] = "application/json";
    request.body = { ...body, imageUrls: req.imageUrls, videoUrls: req.videoUrls, audioUrls: req.audioUrls };
  }
  return request;
}

export function parseSubmitResponse(_ctx, response) {
  const body = response.body;
  const jobId = text(body && body.jobId);
  if (!object(body) || body.success !== true || !jobId) {
    throw new Error("Foke did not confirm a video job ID; check the upstream task list before resubmitting");
  }
  const result = parseTaskResult({}, body);
  const parsed = { taskId: jobId, taskData: { jobId } };
  if (result.status === "FAILURE" || result.status === "SUCCESS") {
    parsed.immediate = result;
    if (result.status === "SUCCESS") parsed.taskData = body;
  }
  return parsed;
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/api/open/v1/video/status?jobId=" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: upstreamHeaders(ctx),
  };
}

function videoURL(body) {
  return body ? httpsURL(body.videoUrl) || httpsURL(body.contentUrl) : "";
}

function settledTokens(billing) {
  if (!billing || billing.mode !== "token" || billing.settled !== true) return null;
  const raw = billing.usage && billing.usage.total_tokens;
  const tokens = typeof raw === "number" || /^\d+$/.test(text(raw)) ? Number(raw) : -1;
  return Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null;
}

export function parseTaskResult(_ctx, body) {
  if (!object(body) || body.success !== true) {
    return { status: "UNKNOWN", reason: "Foke did not return a confirmed task status" };
  }
  switch (body.status) {
    case "failed": {
      const reason = text(body.errorMessage).replace(/https?:\/\/\S+/gi, "[URL]").replace(/[\u0000-\u001f\u007f]/g, " ");
      return { status: "FAILURE", progress: "100%", reason: reason.slice(0, 300) || "Foke video generation failed" };
    }
    case "success":
      if (videoURL(body) && (!body.billing || body.billing.mode !== "token" || settledTokens(body.billing) !== null)) {
        // Keep the provider URL in task data for the content proxy, not ResultURL.
        return { status: "SUCCESS", progress: "100%" };
      }
      // Media archival or token settlement can lag behind generation.
      return { status: "IN_PROGRESS", progress: "99%" };
    case "submitted": {
      const progress = body.progress;
      return typeof progress === "number" && progress >= 0 && progress <= 100
        ? { status: "IN_PROGRESS", progress: Math.min(99, Math.floor(progress)) + "%" }
        : { status: "IN_PROGRESS" };
    }
    default:
      return { status: "UNKNOWN", reason: "Unrecognized Foke video status" };
  }
}

export function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") return null;
  const req = ctx.requestBody;
  return {
    seconds: req.duration,
    tokens: 0,
    has_video_reference: req.videoUrls.length > 0 || req.fileParts.some((part) => part.name === "videos"),
    token_settled: false,
  };
}

export function extractUsageOnComplete(_ctx, result, body) {
  if (result.status !== "SUCCESS") return null;
  const tokens = settledTokens(body && body.billing);
  return tokens === null ? null : { tokens, token_settled: true };
}

export function listArtifacts(task) {
  return task.status === "SUCCESS" && videoURL(task.data) ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  const url = ctx.artifactKey === "video" && videoURL(ctx.data);
  if (!url) throw new Error("Foke video result is not available");
  return { url, method: ctx.clientRequest.method, credentialless: true };
}

export const protocols = {
  openai_video: {
    decodeRequest: decodeVideo,
    render: function (_ctx, task) {
      if (task.status !== "FAILURE") return {};
      return { error: { code: "video_generation_failed", message: task.fail_reason || "Foke video generation failed" } };
    },
  },
};
