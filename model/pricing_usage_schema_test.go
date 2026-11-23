package model

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/jsplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pricingUsagePluginSource(version, usageSchema string) string {
	return fmt.Sprintf(`
export const meta = {
  apiVersion: 1, key: "pricing-usage-probe", name: "Pricing Usage Probe", version: %q, author: {name: "Test"},
  models: ["pricing-usage-model"], fetchMode: "per_task", usageSchema: %s
};
export function buildSubmitRequest() { return {}; }
export function parseSubmitResponse() { return {}; }
export function buildQueryRequest() { return {}; }
export function parseTaskResult() { return {}; }
`, version, usageSchema)
}

func TestChannelScopedTaskModelCanSaveDurationPricing(t *testing.T) {
	resetPricingEndpointTestTables(t)
	require.NoError(t, DB.AutoMigrate(&Option{}))
	originalOptionMap := common.OptionMap
	common.OptionMap = make(map[string]string)
	t.Cleanup(func() { common.OptionMap = originalOptionMap })
	const modelName = "test-channel-video"
	const pluginKey = "test-channel-duration"
	source := strings.Replace(pricingUsagePluginSource("1.0.0", `{
		seconds: {type: "number", unit: "second", description: "Video generation unit price"}
	}`), `key: "pricing-usage-probe"`, `key: "test-channel-duration", modelScope: "channel", protocols: ["openai_video"]`, 1)
	source += `
export const protocols = {openai_video: {decodeRequest() {}, render() {}}};
export function listArtifacts() { return []; }
export function buildContentRequest() { return {}; }
`
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(pluginKey) })

	video := Channel{Id: 933, Type: constant.ChannelTypeTaskPlugin, Status: common.ChannelStatusEnabled, Models: modelName}
	video.SetSetting(dto.ChannelSettings{TaskPluginKey: pluginKey})
	require.NoError(t, DB.Create(&video).Error)
	insertPricingEndpointAbility(t, video.Id, modelName)
	image := Channel{Id: 934, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: "test-channel-image"}
	image.SetSetting(dto.ChannelSettings{TaskPluginKey: pluginKey})
	require.NoError(t, DB.Create(&image).Error)

	const expression = `tier("base", ceil(u("seconds") / 12) * 0.3)`
	const perSecond = `tier("base", u("seconds") * 0.1)`
	draft := PricingValues{billing_setting.PluginBillingExprOption: map[string]any{pluginKey: expression}}
	snapshot, err := GetModelPricingSnapshot([]string{modelName})
	require.NoError(t, err)
	require.Len(t, snapshot.Entries, 1)
	entry := snapshot.Entries[0]
	require.Len(t, entry.PluginVariants, 1)
	assert.Equal(t, "second", entry.PluginVariants[0].UsageSchema["seconds"].Unit)
	_, err = PreviewModelPricing(modelName, PricingValues{"billing_setting.billing_expr": perSecond})
	require.NoError(t, err)
	_, err = PreviewModelPricing(modelName, draft)
	require.NoError(t, err)
	assert.Error(t, ValidateModelPricing("test-channel-image", draft))
	require.NoError(t, UpdateModelPricing([]ModelPricingChange{{
		ModelName: modelName, ExpectedVersion: entry.Version, Pricing: draft,
	}}))
	t.Cleanup(func() {
		saved, err := GetModelPricingSnapshot([]string{modelName})
		require.NoError(t, err)
		require.NoError(t, UpdateModelPricing([]ModelPricingChange{{
			ModelName: modelName, ExpectedVersion: saved.Entries[0].Version, Reset: true,
		}}))
	})
	assert.Equal(t, "second", pricingByModel(GetPricing())[modelName].BillingUsageSchema["seconds"].Unit)
	saved, err := GetModelPricingSnapshot([]string{modelName})
	require.NoError(t, err)
	assert.Equal(t, expression, saved.Entries[0].PluginVariants[0].Effective)
	for _, tc := range []struct {
		seconds   float64
		perSecond float64
		perBlock  float64
	}{
		{0, 0, 0},
		{1, 0.1, 0.3},
		{12, 1.2, 0.3},
		{13, 1.3, 0.6},
		{24, 2.4, 0.6},
	} {
		request := billingexpr.RequestInput{Usage: map[string]any{"seconds": tc.seconds}}
		blocks, _, err := billingexpr.RunExprWithRequest(saved.Entries[0].PluginVariants[0].Effective, billingexpr.TokenParams{}, request)
		require.NoError(t, err)
		assert.InDelta(t, tc.perBlock, blocks, 0.000001, "seconds=%g", tc.seconds)
		seconds, _, err := billingexpr.RunExprWithRequest(perSecond, billingexpr.TokenParams{}, request)
		require.NoError(t, err)
		assert.InDelta(t, tc.perSecond, seconds, 0.000001, "seconds=%g", tc.seconds)
	}

	require.NoError(t, DB.Model(&image).Update("models", modelName).Error)
	mixed, err := GetModelPricingSnapshot([]string{modelName})
	require.NoError(t, err)
	assert.Empty(t, mixed.Entries[0].UsageSchema)
	require.Len(t, mixed.Entries[0].PluginVariants, 1)
	assert.True(t, mixed.Entries[0].PluginVariants[0].ProviderOnly)
	assert.ErrorContains(t, ValidateModelPricing(modelName, PricingValues{"billing_setting.billing_expr": expression}), "separately for its provider")
	require.NoError(t, ValidateModelPricing(modelName, draft))

	require.NoError(t, DB.Model(&video).Update("status", common.ChannelStatusManuallyDisabled).Error)
	disabled, err := GetModelPricingSnapshot([]string{modelName})
	require.NoError(t, err)
	require.Len(t, disabled.Entries[0].PluginVariants, 1)
	assert.True(t, disabled.Entries[0].PluginVariants[0].Stale)
}

