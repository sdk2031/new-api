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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'

import type { TaskTierCondition } from '../lib/billing-expr'
import type {
  DurationPriceRow,
  DurationPriceSection,
} from '../lib/duration-price-sections'
import {
  formatTaskUsageUnitPrice,
  type DynamicPriceOptions,
} from '../lib/dynamic-price'
import { taskEnumLabel, taskPricingConditions } from '../lib/task-price-display'
import type { BillingUsageSchema } from '../types'

export function DurationPriceTables(props: {
  sections: DurationPriceSection[]
  schema: BillingUsageSchema
  priceOptions: DynamicPriceOptions
}) {
  const { t, i18n } = useTranslation()
  const headingFor = (condition: TaskTierCondition) => {
    if (condition.field === 'action') {
      if (condition.value === 'text_to_video') return t('Text to Video')
      if (condition.value === 'image_to_video') return t('Image to Video')
      if (condition.value === 'video_to_video') return t('Video to Video')
    }
    return taskPricingConditions([condition], props.schema, i18n.language, t)
  }

  return (
    <div className='min-w-0 space-y-3'>
      {props.sections.map((section) => {
        const heading =
          section.conditions.map(headingFor).join(' · ') || t('Video')
        const unit =
          section.interval > 1
            ? t('Every {{seconds}} seconds', { seconds: section.interval })
            : t('Per second')
        const hasAudio = section.rows.some((row) => row.audio !== undefined)
        return (
          <div key={section.key} className='min-w-0 space-y-1.5'>
            <h3 className='flex flex-wrap items-baseline gap-x-2 text-sm font-medium'>
              {heading}
              <span className='text-muted-foreground text-xs font-normal'>
                {unit}
              </span>
            </h3>
            <StaticDataTable
              className='border-border/70 rounded-lg'
              tableClassName='[&_tbody>tr]:h-auto'
              tableProps={{ 'aria-label': `${heading} · ${unit}` }}
              data={section.rows}
              getRowKey={(row) => JSON.stringify([row.resolution, row.audio])}
              columns={[
                {
                  id: 'resolution',
                  header: props.schema.resolution
                    ? t('Resolution')
                    : t('Applicable conditions'),
                  className: 'text-muted-foreground bg-muted/20 h-8 px-3',
                  cellClassName: 'px-3 py-1.5 whitespace-normal break-words',
                  cell: (row) =>
                    row.resolution === undefined
                      ? t(row.fallback ? 'Other cases' : 'All requests')
                      : taskEnumLabel(
                          props.schema.resolution,
                          row.resolution,
                          i18n.language
                        ),
                },
                ...(hasAudio
                  ? [
                      {
                        id: 'audio',
                        header: t('Audio track'),
                        className: 'text-muted-foreground bg-muted/20 h-8 px-3',
                        cellClassName: 'text-muted-foreground px-3 py-1.5',
                        cell: (row: DurationPriceRow) => {
                          if (row.audio === undefined) return '-'
                          if (props.schema.generate_audio?.type === 'boolean') {
                            return t(row.audio === 'true' ? 'Yes' : 'No')
                          }
                          return taskEnumLabel(
                            props.schema.generate_audio,
                            row.audio,
                            i18n.language
                          )
                        },
                      },
                    ]
                  : []),
                {
                  id: 'price',
                  header: t('Price'),
                  className:
                    'text-muted-foreground bg-muted/20 h-8 px-3 text-right',
                  cellClassName:
                    'px-3 py-1.5 text-right font-mono tabular-nums',
                  cell: (row) =>
                    formatTaskUsageUnitPrice(row.price, props.priceOptions),
                },
              ]}
            />
          </div>
        )
      })}
    </div>
  )
}
