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
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { TaskUsagePricingEditor } from '../task-usage-pricing-editor'

function renderPricing(unitLabel?: Record<string, string>) {
  const onBillingExprChange = vi.fn()
  render(
    <TaskUsagePricingEditor
      billingExpr='tier("music", 1 + u("clips") * 11)'
      requestRuleExpr=''
      usageSchema={{
        action: {
          enum: ['music', 'lyrics'],
          enumLabels: {
            music: { en: 'Generate songs', zh: '生成歌曲' },
            lyrics: { en: 'Generate lyrics', zh: '生成歌词' },
          },
          description: { en: 'Generate songs or lyrics', zh: '生成歌曲或歌词' },
        },
        clips: {
          type: 'number',
          unit: 'count',
          unitLabel,
          description: { en: 'Song generation unit price', zh: '生成歌曲单价' },
        },
      }}
      onBillingExprChange={onBillingExprChange}
      onRequestRuleExprChange={vi.fn()}
    />
  )
  return onBillingExprChange
}

afterEach(async () => {
  await act(() => i18next.changeLanguage('en'))
})

it('shows localized schema explanations in the price table and calculator', async () => {
  renderPricing()
  const table = screen.getByRole('table')
  expect(within(table).getByText('Song generation unit price')).toBeVisible()
  expect(within(table).getByText('Generate songs or lyrics')).toBeVisible()
  expect(
    screen.getByRole('spinbutton', {
      name: 'Usage · Song generation unit price',
    })
  ).toBeVisible()
  expect(
    within(table).getByText(
      'Added to the usage cost. Set to 0 for no additional charge.'
    )
  ).toBeVisible()
  await act(() => i18next.changeLanguage('zhCN'))
  expect(within(table).getByText('生成歌曲单价')).toBeVisible()
  expect(screen.getByRole('combobox', { name: '生成歌曲或歌词' })).toBeVisible()
})

it('uses count unit labels in the price matrix and calculator without changing the charge', async () => {
  renderPricing({ en: 'song', zh: '首' })
  expect(within(screen.getByRole('table')).getByText('$/song')).toBeVisible()
  expect(
    screen.getByText(
      'Additional charge: $1 + Song generation unit price: 1 song × $11/song = $12'
    )
  ).toBeVisible()
  await act(() => i18next.changeLanguage('zhCN'))
  expect(within(screen.getByRole('table')).getByText('$/首')).toBeVisible()
  expect(screen.getByText('首')).toBeVisible()
  expect(screen.getByText(/1 首 × \$11\/首 = \$12/)).toBeVisible()
})

it('identifies pricing conditions and keeps the additional charge unchanged when sample usage changes', async () => {
  renderPricing()
  expect(
    screen.getByText('Current pricing conditions: Generate songs')
  ).toBeVisible()
  expect(
    screen.getByText(
      'Additional charge: $1 + Song generation unit price: 1 unit × $11/unit = $12'
    )
  ).toBeVisible()
  const user = userEvent.setup()
  const quantity = screen.getByRole('spinbutton', {
    name: 'Usage · Song generation unit price',
  })
  await user.clear(quantity)
  await user.type(quantity, '2')
  expect(
    screen.getByText(
      'Additional charge: $1 + Song generation unit price: 2 unit × $11/unit = $23'
    )
  ).toBeVisible()
})

it('shows localized enum choices while preserving raw values in generated billing expressions', async () => {
  const onChange = renderPricing()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('combobox', { name: 'Generate songs or lyrics' })
  )
  await user.click(screen.getByRole('option', { name: 'Generate lyrics' }))
  expect(
    screen.getByText('Current pricing conditions: Generate lyrics')
  ).toBeVisible()
  const price = screen.getByRole('textbox', {
    name: 'Song generation unit price: Generate lyrics',
  })
  await user.clear(price)
  await user.type(price, '3')
  const expression = onChange.mock.lastCall?.[0]
  expect(expression).toContain('u("action") == "music"')
  expect(expression).toContain('tier("lyrics"')
  expect(expression).not.toContain('Generate lyrics')
})

