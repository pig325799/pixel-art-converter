// 40 色调色板：覆盖灰阶 + 各色相，适合像素画
// 每个颜色为 [r, g, b]
export const PALETTE = [
  // 灰阶 (4)
  [0, 0, 0],
  [168, 168, 174],
  [232, 223, 208],
  [255, 255, 255],
  // 红 (8)
  [139, 30, 45],
  [204, 36, 56],
  [232, 80, 80],
  [240, 152, 152],
  [240, 152, 120],
  [245, 192, 168],
  [248, 216, 200],
  [245, 232, 208],
  // 橙 (8)
  [200, 152, 120],
  [168, 144, 88],
  [232, 144, 48],
  [192, 96, 32],
  [240, 120, 48],
  [240, 192, 40],
  [245, 220, 152],
  [160, 168, 72],
  // 绿 (4)
  [136, 160, 72],
  [88, 104, 40],
  [104, 80, 40],
  [120, 112, 96],
  // 棕 (4)
  [128, 104, 40],
  [72, 40, 24],
  [104, 72, 40],
  [72, 56, 72],
  // 蓝 (4)
  [56, 56, 96],
  [56, 72, 160],
  [104, 88, 168],
  [168, 152, 200],
  // 紫 (4)
  [184, 184, 208],
  [152, 152, 184],
  [120, 184, 176],
  [160, 200, 192],
  // 青 (4)
  [72, 184, 192],
  [88, 168, 152],
  [176, 208, 184],
  [40, 56, 96]
]

// 预计算调色板 hex 字符串，供预览绘制使用
export const PALETTE_HEX = PALETTE.map(
  ([r, g, b]) => `rgb(${r},${g},${b})`
)

/**
 * 在调色板中查找与给定颜色最接近的颜色索引。
 * 使用加权欧氏距离（人眼对绿色更敏感）。
 */
export function nearestColorIndex(r, g, b) {
  let bestIndex = 0
  let bestDist = Infinity
  for (let i = 0; i < PALETTE.length; i++) {
    const [pr, pg, pb] = PALETTE[i]
    const dr = r - pr
    const dg = g - pg
    const db = b - pb
    const dist = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db
    if (dist < bestDist) {
      bestDist = dist
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * 将一个 ImageData 区域采样为 blockSize x blockSize 的调色板索引数组。
 * @param {ImageData} imageData 源图像数据
 * @param {number} sx 源区域左上角 x（像素坐标）
 * @param {number} sy 源区域左上角 y
 * @param {number} sw 源区域宽
 * @param {number} sh 源区域高
 * @param {number} blockSize 输出边长（24）
 * @returns {number[]} 长度 blockSize*blockSize 的调色板索引数组
 */
export function sampleToBlockIndices(
  imageData,
  sx,
  sy,
  sw,
  sh,
  blockSize
) {
  const { data, width: imgW, height: imgH } = imageData
  const result = new Array(blockSize * blockSize)
  const cellW = sw / blockSize
  const cellH = sh / blockSize

  for (let by = 0; by < blockSize; by++) {
    for (let bx = 0; bx < blockSize; bx++) {
      // 采样该子块内所有像素的平均色
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        count = 0
      const x0 = Math.floor(sx + bx * cellW)
      const y0 = Math.floor(sy + by * cellH)
      const x1 = Math.floor(sx + (bx + 1) * cellW)
      const y1 = Math.floor(sy + (by + 1) * cellH)
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          const alpha = data[idx + 3] / 255
          r += data[idx] * alpha
          g += data[idx + 1] * alpha
          b += data[idx + 2] * alpha
          a += alpha
          count++
        }
      }
      if (count > 0 && a > 0) {
        r /= a
        g /= a
        b /= a
      } else {
        r = g = b = 255
      }
      result[by * blockSize + bx] = nearestColorIndex(r | 0, g | 0, b | 0)
    }
  }
  return result
}
