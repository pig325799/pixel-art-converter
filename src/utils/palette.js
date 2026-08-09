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

// 预计算调色板 hex 字符串
export const PALETTE_HEX = PALETTE.map(
  ([r, g, b]) => `rgb(${r},${g},${b})`
)

// ---------- 感知色空间 Lab 辅助函数 ----------
function rgbToLab(r, g, b) {
  // sRGB -> 线性 RGB
  let R = r / 255, G = g / 255, B = b / 255
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92
  // XYZ (D65 白)
  let X = R * 0.4124 + G * 0.3576 + B * 0.1805
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let Z = R * 0.0193 + G * 0.1192 + B * 0.9505
  X /= 0.95047; Y /= 1.0; Z /= 1.08883
  const e = 216 / 24389, k = 24389 / 27
  const fx = X > e ? Math.cbrt(X) : (k * X + 16) / 116
  const fy = Y > e ? Math.cbrt(Y) : (k * Y + 16) / 116
  const fz = Z > e ? Math.cbrt(Z) : (k * Z + 16) / 116
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

// 预计算调色板所有颜色的 Lab 值，避免重复计算
const PALETTE_LAB = PALETTE.map(([r, g, b]) => rgbToLab(r, g, b))

/**
 * 感知色距离：基于 Lab 空间的 CIE76 ΔE，比 RGB 欧氏距离更符合人眼。
 * 防止“肤色映射到绿色”这种视觉不合理的错误。
 */
function labDist([L1, a1, b1], [L2, a2, b2]) {
  const dL = L1 - L2, da = a1 - a2, db = b1 - b2
  return dL * dL + da * da + db * db
}

/**
 * 查找最接近的调色板索引（Lab 感知距离）。
 */
export function nearestColorIndex(r, g, b) {
  const queryLab = rgbToLab(r, g, b)
  let bestIndex = 0
  let bestDist = Infinity
  for (let i = 0; i < PALETTE_LAB.length; i++) {
    const d = labDist(queryLab, PALETTE_LAB[i])
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * 采样为 blockSize x blockSize 的调色板索引数组。
 *
 * 混合策略：
 * - 每个块先做 16 级粗量化分桶；
 * - 如果第一大桶的占比 >= DOMINANT_RATIO_THRESH（0.45），则用该桶代表色；
 * - 否则（多色混合区域），使用整区域真实平均色，避免边缘色被强制拉向错误主导色。
 */
const DOMINANT_RATIO_THRESH = 0.45

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
      const x0 = Math.floor(sx + bx * cellW)
      const y0 = Math.floor(sy + by * cellH)
      const x1 = Math.floor(sx + (bx + 1) * cellW)
      const y1 = Math.floor(sy + (by + 1) * cellH)

      const buckets = new Map()
      let totalPicked = 0
      let avgR = 0, avgG = 0, avgB = 0

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          const alpha = data[idx + 3]
          if (alpha < 128) continue
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          // 分桶从 32 级细化到 16 级（每通道 16 档，共 4096 桶）
          const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)
          if (!buckets.has(key)) {
            buckets.set(key, { r: 0, g: 0, b: 0, count: 0 })
          }
          const bucket = buckets.get(key)
          bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++
          avgR += r; avgG += g; avgB += b
          totalPicked++
        }
      }

      let r, g, b
      if (buckets.size === 0) {
        r = g = b = 255
      } else {
        // 选主导桶
        let bestBucket = null, bestCount = 0
        for (const bucket of buckets.values()) {
          if (bucket.count > bestCount) {
            bestCount = bucket.count
            bestBucket = bucket
          }
        }
        const dominantRatio = bestCount / totalPicked
        if (dominantRatio >= DOMINANT_RATIO_THRESH) {
          // 主色明确，用主色桶平均
          r = bestBucket.r / bestCount
          g = bestBucket.g / bestCount
          b = bestBucket.b / bestCount
        } else {
          // 多色混杂区（边缘/渐变），用真实平均色避免异常传播
          r = avgR / totalPicked
          g = avgG / totalPicked
          b = avgB / totalPicked
        }
      }
      result[by * blockSize + bx] = nearestColorIndex(r | 0, g | 0, b | 0)
    }
  }
  return result
}

/**
 * 去噪：只消除“完全孤立的 1 像素点”，其他细节一律保留。
 */
export function denoiseIndices(indices, blockSize) {
  const result = indices.slice()
  const next = result.slice()
  for (let by = 0; by < blockSize; by++) {
    for (let bx = 0; bx < blockSize; bx++) {
      const idx = by * blockSize + bx
      const current = result[idx]

      let neighborColor = -1
      let isIsolated = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = bx + dx, ny = by + dy
          if (nx < 0 || ny < 0 || nx >= blockSize || ny >= blockSize) {
            isIsolated = false; break
          }
          const nIdx = result[ny * blockSize + nx]
          if (neighborColor === -1) {
            neighborColor = nIdx
          } else if (nIdx !== neighborColor) {
            isIsolated = false; break
          }
        }
        if (!isIsolated) break
      }

      if (isIsolated && neighborColor !== -1 && current !== neighborColor) {
        next[idx] = neighborColor
      }
    }
  }
  return next
}

/**
 * 颜色合并：贪心层级聚类 + 感知距离。
 * 合并完成后，每个被移除的颜色重新映射到**视觉最近**的保留色。
 */
export function reduceColors(indices, maxColors) {
  if (indices.length === 0) return indices

  const counts = new Map()
  for (const idx of indices) {
    counts.set(idx, (counts.get(idx) || 0) + 1)
  }

  if (counts.size <= maxColors) return indices

  function paletteColorDist(i, j) {
    return labDist(PALETTE_LAB[i], PALETTE_LAB[j])
  }

  const clusters = []
  for (const [idx, count] of counts) {
    clusters.push({ members: [idx], weight: count, repIdx: idx })
  }

  while (clusters.length > maxColors) {
    let bestI = -1, bestJ = -1, bestScore = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = paletteColorDist(clusters[i].repIdx, clusters[j].repIdx)
        const minWeight = Math.min(clusters[i].weight, clusters[j].weight)
        const score = d + minWeight * 0.5
        if (score < bestScore) {
          bestScore = score
          bestI = i
          bestJ = j
        }
      }
    }
    const ci = clusters[bestI], cj = clusters[bestJ]
    const merged = {
      members: [...ci.members, ...cj.members],
      weight: ci.weight + cj.weight,
      repIdx: ci.weight >= cj.weight ? ci.repIdx : cj.repIdx
    }
    clusters.splice(bestJ, 1)
    clusters.splice(bestI, 1)
    clusters.push(merged)
  }

  // 最终映射：每种源颜色强制映射到视觉最近的保留色
  const keptReps = clusters.map(c => c.repIdx)
  const mapping = new Map()
  for (const origIdx of counts.keys()) {
    let bestRepIdx = origIdx
    let bestDist = Infinity
    for (const repIdx of keptReps) {
      const d = paletteColorDist(origIdx, repIdx)
      if (d < bestDist) {
        bestDist = d
        bestRepIdx = repIdx
      }
    }
    mapping.set(origIdx, bestRepIdx)
  }

  return indices.map(idx => mapping.get(idx) ?? idx)
}