function TaskPricingDraft(props: {
  expression: string
  onChange: (next: string) => void
  videoResolutions?: boolean
}) {
  const [billingExpr, setBillingExpr] = useState(props.expression)
  const [requestRuleExpr, setRequestRuleExpr] = useState(
    '(header("x-priority") == "high" ? 2 : 1)'
  )
  return (
    <TaskUsagePricingEditor
      billingExpr={billingExpr}
      requestRuleExpr={requestRuleExpr}
      usageSchema={{
        seconds: {
          type: 'number',
          unit: 'second',
          description: 'Seconds price',
        },
        ...(props.videoResolutions
          ? {
              aspect_ratio: { enum: ['16:9', '9:16'] },
              resolution: {
                enum: ['480p', '720p', '1080p'],
                description: 'Resolution',
              },
            }
          : { mode: { enum: ['std', 'pro'] } }),
      }}
      onBillingExprChange={(next) => {
        setBillingExpr(next)
        props.onChange(next)
      }}
      onRequestRuleExprChange={setRequestRuleExpr}
    />
  )
}

it('edits video prices by resolution without presenting aspect ratio as a price condition', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const expression =
    'u("resolution") == "480p" ? tier("duration", ceil(u("seconds") / 30) * 1.5) : u("resolution") == "720p" ? tier("duration", ceil(u("seconds") / 30) * 3) : tier("duration", ceil(u("seconds") / 30) * 6)'
  const draft = render(
    <TaskPricingDraft expression='' onChange={onChange} videoResolutions />
  )
  const table = screen.getByRole('table')
  expect(within(table).getByText('Resolution')).toBeVisible()
  expect(within(table).getByText('480p')).toBeVisible()
  expect(within(table).getByText('720p')).toBeVisible()
  expect(within(table).queryByText('16:9')).not.toBeInTheDocument()
  draft.unmount()

  render(
    <TaskPricingDraft
      expression={expression}
      onChange={onChange}
      videoResolutions
    />
  )
  const durationTable = screen.getByRole('table')
  expect(
    within(durationTable)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
  ).toEqual(['Resolution', 'Billing unit', 'Unit price', 'Actions'])
  const row = within(durationTable).getByRole('row', { name: /^720p / })
  expect(within(row).getByText('Every 30 seconds')).toBeVisible()
  const price = within(row).getByRole('textbox', {
    name: 'Unit price: 720p',
  })
  expect(price).toHaveValue('3')
  expect(screen.getByRole('textbox', { name: 'Unit price: 480p' })).toHaveValue(
    '1.5'
  )
  expect(
    screen.getByRole('textbox', { name: 'Unit price: 1080p' })
  ).toHaveValue('6')
  await user.click(screen.getByRole('combobox', { name: 'Resolution' }))
  await user.click(screen.getByRole('option', { name: '720p' }))
  expect(screen.getByText('Preview base cost: $3')).toBeVisible()
  fireEvent.change(price, { target: { value: '4' } })
  expect(onChange).toHaveBeenLastCalledWith(
    'u("resolution") == "480p" ? tier("duration", ceil(u("seconds") / 30) * 1.5) : u("resolution") == "720p" ? tier("duration", ceil(u("seconds") / 30) * 4) : u("resolution") == "1080p" ? tier("duration", ceil(u("seconds") / 30) * 6) : tier("duration_default", ceil(u("seconds") / 30) * 6)'
  )
  expect(screen.getByText('Preview base cost: $4')).toBeVisible()
})

