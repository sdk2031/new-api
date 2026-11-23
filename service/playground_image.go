package service

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/google/uuid"
)

const (
	MaxPlaygroundImageResponseBytes = 32 << 20
	maxPlaygroundImageBytes         = 16 << 20
	maxPluginImageURLBytes          = 8 << 10
	playgroundImageURLHook          = "resolvePlaygroundImageURL"
	playgroundImageResultPrefix     = "/pg/images/result/"
)

var playgroundImageFilePattern = regexp.MustCompile(`^[a-f0-9-]{36}\.(png|jpg|webp|gif)$`)
var playgroundImageTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
}

var playgroundImageClient = func() *http.Client {
	client := newProtectedFetchHTTPClientWithProxy(nil, nil, func() (*common.SSRFProtection, bool, error) {
		return &common.SSRFProtection{AllowedPorts: []int{80, 443}, ApplyIPFilterForDomain: true}, true, nil
	}, func(*http.Request) (*url.URL, error) { return nil, nil })
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.User != nil {
			return errors.New("image redirect contains credentials")
		}
		req.Header.Del("Referer")
		return checkProtectedFetchRedirect(req, via)
	}
	return client
}()

type PlaygroundImageResult struct {
	URL string `json:"url"`
}

type upstreamPlaygroundImage struct {
	URL    string `json:"url"`
	Base64 string `json:"b64_json"`
}

func playgroundImageDir(userID int) string {
	return filepath.Join(common.GetEnvOrDefaultString("PLAYGROUND_IMAGE_DIR", "playground-images"), strconv.Itoa(userID))
}

func IsFDAIImageChannel(channelType int, pluginKey string) bool {
	return channelType == constant.ChannelTypeOpenAI && pluginKey == "fdai-video"
}

func fdaiImageURLPlugin(ctx context.Context, registry *jsplugin.Registry) (*jsplugin.LoadedPlugin, error) {
	plugin, ok := registry.Get("fdai-video")
	if !ok {
		return nil, errors.New("FDAI Video plugin is not enabled")
	}
	hasHook, err := plugin.Engine.HasCallablePath(ctx, playgroundImageURLHook)
	if err != nil {
		return nil, err
	}
	if !hasHook {
		return nil, errors.New("FDAI Video plugin does not support image response compatibility")
	}
	return plugin, nil
}

func StorePlaygroundImages(ctx context.Context, userID int, channelType int, pluginKey string, body []byte) ([]PlaygroundImageResult, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	var plugin *jsplugin.LoadedPlugin
	if IsFDAIImageChannel(channelType, pluginKey) {
		var err error
		plugin, err = fdaiImageURLPlugin(ctx, jsplugin.DefaultRegistry)
		if err != nil {
			return nil, err
		}
	}
	return storePlaygroundImages(ctx, userID, body, playgroundImageClient, plugin)
}

// NormalizeFDAIImageAPIResponse returns nil when the selected channel is not
// bound or when no image was changed. Ordinary image responses pass through.
func NormalizeFDAIImageAPIResponse(ctx context.Context, channelType int, pluginKey string, body []byte) ([]byte, error) {
	return normalizeFDAIImageAPIResponse(ctx, channelType, pluginKey, body, playgroundImageClient, jsplugin.DefaultRegistry)
}

