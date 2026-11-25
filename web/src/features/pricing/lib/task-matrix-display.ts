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
import type { BillingUsageSchema, PricingModel } from '../types'
import {
  parseTaskTiersFromExpr,
  splitBillingExprAndRequestRules,
  type ParsedTaskTier,
  type TaskTierCondition,
} from './billing-expr'
import { compileBillingExpression } from './billing-expression/parser'
import {
  getTaskNumberFields,
  getTaskEnumFields,
  taskMatrixRowLabel,
  tryParseTaskMatrixConfig,
} from './task-expr'

export type DurationPrice = { interval: number; price: number }
export const DURATION_DEFAULT_TIER = 'duration_default'

export function parseBillingInterval(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const interval = Number(value)
  return Number.isSafeInteger(interval) && interval > 0 ? interval : null
}

export function parseDurationPrice(
  expression: string,
  field?: string
): DurationPrice | null {
  if (!field) return null
  const match =
    /^tier\("(?:base|duration|duration_default)",\s*(?:ceil\((u\("[^"]+"\))\s*\/\s*(\d+)\)|(u\("[^"]+"\)))\s*\*\s*([\d.eE+-]+)\)$/.exec(
      expression.trim()
    )
  if (!match || (match[1] ?? match[3]) !== `u(${JSON.stringify(field)})`) {
    return null
  }
  const interval = parseBillingInterval(match[2] ?? '1')
  const price = Number(match[4])
  if (interval === null || !Number.isFinite(price) || price < 0) return null
  if (match[1] && interval === 1) return null
  return { interval, price }
}

export function parseResolutionDurationTiers(
  expression: string,
  field: string,
  resolutions: readonly string[]
): ParsedTaskTier[] | null {
  if (resolutions.length === 0) return null
  const { billingExpr } = splitBillingExprAndRequestRules(expression)
  const compiled = compileBillingExpression(billingExpr)
  if (compiled.status !== 'ready') return null
  const tiers: ParsedTaskTier[] = []
  const remaining = new Set(resolutions)
  let node = compiled.ast
  let interval: number | undefined
  while (node.kind === 'conditional') {
    const condition = node.condition
    if (
      condition.kind !== 'binary' ||
      condition.operator !== '==' ||
      condition.left.kind !== 'call' ||
      condition.left.name !== 'u' ||
      condition.left.args[0]?.kind !== 'literal' ||
      condition.left.args[0].value !== 'resolution' ||
      condition.right.kind !== 'literal' ||
      typeof condition.right.value !== 'string' ||
      !remaining.delete(condition.right.value)
    ) {
      return null
    }
    const rate = parseDurationPrice(
      billingExpr.slice(node.yes.start, node.yes.end),
      field
    )
    if (!rate || (interval !== undefined && interval !== rate.interval)) {
      return null
    }
    interval = rate.interval
    tiers.push({
      label: condition.right.value,
      conditions: [{ field: 'resolution', value: condition.right.value }],
      constant: 0,
      unitPrices: { [field]: rate.price },
      billingInterval: rate.interval > 1 ? rate.interval : undefined,
    })
    node = node.no
  }
  if (interval === undefined) return null
  const fallback = parseDurationPrice(
    billingExpr.slice(node.start, node.end),
    field
  )
  if (!fallback || fallback.interval !== interval) return null
  const explicitDefault =
    node.kind === 'call' &&
    node.name === 'tier' &&
    node.args[0]?.kind === 'literal' &&
    node.args[0].value === DURATION_DEFAULT_TIER
  // Older rules use the last configured resolution as their catch-all.
  if (!explicitDefault && remaining.size !== 1) return null
  const [resolution] = remaining
  return [
    ...tiers,
    {
      label: explicitDefault ? DURATION_DEFAULT_TIER : resolution,
      conditions: explicitDefault
        ? []
        : [{ field: 'resolution', value: resolution }],
      constant: 0,
      unitPrices: { [field]: fallback.price },
      billingInterval: interval > 1 ? interval : undefined,
    },
  ]
}

const durationDisplaySchema: BillingUsageSchema = {
  seconds: { type: 'number', unit: 'second' },
}

// Older catalog snapshots may omit plugin metadata. Infer the display unit
// only for the exact seconds formula emitted by the duration pricing editor.
export function getTaskPricingDisplaySchema(
  model: PricingModel
): BillingUsageSchema | undefined {
  const schema = model.billing_usage_schema
  if (schema && Object.keys(schema).length > 0) return schema
  if (model.billing_mode !== 'tiered_expr' || !model.billing_expr) return schema
  const { billingExpr } = splitBillingExprAndRequestRules(model.billing_expr)
  return parseDurationPrice(billingExpr, 'seconds')
    ? durationDisplaySchema
    : schema
}

/**
 * Marketplace display helper: expand a recognized task matrix (flat/uniform
 * or a full enum partition) into one row per combination. Returns null when
 * the schema has no enum fields or the expression is not a recognized matrix,
 * so callers keep the raw parsed-tier display.
 */
export function getTaskMatrixDisplayTiers(
  expression: string | null | undefined,
  schema: BillingUsageSchema | null | undefined
): ParsedTaskTier[] | null {
  if (!schema) return null
  if (getTaskEnumFields(schema).length === 0) return null

  const matrix = tryParseTaskMatrixConfig(expression, schema)
  if (!matrix) return null

  return matrix.rows.map((row) => ({
    label: taskMatrixRowLabel(row.combination),
    conditions: Object.entries(row.combination)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, value]) => ({ field, value })),
    constant: row.constant,
    unitPrices: { ...row.unitPrices },
  }))
}

