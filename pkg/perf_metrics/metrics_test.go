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
