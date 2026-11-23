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
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
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

function PlaygroundModeSelect({
  mode,
  onModeChange,
  disabled,
}: Pick<PlaygroundInputProps, 'mode' | 'onModeChange' | 'disabled'>) {
  const { t } = useTranslation()
  const { clear } = usePromptInputAttachments()
  const labels = { chat: t('Conversation'), generate: t('Generate images') }
  return (
    <Select
      value={mode}
      onValueChange={(value) => {
        if (!value) return
        if (value === 'chat') clear()
        onModeChange(value)
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={t('Mode')}>
        <SelectValue>{labels[mode]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value='chat'>{labels.chat}</SelectItem>
          <SelectItem value='generate'>{labels.generate}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function PlaygroundReferencePreviews() {
  const { files } = usePromptInputAttachments()
  if (files.length === 0) return null

  return (
    <PromptInputHeader className='flex w-full flex-wrap justify-start gap-2 px-5 pt-4'>
      <PromptInputAttachments>
        {(file) => (
          <PromptInputAttachment data={file} className='max-w-40' />
        )}
      </PromptInputAttachments>
    </PromptInputHeader>
  )
}

function PlaygroundReferenceUrls({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const { files } = usePromptInputAttachments()

  return (
    <div className='flex min-w-0 flex-1 items-center gap-2'>
      <Label htmlFor={id}>{t('Reference image URLs (optional)')}</Label>
      <Input
        id={id}
        className='h-8 min-w-24'
        placeholder='https://example.com/reference.jpg'
        value={value}
        disabled={disabled || files.length > 0}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
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
  const sizeId = useId()
  const referencesId = useId()
  const isImageMode = mode !== 'chat'
  const handleSubmit = (message: PromptInputMessage): void | false => {
    const submittableText = getSubmittableInputText(message, disabled)

    if (!submittableText || !modelValue || isModelLoading) return false
    if (mode === 'chat') {
      onSubmit(submittableText)
    } else {
      const files = message.attachmentFiles ?? []
      const request: PlaygroundImageRequest = {
        mode: files.length > 0 ? 'edit' : 'generate',
        model: modelValue,
        group: groupValue,
        size: size.trim() || undefined,
      }
      if (files.length > 0) {
        request.files = files
      } else if (references.trim()) {
        const urls = references.trim().split(/\s+/).filter(Boolean)
        if (
          urls.length > 4 ||
          urls.some(
            (url) => !/^https?:\/\/[^\s]+$/i.test(url) || url.length > 2048
          )
        ) {
          toast.error(t('Enter up to 4 HTTP or HTTPS image URLs.'))
          return false
        }
        request.references = urls
      }
      onSubmit(submittableText, request)
      setReferences('')
    }
    setText('')
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 rounded-xl overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        accept='image/png,image/jpeg,image/webp,image/gif'
        attachmentFormat='file'
        attachmentsEnabled={isImageMode && !disabled}
        maxFiles={4}
        maxFileSize={5 * 1024 * 1024}
        multiple
        onError={() =>
          toast.error(
            t('Choose up to 4 PNG, JPEG, WebP or GIF images, 5 MB each.')
          )
        }
        onSubmit={handleSubmit}
      >
        {isImageMode && <PlaygroundReferencePreviews />}
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          pasteAttachments={isImageMode}
          placeholder={
            isImageMode
              ? t('Describe the image you want to create')
              : t('Ask anything')
          }
          value={text}
        />
        {isImageMode && (
          <div className='flex w-full flex-wrap gap-2 px-5 pb-3'>
            <PlaygroundReferenceUrls
              id={referencesId}
              value={references}
              disabled={disabled}
              onChange={setReferences}
            />
            <div className='flex items-center gap-2'>
              <Label htmlFor={sizeId}>{t('Image size')}</Label>
              <Input
                id={sizeId}
                className='h-8 w-24'
                placeholder='9:16'
                value={size}
                maxLength={32}
                disabled={disabled}
                onChange={(event) => setSize(event.target.value)}
              />
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
            text={text}
            tools={
              <>
                <PlaygroundModeSelect
                  mode={mode}
                  onModeChange={onModeChange}
                  disabled={disabled}
                />
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
              </>
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
