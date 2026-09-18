package controller

import (
	"context"
	"fmt"
	"math"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	pluginruntime "github.com/QuantumNous/new-api/pkg/jsplugin"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	jspluginadaptor "github.com/QuantumNous/new-api/relay/channel/task/jsplugin"
)

const providerPerformanceCacheTTL = 30 * time.Second

type providerPerformanceCacheEntry struct {
	expiresAt time.Time
	models    []relaychannel.TaskPerformanceModel
}

type providerPerformanceCall struct {
	done   chan struct{}
	models []relaychannel.TaskPerformanceModel
	err    error
}

var providerPerformanceCache = struct {
	sync.Mutex
	items map[string]providerPerformanceCacheEntry
	calls map[string]*providerPerformanceCall
}{
	items: make(map[string]providerPerformanceCacheEntry),
	calls: make(map[string]*providerPerformanceCall),
}

func getProviderPerformanceModels(parent context.Context, groups []string, hours int) []relaychannel.TaskPerformanceModel {
	count, err := model.CountChannelsByType(constant.ChannelTypeTaskPlugin)
	if err != nil {
		logger.LogWarn(parent, "query task plugin channels for performance fallback: %v", err)
		return nil
	}
	if count == 0 {
		return nil
	}
	channels, err := model.GetChannelsByType(0, int(count), false, constant.ChannelTypeTaskPlugin)
	if err != nil {
		logger.LogWarn(parent, "load task plugin channels for performance fallback: %v", err)
		return nil
	}

	ctx, cancel := context.WithTimeout(parent, 8*time.Second)
	defer cancel()
	allowedGroups := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		allowedGroups[group] = struct{}{}
	}
	selected := make([]relaychannel.TaskPerformanceModel, 0)
	seen := make(map[string]struct{})
	for _, channelSummary := range channels {
		if channelSummary.Status != common.ChannelStatusEnabled || !slices.ContainsFunc(channelSummary.GetGroups(), func(group string) bool {
			_, ok := allowedGroups[group]
			return ok
		}) {
			continue
		}
		channel, cacheErr := model.CacheGetChannel(channelSummary.Id)
		if cacheErr != nil {
			logger.LogWarn(parent, "load task plugin channel %d for performance fallback: %v", channelSummary.Id, cacheErr)
			continue
		}
		pluginKey := strings.TrimSpace(channel.GetSetting().TaskPluginKey)
		plugin, ok := pluginruntime.DefaultRegistry.Get(pluginKey)
		if !ok {
			continue
		}
		provider := relaychannel.TaskPerformanceProvider(jspluginadaptor.New(plugin))
		if !provider.SupportsPerformanceMetrics() {
			continue
		}
		baseURL := strings.TrimRight(strings.TrimSpace(channel.GetBaseURL()), "/")
		if baseURL == "" {
			baseURL = strings.TrimRight(plugin.Meta.BaseURL, "/")
		}
		if baseURL == "" {
			continue
		}
		key := channel.Key
		if keys := channel.GetKeys(); len(keys) > 0 {
			key = keys[0]
		}
		models, fetchErr := fetchCachedProviderPerformanceMetrics(
			ctx,
			provider,
			fmt.Sprintf("%d\x00%s\x00%s\x00%d", channel.Id, pluginKey, baseURL, hours),
			baseURL,
			key,
			channel.GetSetting().Proxy,
			hours,
		)
		if fetchErr != nil {
			logger.LogWarn(parent, "fetch task plugin performance fallback channel=%d plugin=%s: %v", channel.Id, pluginKey, fetchErr)
			continue
		}

		modelMapping := make(map[string]string)
		if rawMapping := strings.TrimSpace(channel.GetModelMapping()); rawMapping != "" {
			if mappingErr := common.UnmarshalJsonStr(rawMapping, &modelMapping); mappingErr != nil {
				logger.LogWarn(parent, "decode channel %d model mapping for performance fallback: %v", channel.Id, mappingErr)
				continue
			}
		}
		localModelsByUpstream := make(map[string][]string, len(channel.GetModels()))
		for _, localModel := range channel.GetModels() {
			localModel = strings.TrimSpace(localModel)
			if localModel == "" {
				continue
			}
			upstreamModel := strings.TrimSpace(modelMapping[localModel])
			if upstreamModel == "" {
				upstreamModel = localModel
			}
			localModelsByUpstream[upstreamModel] = append(localModelsByUpstream[upstreamModel], localModel)
		}
		for _, metric := range models {
			localModels := localModelsByUpstream[metric.ModelName]
			if len(localModels) == 0 {
				continue
			}
			for _, localModel := range localModels {
				deduplicationKey := pluginKey + "\x00" + baseURL + "\x00" + localModel
				if _, duplicate := seen[deduplicationKey]; duplicate {
					continue
				}
				seen[deduplicationKey] = struct{}{}
				localMetric := metric
				localMetric.ModelName = localModel
				selected = append(selected, localMetric)
			}
		}
	}
	return selected
}