func TestPricingCarriesTaskUsageSchemaAndRefreshesWithPluginGeneration(t *testing.T) {
	resetPricingEndpointTestTables(t)
	const pluginKey = "pricing-usage-probe"
	initialSource := pricingUsagePluginSource("1.0.0", `{
  seconds: {type: "number", unit: "second", description: "Estimated duration."},
  action: {enum:["video"],enumLabels:{video:{en:"Generate video",zh:"生成视频"}}}
}`)
	_, err := jsplugin.DefaultRegistry.Register(initialSource, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(pluginKey) })

	insertPricingEndpointChannel(t, 901, constant.ChannelTypeTaskPlugin, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 901, "pricing-usage-model")
	insertPricingEndpointAbility(t, 901, "ordinary-model")

	initialPricing := pricingByModel(GetPricing())
	require.Contains(t, initialPricing, "pricing-usage-model")
	require.Contains(t, initialPricing, "ordinary-model")
	assert.Equal(t, "second", initialPricing["pricing-usage-model"].BillingUsageSchema["seconds"].Unit)
	assert.Equal(t, "Estimated duration.", initialPricing["pricing-usage-model"].BillingUsageSchema["seconds"].Description["en"])
	assert.Equal(t, "生成视频", initialPricing["pricing-usage-model"].BillingUsageSchema["action"].EnumLabels["video"]["zh"])
	assert.Nil(t, initialPricing["ordinary-model"].BillingUsageSchema)

	updatedSource := pricingUsagePluginSource("1.1.0", `{
  seconds: {type: "number", unit: "second", description: "Measured duration."},
  clips: {type: "number", unit: "count", description: "Generated clip count."}
}`)
	_, err = jsplugin.DefaultRegistry.Register(updatedSource, jsplugin.Options{})
	require.NoError(t, err)
	lastGetPricingTime = time.Now().Add(-2 * time.Minute)

	refreshedPricing := pricingByModel(GetPricing())
	require.Len(t, refreshedPricing["pricing-usage-model"].BillingUsageSchema, 2)
	assert.Equal(t, "Measured duration.", refreshedPricing["pricing-usage-model"].BillingUsageSchema["seconds"].Description["en"])
	assert.Equal(t, "count", refreshedPricing["pricing-usage-model"].BillingUsageSchema["clips"].Unit)
}

