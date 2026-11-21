import { useRef, useState } from 'react'
import { Avatar } from './ui'

/** Centre-crops to a square and scales down to 512px JPEG before upload. */
export async function squareJpeg(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(size, side)
  canvas
    .getContext('2d')!
    .drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process photo'))), 'image/jpeg', 0.88))
}

export function AvatarPicker({ name, currentUrl, onPick, onRemove, busy }: { name: string; currentUrl: string | null; onPick: (blob: Blob) => void; onRemove?: () => void; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const choose = async (file: File | undefined) => {
    setErr(null)
    if (!file) return
    if (!file.type.startsWith('image/')) return setErr('Photo must be an image file')
    if (file.size > 15_000_000) return setErr('Photo must be 15 MB or smaller')
    try {
      const blob = await squareJpeg(file)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(blob))
      onPick(blob)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || '?'} url={preview ?? currentUrl} size={64} />
      <div className="space-y-1">
        <div className="flex gap-2">
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {currentUrl || preview ? 'Change photo' : 'Add photo'}
          </button>
          {onRemove && currentUrl && !preview && (
            <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
        <p className="hint">Optional. Cropped to a square.</p>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => choose(e.target.files?.[0])} />
    </div>
  )
}
