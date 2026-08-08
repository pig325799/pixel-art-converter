// 40 色调色板：覆盖灰阶 + 各色相，适合像素画
// 每个颜色为 [r, g, b]
export const PALETTE = [
  // 灰阶 (11)
  [0, 0, 0],
  [26, 26, 26],
  [51, 51, 51],
  [77, 77, 77],
  [102, 102, 102],
  [128, 128, 128],
  [153, 153, 153],
  [179, 179, 179],
  [204, 204, 204],
  [230, 230, 230],
  [255, 255, 255],
  // 红 (5)
  [128, 0, 0],
  [176, 0, 0],
  [220, 40, 40],
  [255, 102, 102],
  [255, 153, 153],
  // 橙 (4)
  [128, 64, 0],
  [220, 110, 0],
  [255, 166, 77],
  [255, 204, 153],
  // 黄 (4)
  [128, 128, 0],
  [220, 220, 0],
  [255, 255, 102],
  [255, 255, 204],
  // 绿 (5)
  [0, 102, 0],
  [0, 176, 0],
  [77, 204, 77],
  [153, 230, 153],
  [204, 255, 204],
  // 青 (3)
  [0, 128, 128],
  [0, 200, 200],
  [153, 230, 230],
  // 蓝 (4)
  [0, 0, 128],
  [40, 80, 200],
  [102, 140, 255],
  [170, 200, 255],
  // 紫 (3)
  [128, 0, 128],
  [200, 60, 200],
  [230, 170, 230],
  // 棕 (1)
  [102, 51, 0]
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
