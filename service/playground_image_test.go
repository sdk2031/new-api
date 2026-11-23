package service

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testPlaygroundPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jL2sAAAAASUVORK5CYII="

func TestPlaygroundImageStoresURLAndBase64Privately(t *testing.T) {
	t.Setenv("PLAYGROUND_IMAGE_DIR", t.TempDir())
	png, err := base64.StdEncoding.DecodeString(testPlaygroundPNG)
	require.NoError(t, err)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Empty(t, r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		_, _ = w.Write(png)
	}))
	t.Cleanup(upstream.Close)
	body, err := common.Marshal(map[string]any{"data": []upstreamPlaygroundImage{
		{URL: upstream.URL + "/image?signature=internal"},
		{Base64: testPlaygroundPNG},
	}})
	require.NoError(t, err)

	results, err := storePlaygroundImages(t.Context(), 17, body, upstream.Client(), nil)
	require.NoError(t, err)
	require.Len(t, results, 2)
	for _, result := range results {
		name, local := strings.CutPrefix(result.URL, "/pg/images/result/")
		require.True(t, local)
		file, mime, err := OpenPlaygroundImage(17, name)
		require.NoError(t, err)
		read, err := io.ReadAll(file)
		require.NoError(t, file.Close())
		require.NoError(t, err)
		assert.Equal(t, png, read)
		assert.Equal(t, "image/png", mime)
		_, _, err = OpenPlaygroundImage(18, name)
		assert.ErrorIs(t, err, os.ErrNotExist)
	}
}

func TestFDAIImageResponsesUseOnlySelectedChannelBinding(t *testing.T) {
	t.Setenv("PLAYGROUND_IMAGE_DIR", t.TempDir())
	source, err := os.ReadFile("../custom-plugins/fdai-video/plugin.js")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.Register(string(source), jsplugin.Options{})
	require.NoError(t, err)
	png, err := base64.StdEncoding.DecodeString(testPlaygroundPNG)
	require.NoError(t, err)
	var downloads atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fdai-image", r.URL.Path)
		assert.Empty(t, r.Header.Get("Authorization"))
		assert.Empty(t, r.Header.Get("Cookie"))
		downloads.Add(1)
		_, _ = w.Write(png)
	}))
	t.Cleanup(upstream.Close)
	body := []byte(`{"created":1770047224,"data":[{"b64_json":"` + upstream.URL + `/fdai-image?signature=internal","revised_prompt":"Example"},{"b64_json":"` + testPlaygroundPNG + `"}]}`)

	for _, tc := range []struct {
		name        string
		channelType int
		pluginKey   string
	}{
		{"unbound channel", constant.ChannelTypeOpenAI, ""},
		{"different plugin", constant.ChannelTypeOpenAI, "other-video"},
		{"FDAI video task channel", constant.ChannelTypeTaskPlugin, "fdai-video"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := downloads.Load()
			response, err := normalizeFDAIImageAPIResponse(t.Context(), tc.channelType, tc.pluginKey, body, upstream.Client(), registry)
			require.NoError(t, err)
			assert.Nil(t, response)
			assert.Equal(t, before, downloads.Load())
		})
	}

	t.Run("bound channel converts only misplaced links and preserves metadata", func(t *testing.T) {
		before := downloads.Load()
		response, err := normalizeFDAIImageAPIResponse(t.Context(), constant.ChannelTypeOpenAI, "fdai-video", body, upstream.Client(), registry)
		require.NoError(t, err)
		expected, err := common.Marshal(map[string]any{
			"created": 1770047224,
			"data": []map[string]string{{
				"b64_json": testPlaygroundPNG, "revised_prompt": "Example",
			}, {"b64_json": testPlaygroundPNG}},
		})
		require.NoError(t, err)
		assert.JSONEq(t, string(expected), string(response))
		assert.Equal(t, before+1, downloads.Load())

		response, err = normalizeFDAIImageAPIResponse(t.Context(), constant.ChannelTypeOpenAI, "fdai-video", response, upstream.Client(), registry)
		require.NoError(t, err)
		assert.Nil(t, response)
		assert.Equal(t, before+1, downloads.Load())
	})

	t.Run("missing plugin does not leak the malformed response", func(t *testing.T) {
		response, err := normalizeFDAIImageAPIResponse(t.Context(), constant.ChannelTypeOpenAI, "fdai-video", body, upstream.Client(), jsplugin.NewRegistry())
		require.Error(t, err)
		assert.Nil(t, response)
	})

	t.Run("online chat stores private results", func(t *testing.T) {
		results, err := storePlaygroundImages(t.Context(), 17, body, upstream.Client(), plugin)
		require.NoError(t, err)
		require.Len(t, results, 2)
		for _, result := range results {
			name, local := strings.CutPrefix(result.URL, playgroundImageResultPrefix)
			require.True(t, local)
			file, _, err := OpenPlaygroundImage(17, name)
			require.NoError(t, err)
			saved, err := io.ReadAll(file)
			require.NoError(t, file.Close())
			require.NoError(t, err)
			assert.Equal(t, png, saved)
		}
	})
}

func TestPlaygroundImageRejectsUnsafeResultAndDiscardsPartialBatch(t *testing.T) {
	t.Setenv("PLAYGROUND_IMAGE_DIR", t.TempDir())
	body, err := common.Marshal(map[string]any{"data": []upstreamPlaygroundImage{
		{Base64: testPlaygroundPNG}, {Base64: base64.StdEncoding.EncodeToString([]byte("<svg/>"))},
	}})
	require.NoError(t, err)
	results, err := StorePlaygroundImages(t.Context(), 17, constant.ChannelTypeOpenAI, "", body)
	require.Error(t, err)
	assert.Empty(t, results)
	entries, err := os.ReadDir(playgroundImageDir(17))
	require.NoError(t, err)
	assert.Empty(t, entries)
}
