import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { PlaygroundInput } from '../components/input/playground-input'
import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../constants'

beforeEach(() => {
  class TestURL extends URL {
    static createObjectURL = vi.fn((file: File) => `blob:test/${file.name}`)
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', TestURL)
})

afterEach(() => vi.unstubAllGlobals())

function renderImageComposer() {
  const onSubmit = vi.fn()
  const model = 'gpt-image-2'
  const group = 'images'
  render(
    <TooltipProvider>
      <PlaygroundInput
        config={DEFAULT_CONFIG}
        mode='generate'
        onModeChange={vi.fn()}
        groupValue={group}
        groups={[{ label: group, value: group, ratio: 1 }]}
        modelValue={model}
        models={[{ label: model, value: model }]}
        onGroupChange={vi.fn()}
        onModelChange={vi.fn()}
        onConfigChange={vi.fn()}
        onParameterEnabledChange={vi.fn()}
        parameterEnabled={DEFAULT_PARAMETER_ENABLED}
        onSubmit={onSubmit}
      />
    </TooltipProvider>
  )
  const textarea = screen.getByPlaceholderText('Describe the image you want to create')
  return { textarea, onSubmit, request: { model, group } }
}

it('previews pasted files above the prompt and sends them for image editing', () => {
  const { textarea, onSubmit, request } = renderImageComposer()
  const first = new File(['first'], 'first.png', { type: 'image/png' })
  const second = new File(['second'], 'second.png', { type: 'image/png' })
  fireEvent.paste(textarea, {
    clipboardData: { items: [{ kind: 'file', getAsFile: () => first }] },
  })
  fireEvent.paste(textarea, { clipboardData: { files: [second] } })

  const preview = screen.getByRole('img', { name: 'first.png' })
  expect(textarea.closest('form')).toContainElement(preview)
  expect(preview.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Reference image URLs (optional)')).toBeDisabled()

  fireEvent.change(textarea, { target: { value: 'Make it brighter' } })
  fireEvent.click(screen.getByRole('button', { name: /send/i }))

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('Make it brighter', {
    ...request,
    mode: 'edit',
    files: [first, second],
  })
  expect(preview).not.toBeInTheDocument()
})

it('returns to text-to-image after removing the last pasted reference', () => {
  const { textarea, onSubmit, request } = renderImageComposer()
  const file = new File(['reference'], 'reference.png', { type: 'image/png' })
  fireEvent.paste(textarea, { clipboardData: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Remove attachment' }))
  expect(screen.queryByRole('img', { name: 'reference.png' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Reference image URLs (optional)')).toBeEnabled()

  fireEvent.change(textarea, { target: { value: 'A city at sunrise' } })
  fireEvent.click(screen.getByRole('button', { name: /send/i }))

  expect(onSubmit).toHaveBeenCalledExactlyOnceWith('A city at sunrise', {
    ...request,
    mode: 'generate',
  })
})
