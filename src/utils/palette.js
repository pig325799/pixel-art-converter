// 40 色调色板
export const PALETTE = [
  // 灰阶 (4)
  [39, 39, 39],
  [179, 179, 179],
  [234, 230, 222],
  [255, 255, 255],
  // 红 (4)
  [210, 51, 57],
  [154, 18, 0],
  [213, 20, 75],
  [229, 149, 140],
  // 粉 (4)
  [254, 151, 116],
  [247, 207, 191],
  [252, 239, 234],
  [250, 246, 231],
  // 橙 (8)
  [219, 209, 199],
  [225, 205, 170],
  [212, 99, 39],
  [211, 139, 68],
  [241, 152, 0],
  [249, 200, 54],
  [252, 227, 152],
  [178, 179, 121],
  // 绿 (2)
  [192, 217, 113],
  [108, 110, 0],
  // 棕 (6)
  [175, 144, 86],
  [167, 142, 115],
  [169, 145, 44],
  [65, 47, 25],
  [115, 74, 36],
  [84, 72, 89],
  // 蓝紫 (4)
  [46, 41, 72],
  [60, 71, 152],
  [90, 71, 156],
  [185, 162, 214],
  // 青 (8)
  [181, 187, 222],
  [167, 170, 189],
  [99, 170, 183],
  [179, 209, 219],
  [144, 215, 229],
  [73, 173, 159],
  [181, 210, 199],
  [43, 59, 100]
]

export const PALETTE_HEX = PALETTE.map(
  ([r, g, b]) => `rgb(${r},${g},${b})`
)

// ---------- sRGB -> Lab 转换 ----------
function rgbToLab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92
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

// 预计算调色板 Lab 值
const PALETTE_LAB = PALETTE.map(([r, g, b]) => rgbToLab(r, g, b))

// HSV 转换（用于色相预筛选）
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) h = ((b - r) / d + 2) * 60
    else h = ((r - g) / d + 4) * 60
  }
  return [h, max === 0 ? 0 : d / max, max]
}

const PALETTE_HSV = PALETTE.map(([r, g, b]) => rgbToHsv(r, g, b))

/**
 * 查找最接近的调色板索引（色相预筛 + Lab 精细匹配）。
 * 先用 HSV 色相排除不相关的颜色，再在候选中用 Lab 精确匹配。
 * 防止"绿色被映射成棕色"这类色相错乱。
 */
export function nearestColorIndex(r, g, b) {
  const [h, s, v] = rgbToHsv(r, g, b)
  const queryLab = rgbToLab(r, g, b)

  // 色相预筛：只考虑色相差 <= 60° 的候选（灰色/彩色特殊处理）
  const candidates = []
  for (let i = 0; i < PALETTE.length; i++) {
    const [ph, ps, pv] = PALETTE_HSV[i]
    // 如果查询色或调色板色是灰/白（饱和度 < 0.15），跳过色相筛选
    if (s < 0.15 || ps < 0.15) {
      candidates.push(i)
      continue
    }
    // 计算色相差
    let dh = Math.abs(h - ph)
    if (dh > 180) dh = 360 - dh
    if (dh <= 60) {
      candidates.push(i)
    }
  }

  // 用 Lab 距离在候选中找最接近的
  let bestIndex = candidates.length > 0 ? candidates[0] : 0
  let bestDist = Infinity
  const pool = candidates.length > 0 ? candidates : PALETTE_LAB.map((_, i) => i)
  for (const i of pool) {
    const [L1, a1, b1] = queryLab
    const [L2, a2, b2] = PALETTE_LAB[i]
    const dL = L1 - L2, da = a1 - a2, db = b1 - b2
    const d = dL * dL + da * da + db * db
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * 双重采样策略：
 * 1. 计算每个块的平均色 + 颜色方差
 * 2. 方差低（纯色区域，如大片头发、肤色）→ 直接用平均色（最准确）
 * 3. 方差高（混合区域，如边缘、纹理）→ 使用分桶主导色 + 边缘加权
 */
const VARIANCE_THRESH = 650 // 颜色方差阈值

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

      // 收集所有有效像素
      const pixels = []
      let sumR = 0, sumG = 0, sumB = 0

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          const alpha = data[idx + 3]
          if (alpha < 128) continue
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          pixels.push([r, g, b])
          sumR += r; sumG += g; sumB += b
        }
      }

      if (pixels.length === 0) {
        result[by * blockSize + bx] = nearestColorIndex(255, 255, 255)
        continue
      }

      // 计算平均色
      const n = pixels.length
      const avgR = sumR / n
      const avgG = sumG / n
      const avgB = sumB / n

      // 计算颜色方差（判断是否为纯色区域）
      let variance = 0
      for (const [r, g, b] of pixels) {
        variance += (r - avgR) * (r - avgR) + (g - avgG) * (g - avgG) + (b - avgB) * (b - avgB)
      }
      variance /= n

      let finalR, finalG, finalB

      if (variance < VARIANCE_THRESH) {
        // 纯色区域：直接用平均色，最准确
        finalR = avgR
        finalG = avgG
        finalB = avgB
      } else {
        // 混合区域：分桶取主导色
        const buckets = new Map()
        for (const [r, g, b] of pixels) {
          const key = (r >> 4) * 256 + (g >> 4) * 16 + (b >> 4)
          if (!buckets.has(key)) {
            buckets.set(key, { r: 0, g: 0, b: 0, count: 0 })
          }
          const bucket = buckets.get(key)
          bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++
        }

        // 取最大桶
        let bestBucket = null, bestCount = 0
        for (const bucket of buckets.values()) {
          if (bucket.count > bestCount) {
            bestCount = bucket.count
            bestBucket = bucket
          }
        }
        const dominantRatio = bestCount / n

        if (dominantRatio >= 0.4) {
          // 有明确主色
          finalR = bestBucket.r / bestCount
          finalG = bestBucket.g / bestCount
          finalB = bestBucket.b / bestCount
        } else {
          // 颜色分散（渐变/纹理），用平均色
          finalR = avgR
          finalG = avgG
          finalB = avgB
        }
      }

      result[by * blockSize + bx] = nearestColorIndex(
        Math.round(finalR),
        Math.round(finalG),
        Math.round(finalB)
      )
    }
  }
  return result
}

