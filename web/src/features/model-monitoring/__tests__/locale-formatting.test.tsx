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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ModelMonitoring } from '..'
import { ModelStatusHistory } from '../model-status-history'

const refetch = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({
      data: {
        groups: [
          {
            group: 'default',
            ratio: 0.2,
            sort_order: 10,
          },
          {
            group: 'vip',
            ratio: 0.3,
            sort_order: 20,
          },
          {
            group: 'provider',
            ratio: 0.25,
            sort_order: 15,
          },
        ],
        metrics: [
          {
            group: 'default',
            perf: {
              model_name: '',
              avg_latency_ms: 250,
              success_rate: 99,
              avg_tps: 20,
              request_count: 1000,
              recent_interval_series: Array.from(
                { length: 30 },
                (_, index) => ({
                  ts:
                    Math.floor(Date.now() / 1_000 / 300) * 300 -
                    (29 - index) * 300,
                  success_rate: 99,
                  avg_latency_ms: 250,
                  avg_tps: 20,
                  request_count: 12,
                })
              ),
            },
          },
          {
            group: 'provider',
            perf: {
              model_name: '',
              avg_latency_ms: 1200,
              success_rate: 95,
              avg_tps: 0,
              provider_fallback: true,
            },
          },
        ],
      },
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch,
    }),
  }
})

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: { price: 10 } }),
}))

beforeEach(async () => {
  await i18next.changeLanguage('zhCN')
})

afterEach(async () => {
  await i18next.changeLanguage('en')
})

it('renders compact group metrics and five-minute details in zhCN', async () => {
  expect(() => render(<ModelMonitoring />)).not.toThrow()
  expect(screen.getAllByText('default')).toHaveLength(1)
  expect(
    [...document.querySelectorAll('[data-slot="card-title"]')].map(
      (element) => element.textContent
    )
  ).toEqual(['vip', 'provider', 'default'])
  expect(screen.getByText('¥2 / USD')).toBeInTheDocument()
  expect(screen.queryByText('1,000')).not.toBeInTheDocument()
  expect(screen.queryByText('0.2x')).not.toBeInTheDocument()
  expect(screen.getByText('250ms')).toBeInTheDocument()
  expect(screen.getByText('20.0 t/s')).toBeInTheDocument()
  expect(screen.getAllByText(i18next.t('Normal')).length).toBeGreaterThan(0)

  const monitoringGrid = document.querySelector('[data-slot="monitoring-grid"]')
  expect(monitoringGrid).toHaveClass(
    'sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]'
  )
  const summary = screen.getByText(i18next.t('Average availability'))
    .parentElement?.parentElement
  if (!(summary instanceof HTMLElement)) {
    throw new Error('Group monitoring summary was not rendered')
  }
  const normalSummary = within(summary).getByText(
    i18next.t('Normal')
  ).parentElement
  const fluctuatingSummary = within(summary).getByText(
    i18next.t('Fluctuating')
  ).parentElement
  const abnormalSummary = within(summary).getByText(
    i18next.t('Abnormal')
  ).parentElement
  expect(normalSummary?.lastElementChild).toHaveClass('text-emerald-500')
  expect(fluctuatingSummary?.lastElementChild).toHaveClass('text-amber-600')
  expect(abnormalSummary?.lastElementChild).toHaveClass('text-red-600')
  const searchSummaryRow = document.querySelector(
    '[data-slot="monitoring-search-summary"]'
  )
  expect(searchSummaryRow).toContainElement(
    screen.getByPlaceholderText(i18next.t('Search groups'))
  )
  expect(searchSummaryRow).toContainElement(summary)

  const vipGroupCard = screen.getByText('vip').closest('[data-slot="card"]')
  if (!(vipGroupCard instanceof HTMLElement)) {
    throw new Error('VIP group card was not rendered')
  }
  expect(
    within(vipGroupCard).getByText(i18next.t('No data'))
  ).toBeInTheDocument()
  const emptyHistory = within(vipGroupCard).getByRole('img', {
    name: i18next.t('Performance in the latest 24 five-minute intervals.'),
  })
  expect(
    emptyHistory.querySelectorAll('[data-slot="status-empty"]')
  ).toHaveLength(24)
  expect(emptyHistory.querySelector('[data-slot="status-empty"]')).toHaveClass(
    'border',
    'bg-muted-foreground/20'
  )
  expect(within(vipGroupCard).getAllByText('—')).toHaveLength(3)

  const providerGroupCard = screen
    .getByText('provider')
    .closest('[data-slot="card"]')
  if (!(providerGroupCard instanceof HTMLElement)) {
    throw new Error('Provider group card was not rendered')
  }
  expect(
    within(providerGroupCard).getByText(i18next.t('Normal'))
  ).toBeInTheDocument()
  expect(within(providerGroupCard).getByText('95.00%')).toBeInTheDocument()

  const defaultGroupCard = screen
    .getByText('default')
    .closest('[data-slot="card"]')
  if (!(defaultGroupCard instanceof HTMLElement)) {
    throw new Error('Default group card was not rendered')
  }
  const history = within(defaultGroupCard).getByRole('img', {
    name: i18next.t('Performance in the latest 24 five-minute intervals.'),
  })
  expect(history).not.toHaveAttribute('title')
  const bars = history.querySelectorAll('[data-slot="tooltip-trigger"]')
  expect(bars).toHaveLength(24)
  fireEvent.focus(bars.item(bars.length - 1))

  await waitFor(() => {
    expect(
      screen.getByText(`${i18next.t('Availability')}:`)
    ).toBeInTheDocument()
    expect(screen.getByText('99.0%')).toBeInTheDocument()
    expect(
      screen.getByText(`${i18next.t('Average latency')}:`)
    ).toBeInTheDocument()
    expect(screen.getByText(`${i18next.t('Throughput')}:`)).toBeInTheDocument()
    expect(
      screen.queryByText(`${i18next.t('Requests')}:`)
    ).not.toBeInTheDocument()
  })
})