it('adds only selected resolutions and restores the default rate when a row is removed', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <TaskPricingDraft
      expression='tier("duration", u("seconds") * 0.4)'
      onChange={onChange}
      videoResolutions
    />
  )
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('rowheader')).toHaveLength(1)
  expect(
    within(table).getByRole('rowheader', { name: 'Other cases' })
  ).toBeVisible()
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('combobox', { name: 'Add resolution' }))
  await user.click(screen.getByRole('option', { name: '720p' }))
  const price = within(table).getByRole('textbox', { name: 'Unit price: 720p' })
  expect(price).toHaveValue('0.4')
  fireEvent.change(price, { target: { value: '0.8' } })
  expect(onChange).toHaveBeenLastCalledWith(
    'u("resolution") == "720p" ? tier("duration", u("seconds") * 0.8) : tier("duration_default", u("seconds") * 0.4)'
  )
  await user.click(screen.getByRole('combobox', { name: 'Add resolution' }))
  expect(screen.queryByRole('option', { name: '720p' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('option', { name: '1080p' }))
  await user.click(within(table).getByRole('button', { name: 'Remove 1080p' }))
  expect(
    within(table).queryByRole('rowheader', { name: '1080p' })
  ).not.toBeInTheDocument()
  await user.click(within(table).getByRole('button', { name: 'Remove 720p' }))
  expect(onChange).toHaveBeenLastCalledWith(
    'tier("duration", u("seconds") * 0.4)'
  )
})

it('lets users cancel or discard an unsupported expression and its request rules', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <TaskPricingDraft
      expression='tier("custom", u("seconds") * u("seconds"))'
      onChange={onChange}
    />
  )
  const original = screen.getByRole('textbox', { name: 'Billing expression' })
  const originalValue = (original as HTMLTextAreaElement).value
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Visual editor' }))
  let dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent('resets all prices to zero')
  expect(onChange).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(original).toHaveValue(originalValue)
  expect(onChange).not.toHaveBeenCalled()

  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Visual editor' }))
  dialog = screen.getByRole('alertdialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'Switch to visual editor' })
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('table')).toBeVisible()
  expect(onChange).toHaveBeenLastCalledWith('tier("base", u("seconds") * 0)')
  for (const price of within(screen.getByRole('table')).getAllByRole(
    'textbox'
  )) {
    expect(price).toHaveValue('0')
  }
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Expression editor' }))
  expect(
    screen.getByRole('textbox', { name: 'Billing expression' })
  ).toHaveValue('tier("base", u("seconds") * 0)')
})

it('sets a price per second or per started custom interval', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <TaskPricingDraft
      expression='tier("base", u("seconds") * 0.4)'
      onChange={onChange}
    />
  )
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Duration pricing' }))
  expect(onChange).toHaveBeenLastCalledWith(
    'tier("duration", u("seconds") * 0.4)'
  )
  expect(screen.getByRole('radio', { name: 'Per second' })).toBeChecked()
  expect(screen.getByRole('textbox', { name: 'Price per second' })).toHaveValue(
    '0.4'
  )
  expect(
    screen.queryByRole('textbox', { name: 'Billing interval' })
  ).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('radio', { name: 'Fixed price per duration block' })
  )
  await user.clear(screen.getByRole('textbox', { name: 'Billing interval' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Billing interval' }),
    '30'
  )
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Price per billing interval' }),
    {
      target: { value: '1.50' },
    }
  )
  expect(onChange).toHaveBeenLastCalledWith(
    'tier("duration", ceil(u("seconds") / 30) * 1.5)'
  )
  const duration = screen.getByRole('spinbutton', {
    name: 'Preview duration (seconds)',
  })
  for (const seconds of [5, 20, 30]) {
    fireEvent.change(duration, { target: { value: String(seconds) } })
    expect(screen.getByText('Preview base cost: $1.5')).toBeVisible()
  }
  fireEvent.change(duration, { target: { value: '31' } })
  expect(screen.getByText('Preview base cost: $3')).toBeVisible()
  await user.click(screen.getByRole('radio', { name: 'Per second' }))
  expect(onChange).toHaveBeenLastCalledWith(
    'tier("duration", u("seconds") * 0.05)'
  )
  expect(duration).toHaveValue(31)
  expect(screen.getByText('Preview base cost: $1.55')).toBeVisible()
})

