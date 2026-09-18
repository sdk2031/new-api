package controller

import (
	"net/http"
	"strconv"

	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

func GetPerfMetricsSummary(c *gin.Context) {
	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	groupInfo, visibleGroups := getVisiblePerfMetricGroups(c)
	activeGroups := lo.Keys(visibleGroups)
	requestedGroup := c.Query("group")
	if requestedGroup != "" {
		if _, ok := visibleGroups[requestedGroup]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "invalid group",
			})
			return
		}
		activeGroups = []string{requestedGroup}
	}
	result, err := perfmetrics.QuerySummaryAll(hours, activeGroups)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}
	providerModels := getProviderPerformanceModels(c.Request.Context(), activeGroups, hours)
	result.Models = mergeProviderPerformanceModels(result.Models, providerModels)
	if requestedGroup != "" && result.Aggregate == nil {
		result.Aggregate = aggregateProviderPerformanceModels(providerModels)
	}
	result.Groups = groupInfo

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

func GetPerfMetrics(c *gin.Context) {
	modelName := c.Query("model")
	if modelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "model is required",
		})
		return
	}

	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	_, visibleGroups := getVisiblePerfMetricGroups(c)
	group := c.Query("group")
	if group != "" {
		if _, ok := visibleGroups[group]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": "invalid group",
			})
			return
		}
	}

	result, err := perfmetrics.Query(perfmetrics.QueryParams{
		Model: modelName,
		Group: group,
		Hours: hours,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	result.Groups = lo.Filter(result.Groups, func(group perfmetrics.GroupResult, _ int) bool {
		_, ok := visibleGroups[group.Group]
		return ok
	})

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

func getVisiblePerfMetricGroups(c *gin.Context) ([]perfmetrics.GroupSummaryInfo, map[string]struct{}) {
	userGroup := c.GetString("group")
	usableGroups := service.GetUserUsableGroups(userGroup)
	groupRatios := ratio_setting.GetGroupRatioCopy()
	groupInfo := make([]perfmetrics.GroupSummaryInfo, 0, len(groupRatios))
	visibleGroups := make(map[string]struct{}, len(groupRatios))

	for _, group := range ratio_setting.GetOrderedGroupNames() {
		if _, ok := usableGroups[group]; !ok {
			continue
		}

		groupInfo = append(groupInfo, perfmetrics.GroupSummaryInfo{
			Group:     group,
			Ratio:     service.GetUserGroupRatio(userGroup, group),
			SortOrder: ratio_setting.GetGroupOrder(group),
		})
		visibleGroups[group] = struct{}{}
	}

	return groupInfo, visibleGroups
}