/** Display explicit conditions for a fallback only when its complement is unique.
 * Unlike the editor matrix, unrelated schema fields do not expand the price table.
 */
export function getTaskPricingDisplayTiers(
  expression: string | null | undefined,
  schema: BillingUsageSchema | null | undefined
): ParsedTaskTier[] {
  const durationFields = getTaskNumberFields(schema ?? undefined).filter(
    ([, field]) => field.unit === 'second'
  )
  if (durationFields.length === 1) {
    const [field] = durationFields[0]
    const resolutionTiers = parseResolutionDurationTiers(
      expression || '',
      field,
      schema?.resolution?.enum ?? []
    )
    if (resolutionTiers) return resolutionTiers
    const duration = parseDurationPrice(expression || '', field)
    if (duration && duration.interval > 1) {
      return [
        {
          label: expression?.trim().startsWith('tier("duration",')
            ? 'duration'
            : 'base',
          conditions: [],
          constant: 0,
          unitPrices: { [field]: duration.price },
          billingInterval: duration.interval,
        },
      ]
    }
  }
  const tiers = parseTaskTiersFromExpr(expression || '', schema, true)
  const fallback = tiers.at(-1)
  if (!schema || tiers.length < 2 || !fallback) return tiers
  const previous = tiers.slice(0, -1)
  const fields = [
    ...new Set(
      previous.flatMap((tier) =>
        tier.conditions.map((condition) => condition.field)
      )
    ),
  ].sort()
  let combinations: TaskTierCondition[][] = [[]]
  for (const field of fields) {
    const definition = schema[field]
    const values =
      definition?.type === 'boolean' ? ['false', 'true'] : definition?.enum
    // Avoid expanding large plugin schemas merely to name a fallback row.
    if (!values?.length || combinations.length * values.length > 256) {
      return tiers
    }
    combinations = combinations.flatMap((combination) =>
      values.map((value) => [...combination, { field, value }])
    )
  }
  const remaining = combinations.filter(
    (combination) =>
      !previous.some((tier) =>
        tier.conditions.every((condition) =>
          combination.some(
            (value) =>
              value.field === condition.field && value.value === condition.value
          )
        )
      )
  )
  if (remaining.length !== 1) return tiers
  return [...previous, { ...fallback, conditions: remaining[0] }]
}