func mergeProviderPerformanceModels(local []perfmetrics.ModelSummary, provider []relaychannel.TaskPerformanceModel) []perfmetrics.ModelSummary {
	seen := make(map[string]struct{}, len(local))
	for _, summary := range local {
		seen[summary.ModelName] = struct{}{}
	}
	byModel := make(map[string][]relaychannel.TaskPerformanceModel)
	for _, metric := range provider {
		if _, ok := seen[metric.ModelName]; ok {
			continue
		}
		byModel[metric.ModelName] = append(byModel[metric.ModelName], metric)
	}
	names := make([]string, 0, len(byModel))
	for name := range byModel {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		summary := aggregateProviderPerformanceModels(byModel[name])
		if summary == nil {
			continue
		}
		summary.ModelName = name
		local = append(local, *summary)
	}
	return local
}

func fetchCachedProviderPerformanceMetrics(
	ctx context.Context,
	provider relaychannel.TaskPerformanceProvider,
	cacheKey, baseURL, key, proxy string,
	hours int,
) ([]relaychannel.TaskPerformanceModel, error) {
	now := time.Now()
	providerPerformanceCache.Lock()
	entry, ok := providerPerformanceCache.items[cacheKey]
	if ok && now.Before(entry.expiresAt) {
		providerPerformanceCache.Unlock()
		return entry.models, nil
	}
	if call, pending := providerPerformanceCache.calls[cacheKey]; pending {
		providerPerformanceCache.Unlock()
		select {
		case <-call.done:
			return call.models, call.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	call := &providerPerformanceCall{done: make(chan struct{})}
	providerPerformanceCache.calls[cacheKey] = call
	providerPerformanceCache.Unlock()

	models, err := provider.FetchPerformanceMetrics(ctx, baseURL, key, proxy, hours)
	providerPerformanceCache.Lock()
	if err == nil {
		providerPerformanceCache.items[cacheKey] = providerPerformanceCacheEntry{
			expiresAt: now.Add(providerPerformanceCacheTTL),
			models:    models,
		}
	}
	call.models = models
	call.err = err
	delete(providerPerformanceCache.calls, cacheKey)
	close(call.done)
	providerPerformanceCache.Unlock()
	return models, err
}

func aggregateProviderPerformanceModels(models []relaychannel.TaskPerformanceModel) *perfmetrics.ModelSummary {
	if len(models) == 0 {
		return nil
	}
	type intervalTotal struct {
		latency      int64
		successRate  float64
		tps          float64
		requestCount int64
		modelCount   int64
	}
	intervals := make(map[int64]intervalTotal)
	var latencyTotal int64
	var successRateTotal float64
	var tpsTotal float64
	for _, metric := range models {
		latencyTotal += metric.AvgLatencyMs
		successRateTotal += metric.SuccessRate
		tpsTotal += metric.AvgTps
		for _, point := range metric.RecentIntervals {
			total := intervals[point.Ts]
			total.latency += point.AvgLatencyMs
			total.successRate += point.SuccessRate
			total.tps += point.AvgTps
			total.requestCount += point.RequestCount
			total.modelCount++
			intervals[point.Ts] = total
		}
	}

	timestamps := make([]int64, 0, len(intervals))
	for timestamp := range intervals {
		timestamps = append(timestamps, timestamp)
	}
	slices.Sort(timestamps)
	series := make([]perfmetrics.PerformanceIntervalPoint, 0, len(timestamps))
	recentSuccess := make([]perfmetrics.SuccessRatePoint, 0, len(timestamps))
	for _, timestamp := range timestamps {
		total := intervals[timestamp]
		if total.modelCount == 0 {
			continue
		}
		successRate := math.Round(total.successRate/float64(total.modelCount)*100) / 100
		series = append(series, perfmetrics.PerformanceIntervalPoint{
			Ts:           timestamp,
			SuccessRate:  successRate,
			AvgLatencyMs: int64(math.Round(float64(total.latency) / float64(total.modelCount))),
			AvgTps:       math.Round(total.tps/float64(total.modelCount)*100) / 100,
			RequestCount: total.requestCount,
		})
		recentSuccess = append(recentSuccess, perfmetrics.SuccessRatePoint{Ts: timestamp, SuccessRate: successRate})
	}
	modelCount := float64(len(models))
	return &perfmetrics.ModelSummary{
		AvgLatencyMs:         int64(math.Round(float64(latencyTotal) / modelCount)),
		SuccessRate:          math.Round(successRateTotal/modelCount*100) / 100,
		AvgTps:               math.Round(tpsTotal/modelCount*100) / 100,
		RecentSuccessSeries:  recentSuccess,
		RecentIntervalSeries: series,
		ProviderFallback:     true,
	}
}
