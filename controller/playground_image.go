package controller

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Withhold the upstream body and headers until its images have been stored.
type playgroundImageResponse struct {
	gin.ResponseWriter
	header   http.Header
	body     bytes.Buffer
	status   int
	written  bool
	tooLarge bool
}

func (w *playgroundImageResponse) Header() http.Header { return w.header }
func (w *playgroundImageResponse) Status() int         { return w.status }
func (w *playgroundImageResponse) Written() bool       { return w.written }
func (w *playgroundImageResponse) WriteHeaderNow()     { w.written = true }
func (w *playgroundImageResponse) Flush()              { w.WriteHeaderNow() }
func (w *playgroundImageResponse) Size() int {
	if !w.written {
		return -1
	}
	return w.body.Len()
}
func (w *playgroundImageResponse) WriteHeader(status int) {
	if !w.written {
		w.status = status
	}
}
func (w *playgroundImageResponse) Write(p []byte) (int, error) {
	w.WriteHeaderNow()
	if w.tooLarge || len(p) > service.MaxPlaygroundImageResponseBytes-w.body.Len() {
		w.tooLarge = true
		return len(p), nil
	}
	return w.body.Write(p)
}
func (w *playgroundImageResponse) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

func PlaygroundImage(c *gin.Context) {
	// The group query is for local routing only.
	c.Request.URL.RawQuery = ""
	w := &playgroundImageResponse{ResponseWriter: c.Writer, header: make(http.Header), status: http.StatusOK}
	c.Writer = w
	func() {
		defer func() { c.Writer = w.ResponseWriter }()
		relayPlayground(c, types.RelayFormatOpenAIImage)
	}()

	c.Header("Cache-Control", "private, no-store")
	if !w.tooLarge && w.status >= 400 {
		c.Data(w.status, "application/json", w.body.Bytes())
		return
	}
	if !w.tooLarge && w.status == http.StatusOK && !strings.HasPrefix(w.header.Get("Content-Type"), "text/event-stream") {
		channelBaseURL := common.GetContextKeyString(c, constant.ContextKeyChannelBaseUrl)
		images, err := service.StorePlaygroundImages(c.Request.Context(), c.GetInt("id"), channelBaseURL, w.body.Bytes())
		if err == nil {
			c.JSON(http.StatusOK, gin.H{"data": images})
			return
		}
	}
	c.JSON(http.StatusBadGateway, gin.H{"error": gin.H{
		"code":    "playground_image_storage_failed",
		"message": "Image result could not be saved.",
	}})
}

func GetPlaygroundImage(c *gin.Context) {
	file, contentType, err := service.OpenPlaygroundImage(c.GetInt("id"), c.Param("file"))
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer file.Close()
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cross-Origin-Resource-Policy", "same-origin")
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, file)
}
