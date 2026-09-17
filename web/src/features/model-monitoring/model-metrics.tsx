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

import {
  formatLatency,
  formatThroughput,
} from '@/features/performance-metrics/lib/format'
import type { PerfModelSummary } from '@/features/performance-metrics/types'

export function ModelMetrics({ perf }: { perf?: PerfModelSummary }) {
  const { t } = useTranslation()
  const latency = formatLatency(perf?.avg_latency_ms ?? 0)
  const throughput = formatThroughput(perf?.avg_tps ?? 0).replace(' t/s', 't/s')

  return (
    <dl
      aria-label={t('Performance metrics for the last 24 hours')}
      className='flex min-w-0 items-start gap-5 text-xs tabular-nums'
    >
      <div title={t('Average latency')} className='shrink-0'>
        <dt className='text-muted-foreground text-[11px] leading-4'>
          {t('Latency short')}
        </dt>
        <dd className='mt-1 font-mono whitespace-nowrap'>
          {latency === '—' ? '—s' : latency}
        </dd>
      </div>
      <div title={t('Throughput')} className='shrink-0'>
        <dt className='text-muted-foreground text-[11px] leading-4'>
          {t('Throughput short')}
        </dt>
        <dd className='mt-1 font-mono whitespace-nowrap'>
          {throughput === '—' ? '—t/s' : throughput}
        </dd>
      </div>
    </dl>
  )
}
