// 生成桌面应用图标 build/icon.png（512x512）
// 设计：蓝色渐变背景 + 白色“wo”字母图形，呼应“wokao”品牌
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const SIZE = 512

function inRoundRect(x, y, x1, y1, x2, y2, r) {
  if (x < x1 || x > x2 || y < y1 || y > y2) return false
  const cx = Math.max(x1 + r, Math.min(x, x2 - r))
  const cy = Math.max(y1 + r, Math.min(y, y2 - r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

// “w” 四段折线
const W_SEGS = [
  [71, 130, 121, 385],
  [121, 385, 144, 250],
  [144, 250, 166, 385],
  [166, 385, 216, 130]
]
// “o” 圆环
const O = { cx: 341, cy: 260, r: 100, thick: 30 }

function isWhite(x, y) {
  for (const [x1, y1, x2, y2] of W_SEGS) {
    if (distToSegment(x, y, x1, y1, x2, y2) <= 13) return true
  }
  const d = Math.hypot(x - O.cx, y - O.cy)
  if (Math.abs(d - O.r) <= O.thick / 2) return true
  return false
}

const png = new PNG({ width: SIZE, height: SIZE })

for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE
  const br = lerp(47, 26, t)
  const bg = lerp(107, 79, t)
  const bb = lerp(255, 214, t)
  for (let x = 0; x < SIZE; x++) {
    const idx = (SIZE * y + x) << 2
    let r = br
    let g = bg
    let b = bb
    let a = 255
    if (!inRoundRect(x, y, 0, 0, SIZE - 1, SIZE - 1, 96)) {
      a = 0
    } else if (isWhite(x, y)) {
      r = 255
      g = 255
      b = 255
    }
    png.data[idx] = r
    png.data[idx + 1] = g
    png.data[idx + 2] = b
    png.data[idx + 3] = a
  }
}

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'icon.png'), PNG.sync.write(png))
console.log('已生成 build/icon.png')
