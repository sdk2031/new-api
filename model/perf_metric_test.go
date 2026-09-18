package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetLatestPerfMetricsSummaryBucketsBeforeUsesLatestMatchingBucket(t *testing.T) {
	truncateTables(t)
	metrics := []PerfMetric{
		{ModelName: "model-a", Group: "alpha", BucketTs: 100, RequestCount: 1, SuccessCount: 1},
		{ModelName: "model-a", Group: "alpha", BucketTs: 200, RequestCount: 2, SuccessCount: 1},
		{ModelName: "model-b", Group: "alpha", BucketTs: 200, RequestCount: 3, SuccessCount: 3},
		{ModelName: "model-a", Group: "alpha", BucketTs: 300, RequestCount: 4, SuccessCount: 4},
		{ModelName: "model-c", Group: "beta", BucketTs: 250, RequestCount: 5, SuccessCount: 5},
	}
	require.NoError(t, DB.Create(&metrics).Error)

	rows, err := GetLatestPerfMetricsSummaryBucketsBefore(275, []string{"alpha"})
	require.NoError(t, err)
	require.Len(t, rows, 2)
	assert.Equal(t, int64(200), rows[0].BucketTs)
	assert.Equal(t, int64(200), rows[1].BucketTs)
	assert.ElementsMatch(t, []string{"model-a", "model-b"}, []string{rows[0].ModelName, rows[1].ModelName})

	empty, err := GetLatestPerfMetricsSummaryBucketsBefore(100, []string{"alpha"})
	require.NoError(t, err)
	assert.Empty(t, empty)
}
