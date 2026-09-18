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
import { useQuery } from '@tanstack/react-query'
import {
  CircleOff,
  Clock3,
  HeartPulse,
  Layers3,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import type {
  PerformanceIntervalPoint,
  PerfGroupSummaryInfo,
  PerfModelSummary,
} from '@/features/performance-metrics/types'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import {
  MONITORING_INTERVAL_SECONDS,
  MONITORING_SLOT_COUNT,
  ModelStatusHistory,
} from './model-status-history'

const PERFORMANCE_WINDOW_HOURS = 24
const REFRESH_INTERVAL_MS = 30_000
const NORMAL_RATE_MIN = 90
const FLUCTUATING_RATE_MIN = 70

type StatusFilter = 'all' | 'normal' | 'fluctuating' | 'abnormal' | 'unknown'

type GroupMetricsResult = {
  group: string
  perf?: PerfModelSummary
}

type GroupMonitoringResult = {
  groups: PerfGroupSummaryInfo[]
  metrics: GroupMetricsResult[]
}

type MonitoringRow = {
  group: string
  sortOrder: number
  effectivePrice: number
  perf?: PerfModelSummary
  status: Exclude<StatusFilter, 'all'>
}

function getMonitoringStatus(
  perf: PerfModelSummary | undefined,
  currentInterval: number
): MonitoringRow['status'] {
  if (currentInterval <= 0) return 'unknown'
  const windowStart =
    currentInterval - (MONITORING_SLOT_COUNT - 1) * MONITORING_INTERVAL_SECONDS
  const latestPoint = (perf?.recent_interval_series ?? []).reduce<
    PerformanceIntervalPoint | undefined
  >((latest, point) => {
    if (
      !Number.isFinite(point.success_rate) ||
      point.success_rate < 0 ||
      point.success_rate > 100
    ) {
      return latest
    }
    if (point.ts < windowStart || point.ts > currentInterval) return latest
    if (!latest || point.ts > latest.ts) return point
    return latest
  }, undefined)
  const successRate = latestPoint?.success_rate
  if (successRate == null || !Number.isFinite(successRate)) return 'unknown'
  if (successRate >= NORMAL_RATE_MIN) return 'normal'
  if (successRate >= FLUCTUATING_RATE_MIN) return 'fluctuating'
  return 'abnormal'
}

export function ModelMonitoring() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [now, setNow] = useState(0)
  const { status } = useStatus()
  const rawPriceRate = Number(status?.price)
  const priceRate =
    Number.isFinite(rawPriceRate) && rawPriceRate >= 0 ? rawPriceRate : 1
  const priceFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        maximumFractionDigits: 6,
      }),
    [locale]
  )
  const metricsQuery = useQuery({
    queryKey: ['perf-metrics-group-summary', PERFORMANCE_WINDOW_HOURS],
    queryFn: async (): Promise<GroupMonitoringResult> => {
      const overview = requireServerSuccess(
        await getPerfMetricsSummary(PERFORMANCE_WINDOW_HOURS)
      )
      const groups = overview.data.groups ?? []
      const metrics = await Promise.all(
        groups.map(async (groupInfo) => {
          const response = requireServerSuccess(
            await getPerfMetricsSummary(
              PERFORMANCE_WINDOW_HOURS,
              groupInfo.group
            )
          )
          return { group: groupInfo.group, perf: response.data.aggregate }
        })
      )
      return { groups, metrics }
    },
    staleTime: 30_000,
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const currentMonitoringInterval =
    Math.floor(
      metricsQuery.dataUpdatedAt / 1_000 / MONITORING_INTERVAL_SECONDS
    ) * MONITORING_INTERVAL_SECONDS

  const perfMap = useMemo(
    () =>
      new Map(
        (metricsQuery.data?.metrics ?? []).map((item) => [
          item.group,
          item.perf,
        ])
      ),
    [metricsQuery.data]
  )

  const rows = useMemo<MonitoringRow[]>(() => {
    return (metricsQuery.data?.groups ?? [])
      .map((groupInfo) => {
        const perf = perfMap.get(groupInfo.group)
        return {
          group: groupInfo.group,
          sortOrder: groupInfo.sort_order ?? 0,
          effectivePrice: groupInfo.ratio * priceRate,
          perf,
          status: getMonitoringStatus(perf, currentMonitoringInterval),
        }
      })
      .sort((left, right) => {
        const orderDifference = right.sortOrder - left.sortOrder
        if (orderDifference !== 0) return orderDifference
        return left.group.localeCompare(right.group)
      })
  }, [currentMonitoringInterval, metricsQuery.data?.groups, perfMap, priceRate])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!deferredSearch) return true
      const price = priceFormatter.format(row.effectivePrice).toLowerCase()
      return (
        row.group.toLowerCase().includes(deferredSearch) ||
        price.includes(deferredSearch) ||
        `¥${price}`.includes(deferredSearch)
      )
    })
  }, [deferredSearch, priceFormatter, rows, statusFilter])

  const summary = useMemo(() => {
    const measured = rows.filter((row) => row.status !== 'unknown' && row.perf)
    const average =
      measured.length > 0
        ? measured.reduce(
            (total, row) => total + (row.perf?.success_rate ?? 0),
            0
          ) / measured.length
        : Number.NaN
    return {
      normal: rows.filter((row) => row.status === 'normal').length,
      fluctuating: rows.filter((row) => row.status === 'fluctuating').length,
      abnormal: rows.filter((row) => row.status === 'abnormal').length,
      unknown: rows.filter((row) => row.status === 'unknown').length,
      average,
    }
  }, [rows])

  const secondsToRefresh =
    metricsQuery.dataUpdatedAt && now > 0
      ? Math.max(
          0,
          Math.ceil(
            (metricsQuery.dataUpdatedAt + REFRESH_INTERVAL_MS - now) / 1_000
          )
        )
      : 0
  const updatedAt = metricsQuery.dataUpdatedAt
    ? new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(metricsQuery.dataUpdatedAt)
    : '—'

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='flex items-center gap-2'>
          <HeartPulse className='size-5 text-emerald-500' />
          {t('Group monitoring')}
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <span className='text-muted-foreground hidden items-center gap-3 text-xs tabular-nums sm:flex'>
          <span>
            {t('Last updated')}: {updatedAt}
          </span>
          <span className='flex items-center gap-1.5'>
            <Clock3 className='size-3.5' />
            {t('Refreshes in {{seconds}}s', { seconds: secondsToRefresh })}
          </span>
        </span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={metricsQuery.isFetching}
          onClick={() => metricsQuery.refetch()}
        >
          <RefreshCw
            data-icon='inline-start'
            className={cn(metricsQuery.isFetching && 'animate-spin')}
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-[1800px] space-y-4'>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Based on usage data from models in each group. For reference only; actual calls take precedence.'
            )}
          </p>

          <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
            <div
              data-slot='monitoring-search-summary'
              className='flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center'
            >
              <div className='relative w-full sm:max-w-sm sm:shrink-0'>
                <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Search groups')}
                  className='pl-8'
                />
              </div>
              <span
                data-slot='monitoring-summary'
                className='text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] leading-none font-normal tabular-nums'
              >
                <span className='flex items-baseline gap-1'>
                  <span>{t('Normal')}</span>
                  <span className='text-emerald-500 dark:text-emerald-400'>
                    {summary.normal.toLocaleString(locale)}
                  </span>
                </span>
                <span className='flex items-baseline gap-1'>
                  <span>{t('Fluctuating')}</span>
                  <span className='text-amber-600 dark:text-amber-400'>
                    {summary.fluctuating.toLocaleString(locale)}
                  </span>
                </span>
                <span className='flex items-baseline gap-1'>
                  <span>{t('Abnormal')}</span>
                  <span className='text-red-600 dark:text-red-400'>
                    {summary.abnormal.toLocaleString(locale)}
                  </span>
                </span>
                <span className='flex items-baseline gap-1'>
                  <span>{t('No data')}</span>
                  <span className='text-muted-foreground'>
                    {summary.unknown.toLocaleString(locale)}
                  </span>
                </span>
                <span className='flex items-baseline gap-1'>
                  <span>{t('Average availability')}</span>
                  <span className={getSuccessRateTextClass(summary.average)}>
                    {formatUptimePct(summary.average)}
                  </span>
                </span>
              </span>
            </div>
            <div
              role='group'
              aria-label={t('Status')}
              className='bg-muted/60 flex max-w-full overflow-x-auto rounded-lg p-1'
            >
              {(
                [
                  ['all', t('All')],
                  ['normal', t('Normal')],
                  ['fluctuating', t('Fluctuating')],
                  ['abnormal', t('Abnormal')],
                  ['unknown', t('No data')],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  type='button'
                  size='sm'
                  variant={statusFilter === value ? 'secondary' : 'ghost'}
                  aria-pressed={statusFilter === value}
                  onClick={() => startTransition(() => setStatusFilter(value))}
                  className='shrink-0 px-2'
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <MonitoringResults
            loading={metricsQuery.isLoading}
            rows={filteredRows}
            currentInterval={currentMonitoringInterval}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function MonitoringCard(props: {
  row: MonitoringRow
  currentInterval: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const perf = props.row.perf
  const hasMonitoringData = props.row.status !== 'unknown'
  const successRate = hasMonitoringData
    ? (perf?.success_rate ?? Number.NaN)
    : Number.NaN
  const effectivePrice = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6,
  }).format(props.row.effectivePrice)
  let statusLabel = t('No data')
  if (props.row.status === 'normal') statusLabel = t('Normal')
  if (props.row.status === 'fluctuating') statusLabel = t('Fluctuating')
  if (props.row.status === 'abnormal') statusLabel = t('Abnormal')
  let statusDotClass = 'bg-muted-foreground/40'
  if (props.row.status === 'normal') statusDotClass = 'bg-emerald-500'
  if (props.row.status === 'fluctuating') statusDotClass = 'bg-amber-500'
  if (props.row.status === 'abnormal') statusDotClass = 'bg-red-500'

  return (
    <Card className='w-full min-w-0 gap-3 rounded-lg py-3'>
      <CardHeader className='grid-cols-[1fr_auto] px-3'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
            <Layers3 className='size-5' />
          </div>
          <div className='min-w-0'>
            <CardTitle className='truncate font-mono text-sm'>
              {props.row.group}
            </CardTitle>
            <CardDescription className='truncate font-mono text-xs tabular-nums'>
              ¥{effectivePrice} / USD
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge variant='outline' className='gap-1.5'>
            <span className={cn('size-1.5 rounded-full', statusDotClass)} />
            {statusLabel}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className='space-y-3 px-3'>
        <div className='flex items-end justify-between gap-4'>
          <div>
            <div className='text-muted-foreground text-[11px]'>
              {t('Success rate')}
            </div>
            <div
              className={cn(
                'mt-0.5 font-mono text-3xl font-semibold tabular-nums',
                props.row.status === 'unknown'
                  ? 'text-muted-foreground'
                  : getSuccessRateTextClass(successRate)
              )}
            >
              {formatUptimePct(successRate)}
            </div>
          </div>
          <dl className='grid shrink-0 grid-cols-2 gap-4 text-right text-xs tabular-nums'>
            <div>
              <dt className='text-muted-foreground text-[11px]'>
                {t('Average latency')}
              </dt>
              <dd className='mt-1 font-mono font-semibold'>
                {formatLatency(
                  hasMonitoringData ? (perf?.avg_latency_ms ?? 0) : 0
                )}
              </dd>
            </div>
            <div>
              <dt className='text-muted-foreground text-[11px]'>
                {t('Throughput')}
              </dt>
              <dd className='mt-1 font-mono font-semibold'>
                {formatThroughput(hasMonitoringData ? (perf?.avg_tps ?? 0) : 0)}
              </dd>
            </div>
          </dl>
        </div>

        <ModelStatusHistory
          series={perf?.recent_interval_series}
          currentInterval={props.currentInterval}
          className='h-6 w-full gap-1'
          barClassName='w-full rounded-sm'
        />
      </CardContent>
    </Card>
  )
}

function MonitoringResults(props: {
  loading: boolean
  rows: MonitoringRow[]
  currentInterval: number
}) {
  const { t } = useTranslation()

  if (props.loading) return <MonitoringSkeleton />

  if (props.rows.length > 0) {
    return (
      <div
        data-slot='monitoring-grid'
        className='grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]'
      >
        {props.rows.map((row) => (
          <MonitoringCard
            key={row.group}
            row={row}
            currentInterval={props.currentInterval}
          />
        ))}
      </div>
    )
  }

  return (
    <Empty className='min-h-64 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <CircleOff />
        </EmptyMedia>
        <EmptyTitle>{t('No groups match the current filters')}</EmptyTitle>
        <EmptyDescription>
          {t('No group performance data available')}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function MonitoringSkeleton() {
  return (
    <div
      data-slot='monitoring-grid'
      className='grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]'
    >
      {Array.from({ length: 6 }, (_, index) => (
        <Card key={index} className='w-full min-w-0 gap-3 rounded-lg py-3'>
          <CardHeader className='px-3'>
            <div className='flex items-center gap-2.5'>
              <Skeleton className='size-9' />
              <div className='space-y-1.5'>
                <Skeleton className='h-4 w-40' />
                <Skeleton className='h-3 w-20' />
              </div>
            </div>
          </CardHeader>
          <CardContent className='space-y-3 px-3'>
            <Skeleton className='h-9 w-28' />
            <Skeleton className='h-6 w-full' />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
