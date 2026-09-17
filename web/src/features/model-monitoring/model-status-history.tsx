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
import { memo, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getSuccessRateDotClass } from '@/features/performance-metrics/lib/format'
import type { SuccessRatePoint } from '@/features/performance-metrics/types'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

interface ModelStatusHistoryProps extends React.HTMLAttributes<HTMLDivElement> {
  series?: SuccessRatePoint[]
  barClassName?: string
}

const STATUS_SLOTS = Array.from({ length: 24 }, (_, slot) => slot)
const HOUR_SECONDS = 3_600
const ONLINE_RATE_MIN = 70
const CLOCK_POLL_INTERVAL_MS = 60_000
const clockListeners = new Set<() => void>()
let clockTimer: number | undefined
let currentHourStart = getCurrentHourStart()

function getCurrentHourStart() {
  return Math.floor(Date.now() / 1_000 / HOUR_SECONDS) * HOUR_SECONDS
}

function subscribeToHourlyClock(listener: () => void) {
  clockListeners.add(listener)
  if (clockListeners.size === 1) {
    clockTimer = window.setInterval(() => {
      const nextHourStart = getCurrentHourStart()
      if (nextHourStart === currentHourStart) return
      currentHourStart = nextHourStart
      clockListeners.forEach((notify) => notify())
    }, CLOCK_POLL_INTERVAL_MS)
  }

  return () => {
    clockListeners.delete(listener)
    if (clockListeners.size === 0 && clockTimer !== undefined) {
      window.clearInterval(clockTimer)
      clockTimer = undefined
    }
  }
}

function getHourlyClockSnapshot() {
  return currentHourStart
}

export const ModelStatusHistory = memo(function ModelStatusHistory(
  props: ModelStatusHistoryProps
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { series, barClassName, className, ...rest } = props
  const currentHour = useSyncExternalStore(
    subscribeToHourlyClock,
    getHourlyClockSnapshot,
    getHourlyClockSnapshot
  )
  const statusPoints = useMemo(() => {
    const ratesByHour = new Map<number, number>()
    for (const point of series ?? []) {
      ratesByHour.set(point.ts, point.success_rate)
    }
    return STATUS_SLOTS.map((slot) => {
      const ts = currentHour - (23 - slot) * HOUR_SECONDS
      return { ts, rate: ratesByHour.get(ts) }
    })
  }, [currentHour, series])
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
        'Recent success-rate samples; gray bars indicate missing data.'
      )}
      title={t('Recent success-rate samples; gray bars indicate missing data.')}
      className={cn('flex h-3 w-24 items-center gap-px', className)}
      {...rest}
    >
      {STATUS_SLOTS.map((slot) => {
        const point = statusPoints[slot]
        const rate = point.rate
        const hasData =
          rate != null && Number.isFinite(rate) && rate >= 0 && rate <= 100
        let statusLabel = t('No data')
        if (hasData) {
          statusLabel = rate >= ONLINE_RATE_MIN ? t('Online') : t('Offline')
        }
        const timeLabel = timeFormatter.format(point.ts * 1_000)
        return (
          <Tooltip key={slot}>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    'h-full w-[3px] shrink-0 cursor-default rounded-xs transition-opacity hover:opacity-80',
                    hasData
                      ? getSuccessRateDotClass(rate)
                      : 'bg-muted-foreground/15',
                    barClassName
                  )}
                />
              }
            />
            <TooltipContent
              side='top'
              className='grid min-w-36 gap-1.5 font-mono text-xs'
            >
              <div className='font-semibold'>{timeLabel}</div>
              <div className='grid grid-cols-[auto_1fr] gap-x-2'>
                <span>{t('Status')}:</span>
                <span className='text-right'>{statusLabel}</span>
                <span>{t('Availability')}:</span>
                <span className='text-right'>
                  {hasData ? `${rate.toFixed(1)}%` : '—'}
                </span>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
})