func normalizeFDAIImageAPIResponse(ctx context.Context, channelType int, pluginKey string, body []byte, client *http.Client, registry *jsplugin.Registry) ([]byte, error) {
	if !IsFDAIImageChannel(channelType, pluginKey) {
		return nil, nil
	}
	if len(body) > MaxPlaygroundImageResponseBytes {
		return nil, errors.New("image response exceeds size limit")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	plugin, err := fdaiImageURLPlugin(ctx, registry)
	if err != nil {
		return nil, err
	}
	var response map[string]json.RawMessage
	var data []map[string]json.RawMessage
	if common.Unmarshal(body, &response) != nil {
		return nil, errors.New("invalid FDAI image response")
	}
	if len(response["data"]) == 0 {
		return nil, nil
	}
	if common.Unmarshal(response["data"], &data) != nil || len(data) > dto.MaxImageN {
		return nil, errors.New("invalid FDAI image response")
	}
	remaining := int64(MaxPlaygroundImageResponseBytes)
	changed := false
	for _, image := range data {
		raw := image["b64_json"]
		if len(raw) == 0 || len(raw) > maxPluginImageURLBytes*6+2 {
			continue
		}
		var value string
		if common.Unmarshal(raw, &value) != nil {
			continue
		}
		imageURL, err := resolvePluginImageURL(ctx, plugin, value)
		if err != nil {
			return nil, err
		}
		if imageURL == "" {
			continue
		}
		limit := min(remaining, maxPlaygroundImageBytes)
		if limit <= 0 {
			return nil, errors.New("image response exceeds size limit")
		}
		source, err := openGeneratedImage(ctx, upstreamPlaygroundImage{URL: imageURL}, limit, client)
		if err != nil {
			return nil, err
		}
		content, err := io.ReadAll(io.LimitReader(source, limit+1))
		_ = source.Close()
		if err != nil || int64(len(content)) > limit || generatedImageExtension(content) == "" {
			return nil, errors.New("invalid or oversized FDAI image")
		}
		remaining -= int64(len(content))
		image["b64_json"], err = common.Marshal(base64.StdEncoding.EncodeToString(content))
		if err != nil {
			return nil, err
		}
		delete(image, "url")
		changed = true
	}
	if !changed {
		return nil, nil
	}
	response["data"], err = common.Marshal(data)
	if err != nil {
		return nil, err
	}
	return common.Marshal(response)
}

func resolvePluginImageURL(ctx context.Context, plugin *jsplugin.LoadedPlugin, value string) (string, error) {
	if plugin == nil || len(value) == 0 || len(value) > maxPluginImageURLBytes {
		return "", nil
	}
	result, err := plugin.Engine.Call(ctx, playgroundImageURLHook, value)
	imageURL, _ := result.(string)
	return imageURL, err
}

func storePlaygroundImages(ctx context.Context, userID int, body []byte, client *http.Client, plugin *jsplugin.LoadedPlugin) ([]PlaygroundImageResult, error) {
	var response struct {
		Data []upstreamPlaygroundImage `json:"data"`
	}
	if userID <= 0 || common.Unmarshal(body, &response) != nil || len(response.Data) == 0 || len(response.Data) > dto.MaxImageN {
		return nil, errors.New("invalid image response")
	}
	dir := playgroundImageDir(userID)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(response.Data))
	results := make([]PlaygroundImageResult, 0, len(response.Data))
	remaining := int64(MaxPlaygroundImageResponseBytes)
	for _, image := range response.Data {
		imageURL, err := resolvePluginImageURL(ctx, plugin, image.Base64)
		if imageURL != "" {
			image = upstreamPlaygroundImage{URL: imageURL}
		}
		var name string
		var size int64
		if err == nil {
			name, size, err = savePlaygroundImage(ctx, dir, image, min(remaining, maxPlaygroundImageBytes), client)
		}
		if err != nil {
			for _, path := range paths {
				_ = os.Remove(path)
			}
			return nil, err
		}
		remaining -= size
		paths = append(paths, filepath.Join(dir, name))
		results = append(results, PlaygroundImageResult{URL: playgroundImageResultPrefix + name})
	}
	return results, nil
}

func openGeneratedImage(ctx context.Context, image upstreamPlaygroundImage, limit int64, client *http.Client) (io.ReadCloser, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if image.Base64 != "" {
		return io.NopCloser(base64.NewDecoder(base64.StdEncoding, strings.NewReader(image.Base64))), nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, image.URL, nil)
	if err != nil || req.URL.Hostname() == "" || req.URL.User != nil || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
		return nil, errors.New("invalid image URL")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK || resp.ContentLength > limit {
		_ = resp.Body.Close()
		return nil, errors.New("image download failed or exceeded size limit")
	}
	return resp.Body, nil
}

func generatedImageExtension(header []byte) string {
	contentType := http.DetectContentType(header)
	for ext, mediaType := range playgroundImageTypes {
		if contentType == mediaType {
			return ext
		}
	}
	return ""
}

func savePlaygroundImage(ctx context.Context, dir string, image upstreamPlaygroundImage, limit int64, client *http.Client) (string, int64, error) {
	source, err := openGeneratedImage(ctx, image, limit, client)
	if err != nil {
		return "", 0, err
	}
	defer source.Close()
	reader := bufio.NewReader(io.LimitReader(source, limit+1))
	header, _ := reader.Peek(512)
	extension := generatedImageExtension(header)
	if extension == "" {
		return "", 0, errors.New("unsupported image format")
	}
	file, err := os.CreateTemp(dir, ".image-*")
	if err != nil {
		return "", 0, err
	}
	defer os.Remove(file.Name())
	size, err := io.Copy(file, reader)
	closeErr := file.Close()
	if err != nil || closeErr != nil || size > limit {
		return "", 0, errors.New("image could not be saved within size limit")
	}
	name := uuid.NewString() + extension
	return name, size, os.Rename(file.Name(), filepath.Join(dir, name))
}

func OpenPlaygroundImage(userID int, name string) (*os.File, string, error) {
	if userID <= 0 || !playgroundImageFilePattern.MatchString(name) {
		return nil, "", os.ErrNotExist
	}
	file, err := os.Open(filepath.Join(playgroundImageDir(userID), name))
	return file, playgroundImageTypes[filepath.Ext(name)], err
}
