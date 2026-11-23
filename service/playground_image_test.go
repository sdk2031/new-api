package service

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
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

func TestPlaygroundImageURLInBase64UsesOnlyFDAIPlugin(t *testing.T) {
	t.Setenv("PLAYGROUND_IMAGE_DIR", t.TempDir())
	source, err := os.ReadFile("../custom-plugins/fdai-video/plugin.js")
	require.NoError(t, err)
	registry := jsplugin.NewRegistry()
	plugin, err := registry.Register(string(source), jsplugin.Options{})
	require.NoError(t, err)
	png, err := base64.StdEncoding.DecodeString(testPlaygroundPNG)
	require.NoError(t, err)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/fdai-image", r.URL.Path)
		_, _ = w.Write(png)
	}))
	t.Cleanup(upstream.Close)
	body := []byte(`{"data":[{"b64_json":"` + upstream.URL + `/fdai-image?signature=internal"},{"b64_json":"` + testPlaygroundPNG + `"}]}`)

	for _, channelBaseURL := range []string{"https://api.fdai.xyz", "https://apinocf.fdai.xyz/v1/"} {
		selected := playgroundImageURLPlugin(channelBaseURL, registry)
		require.Same(t, plugin, selected)
		results, err := storePlaygroundImages(t.Context(), 17, body, upstream.Client(), selected)
		require.NoError(t, err)
		require.Len(t, results, 2)
		for _, result := range results {
			name, local := strings.CutPrefix(result.URL, "/pg/images/result/")
			require.True(t, local)
			saved, err := os.ReadFile(filepath.Join(playgroundImageDir(17), name))
			require.NoError(t, err)
			assert.Equal(t, png, saved)
		}
	}

	for _, channelBaseURL := range []string{"https://other.example", "https://api.fdai.xyz.other.example"} {
		selected := playgroundImageURLPlugin(channelBaseURL, registry)
		require.Nil(t, selected)
		results, err := storePlaygroundImages(t.Context(), 18, body, upstream.Client(), selected)
		require.Error(t, err)
		assert.Empty(t, results)
	}
}

func TestPlaygroundImageRejectsUnsafeResultAndDiscardsPartialBatch(t *testing.T) {
	t.Setenv("PLAYGROUND_IMAGE_DIR", t.TempDir())
	body, err := common.Marshal(map[string]any{"data": []upstreamPlaygroundImage{
		{Base64: testPlaygroundPNG}, {Base64: base64.StdEncoding.EncodeToString([]byte("<svg/>"))},
	}})
	require.NoError(t, err)
	results, err := StorePlaygroundImages(t.Context(), 17, "", body)
	require.Error(t, err)
	assert.Empty(t, results)
	entries, err := os.ReadDir(playgroundImageDir(17))
	require.NoError(t, err)
	assert.Empty(t, entries)
}