// ============================================================
// 多种像素化算法
// ============================================================

/**
 * 算法 1：平均色（最简单）
 * 每个块取所有像素的算术平均，再映射到调色板。
 * 效果：平滑但容易丢细节，渐变区域表现好。
 */
export function sampleAverage(imageData, sx, sy, sw, sh, blockSize) {
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

      let sumR = 0, sumG = 0, sumB = 0, n = 0
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          if (data[idx + 3] < 128) continue
          sumR += data[idx]; sumG += data[idx + 1]; sumB += data[idx + 2]; n++
        }
      }
      if (n === 0) { result[by * blockSize + bx] = nearestColorIndex(255, 255, 255); continue }
      result[by * blockSize + bx] = nearestColorIndex(
        Math.round(sumR / n), Math.round(sumG / n), Math.round(sumB / n)
      )
    }
  }
  return result
}

/**
 * 算法 2：中值色
 * 每个块取所有像素 RGB 各通道的中值。
 * 效果：抗噪能力强，适合有压缩噪点的图片。
 */
export function sampleMedian(imageData, sx, sy, sw, sh, blockSize) {
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

      const rs = [], gs = [], bs = []
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          if (data[idx + 3] < 128) continue
          rs.push(data[idx]); gs.push(data[idx + 1]); bs.push(data[idx + 2])
        }
      }
      if (rs.length === 0) { result[by * blockSize + bx] = nearestColorIndex(255, 255, 255); continue }
      rs.sort((a, b) => a - b); gs.sort((a, b) => a - b); bs.sort((a, b) => a - b)
      const mid = Math.floor(rs.length / 2)
      result[by * blockSize + bx] = nearestColorIndex(rs[mid], gs[mid], bs[mid])
    }
  }
  return result
}

/**
 * 算法 3：K-Means 聚类
 * 每个块内做 K=3 的聚类，取最大簇的中心色。
 * 效果：能分离前景/背景，保留特征。
 */
export function sampleKMeans(imageData, sx, sy, sw, sh, blockSize) {
  const { data, width: imgW, height: imgH } = imageData
  const result = new Array(blockSize * blockSize)
  const cellW = sw / blockSize
  const cellH = sh / blockSize
  const K = 3
  const ITER = 5

  for (let by = 0; by < blockSize; by++) {
    for (let bx = 0; bx < blockSize; bx++) {
      const x0 = Math.floor(sx + bx * cellW)
      const y0 = Math.floor(sy + by * cellH)
      const x1 = Math.floor(sx + (bx + 1) * cellW)
      const y1 = Math.floor(sy + (by + 1) * cellH)

      const pixels = []
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          if (data[idx + 3] < 128) continue
          pixels.push([data[idx], data[idx + 1], data[idx + 2]])
        }
      }
      if (pixels.length === 0) { result[by * blockSize + bx] = nearestColorIndex(255, 255, 255); continue }
      if (pixels.length <= K) {
        let sr = 0, sg = 0, sb = 0
        for (const [r, g, b] of pixels) { sr += r; sg += g; sb += b }
        result[by * blockSize + bx] = nearestColorIndex(
          Math.round(sr / pixels.length), Math.round(sg / pixels.length), Math.round(sb / pixels.length)
        )
        continue
      }

      // 初始化：均匀采样 K 个中心
      const centers = []
      for (let i = 0; i < K; i++) {
        centers.push(pixels[Math.floor(i * pixels.length / K)].slice())
      }
      const counts = new Array(K).fill(0)

      for (let iter = 0; iter < ITER; iter++) {
        const sums = Array.from({ length: K }, () => [0, 0, 0])
        counts.fill(0)
        for (const [r, g, b] of pixels) {
          let bestK = 0, bestD = Infinity
          for (let k = 0; k < K; k++) {
            const d = (r - centers[k][0]) ** 2 + (g - centers[k][1]) ** 2 + (b - centers[k][2]) ** 2
            if (d < bestD) { bestD = d; bestK = k }
          }
          sums[bestK][0] += r; sums[bestK][1] += g; sums[bestK][2] += b
          counts[bestK]++
        }
        for (let k = 0; k < K; k++) {
          if (counts[k] > 0) {
            centers[k][0] = sums[k][0] / counts[k]
            centers[k][1] = sums[k][1] / counts[k]
            centers[k][2] = sums[k][2] / counts[k]
          }
        }
      }

      // 取最大簇
      let bestK = 0
      for (let k = 1; k < K; k++) if (counts[k] > counts[bestK]) bestK = k
      result[by * blockSize + bx] = nearestColorIndex(
        Math.round(centers[bestK][0]), Math.round(centers[bestK][1]), Math.round(centers[bestK][2])
      )
    }
  }
  return result
}

