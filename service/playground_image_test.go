package service

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
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
		{Base64: upstream.URL + "/fdai-image?signature=internal"},
	}})
	require.NoError(t, err)

	results, err := storePlaygroundImages(t.Context(), 17, body, upstream.Client())
	require.NoError(t, err)
	require.Len(t, results, 3)
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

func TestPlaygroundImageRejectsUnsafeResultAndDiscardsPartialBatch(t *testing.T) {
	t.Setenv("PLAYGROUND_IMAGE_DIR", t.TempDir())
	body, err := common.Marshal(map[string]any{"data": []upstreamPlaygroundImage{
		{Base64: testPlaygroundPNG}, {Base64: base64.StdEncoding.EncodeToString([]byte("<svg/>"))},
	}})
	require.NoError(t, err)
	results, err := StorePlaygroundImages(t.Context(), 17, body)
	require.Error(t, err)
	assert.Empty(t, results)
	entries, err := os.ReadDir(playgroundImageDir(17))
	require.NoError(t, err)
	assert.Empty(t, entries)
}
