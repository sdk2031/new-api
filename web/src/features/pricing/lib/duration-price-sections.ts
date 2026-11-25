/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { PricingModel } from '../types'
import {
  splitBillingExprAndRequestRules,
  type TaskTierCondition,
} from './billing-expr'
import { hasDynamicRequestRules } from './dynamic-price'
import { getTaskPricingDisplayTiers } from './task-matrix-display'

export type DurationPriceRow = {
  resolution?: string
  audio?: string
  price: number
  fallback: boolean
}

export type DurationPriceSection = {
  key: string
  conditions: TaskTierCondition[]
  interval: number
  rows: DurationPriceRow[]
}

export function getDurationPriceSections(model: PricingModel) {
  const schema = model.billing_usage_schema
  if (
    !schema ||
    (!schema.resolution && !model.output_modalities?.includes('video'))
  ) {
    return null
  }
  if (model.billing_mode !== 'tiered_expr' || !model.billing_expr) return null
  const expression = splitBillingExprAndRequestRules(model.billing_expr)
  if (expression.requestRuleExpr?.trim() || hasDynamicRequestRules(model)) {
    return null
  }

  const tiers = getTaskPricingDisplayTiers(expression.billingExpr, schema)
  if (!tiers.length) return null
  const sections = new Map<string, DurationPriceSection>()
  let durationField: string | undefined
  for (const [index, tier] of tiers.entries()) {
    const prices = Object.entries(tier.unitPrices)
    if (tier.constant !== 0 || prices.length !== 1) return null
    const [field, price] = prices[0]
    if (
      schema[field]?.unit !== 'second' ||
      (durationField && durationField !== field)
    ) {
      return null
    }
    durationField = field

    // Overlapping explicit conditions depend on rule order; keep the generic view.
    if (
      tier.conditions.length &&
      tiers
        .slice(0, index)
        .some(
          (previous) =>
            !previous.conditions.some((condition) =>
              tier.conditions.some(
                (current) =>
                  current.field === condition.field &&
                  current.value !== condition.value
              )
            )
        )
    ) {
      return null
    }

    const conditions = tier.conditions
      .filter(
        ({ field }) => field !== 'resolution' && field !== 'generate_audio'
      )
      .sort((left, right) => left.field.localeCompare(right.field))
    const interval = tier.billingInterval ?? 1
    const key = JSON.stringify([conditions, interval])
    const section = sections.get(key) ?? { key, conditions, interval, rows: [] }
    section.rows.push({
      resolution: tier.conditions.find(({ field }) => field === 'resolution')
        ?.value,
      audio: tier.conditions.find(({ field }) => field === 'generate_audio')
        ?.value,
      price,
      fallback: tiers.length > 1 && tier.conditions.length === 0,
    })
    sections.set(key, section)
  }
  return { sections: [...sections.values()], schema }
}
