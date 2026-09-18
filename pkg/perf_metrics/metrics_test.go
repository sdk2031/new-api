package perfmetrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildModelSummaryAggregatesTrafficAcrossModels(t *testing.T) {
	buckets := map[int64]counters{
		3_600: {requestCount: 4, successCount: 3},
		7_200: {requestCount: 6, successCount: 6},
	}
	total := counters{
		requestCount:   10,
		successCount:   9,
		totalLatencyMs: 2_500,
		outputTokens:   200,
		generationMs:   4_000,
	}

	summary := buildModelSummary("", total, buckets)

	assert.Equal(t, int64(250), summary.AvgLatencyMs)
	assert.Equal(t, 90.0, summary.SuccessRate)
	assert.Equal(t, 50.0, summary.AvgTps)
	require.Len(t, summary.RecentSuccessSeries, 2)
	assert.Equal(t, SuccessRatePoint{Ts: 3_600, SuccessRate: 75}, summary.RecentSuccessSeries[0])
	assert.Equal(t, SuccessRatePoint{Ts: 7_200, SuccessRate: 100}, summary.RecentSuccessSeries[1])
}

func TestRecentIntervalSeriesAggregatesFiveMinuteMetrics(t *testing.T) {
	buckets := map[int64]counters{
		301: {
			requestCount:   2,
			successCount:   1,
			totalLatencyMs: 600,
			outputTokens:   20,
			generationMs:   1_000,
		},
		599: {
			requestCount:   3,
			successCount:   3,
			totalLatencyMs: 900,
			outputTokens:   30,
			generationMs:   1_500,
		},
		601: {
			requestCount:   2,
			successCount:   2,
			totalLatencyMs: 1_000,
			outputTokens:   18,
			generationMs:   2_000,
		},
	}

	series := recentIntervalSeries(buckets)

	require.Len(t, series, 2)
	assert.Equal(t, PerformanceIntervalPoint{
		Ts:           300,
		SuccessRate:  80,
		AvgLatencyMs: 300,
		AvgTps:       20,
		RequestCount: 5,
	}, series[0])
	assert.Equal(t, PerformanceIntervalPoint{
		Ts:           600,
		SuccessRate:  100,
		AvgLatencyMs: 500,
		AvgTps:       9,
		RequestCount: 2,
	}, series[1])
}