it('finds groups by their effective price', async () => {
  render(<ModelMonitoring />)
  const search = screen.getByPlaceholderText(i18next.t('Search groups'))

  fireEvent.change(search, { target: { value: '¥2' } })
  await waitFor(() => {
    expect(screen.getByText('¥2 / USD')).toBeInTheDocument()
  })

  fireEvent.change(search, { target: { value: '¥9' } })
  await waitFor(() => {
    expect(screen.queryByText('¥2 / USD')).not.toBeInTheDocument()
  })
})

it('keeps a single active record compact and updates its color in place', () => {
  const timestamp = Math.floor(Date.now() / 1_000 / 300) * 300
  const { container, rerender } = render(
    <ModelStatusHistory
      currentInterval={timestamp}
      series={[
        {
          ts: timestamp,
          success_rate: 100,
          avg_latency_ms: 200,
          avg_tps: 10,
          request_count: 1,
        },
      ]}
    />
  )

  let bars = container.querySelectorAll('[data-slot="tooltip-trigger"]')
  expect(bars).toHaveLength(1)
  expect(bars.item(0)).toHaveClass('bg-emerald-500')
  expect(bars.item(0)).toHaveClass('w-full')
  expect(container.querySelectorAll('[data-slot="status-empty"]')).toHaveLength(
    23
  )

  rerender(
    <ModelStatusHistory
      currentInterval={timestamp}
      series={[
        {
          ts: timestamp,
          success_rate: 50,
          avg_latency_ms: 400,
          avg_tps: 5,
          request_count: 2,
        },
      ]}
    />
  )

  bars = container.querySelectorAll('[data-slot="tooltip-trigger"]')
  expect(bars).toHaveLength(1)
  expect(bars.item(0)).toHaveClass('bg-red-500')
})

it('backfills only leading silence with older active intervals', () => {
  const timestamp = Math.floor(Date.now() / 1_000 / 300) * 300
  const { container } = render(
    <ModelStatusHistory
      currentInterval={timestamp}
      series={[
        {
          ts: timestamp - 30 * 300,
          success_rate: 100,
          avg_latency_ms: 200,
          avg_tps: 10,
          request_count: 1,
        },
        {
          ts: timestamp - 25 * 300,
          success_rate: 80,
          avg_latency_ms: 300,
          avg_tps: 8,
          request_count: 1,
        },
        {
          ts: timestamp - 10 * 300,
          success_rate: 50,
          avg_latency_ms: 400,
          avg_tps: 5,
          request_count: 1,
        },
        {
          ts: timestamp - 8 * 300,
          success_rate: 100,
          avg_latency_ms: 250,
          avg_tps: 9,
          request_count: 1,
        },
      ]}
    />
  )

  const bars = container.querySelectorAll('[data-slot="tooltip-trigger"]')
  expect(bars).toHaveLength(4)
  expect(bars.item(0)).toHaveClass('bg-emerald-500')
  expect(bars.item(1)).toHaveClass('bg-amber-500')
  expect(bars.item(2)).toHaveClass('bg-red-500')
  expect(bars.item(3)).toHaveClass('bg-emerald-500')
  expect(container.querySelectorAll('[data-slot="status-empty"]')).toHaveLength(
    20
  )
})
