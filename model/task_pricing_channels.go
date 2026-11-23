package model

import (
	"maps"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"gorm.io/gorm"
)

type taskPricingChannels struct {
	byModel        map[string]map[string]string
	ordinaryModels map[string]bool
}

func loadTaskPricingChannels(db *gorm.DB, generation *jsplugin.RoutingGeneration) (taskPricingChannels, error) {
	index := taskPricingChannels{
		byModel:        make(map[string]map[string]string),
		ordinaryModels: make(map[string]bool),
	}
	if db == nil || !slices.ContainsFunc(generation.Plugins(), func(plugin *jsplugin.LoadedPlugin) bool {
		return plugin.Meta.ModelScope == "channel"
	}) {
		return index, nil
	}
	var channels []Channel
	err := db.Select("id", "type", "models", "setting", "model_mapping").
		Where("status = ?", common.ChannelStatusEnabled).Find(&channels).Error
	if err != nil {
		return index, err
	}
	for i := range channels {
		channel := &channels[i]
		if channel.Type != constant.ChannelTypeTaskPlugin {
			for _, model := range channel.GetModels() {
				index.ordinaryModels[model] = true
			}
			continue
		}
		var settings dto.ChannelSettings
		if channel.Setting == nil || common.UnmarshalJsonStr(*channel.Setting, &settings) != nil {
			continue
		}
		plugin, enabled := generation.Get(strings.TrimSpace(settings.TaskPluginKey))
		if !enabled || plugin.Meta.ModelScope != "channel" ||
			!slices.ContainsFunc(plugin.Meta.Protocols, func(claim jsplugin.ProtocolClaim) bool {
				return len(claim.Models) == 0
			}) {
			continue
		}
		var mapping map[string]string
		if value := channel.GetModelMapping(); value != "" && common.UnmarshalJsonStr(value, &mapping) != nil {
			continue
		}
		for _, name := range channel.GetModels() {
			mapped, cyclic := followChannelModelMapping(mapping, name)
			if name == "" || cyclic {
				continue
			}
			providers := index.byModel[name]
			if providers == nil {
				providers = make(map[string]string)
				index.byModel[name] = providers
			}
			if previous, exists := providers[plugin.Meta.Key]; exists && previous != mapped {
				mapped = ""
			}
			providers[plugin.Meta.Key] = mapped
		}
	}
	return index, nil
}

func (index taskPricingChannels) providers(generation *jsplugin.RoutingGeneration, model string) map[string]string {
	providers := make(map[string]string)
	for _, plugin := range generation.PluginsByModel(model) {
		providers[plugin.Meta.Key] = model
	}
	maps.Copy(providers, index.byModel[model])
	return providers
}

func (index taskPricingChannels) requiresProviderPricing(model string) bool {
	return len(index.byModel[model]) > 0 && index.ordinaryModels[model]
}
