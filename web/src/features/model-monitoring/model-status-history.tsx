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
  currentInterval: number
}

export const MONITORING_SLOT_COUNT = 24
export const MONITORING_INTERVAL_SECONDS = 300
const NORMAL_RATE_MIN = 90
const FLUCTUATING_RATE_MIN = 70

export const ModelStatusHistory = memo(function ModelStatusHistory(
  props: ModelStatusHistoryProps
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { series, barClassName, currentInterval, className, ...rest } = props
  const statusPoints = useMemo(() => {
    const metricsByInterval = new Map<number, PerformanceIntervalPoint>()
    for (const point of series ?? []) {
      if (
        !Number.isFinite(point.success_rate) ||
        point.success_rate < 0 ||
        point.success_rate > 100
      ) {
        continue
      }
      const interval = point.ts - (point.ts % MONITORING_INTERVAL_SECONDS)
      metricsByInterval.set(interval, point)
    }
    return Array.from({ length: MONITORING_SLOT_COUNT }, (_, index) => {
      const ts =
        currentInterval -
        (MONITORING_SLOT_COUNT - 1 - index) * MONITORING_INTERVAL_SECONDS
      return { ts, metrics: metricsByInterval.get(ts) }
    })
  }, [currentInterval, series])
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
      aria-label={t('Performance in the latest 24 five-minute intervals.')}
      className={cn(
        'grid h-3 w-24 grid-cols-[repeat(24,minmax(0,1fr))] items-center gap-px',
        className
      )}
      {...rest}
    >
      {statusPoints.map((point) => {
        if (!point.metrics) {
          return (
            <span
              key={point.ts}
              data-slot='status-empty'
              aria-hidden='true'
              className='border-border/50 bg-muted-foreground/20 h-full min-w-0 rounded-[1px] border'
            />
          )
        }

        const rate = point.metrics.success_rate
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
                    'h-full w-full cursor-default rounded-xs transition-opacity hover:opacity-80',
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
                <span className='text-right font-mono'>{rate.toFixed(1)}%</span>
                <span>{t('Average latency')}:</span>
                <span className='text-right font-mono'>
                  {formatLatency(point.metrics.avg_latency_ms)}
                </span>
                <span>{t('Throughput')}:</span>
                <span className='text-right font-mono'>
                  {formatThroughput(point.metrics.avg_tps)}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})
