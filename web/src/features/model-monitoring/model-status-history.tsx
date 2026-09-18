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
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatLatency,
  formatThroughput,
  getSuccessRateDotClass,
} from '@/features/performance-metrics/lib/format'
import type { PerformanceIntervalPoint } from '@/features/performance-metrics/types'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

interface ModelStatusHistoryProps extends React.HTMLAttributes<HTMLDivElement> {
  series?: PerformanceIntervalPoint[]
  barClassName?: string
}

const MAX_STATUS_RECORDS = 24
const NORMAL_RATE_MIN = 90
const FLUCTUATING_RATE_MIN = 70

export const ModelStatusHistory = memo(function ModelStatusHistory(
  props: ModelStatusHistoryProps
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { series, barClassName, className, ...rest } = props
  const statusPoints = useMemo(() => {
    return [...(series ?? [])]
      .filter(
        (point) =>
          Number.isFinite(point.success_rate) &&
          point.success_rate >= 0 &&
          point.success_rate <= 100
      )
      .sort((left, right) => left.ts - right.ts)
      .slice(-MAX_STATUS_RECORDS)
  }, [series])
  const emptySlots = MAX_STATUS_RECORDS - statusPoints.length
  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [locale]
  )

  return (
    <div
      role='img'
      aria-label={t(
        'Latest 24 performance records at five-minute intervals.'
      )}
      title={t(
        'Latest 24 performance records at five-minute intervals.'
      )}
      className={cn(
        'grid h-3 w-24 grid-cols-[repeat(24,minmax(0,1fr))] items-center gap-px',
        className
      )}
      {...rest}
    >
      {Array.from({ length: emptySlots }, (_, index) => (
        <span
          key={`empty-${index}`}
          data-slot='status-empty'
          aria-hidden='true'
          className='h-full min-w-0'
        />
      ))}
      {statusPoints.map((point) => {
        const rate = point.success_rate
        let statusLabel = t('No data')
        if (rate >= NORMAL_RATE_MIN) statusLabel = t('Normal')
        else if (rate >= FLUCTUATING_RATE_MIN) {
          statusLabel = t('Fluctuating')
        } else statusLabel = t('Abnormal')
        const timeLabel = timeFormatter.format(point.ts * 1_000)
        return (
          <Tooltip key={point.ts}>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    'h-full w-[3px] shrink-0 cursor-default rounded-xs transition-opacity hover:opacity-80',
                    getSuccessRateDotClass(rate),
                    barClassName
                  )}
                />
              }
            />
            <TooltipContent
              side='top'
              className='grid min-w-44 gap-1.5 text-xs'
            >
              <div className='font-mono font-semibold'>{timeLabel}</div>
              <div className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1'>
                <span>{t('Status')}:</span>
                <span className='text-right'>{statusLabel}</span>
                <span>{t('Availability')}:</span>
                <span className='text-right font-mono'>
                  {rate.toFixed(1)}%
                </span>
                <span>{t('Average latency')}:</span>
                <span className='text-right font-mono'>
                  {formatLatency(point.avg_latency_ms)}
                </span>
                <span>{t('Throughput')}:</span>
                <span className='text-right font-mono'>
                  {formatThroughput(point.avg_tps)}
                </span>
                <span>{t('Requests')}:</span>
                <span className='text-right font-mono'>
                  {point.request_count.toLocaleString(locale)}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})
