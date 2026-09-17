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
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { useTopNavLinks } from '../use-top-nav-links'

const statusState = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: statusState.value }),
}))

beforeEach(() => {
  useAuthStore.getState().auth.reset()
  statusState.value = {
    HeaderNavModules: {
      pricing: { enabled: true, requireAuth: false },
      monitoring: { enabled: true, requireAuth: true },
      rankings: { enabled: true, requireAuth: false },
    },
  }
})

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
})

it('places group monitoring after Model Square and requires anonymous users to log in', () => {
  const { result } = renderHook(() => useTopNavLinks())
  const links = result.current
  const pricingIndex = links.findIndex((link) => link.href === '/pricing')
  const monitoringIndex = links.findIndex((link) => link.href === '/monitoring')
  const rankingsIndex = links.findIndex((link) => link.href === '/rankings')

  expect(monitoringIndex).toBe(pricingIndex + 1)
  expect(rankingsIndex).toBe(monitoringIndex + 1)
  expect(links[monitoringIndex]?.requiresAuth).toBe(true)
})

it('hides group monitoring when its navigation module is disabled', () => {
  statusState.value = {
    HeaderNavModules: {
      monitoring: { enabled: false, requireAuth: false },
    },
  }

  const { result } = renderHook(() => useTopNavLinks())

  expect(result.current.some((link) => link.href === '/monitoring')).toBe(false)
})
