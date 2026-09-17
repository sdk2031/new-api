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
  formatUptimePct,
  getSuccessRateDotClass,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import type {
  PerfGroupSummaryInfo,
  PerfModelSummary,
} from '@/features/performance-metrics/types'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { ModelMetrics } from './model-metrics'
import { ModelStatusHistory } from './model-status-history'

const PERFORMANCE_WINDOW_HOURS = 24
const REFRESH_INTERVAL_MS = 60_000
const ONLINE_RATE_MIN = 70

type StatusFilter = 'all' | 'online' | 'offline' | 'unknown'

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
  ratio: number
  modelCount: number
  perf?: PerfModelSummary
  status: Exclude<StatusFilter, 'all'>
}

function getMonitoringStatus(
  perf: PerfModelSummary | undefined
): MonitoringRow['status'] {
  if (!perf || !Number.isFinite(perf.success_rate)) return 'unknown'
  return perf.success_rate >= ONLINE_RATE_MIN ? 'online' : 'offline'
}

export function ModelMonitoring() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [now, setNow] = useState(0)
  const { status } = useStatus()
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
          ratio: groupInfo.ratio,
          modelCount: groupInfo.model_count,
          perf,
          status: getMonitoringStatus(perf),
        }
      })
      .sort((left, right) => {
        if (left.status === 'unknown' && right.status !== 'unknown') return 1
        if (left.status !== 'unknown' && right.status === 'unknown') return -1
        if (left.perf && right.perf) {
          return left.perf.success_rate - right.perf.success_rate
        }
        return left.group.localeCompare(right.group)
      })
  }, [metricsQuery.data?.groups, perfMap])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      if (!deferredSearch) return true
      return row.group.toLowerCase().includes(deferredSearch)
    })
  }, [deferredSearch, rows, statusFilter])

  const summary = useMemo(() => {
    const measured = rows.filter((row) => row.perf)
    const average =
      measured.length > 0
        ? measured.reduce(
            (total, row) => total + (row.perf?.success_rate ?? 0),
            0
          ) / measured.length
        : Number.NaN
    return {
      online: rows.filter((row) => row.status === 'online').length,
      offline: rows.filter((row) => row.status === 'offline').length,
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
  const rawPriceRate = Number(status?.price)
  const priceRate =
    Number.isFinite(rawPriceRate) && rawPriceRate >= 0 ? rawPriceRate : 1

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='flex items-center gap-2'>
          <HeartPulse className='size-5 text-emerald-500' />
          {t('Group monitoring')}
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <span className='text-muted-foreground hidden items-center gap-1.5 text-xs tabular-nums sm:flex'>
          <Clock3 className='size-3.5' />
          {t('Refreshes in {{seconds}}s', { seconds: secondsToRefresh })}
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
          <div>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Monitor group availability, latency, and throughput from real API traffic.'
              )}
            </p>
            <p className='text-muted-foreground/70 mt-1 text-xs'>
              {t('Last updated')}: {updatedAt}
            </p>
          </div>

          <div className='bg-card grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4'>
            <SummaryMetric
              label={t('Online')}
              value={summary.online.toLocaleString(locale)}
              tone='text-emerald-600 dark:text-emerald-400'
            />
            <SummaryMetric
              label={t('Offline')}
              value={summary.offline.toLocaleString(locale)}
              tone='text-red-600 dark:text-red-400'
            />
            <SummaryMetric
              label={t('No data')}
              value={summary.unknown.toLocaleString(locale)}
              tone='text-muted-foreground'
            />
            <SummaryMetric
              label={t('Average availability')}
              value={formatUptimePct(summary.average)}
              tone={getSuccessRateTextClass(summary.average)}
            />
          </div>

          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='relative w-full sm:max-w-sm'>
              <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('Search groups')}
                className='pl-8'
              />
            </div>
            <div
              role='group'
              aria-label={t('Status')}
              className='bg-muted/60 grid grid-cols-4 rounded-lg p-1'
            >
              {(
                [
                  ['all', t('All')],
                  ['online', t('Online')],
                  ['offline', t('Offline')],
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
                  className='min-w-0 px-2'
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <MonitoringResults
            loading={metricsQuery.isLoading}
            rows={filteredRows}
            priceRate={priceRate}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function SummaryMetric(props: { label: string; value: string; tone: string }) {
  return (
    <div className='border-border/70 border-b p-3 odd:border-r sm:border-r sm:border-b-0 sm:last:border-r-0'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div
        className={cn(
          'mt-1 font-mono text-xl font-semibold tabular-nums',
          props.tone
        )}
      >
        {props.value}
      </div>
    </div>
  )
}

function MonitoringCard(props: { row: MonitoringRow; priceRate: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { group, ratio, modelCount, perf, status } = props.row
  const successRate = perf?.success_rate ?? Number.NaN
  const numberFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6,
  })
  const effectivePrice = numberFormatter.format(ratio * props.priceRate)
  let statusLabel = t('No data')
  if (status === 'online') statusLabel = t('Online')
  if (status === 'offline') statusLabel = t('Offline')

  return (
    <Card className='gap-3 rounded-lg py-3'>
      <CardHeader className='grid-cols-[1fr_auto] px-3'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
            <Layers3 className='size-5' />
          </div>
          <div className='min-w-0'>
            <CardTitle className='truncate font-mono text-sm'>
              {group}
            </CardTitle>
            <CardDescription className='truncate text-xs'>
              {t('{{count}} models', { count: modelCount })}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge variant='outline' className='gap-1.5'>
            <span
              className={cn(
                'size-1.5 rounded-full',
                status === 'unknown'
                  ? 'bg-muted-foreground/40'
                  : getSuccessRateDotClass(successRate)
              )}
            />
            {statusLabel}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className='space-y-3 px-3'>
        <div className='flex items-end justify-between gap-3'>
          <div>
            <div className='text-muted-foreground text-[11px]'>
              {t('Success rate')}
            </div>
            <div
              className={cn(
                'mt-0.5 font-mono text-3xl font-semibold tabular-nums',
                status === 'unknown'
                  ? 'text-muted-foreground'
                  : getSuccessRateTextClass(successRate)
              )}
            >
              {formatUptimePct(successRate)}
            </div>
          </div>
          <div className='text-right'>
            <div className='text-muted-foreground text-[11px]'>
              {t('Requests')}
            </div>
            <div className='mt-0.5 font-mono text-sm font-semibold tabular-nums'>
              {(perf?.request_count ?? 0).toLocaleString(locale)}
            </div>
          </div>
        </div>

        <ModelStatusHistory
          series={perf?.recent_success_series}
          className='h-6 w-full gap-1'
          barClassName='min-w-0 flex-1 rounded-sm'
        />

        <div className='border-border/60 grid grid-cols-2 gap-3 border-t pt-3'>
          <div>
            <div className='text-muted-foreground text-[11px]'>
              {t('Group Ratio')}
            </div>
            <div className='mt-1 font-mono text-sm font-semibold tabular-nums'>
              {numberFormatter.format(ratio)}x
            </div>
          </div>
          <div className='text-right'>
            <div className='text-muted-foreground text-[11px]'>
              {t('Effective price')}
            </div>
            <div className='mt-1 font-mono text-sm font-semibold tabular-nums'>
              ¥{effectivePrice} / USD
            </div>
          </div>
        </div>
      </CardContent>

      <div className='border-border/60 mx-3 border-t pt-2'>
        <ModelMetrics perf={perf} />
      </div>
    </Card>
  )
}

function MonitoringResults(props: {
  loading: boolean
  rows: MonitoringRow[]
  priceRate: number
}) {
  const { t } = useTranslation()

  if (props.loading) return <MonitoringSkeleton />

  if (props.rows.length > 0) {
    return (
      <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
        {props.rows.map((row) => (
          <MonitoringCard
            key={row.group}
            row={row}
            priceRate={props.priceRate}
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
    <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
      {Array.from({ length: 6 }, (_, index) => (
        <Card key={index} className='gap-3 rounded-lg py-3'>
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
            <Skeleton className='h-5 w-36' />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
