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

const refetch = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: () => ({
      data: {
        groups: [
          { group: 'default', ratio: 0.2, sort_order: 10 },
          { group: 'vip', ratio: 0.3, sort_order: 20 },
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
              recent_interval_series: [
                {
                  ts: Math.floor(Date.now() / 1_000 / 300) * 300,
                  success_rate: 99,
                  avg_latency_ms: 250,
                  avg_tps: 20,
                  request_count: 12,
                },
              ],
            },
          },
        ],
      },
      dataUpdatedAt: Date.UTC(2026, 0, 1),
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
  ).toEqual(['vip', 'default'])
  expect(screen.getByText('¥2 / USD')).toBeInTheDocument()
  expect(screen.queryByText('1,000')).not.toBeInTheDocument()
  expect(screen.queryByText('0.2x')).not.toBeInTheDocument()
  expect(screen.getByText('250ms')).toBeInTheDocument()
  expect(screen.getByText('20.0 t/s')).toBeInTheDocument()
  expect(screen.getAllByText(i18next.t('Normal')).length).toBeGreaterThan(0)

  const defaultGroupCard = screen
    .getByText('default')
    .closest('[data-slot="card"]')
  if (!(defaultGroupCard instanceof HTMLElement)) {
    throw new Error('Default group card was not rendered')
  }
  const history = within(defaultGroupCard).getByRole('img', {
    name: i18next.t(
      'Recent performance samples at five-minute intervals; gray bars indicate missing data.'
    ),
  })
  const bars = history.querySelectorAll('[data-slot="tooltip-trigger"]')
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
    expect(screen.getByText(`${i18next.t('Requests')}:`)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
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
