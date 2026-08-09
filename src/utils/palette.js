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
 * 使用主导色采样：对每个块内的像素按粗量化分桶，取出现次数最多的桶的平均色，
 * 而非所有像素的平均色，从而避免边缘像素混色产生的脏色。
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
      const x0 = Math.floor(sx + bx * cellW)
      const y0 = Math.floor(sy + by * cellH)
      const x1 = Math.floor(sx + (bx + 1) * cellW)
      const y1 = Math.floor(sy + (by + 1) * cellH)

      // 主导色采样：粗量化分桶
      const buckets = new Map()
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue
          const idx = (py * imgW + px) * 4
          const alpha = data[idx + 3]
          if (alpha < 128) continue // 跳过透明像素
          const r = data[idx]
          const g = data[idx + 1]
          const b = data[idx + 2]
          // 粗量化到 32 级（>>3 再 >>2，每通道 32 档）
          const key = (r >> 3) * 1024 + (g >> 3) * 32 + (b >> 3)
          if (!buckets.has(key)) {
            buckets.set(key, { r: 0, g: 0, b: 0, count: 0 })
          }
          const bucket = buckets.get(key)
          bucket.r += r
          bucket.g += g
          bucket.b += b
          bucket.count++
        }
      }

      let r, g, b
      if (buckets.size > 0) {
        // 取出现次数最多的桶
        let bestBucket = null
        let bestCount = 0
        for (const bucket of buckets.values()) {
          if (bucket.count > bestCount) {
            bestCount = bucket.count
            bestBucket = bucket
          }
        }
        r = bestBucket.r / bestBucket.count
        g = bestBucket.g / bestBucket.count
        b = bestBucket.b / bestBucket.count
      } else {
        r = g = b = 255
      }
      result[by * blockSize + bx] = nearestColorIndex(r | 0, g | 0, b | 0)
    }
  }
  return result
}

/**
 * 去噪后处理：消除完全孤立的单点噪点。
 * 只处理周围 8 邻居颜色完全一致、且与当前颜色不同的情况（真正的“孤点”），
 * 以此保护线条和细节，避免过度平滑导致特征丢失。
 */
export function denoiseIndices(indices, blockSize) {
  let result = indices.slice()
  const next = result.slice()
  for (let by = 0; by < blockSize; by++) {
    for (let bx = 0; bx < blockSize; bx++) {
      const idx = by * blockSize + bx
      const current = result[idx]
      
      // 统计周围 8 邻居
      let neighborColor = -1
      let isIsolated = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = bx + dx
          const ny = by + dy
          if (nx < 0 || ny < 0 || nx >= blockSize || ny >= blockSize) {
            isIsolated = false // 边缘不算孤立
            break
          }
          const nIdx = result[ny * blockSize + nx]
          if (neighborColor === -1) {
            neighborColor = nIdx
          } else if (nIdx !== neighborColor) {
            isIsolated = false
            break
          }
        }
        if (!isIsolated) break
      }
      
      // 如果是完全孤立的点，替换为邻居颜色
      if (isIsolated && neighborColor !== -1 && current !== neighborColor) {
        next[idx] = neighborColor
      }
    }
  }
  return next
}

/**
 * 颜色合并：使用贪心层级聚类，逐步合并最接近的颜色对。
 * 比简单频次保留更智能：会优先合并视觉上最接近的颜色，
 * 减少颜色跳跃带来的脏色感。
 */
export function reduceColors(indices, maxColors) {
  if (indices.length === 0) return indices

  const counts = new Map()
  for (const idx of indices) {
    counts.set(idx, (counts.get(idx) || 0) + 1)
  }

  if (counts.size <= maxColors) return indices

  // 调色板颜色距离
  function colorDist(i, j) {
    const [r1, g1, b1] = PALETTE[i]
    const [r2, g2, b2] = PALETTE[j]
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2
    return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db
  }

  // 初始化：每个使用的颜色一个簇
  const clusters = []
  for (const [idx, count] of counts) {
    clusters.push({ members: [idx], weight: count, repIdx: idx })
  }

  // 贪心合并：每次合并距离最近的两个簇
  while (clusters.length > maxColors) {
    let bestI = -1, bestJ = -1, bestScore = Infinity
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = colorDist(clusters[i].repIdx, clusters[j].repIdx)
        // 评分：距离越小越优先合并，低频次簇更容易被合并
        const minWeight = Math.min(clusters[i].weight, clusters[j].weight)
        const score = d + minWeight * 0.5
        if (score < bestScore) {
          bestScore = score
          bestI = i
          bestJ = j
        }
      }
    }
    // 合并 bestI 和 bestJ，代表色取频次更高的
    const ci = clusters[bestI]
    const cj = clusters[bestJ]
    const merged = {
      members: [...ci.members, ...cj.members],
      weight: ci.weight + cj.weight,
      repIdx: ci.weight >= cj.weight ? ci.repIdx : cj.repIdx
    }
    // 先删大索引再删小索引
    clusters.splice(bestJ, 1)
    clusters.splice(bestI, 1)
    clusters.push(merged)
  }

  // 构建映射表：强制将所有颜色映射到调色板中距离最近的保留色
  const keptReps = clusters.map(c => c.repIdx)
  const mapping = new Map()
  for (const origIdx of counts.keys()) {
    let bestRepIdx = origIdx
    let bestDist = Infinity
    for (const repIdx of keptReps) {
      const d = colorDist(origIdx, repIdx)
      if (d < bestDist) {
        bestDist = d
        bestRepIdx = repIdx
      }
    }
    mapping.set(origIdx, bestRepIdx)
  }

  return indices.map(idx => mapping.get(idx) ?? idx)
}
