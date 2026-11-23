import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { sendPlaygroundImage } from '../api'

const result = '/pg/images/result/921fb9be-9b44-449e-8c62-f1004014cdea.png'

afterEach(() => vi.restoreAllMocks())

it('forwards the FDAI reference array and ratio and accepts only local result URLs', async () => {
  const send = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      data: [{ url: result }, { url: 'https://upstream.test/result.png' }],
    },
  })
  const references = ['https://example.com/a.png', 'https://example.com/b.png']
  const signal = new AbortController().signal

  await expect(
    sendPlaygroundImage(
      {
        mode: 'generate',
        group: 'images',
        model: 'nano_banana_pro',
        size: '9:16',
        references,
      },
      'City street',
      signal
    )
  ).resolves.toEqual([result])

  expect(send).toHaveBeenCalledWith(
    '/pg/images/generations',
    {
      model: 'nano_banana_pro',
      prompt: 'City street',
      size: '9:16',
      image: references,
    },
    expect.objectContaining({ params: { group: 'images' }, signal })
  )
})

it('sends uploaded reference files to the image edits endpoint', async () => {
  const send = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { data: [{ url: result }] } })
  const reference = new File(['image'], 'reference.png', { type: 'image/png' })

  await sendPlaygroundImage(
    { mode: 'edit', group: 'images', model: 'gpt-image-2', files: [reference] },
    'Make it brighter',
    new AbortController().signal
  )

  const [endpoint, body] = send.mock.calls[0]
  expect(endpoint).toBe('/pg/images/edits')
  expect(body).toBeInstanceOf(FormData)
  expect((body as FormData).get('prompt')).toBe('Make it brighter')
  expect((body as FormData).getAll('image')).toEqual([reference])
})
