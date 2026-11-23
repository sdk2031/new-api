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
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import { getSubmittableInputText } from '../../lib'
import type {
  ModelOption,
  GroupOption,
  ParameterEnabled,
  PlaygroundConfig,
  PlaygroundImageRequest,
  PlaygroundMode,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'

interface PlaygroundInputProps {
  config: PlaygroundConfig
  onSubmit: (text: string, imageRequest?: PlaygroundImageRequest) => void
  mode: PlaygroundMode
  onModeChange: (value: PlaygroundMode) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  hasMessages?: boolean
  onConfigChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  onClearMessages?: () => void
  onParameterEnabledChange: (
    key: keyof ParameterEnabled,
    value: boolean
  ) => void
  parameterEnabled: ParameterEnabled
}

export function PlaygroundInput({
  config,
  mode,
  onModeChange,
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  hasMessages = false,
  onConfigChange,
  onClearMessages,
  onParameterEnabledChange,
  parameterEnabled,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [size, setSize] = useState('')
  const [references, setReferences] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sizeId = useId()
  const referencesId = useId()
  const isImageMode = mode !== 'chat'
  const modeLabels = {
    chat: t('Chat'),
    generate: t('Image Generation'),
    edit: t('Image to image'),
  }

  const handleSubmit = (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(message, disabled)

    if (!submittableText || !modelValue || isModelLoading) return
    if (mode === 'chat') {
      onSubmit(submittableText)
    } else {
      const request: PlaygroundImageRequest = {
        mode,
        model: modelValue,
        group: groupValue,
        size: size.trim() || undefined,
      }
      if (mode === 'edit' && selectedFiles.length > 0) {
        // PromptInput resets its form before invoking this handler, so use the
        // files captured by the input's change handler.
        const selected = selectedFiles
        if (
          !selected.length ||
          selected.length > 4 ||
          selected.some(
            (file) =>
              !/^image\/(png|jpeg|webp|gif)$/.test(file.type) ||
              file.size > 5 * 1024 * 1024
          )
        ) {
          toast.error(
            t('Choose up to 4 PNG, JPEG, WebP or GIF images, 5 MB each.')
          )
          return
        }
        request.files = selected
        setSelectedFiles([])
      } else if (mode === 'edit') {
        const urls = references.trim().split(/\s+/).filter(Boolean)
        if (
          urls.length === 0 ||
          urls.length > 4 ||
          urls.some(
            (url) => !/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2048
          )
        ) {
          toast.error(t('Enter up to 4 HTTP or HTTPS image URLs.'))
          return
        }
        request.mode = 'generate'
        request.references = urls
        setReferences('')
      }
      onSubmit(submittableText, request)
    }
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 rounded-xl overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        onSubmit={handleSubmit}
      >
        <div className='flex flex-wrap items-center gap-2 px-3 pt-3'>
          <Select
            value={mode}
            onValueChange={(value) => {
              if (!value) return
              if (value !== 'edit') setSelectedFiles([])
              onModeChange(value)
            }}
            disabled={disabled}
          >
            <SelectTrigger aria-label={t('Mode')}>
              <SelectValue>{modeLabels[mode]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value='chat'>{modeLabels.chat}</SelectItem>
                <SelectItem value='generate'>{modeLabels.generate}</SelectItem>
                <SelectItem value='edit'>{modeLabels.edit}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {isImageMode && (
            <div className='flex items-center gap-2'>
              <Label htmlFor={sizeId}>{t('Image size')}</Label>
              <Input
                id={sizeId}
                className='h-8 w-32'
                placeholder='9:16'
                value={size}
                maxLength={32}
                disabled={disabled}
                onChange={(event) => setSize(event.target.value)}
              />
            </div>
          )}
        </div>
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            isImageMode
              ? t('Describe the image you want to create')
              : t('Ask anything')
          }
          value={text}
        />
        {mode === 'edit' && (
          <div className='grid w-full gap-2 px-3 pb-3'>
            <Label htmlFor={referencesId}>
              {t('Reference image URLs (optional)')}
            </Label>
            <Textarea
              id={referencesId}
              placeholder='https://example.com/reference.jpg'
              rows={2}
              value={references}
              disabled={disabled || selectedFiles.length > 0}
              onChange={(event) => setReferences(event.target.value)}
            />
            <Label htmlFor={`${referencesId}-file`}>
              {t('Upload reference images')}
            </Label>
            <div className='flex items-center gap-2'>
              <Input
                ref={fileInputRef}
                id={`${referencesId}-file`}
                type='file'
                accept='image/png,image/jpeg,image/webp,image/gif'
                multiple
                disabled={disabled || references.trim().length > 0}
                onChange={(event) =>
                  setSelectedFiles(Array.from(event.target.files ?? []))
                }
              />
              {selectedFiles.length > 0 && (
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  disabled={disabled}
                  onClick={() => {
                    setSelectedFiles([])
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                >
                  {t('Remove')}
                </Button>
              )}
            </div>
          </div>
        )}

        <PromptInputFooter className='border-border/60 bg-muted/20 dark:bg-muted/10 border-t px-3 py-2.5 backdrop-blur'>
          <PlaygroundInputControls
            disabled={disabled}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isModelLoading={isModelLoading}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            text={
              mode === 'edit' &&
              selectedFiles.length === 0 &&
              !references.trim()
                ? ''
                : text
            }
            tools={
              <PlaygroundInputTools
                isImageMode={isImageMode}
                config={config}
                disabled={disabled}
                hasMessages={hasMessages}
                onConfigChange={onConfigChange}
                onClearMessages={onClearMessages}
                onParameterEnabledChange={onParameterEnabledChange}
                parameterEnabled={parameterEnabled}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
