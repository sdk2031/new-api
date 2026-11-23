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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { PLAYGROUND_IMAGE_PATH } from '../../api'

export function PlaygroundResultImage(props: { path: string }) {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: ['playground', 'image', userId, props.path],
    queryFn: async ({ signal }) => {
      const response = await api.get<Blob>(props.path, {
        responseType: 'blob',
        signal,
        disableDuplicate: true,
        skipErrorHandler: true,
        skipBusinessError: true,
      })
      if (!response.data.type.startsWith('image/'))
        throw new Error('Invalid image response')
      return response.data
    },
    enabled: Boolean(userId) && PLAYGROUND_IMAGE_PATH.test(props.path),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
  })
  const [image, setImage] = useState<{ blob: Blob; src: string } | null>(null)
  useEffect(() => {
    if (!query.data) return
    const src = URL.createObjectURL(query.data)
    setImage({ blob: query.data, src })
    return () => URL.revokeObjectURL(src)
  }, [query.data])

  if (image && image.blob === query.data) {
    return (
      <a
        href={image.src}
        download={props.path.split('/').at(-1)}
        aria-label={t('Download')}
      >
        <img
          src={image.src}
          alt={t('Generated image')}
          className='max-h-[65vh] max-w-full rounded-lg border object-contain'
        />
      </a>
    )
  }
  if (query.isFetching || query.data)
    return <Skeleton className='h-40 w-full rounded-lg' />
  return (
    <p className='text-muted-foreground text-sm'>
      {t('Image could not be loaded.')}
    </p>
  )
}
