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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
        success: true,
        data: {
          models: [
            {
              model_name: 'gpt-test',
              avg_latency_ms: 250,
              success_rate: 99,
              avg_tps: 20,
              request_count: 1000,
              recent_success_series: [
                {
                  ts: Math.floor(Date.now() / 1_000 / 3_600) * 3_600,
                  success_rate: 99,
                },
              ],
            },
          ],
        },
      },
      dataUpdatedAt: Date.UTC(2026, 0, 1),
      isLoading: false,
      isFetching: false,
      refetch,
    }),
  }
})

vi.mock('@/features/pricing/hooks/use-pricing-data', () => ({
  usePricingData: () => ({
    models: [
      {
        id: 1,
        model_name: 'gpt-test',
        vendor_name: 'OpenAI',
        vendor_icon: 'OpenAI',
        enable_groups: ['default'],
        model_ratio: 1,
        completion_ratio: 2,
      },
    ],
    isLoading: false,
    priceRate: 7.3,
    usdExchangeRate: 7.3,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children?: React.ReactNode }) => (
    <a href='#'>{props.children}</a>
  ),
}))

beforeEach(async () => {
  await i18next.changeLanguage('zhCN')
})

afterEach(async () => {
  await i18next.changeLanguage('en')
})

it('renders monitoring metrics and hourly details when the interface language is zhCN', async () => {
  expect(() => render(<ModelMonitoring />)).not.toThrow()
  expect(screen.getByText('gpt-test')).toBeInTheDocument()
  expect(screen.getByText('1,000')).toBeInTheDocument()
  expect(screen.getByText(i18next.t('Price'))).toBeInTheDocument()

  const history = screen.getByRole('img', {
    name: i18next.t(
      'Recent success-rate samples; gray bars indicate missing data.'
    ),
  })
  const bars = history.querySelectorAll('[data-slot="tooltip-trigger"]')
  fireEvent.focus(bars.item(bars.length - 1))

  await waitFor(() => {
    expect(
      screen.getByText(`${i18next.t('Availability')}:`)
    ).toBeInTheDocument()
    expect(screen.getByText('99.0%')).toBeInTheDocument()
  })
})