/**
 * 算法 4：Floyd-Steinberg 抖动
 * 先降采样到 blockSize×blockSize，再做误差扩散抖动。
 * 效果：保留更多颜色细节和过渡，有颗粒感。
 */
export function sampleFloydSteinberg(imageData, sx, sy, sw, sh, blockSize) {
  const { data, width: imgW, height: imgH } = imageData
  const cellW = sw / blockSize
  const cellH = sh / blockSize

  // 先降采样到一个 blockSize×blockSize 的浮点缓冲
  const buf = new Float32Array(blockSize * blockSize * 3)
  const cnt = new Int32Array(blockSize * blockSize)

  // 只遍历选区范围内的像素（性能优化：避免遍历整张图）
  const startX = Math.max(0, Math.floor(sx))
  const startY = Math.max(0, Math.floor(sy))
  const endX = Math.min(imgW, Math.ceil(sx + sw))
  const endY = Math.min(imgH, Math.ceil(sy + sh))

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      const idx = (py * imgW + px) * 4
      if (data[idx + 3] < 128) continue
      const bx = Math.min(blockSize - 1, Math.floor((px - sx) / cellW))
      const by = Math.min(blockSize - 1, Math.floor((py - sy) / cellH))
      const bi = (by * blockSize + bx) * 3
      buf[bi] += data[idx]; buf[bi + 1] += data[idx + 1]; buf[bi + 2] += data[idx + 2]
      cnt[by * blockSize + bx]++
    }
  }

  // 求平均
  for (let i = 0; i < blockSize * blockSize; i++) {
    if (cnt[i] > 0) { buf[i * 3] /= cnt[i]; buf[i * 3 + 1] /= cnt[i]; buf[i * 3 + 2] /= cnt[i] }
    else { buf[i * 3] = 255; buf[i * 3 + 1] = 255; buf[i * 3 + 2] = 255 }
  }

  // Floyd-Steinberg 误差扩散
  const result = new Array(blockSize * blockSize)
  for (let by = 0; by < blockSize; by++) {
    for (let bx = 0; bx < blockSize; bx++) {
      const bi = (by * blockSize + bx) * 3
      const r = buf[bi], g = buf[bi + 1], b = buf[bi + 2]
      const ci = nearestColorIndex(
        Math.max(0, Math.min(255, Math.round(r))),
        Math.max(0, Math.min(255, Math.round(g))),
        Math.max(0, Math.min(255, Math.round(b)))
      )
      result[by * blockSize + bx] = ci
      const [pr, pg, pb] = PALETTE[ci]
      const errR = r - pr, errG = g - pg, errB = b - pb

      // 扩散到右、下、左下、右下
      const spread = (nx, ny, w) => {
        if (nx < 0 || ny < 0 || nx >= blockSize || ny >= blockSize) return
        const ni = (ny * blockSize + nx) * 3
        buf[ni] += errR * w; buf[ni + 1] += errG * w; buf[ni + 2] += errB * w
      }
      spread(bx + 1, by, 7 / 16)
      spread(bx - 1, by + 1, 3 / 16)
      spread(bx, by + 1, 5 / 16)
      spread(bx + 1, by + 1, 1 / 16)
    }
  }
  return result
}

/**
 * 去噪：只消除完全孤立的 1 像素点。
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
 * 颜色合并：贪心层级聚类。
 */
export function reduceColors(indices, maxColors) {
  if (indices.length === 0) return indices

  const counts = new Map()
  for (const idx of indices) {
    counts.set(idx, (counts.get(idx) || 0) + 1)
  }

  if (counts.size <= maxColors) return indices

  function paletteColorDist(i, j) {
    const [L1, a1, b1] = PALETTE_LAB[i]
    const [L2, a2, b2] = PALETTE_LAB[j]
    const dL = L1 - L2, da = a1 - a2, db = b1 - b2
    return dL * dL + da * da + db * db
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
