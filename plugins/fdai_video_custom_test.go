package plugins_test

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFDAIVideoCustomPlugin(t *testing.T) {
	source, err := os.ReadFile("../custom-plugins/fdai-video/plugin.js")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.Register(string(source), jsplugin.Options{})
	require.NoError(t, err)
	require.Equal(t, "fdai-video", plugin.Meta.Key)
	require.Equal(t, []string{"sd2.0_mini-720p-zr-903-12s", "sd2.0_mini-480p-zr-903-15s"}, plugin.Meta.Models)
	assert.Empty(t, plugin.Meta.ChannelTypes)
	assert.Equal(t, "channel", plugin.Meta.ModelScope)
	binding, found := registry.Generation().LookupEndpoint("POST", "/v1/videos", "channel-configured-model")
	require.True(t, found)
	assert.Same(t, plugin, binding.Plugin)

	t.Run("converts the public request to FDAI fields", func(t *testing.T) {
		decoded, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
			"model": "video-alias",
			"body": map[string]any{"kind": "json", "value": map[string]any{
				"model": "video-alias", "prompt": "A city at night", "seconds": 12, "size": "1280x720",
				"images": []any{"https://assets.example/one.png"}, "ignored": "value",
			}},
		})
		require.NoError(t, callErr)
		intent := decoded.(map[string]any)
		assert.Equal(t, "video-alias", intent["model"])
		assert.Equal(t, "image_to_video", intent["action"])
		assert.Equal(t, map[string]any{
			"model": "video-alias", "prompt": "A city at night", "duration": int64(12), "aspect_ratio": "16:9",
			"images": []any{"https://assets.example/one.png"},
		}, intent["requestBody"])

		descriptor, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
			"baseUrl": "https://api.fdai.xyz", "apiKey": "secret", "model": "video-alias",
			"upstreamModel": "sd2.0_mini-720p-zr-903-12s", "requestBody": intent["requestBody"],
		})
		require.NoError(t, callErr)
		request := descriptor.(map[string]any)
		assert.Equal(t, "https://api.fdai.xyz/v1/videos", request["url"])
		body := request["body"].(map[string]any)
		assert.Equal(t, "sd2.0_mini-720p-zr-903-12s", body["model"])
		assert.NotContains(t, body, "ignored")
	})

	t.Run("uses the v1 submit body only for veo and omni upstream models", func(t *testing.T) {
		for _, model := range []string{"veo_3_1-fast", "omni-video-latest"} {
			descriptor, callErr := plugin.Engine.Call(t.Context(), "buildSubmitRequest", map[string]any{
				"baseUrl": "https://api.fdai.xyz", "apiKey": "secret", "upstreamModel": model,
				"requestBody": map[string]any{
					"prompt": "A city at night", "duration": 10, "aspect_ratio": "9:16",
					"images": []any{"https://assets.example/one.png", "https://assets.example/two.png"},
				},
			})
			require.NoError(t, callErr)
			body := descriptor.(map[string]any)["body"].(map[string]any)
			assert.Equal(t, map[string]any{
				"model": model, "prompt": "A city at night",
				"input_reference": "https://assets.example/one.png|https://assets.example/two.png", "size": "9:16",
			}, body)
			assert.NotContains(t, body, "duration")
			assert.NotContains(t, body, "images")
		}
	})

	t.Run("rejects invalid duration and media values", func(t *testing.T) {
		for _, body := range []map[string]any{
			{"model": "video-alias", "prompt": "test", "duration": 16},
			{"model": "video-alias", "prompt": "test", "images": []any{"not-a-url"}},
		} {
			_, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "decodeRequest"}, map[string]any{
				"model": "video-alias", "body": map[string]any{"kind": "json", "value": body},
			})
			require.Error(t, callErr)
		}
	})

	t.Run("parses submission and polling responses", func(t *testing.T) {
		submitted, callErr := plugin.Engine.Call(t.Context(), "parseSubmitResponse", nil, map[string]any{
			"body": map[string]any{"task_id": "upstream-task", "status": "pending"},
		})
		require.NoError(t, callErr)
		assert.Equal(t, "upstream-task", submitted.(map[string]any)["taskId"])

		_, callErr = plugin.Engine.Call(t.Context(), "parseSubmitResponse", nil, map[string]any{
			"body": map[string]any{"error": map[string]any{"code": "INVALID_MODEL", "message": "model unavailable"}},
		})
		require.ErrorContains(t, callErr, "INVALID_MODEL: model unavailable")

		cases := []struct {
			status string
			want   string
		}{
			{status: "queued", want: "QUEUED"},
			{status: "processing", want: "IN_PROGRESS"},
			{status: "completed", want: "SUCCESS"},
			{status: "failed", want: "FAILURE"},
		}
		for _, tc := range cases {
			value, parseErr := plugin.Engine.Call(t.Context(), "parseTaskResult", nil, map[string]any{"status": tc.status, "progress": 50})
			require.NoError(t, parseErr)
			assert.Equal(t, tc.want, value.(map[string]any)["status"])
		}
	})

	t.Run("proxies result URLs and falls back to the content endpoint", func(t *testing.T) {
		artifacts, callErr := plugin.Engine.Call(t.Context(), "listArtifacts", map[string]any{"status": "SUCCESS", "data": map[string]any{}})
		require.NoError(t, callErr)
		require.Len(t, artifacts, 1)

		content, callErr := plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
			"artifactKey": "video", "data": map[string]any{"result": map[string]any{"video_url": "https://cdn.example/result.mp4"}},
			"clientRequest": map[string]any{"method": "GET"}, "baseUrl": "https://api.fdai.xyz", "upstreamTaskId": "task-1", "apiKey": "secret",
		})
		require.NoError(t, callErr)
		proxied := content.(map[string]any)
		assert.Equal(t, "https://cdn.example/result.mp4", proxied["url"])
		assert.Equal(t, true, proxied["credentialless"])

		content, callErr = plugin.Engine.Call(t.Context(), "buildContentRequest", map[string]any{
			"artifactKey": "video", "data": map[string]any{}, "clientRequest": map[string]any{"method": "HEAD"},
			"baseUrl": "https://api.fdai.xyz", "upstreamTaskId": "task/id", "apiKey": "secret",
		})
		require.NoError(t, callErr)
		fallback := content.(map[string]any)
		assert.Equal(t, "https://api.fdai.xyz/v1/videos/task%2Fid/content", fallback["url"])
		assert.NotContains(t, fallback, "credentialless")
	})

	t.Run("does not expose upstream response data", func(t *testing.T) {
		value, callErr := plugin.Engine.CallPath(t.Context(), "protocols", []string{"openai_video", "render"}, nil, map[string]any{
			"task_id": "public-task", "status": "SUCCESS", "progress": "100%", "created_at": 10,
			"data": map[string]any{"task_id": "upstream-task", "video_url": "https://cdn.example/private.mp4"},
		})
		require.NoError(t, callErr)
		output := value.(map[string]any)
		assert.Equal(t, "public-task", output["id"])
		assert.NotContains(t, output, "data")
		assert.NotContains(t, output, "video_url")
	})

	t.Run("normalizes upstream performance metrics", func(t *testing.T) {
		descriptor, callErr := plugin.Engine.Call(t.Context(), "buildPerformanceRequest", map[string]any{
			"baseUrl": "https://api.fdai.xyz", "hours": 24, "authHeader": "",
		})
		require.NoError(t, callErr)
		request := descriptor.(map[string]any)
		assert.Equal(t, "https://api.fdai.xyz/api/perf-metrics/summary?hours=24", request["url"])

		value, callErr := plugin.Engine.Call(t.Context(), "parsePerformanceResponse", nil, map[string]any{
			"data": map[string]any{"models": []any{map[string]any{
				"model_name": "omni_flash", "avg_latency_ms": 241601, "success_rate": 88.24, "avg_tps": 0,
				"recent_periods": []any{map[string]any{"ts": 1789696800, "avg_latency_ms": 169627, "success_rate": 96.21}},
			}}},
		}, map[string]any{"status": 200})
		require.NoError(t, callErr)
		models := value.([]any)
		require.Len(t, models, 1)
		metric := models[0].(map[string]any)
		assert.Equal(t, "omni_flash", metric["modelName"])
		assert.Equal(t, float64(88.24), metric["successRate"])
		require.Len(t, metric["recentIntervals"], 1)
	})
}
