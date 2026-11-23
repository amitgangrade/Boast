import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

/**
 * A QR code as inline SVG. Always navy on white with a quiet zone, whatever the theme,
 * because phone cameras need the contrast.
 */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`
    return { path: d, count: n + 8 }
  }, [value])
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${count} ${count}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-lg">
      <rect width={count} height={count} fill="#ffffff" />
      <path d={path} fill="#0b1f4b" />
    </svg>
  )
}
