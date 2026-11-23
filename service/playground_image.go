package service

import (
	"bufio"
	"context"
	"encoding/base64"
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
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/google/uuid"
)

const (
	MaxPlaygroundImageResponseBytes = 32 << 20
	maxPlaygroundImageBytes         = 16 << 20
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

func StorePlaygroundImages(ctx context.Context, userID int, body []byte) ([]PlaygroundImageResult, error) {
	return storePlaygroundImages(ctx, userID, body, playgroundImageClient)
}

func storePlaygroundImages(ctx context.Context, userID int, body []byte, client *http.Client) ([]PlaygroundImageResult, error) {
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
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	paths := make([]string, 0, len(response.Data))
	results := make([]PlaygroundImageResult, 0, len(response.Data))
	remaining := int64(MaxPlaygroundImageResponseBytes)
	for _, image := range response.Data {
		name, size, err := savePlaygroundImage(ctx, dir, image, min(remaining, maxPlaygroundImageBytes), client)
		if err != nil {
			for _, path := range paths {
				_ = os.Remove(path)
			}
			return nil, err
		}
		remaining -= size
		paths = append(paths, filepath.Join(dir, name))
		results = append(results, PlaygroundImageResult{URL: "/pg/images/result/" + name})
	}
	return results, nil
}

func savePlaygroundImage(ctx context.Context, dir string, image upstreamPlaygroundImage, limit int64, client *http.Client) (string, int64, error) {
	if err := ctx.Err(); err != nil {
		return "", 0, err
	}
	var source io.Reader
	if image.Base64 != "" {
		source = base64.NewDecoder(base64.StdEncoding, strings.NewReader(image.Base64))
	} else {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, image.URL, nil)
		if err != nil || req.URL.Hostname() == "" || req.URL.User != nil || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
			return "", 0, errors.New("invalid image URL")
		}
		resp, err := client.Do(req)
		if err != nil {
			return "", 0, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK || resp.ContentLength > limit {
			return "", 0, errors.New("image download failed or exceeded size limit")
		}
		source = resp.Body
	}
	reader := bufio.NewReader(io.LimitReader(source, limit+1))
	header, _ := reader.Peek(512)
	contentType := http.DetectContentType(header)
	extension := ""
	for ext, mediaType := range playgroundImageTypes {
		if contentType == mediaType {
			extension = ext
			break
		}
	}
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