func TestPricingAliasCarriesPluginUsageSchemaAndTailExpr(t *testing.T) {
	resetPricingEndpointTestTables(t)
	const pluginKey = "pricing-usage-probe"
	source := pricingUsagePluginSource("1.0.0", `{
  seconds: {type: "number", unit: "second", description: "Estimated duration."}
}`)
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(pluginKey) })

	mapping := `{"alias-model":"pricing-usage-model"}`
	channel := &Channel{
		Id:           910,
		Type:         constant.ChannelTypeTaskPlugin,
		Key:          "key-910",
		Status:       1,
		Name:         "channel-910",
		Models:       "alias-model,pricing-usage-model",
		ModelMapping: &mapping,
	}
	require.NoError(t, DB.Create(channel).Error)
	insertPricingEndpointAbility(t, 910, "alias-model")
	insertPricingEndpointAbility(t, 910, "pricing-usage-model")
	InitChannelCache()

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
	})
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"pricing-usage-model":"tiered_expr","alias-own-expr":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"pricing-usage-model":"u(\"seconds\")","alias-own-expr":"u(\"seconds\") * 2"}`,
	}))
	InvalidatePricingCache()

	pricing := pricingByModel(GetPricing())
	require.Contains(t, pricing, "alias-model")
	require.Contains(t, pricing, "pricing-usage-model")
	assert.Equal(t, "second", pricing["alias-model"].BillingUsageSchema["seconds"].Unit)
	assert.Equal(t, "Estimated duration.", pricing["alias-model"].BillingUsageSchema["seconds"].Description["en"])
	assert.Equal(t, "tiered_expr", pricing["alias-model"].BillingMode)
	assert.Equal(t, `u("seconds")`, pricing["alias-model"].BillingExpr)
	assert.Equal(t, "tiered_expr", pricing["pricing-usage-model"].BillingMode)
	assert.Equal(t, `u("seconds")`, pricing["pricing-usage-model"].BillingExpr)

	ownMapping := `{"alias-own-expr":"pricing-usage-model"}`
	own := &Channel{
		Id:           911,
		Type:         constant.ChannelTypeTaskPlugin,
		Key:          "key-911",
		Status:       1,
		Name:         "channel-911",
		Models:       "alias-own-expr,pricing-usage-model",
		ModelMapping: &ownMapping,
	}
	require.NoError(t, DB.Create(own).Error)
	insertPricingEndpointAbility(t, 911, "alias-own-expr")
	InitChannelCache()
	InvalidatePricingCache()

	refreshed := pricingByModel(GetPricing())
	assert.Equal(t, `u("seconds") * 2`, refreshed["alias-own-expr"].BillingExpr)
	assert.Equal(t, "second", refreshed["alias-own-expr"].BillingUsageSchema["seconds"].Unit)
}

func pricingByModel(pricings []Pricing) map[string]Pricing {
	result := make(map[string]Pricing, len(pricings))
	for _, pricing := range pricings {
		result[pricing.ModelName] = pricing
	}
	return result
}

func TestPricingUsageProfilesAndAliases(t *testing.T) {
	resetPricingEndpointTestTables(t)
	require.NoError(t, DB.AutoMigrate(&Option{}))
	const key = "pricing-profiles"
	const source = `