it.each([12, 30])(
  'restores a saved %s-second interval and rejects invalid edits',
  (interval) => {
    const onChange = vi.fn()
    render(
      <TaskPricingDraft
        expression={`tier("duration", ceil(u("seconds") / ${interval}) * 1.2)`}
        onChange={onChange}
      />
    )
    const input = screen.getByRole('textbox', { name: 'Billing interval' })
    expect(input).toHaveValue(String(interval))
    const price = screen.getByRole('textbox', {
      name: 'Price per billing interval',
    })
    expect(price).toHaveValue('1.2')

    expect(
      screen.getByRole('radio', { name: 'Fixed price per duration block' })
    ).toBeChecked()
    for (const value of ['', '0', '1', '-2', '2.5']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveAttribute('data-billing-invalid', 'true')
      expect(input).toHaveAccessibleDescription(
        'Enter a whole number of at least 2'
      )
      expect(price).toBeDisabled()
    }
    expect(onChange).not.toHaveBeenCalled()
  }
)

it('confirms regeneration of supported expressions and preserves their prices and request rules', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const expression =
    'u("mode") == "std" ? tier("old-standard", u("seconds") * 0.4) : tier("old-pro", u("seconds") * 0.8)'
  render(<TaskPricingDraft expression={expression} onChange={onChange} />)
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Expression editor' }))
  expect(
    (
      screen.getByRole('textbox', {
        name: 'Billing expression',
      }) as HTMLTextAreaElement
    ).value
  ).toContain(expression)
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Visual editor' }))
  const dialog = screen.getByRole('alertdialog')
  expect(dialog).toHaveTextContent(
    'replaces its original formatting and tier names'
  )
  expect(onChange).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Switch to visual editor' })
  )
  expect(onChange).toHaveBeenLastCalledWith(
    'u("mode") == "std" ? tier("std", u("seconds") * 0.4) : tier("pro", u("seconds") * 0.8)'
  )
  expect(
    screen.getByRole('textbox', { name: 'Seconds price: mode: std' })
  ).toHaveValue('0.4')
  expect(
    screen.getByRole('textbox', { name: 'Seconds price: mode: pro' })
  ).toHaveValue('0.8')
  await user.click(screen.getByRole('combobox', { name: 'Editor mode' }))
  await user.click(screen.getByRole('option', { name: 'Expression editor' }))
  expect(
    (
      screen.getByRole('textbox', {
        name: 'Billing expression',
      }) as HTMLTextAreaElement
    ).value
  ).toContain('header("x-priority")')
})

it.each(['image', 'video'] as const)(
  'limits pricing fields to the resolved %s model schema',
  (kind) => {
    const usageSchema = {
      image: {
        image_count: {
          type: 'number' as const,
          unit: 'count' as const,
          unitLabel: { en: 'image', zh: '张' },
          description: { en: 'Image quantity' },
        },
      },
      video: {
        seconds: {
          type: 'number' as const,
          unit: 'second' as const,
          description: { en: 'Video duration' },
        },
        resolution: {
          enum: ['720P', '1080P'],
          description: { en: 'Resolution' },
        },
      },
    }
    const field = kind === 'image' ? 'image_count' : 'seconds'
    render(
      <TaskUsagePricingEditor
        billingExpr={`tier("base", u("${field}") * 1)`}
        requestRuleExpr=''
        usageSchema={usageSchema[kind]}
        onBillingExprChange={vi.fn()}
        onRequestRuleExprChange={vi.fn()}
      />
    )
    const presentLabel = kind === 'image' ? 'Image quantity' : 'Video duration'
    const absentLabel = kind === 'image' ? 'Video duration' : 'Image quantity'
    expect(
      screen.getByRole('spinbutton', { name: `Usage · ${presentLabel}` })
    ).toBeVisible()
    expect(
      screen.queryByRole('spinbutton', { name: `Usage · ${absentLabel}` })
    ).not.toBeInTheDocument()
    if (kind === 'image') {
      expect(screen.getByText('$/image')).toBeVisible()
      expect(
        screen.queryByRole('combobox', { name: 'Resolution' })
      ).not.toBeInTheDocument()
    } else {
      expect(screen.getByRole('combobox', { name: 'Resolution' })).toBeVisible()
    }
  }
)
