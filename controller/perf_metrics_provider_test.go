package controller

import (
	"testing"

	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAggregateProviderPerformanceModelsUsesEqualModelWeightAndRealIntervals(t *testing.T) {
	result := aggregateProviderPerformanceModels([]relaychannel.TaskPerformanceModel{
		{
			ModelName: "omni_flash", AvgLatencyMs: 200, SuccessRate: 80, AvgTps: 2,
			RecentIntervals: []relaychannel.TaskPerformanceInterval{
				{Ts: 1_000, AvgLatencyMs: 100, SuccessRate: 90, AvgTps: 4},
				{Ts: 2_000, AvgLatencyMs: 300, SuccessRate: 70, AvgTps: 2},
			},
		},
		{
			ModelName: "veo_fast", AvgLatencyMs: 400, SuccessRate: 100, AvgTps: 6,
			RecentIntervals: []relaychannel.TaskPerformanceInterval{
				{Ts: 2_000, AvgLatencyMs: 500, SuccessRate: 90, AvgTps: 6},
			},
		},
	})

	require.NotNil(t, result)
	assert.True(t, result.ProviderFallback)
	assert.Equal(t, int64(300), result.AvgLatencyMs)
	assert.Equal(t, 90.0, result.SuccessRate)
	assert.Equal(t, 4.0, result.AvgTps)
	require.Len(t, result.RecentIntervalSeries, 2)
	assert.Equal(t, int64(1_000), result.RecentIntervalSeries[0].Ts)
	assert.Equal(t, 90.0, result.RecentIntervalSeries[0].SuccessRate)
	assert.Equal(t, int64(2_000), result.RecentIntervalSeries[1].Ts)
	assert.Equal(t, int64(400), result.RecentIntervalSeries[1].AvgLatencyMs)
	assert.Equal(t, 80.0, result.RecentIntervalSeries[1].SuccessRate)
	assert.Nil(t, aggregateProviderPerformanceModels(nil))
}

func TestMergeProviderPerformanceModelsPreservesLocalMetricsAndAddsMissingModels(t *testing.T) {
	local := []perfmetrics.ModelSummary{{ModelName: "local-model", SuccessRate: 99}}
	result := mergeProviderPerformanceModels(local, []relaychannel.TaskPerformanceModel{
		{ModelName: "local-model", SuccessRate: 50},
		{ModelName: "fdai-model", AvgLatencyMs: 1200, SuccessRate: 95, AvgTps: 3},
	})

	require.Len(t, result, 2)
	assert.Equal(t, "local-model", result[0].ModelName)
	assert.Equal(t, 99.0, result[0].SuccessRate)
	assert.Equal(t, "fdai-model", result[1].ModelName)
	assert.Equal(t, 95.0, result[1].SuccessRate)
	assert.True(t, result[1].ProviderFallback)
}