export const meta = {
 apiVersion:1,key:"pricing-profiles",name:"Pricing Profiles",version:"1.0.0",author:{name:"Test"},
 models:["profile-image","profile-video"],fetchMode:"per_task",
 usageSchema:{fallback:{type:"number",unit:"count"}},
 usageExamples:[{label:"default",facts:{fallback:1}}],
 usageProfiles:[
  {models:["profile-image"],schema:{image_count:{type:"number",unit:"count"}}},
  {models:["profile-video"],schema:{seconds:{type:"number",unit:"second"}},examples:[{label:"5 seconds",facts:{seconds:5}}]}
 ]
};
export function buildSubmitRequest(){return {};}
export function parseSubmitResponse(){return {};}
export function buildQueryRequest(){return {};}
export function parseTaskResult(){return {};}
`
	_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
	require.NoError(t, err)
	t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(key) })
	for index, mapping := range []string{
		`{"image-alias":"profile-image","video-alias":"profile-video","ambiguous-alias":"profile-image"}`,
		`{"ambiguous-alias":"profile-video"}`,
	} {
		id := 920 + index
		require.NoError(t, DB.Create(&Channel{
			Id: id, Type: constant.ChannelTypeTaskPlugin, Status: 1, Name: fmt.Sprintf("channel-%d", id),
			Models: "profile-image,profile-video,image-alias,video-alias,ambiguous-alias", ModelMapping: &mapping,
		}).Error)
		for _, name := range []string{"profile-image", "profile-video", "image-alias", "video-alias", "ambiguous-alias"} {
			insertPricingEndpointAbility(t, id, name)
		}
	}
	InitChannelCache()
	pricing := pricingByModel(GetPricing())
	names := []string{"profile-image", "profile-video", "image-alias", "video-alias", "ambiguous-alias"}
	snapshot, err := GetModelPricingSnapshot(names)
	require.NoError(t, err)
	entries := make(map[string]ModelPricingEntry, len(snapshot.Entries))
	for _, entry := range snapshot.Entries {
		entries[entry.ModelName] = entry
	}
	for _, tc := range []struct {
		name, field, unit string
		wantExamples      int
	}{
		{"profile-image", "image_count", "count", 0},
		{"profile-video", "seconds", "second", 1},
		{"image-alias", "image_count", "count", 0},
		{"video-alias", "seconds", "second", 1},
		{"ambiguous-alias", "fallback", "count", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			expected := map[string]jsplugin.UsageFieldSchema{tc.field: {Type: "number", Unit: tc.unit}}
			assert.Equal(t, expected, pricing[tc.name].BillingUsageSchema)
			assert.Equal(t, expected, entries[tc.name].UsageSchema)
			assert.Len(t, pricing[tc.name].BillingUsageExamples, tc.wantExamples)
			require.NoError(t, ValidateModelPricing(tc.name, PricingValues{"billing_setting.billing_expr": `u("` + tc.field + `")`}))
			require.ErrorContains(t, ValidateModelPricing(tc.name, PricingValues{"billing_setting.billing_expr": `u("missing")`}), "not declared")
		})
	}
	require.ErrorContains(t, ValidateModelPricing("profile-image", PricingValues{"billing_setting.billing_expr": `u("seconds")`}), "not declared")
	require.ErrorContains(t, ValidateModelPricing("video-alias", PricingValues{"billing_setting.billing_expr": `u("image_count")`}), "not declared")

	updated := strings.Replace(source, `version:"1.0.0"`, `version:"1.1.0"`, 1)
	updated = strings.Replace(updated, `image_count:{type:"number",unit:"count"}`, `images:{type:"number",unit:"count"}`, 1)
	_, err = jsplugin.DefaultRegistry.Register(updated, jsplugin.Options{})
	require.NoError(t, err)
	InvalidatePricingCache()
	refreshed := pricingByModel(GetPricing())
	assert.Equal(t, map[string]jsplugin.UsageFieldSchema{"images": {Type: "number", Unit: "count"}}, refreshed["image-alias"].BillingUsageSchema)
	assert.Equal(t, "second", refreshed["profile-video"].BillingUsageSchema["seconds"].Unit)
}

func TestPricingSharedPluginVariantsUseEachSchemaAndExpression(t *testing.T) {
	resetPricingEndpointTestTables(t)
	saved := config.GlobalConfig.ExportAllConfigs()
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })
	for _, spec := range []struct{ key, field, unit string }{{"pricing-alpha", "seconds", "second"}, {"pricing-beta", "credits", "credit"}} {
		source := strings.ReplaceAll(pricingUsagePluginSource("1.0.0", `{`+spec.field+`:{type:"number",unit:"`+spec.unit+`"}}`), "pricing-usage-probe", spec.key)
		_, err := jsplugin.DefaultRegistry.Register(source, jsplugin.Options{})
		require.NoError(t, err)
		t.Cleanup(func() { jsplugin.DefaultRegistry.Unregister(spec.key) })
	}
	insertPricingEndpointChannel(t, 930, constant.ChannelTypeTaskPlugin, dto.ChannelOtherSettings{})
	insertPricingEndpointAbility(t, 930, "pricing-usage-model")
	const expression = `tier("base", u("seconds") * 0.4)`
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":          `{"pricing-usage-model":"tiered_expr"}`,
		"billing_setting.billing_expr":          `{"pricing-usage-model":"tier(\"base\", u(\"seconds\") * 0.4)"}`,
		billing_setting.PluginBillingExprOption: `{}`,
	}))
	prices := pricingByModel(GetPricing())
	variants := prices["pricing-usage-model"].BillingPluginVariants
	require.Len(t, variants, 2)
	assert.Equal(t, "pricing-alpha", variants[0].PluginKey)
	assert.Equal(t, "pricing-beta", variants[1].PluginKey)
	assert.Equal(t, expression, variants[0].BillingExpr)
	assert.Empty(t, variants[1].BillingExpr)
	assert.Equal(t, "credit", variants[1].BillingUsageSchema["credits"].Unit)
	assert.Equal(t, expression, prices["pricing-usage-model"].BillingExpr)
	assert.Contains(t, prices["pricing-usage-model"].BillingUsageSchema, "seconds")
	draft := PricingValues{"billing_setting.billing_expr": expression}
	require.ErrorContains(t, ValidateModelPricing("pricing-usage-model", draft), "plugin pricing-beta")
	draft[billing_setting.PluginBillingExprOption] = map[string]any{"pricing-beta": `tier("beta", u("credits") * 2)`}
	require.NoError(t, ValidateModelPricing("pricing-usage-model", draft))
	for _, invalid := range []any{map[string]any{"missing": "1"}, map[string]any{"pricing-beta": float64(1)}, map[string]any{"pricing-beta": `u("seconds")`}, map[string]any(nil), []any{}, "invalid"} {
		draft[billing_setting.PluginBillingExprOption] = invalid
		assert.Error(t, ValidateModelPricing("pricing-usage-model", draft))
	}
	draft = PricingValues{
		"billing_setting.billing_expr":          "invalid expression(",
		billing_setting.PluginBillingExprOption: map[string]any{"pricing-alpha": expression, "pricing-beta": `u("credits")`},
	}
	require.ErrorContains(t, ValidateModelPricing("pricing-usage-model", draft), "compile")
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		billing_setting.PluginBillingExprOption: `{"pricing-beta::pricing-usage-model":"tier(\"beta\", u(\"credits\") * 2)"}`,
	}))
	InvalidatePricingCache()
	priced := pricingByModel(GetPricing())["pricing-usage-model"].BillingPluginVariants
	require.Len(t, priced, 2)
	assert.Equal(t, `tier("beta", u("credits") * 2)`, priced[1].BillingExpr)
	previousPrice := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(previousPrice)) })
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"pricing-usage-model":0.25}`))
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"billing_setting.billing_mode": `{"pricing-usage-model":"ratio"}`}))
	InvalidatePricingCache()
	mixed := pricingByModel(GetPricing())["pricing-usage-model"].BillingPluginVariants
	require.Len(t, mixed, 2)
	assert.Equal(t, billing_setting.BillingModeRatio, mixed[0].BillingMode)
	assert.Equal(t, billing_setting.BillingModeTieredExpr, mixed[1].BillingMode)
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{billing_setting.PluginBillingExprOption: `{}`}))
	InvalidatePricingCache()
	perCall := pricingByModel(GetPricing())["pricing-usage-model"]
	assert.Empty(t, perCall.BillingPluginVariants)
	assert.Equal(t, 1, perCall.QuotaType)
	assert.Equal(t, 0.25, perCall.ModelPrice)
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		billing_setting.PluginBillingExprOption: `{"pricing-beta::pricing-usage-model":"tier(\"beta\", u(\"credits\") * 2)"}`,
	}))
	require.NoError(t, jsplugin.DefaultRegistry.Unregister("pricing-alpha"))
	InvalidatePricingCache()
	single := pricingByModel(GetPricing())["pricing-usage-model"]
	require.Len(t, single.BillingPluginVariants, 1)
	assert.Equal(t, "pricing-beta", single.BillingPluginVariants[0].PluginKey)
	assert.Equal(t, `tier("beta", u("credits") * 2)`, single.BillingPluginVariants[0].BillingExpr)
	encoded, err := common.Marshal(single)
	require.NoError(t, err)
	assert.Contains(t, string(encoded), "billing_plugin_variants")
}
