<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  PALETTE, PALETTE_HEX,
  sampleToBlockIndices, sampleAverage, sampleMedian, sampleKMeans, sampleFloydSteinberg,
  reduceColors, denoiseIndices
} from '../utils/palette.js'

const BLOCK_SIZE = 24

/* ---------------- DOM 引用 ---------------- */
const fileInputRef = ref(null)
const leftCanvasRef = ref(null)
const previewCanvasRef = ref(null)
const leftWrapRef = ref(null)
const previewWrapRef = ref(null)

/* ---------------- 响应式状态 ---------------- */
const hasImage = ref(false)
const zoomPercent = ref(100)
const maxColors = ref(4)
const showNumbers = ref(false)
const algorithm = ref('dominant')

const algorithms = [
  { id: 'dominant', name: '主导色', desc: '方差判断+边缘加权' },
  { id: 'average', name: '平均色', desc: '纯平均，平滑' },
  { id: 'median', name: '中值色', desc: '抗噪，适合压缩图' },
  { id: 'kmeans', name: 'K-Means', desc: '聚类分离前景背景' },
  { id: 'dither', name: '抖动', desc: 'Floyd-Steinberg 误差扩散' }
]
const blockIndices = ref([])
const previewReady = ref(false)
const sourceInfo = ref({ w: 0, h: 0 })

/* ---------------- 调色板分组展示 ---------------- */
const paletteGroups = computed(() => [
  { name: '灰阶', start: 0, end: 4, hue: 'mono' },
  { name: '红', start: 4, end: 8, hue: 'red' },
  { name: '粉', start: 8, end: 12, hue: 'red' },
  { name: '橙', start: 12, end: 20, hue: 'orange' },
  { name: '绿', start: 20, end: 22, hue: 'green' },
  { name: '棕', start: 22, end: 28, hue: 'brown' },
  { name: '蓝紫', start: 28, end: 32, hue: 'blue' },
  { name: '青', start: 32, end: 40, hue: 'cyan' }
])

/* ---------------- 预览统计 ---------------- */
const previewStats = computed(() => {
  const arr = blockIndices.value
  if (!arr.length) return { unique: 0, topColor: -1 }
  const counts = new Map()
  let top = -1
  let topN = 0
  for (const c of arr) {
    const n = (counts.get(c) || 0) + 1
    counts.set(c, n)
    if (n > topN) {
      topN = n
      top = c
    }
  }
  return {
    unique: counts.size,
    topColor: top,
    topPercent: Math.round((topN / arr.length) * 100)
  }
})

/* ---------------- 已使用颜色集合（用于调色板高亮） ---------------- */
const usedColorSet = computed(() => {
  const set = new Set()
  for (const c of blockIndices.value) set.add(c)
  return set
})

/* ---------------- 内部变量 ---------------- */
let imgEl = null
let sourceCanvas = null
let sourceCtx = null
let sourceImageData = null

let dpr = 1
let leftW = 0
let leftH = 0
let previewW = 0
let previewH = 0

let offsetX = 0
let offsetY = 0
let scale = 1
const MIN_SCALE = 0.05
const MAX_SCALE = 30

let frameSize = 0
let frameX = 0
let frameY = 0

let dragging = false
let dragStartX = 0
let dragStartY = 0
let dragOffsetX = 0
let dragOffsetY = 0

let pinching = false
let pinchStartDist = 0
let pinchStartScale = 1
let pinchStartOffsetX = 0
let pinchStartOffsetY = 0
let pinchCenterX = 0
let pinchCenterY = 0

let rafId = 0
let roLeft = null
let roPreview = null

/* ---------------- 文件上传 ---------------- */
function triggerUpload() {
  fileInputRef.value?.click()
}

function loadFile(file) {
  if (!file) return
  if (!file.type.startsWith('image/')) {
    alert('请上传图片文件')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      imgEl = img
      sourceInfo.value = {
        w: img.naturalWidth,
        h: img.naturalHeight
      }
      prepareSource()
      hasImage.value = true
      nextTick(() => {
        resizeLeftCanvas()
        fitImage()
        render()
      })
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  loadFile(file)
  e.target.value = ''
}

function onDropFile(e) {
  const file = e.dataTransfer?.files?.[0]
  loadFile(file)
}

function prepareSource() {
  if (!imgEl) return
  sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = imgEl.naturalWidth
  sourceCanvas.height = imgEl.naturalHeight
  sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })
  sourceCtx.drawImage(imgEl, 0, 0)
  sourceImageData = sourceCtx.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height
  )
}

/* ---------------- 画布尺寸 ---------------- */
function resizeLeftCanvas() {
  const canvas = leftCanvasRef.value
  const wrap = leftWrapRef.value
  if (!canvas || !wrap) return
  const rect = wrap.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  leftW = rect.width
  leftH = rect.height
  canvas.width = Math.round(leftW * dpr)
  canvas.height = Math.round(leftH * dpr)
  canvas.style.width = leftW + 'px'
  canvas.style.height = leftH + 'px'
  frameSize = Math.floor(Math.min(leftW, leftH) * 0.72)
  frameX = Math.round((leftW - frameSize) / 2)
  frameY = Math.round((leftH - frameSize) / 2)
}

function resizePreviewCanvas() {
  const canvas = previewCanvasRef.value
  const wrap = previewWrapRef.value
  if (!canvas || !wrap) return
  const rect = wrap.getBoundingClientRect()
  previewW = rect.width
  previewH = rect.height
  canvas.width = Math.round(previewW * dpr)
  canvas.height = Math.round(previewH * dpr)
  canvas.style.width = previewW + 'px'
  canvas.style.height = previewH + 'px'
}

function onResizeLeft() {
  resizeLeftCanvas()
  if (hasImage.value) render()
}

function onResizePreview() {
  resizePreviewCanvas()
  if (hasImage.value) renderPreview()
}

/* ---------------- 图像适配 ---------------- */
function fitImage() {
  if (!imgEl || leftW === 0) return
  const iw = imgEl.naturalWidth
  const ih = imgEl.naturalHeight
  const fit = Math.min(leftW / iw, leftH / ih) * 0.95
  scale = clamp(fit, MIN_SCALE, MAX_SCALE)
  offsetX = (leftW - iw * scale) / 2
  offsetY = (leftH - ih * scale) / 2
  zoomPercent.value = Math.round(scale * 100)
}

/* ---------------- 渲染：左侧画布 ---------------- */
function render() {
  if (!rafId) rafId = requestAnimationFrame(doRender)
}

function doRender() {
  rafId = 0
  const canvas = leftCanvasRef.value
  if (!canvas || !imgEl) return
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, leftW, leftH)

  drawCheckerboard(ctx, leftW, leftH)

  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imgEl, 0, 0)
  ctx.restore()

  // 选区外暗化（半透明渐变遮罩让边缘更柔和）
  ctx.save()
  const g = ctx.createLinearGradient(0, 0, 0, 1)
  g.addColorStop(0, 'rgba(10, 12, 18, 0.7)')
  g.addColorStop(1, 'rgba(10, 12, 18, 0.58)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.rect(0, 0, leftW, leftH)
  ctx.rect(frameX, frameY, frameSize, frameSize)
  ctx.fill('evenodd')
  ctx.restore()

  // 选区框：金色外边框 + 内阴影
  ctx.save()
  ctx.shadowColor = 'rgba(255, 200, 80, 0.35)'
  ctx.shadowBlur = 12
  ctx.strokeStyle = '#ffd45c'
  ctx.lineWidth = 2
  ctx.strokeRect(frameX + 0.5, frameY + 0.5, frameSize - 1, frameSize - 1)
  ctx.restore()

  // 内描边（暗色对比，让框更清晰）
  ctx.save()
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = 1
  ctx.strokeRect(frameX + 2.5, frameY + 2.5, frameSize - 5, frameSize - 5)
  ctx.restore()

  // 四角标记
  const c = 12
  ctx.save()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffe083'
  ctx.lineCap = 'square'
  drawCorner(ctx, frameX, frameY, c)
  drawCorner(ctx, frameX + frameSize, frameY, c, 1, 0)
  drawCorner(ctx, frameX, frameY + frameSize, c, 0, 1)
  drawCorner(ctx, frameX + frameSize, frameY + frameSize, c, 1, 1)
  ctx.restore()

  // 中心点
  ctx.save()
  const cx = frameX + frameSize / 2
  const cy = frameY + frameSize / 2
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(cx, frameY)
  ctx.lineTo(cx, frameY + frameSize)
  ctx.moveTo(frameX, cy)
  ctx.lineTo(frameX + frameSize, cy)
  ctx.stroke()
  ctx.restore()

  renderPreview()
}

function drawCorner(ctx, x, y, len, fx = 0, fy = 0) {
  ctx.beginPath()
  ctx.moveTo(x + len * (fx ? -1 : 1), y)
  ctx.lineTo(x, y)
  ctx.lineTo(x, y + len * (fy ? -1 : 1))
  ctx.stroke()
}

function drawCheckerboard(ctx, w, h) {
  const s = 14
  ctx.fillStyle = '#1e2230'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#181b26'
  for (let y = 0; y < h; y += s) {
    for (let x = 0; x < w; x += s) {
      if (((x / s) | 0) % 2 === ((y / s) | 0) % 2) {
        ctx.fillRect(x, y, s, s)
      }
    }
  }
}

/* ---------------- 渲染：右侧预览 ---------------- */
function renderPreview() {
  const canvas = previewCanvasRef.value
  if (!canvas || !sourceImageData) return
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, previewW, previewH)

  const sx = (frameX - offsetX) / scale
  const sy = (frameY - offsetY) / scale
  const sw = frameSize / scale
  const sh = frameSize / scale

  const indices = (() => {
    const args = [sourceImageData, sx, sy, sw, sh, BLOCK_SIZE]
    switch (algorithm.value) {
      case 'average': return sampleAverage(...args)
      case 'median': return sampleMedian(...args)
      case 'kmeans': return sampleKMeans(...args)
      case 'dither': return sampleFloydSteinberg(...args)
      default: return sampleToBlockIndices(...args)
    }
  })()
  // 去噪：消除采样产生的孤立色块（抖动算法跳过去噪，保留颗粒感）
  const denoised = algorithm.value === 'dither' ? indices : denoiseIndices(indices, BLOCK_SIZE)
  // 降色：所有算法都走层级聚类合并到目标颜色数
  const reduced = reduceColors(denoised, maxColors.value)
  blockIndices.value = reduced
  previewReady.value = true

  const size = Math.min(previewW, previewH) * 0.86
  const px = (previewW - size) / 2
  const py = (previewH - size) / 2
  const cell = size / BLOCK_SIZE

  // 预览底板：内阴影 + 细边
  const pad = 10
  ctx.save()
  ctx.fillStyle = '#0e1016'
  roundRect(ctx, px - pad, py - pad, size + pad * 2, size + pad * 2, 12)
  ctx.fill()
  ctx.restore()

  // 绘制色块
  for (let by = 0; by < BLOCK_SIZE; by++) {
    for (let bx = 0; bx < BLOCK_SIZE; bx++) {
      const idx = reduced[by * BLOCK_SIZE + bx]
      ctx.fillStyle = PALETTE_HEX[idx]
      const x = Math.floor(px + bx * cell)
      const y = Math.floor(py + by * cell)
      const w = Math.ceil(cell)
      const h = Math.ceil(cell)
      ctx.fillRect(x, y, w, h)
      // 每格 1px 深色描边，让色块感更清晰（仅当 cell >= 3 时）
      if (cell >= 3) {
        ctx.fillStyle = 'rgba(0,0,0,0.10)'
        ctx.fillRect(x, y + h - 1, w, 1)
        ctx.fillRect(x + w - 1, y, 1, h)
      }
      // 显示色块编号
      if (showNumbers.value && cell >= 8) {
        const num = idx + 1
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.font = `${Math.floor(cell * 0.35)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(num, x + w / 2, y + h / 2)
      }
    }
  }

  // 外层亮边
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1)
  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/* ---------------- 拖拽 ---------------- */
function onPointerDown(e) {
  if (!hasImage.value) return
  dragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragOffsetX = offsetX
  dragOffsetY = offsetY
  e.target.setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e) {
  if (!dragging) return
  offsetX = dragOffsetX + (e.clientX - dragStartX)
  offsetY = dragOffsetY + (e.clientY - dragStartY)
  render()
}

function onPointerUp(e) {
  dragging = false
  e.target.releasePointerCapture?.(e.pointerId)
}

function onWheel(e) {
  if (!hasImage.value) return
  e.preventDefault()
  const rect = leftCanvasRef.value.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
  const real = newScale / scale
  offsetX = cx - (cx - offsetX) * real
  offsetY = cy - (cy - offsetY) * real
  scale = newScale
  zoomPercent.value = Math.round(scale * 100)
  render()
}

function touchDist(t1, t2) {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function onTouchStart(e) {
  if (!hasImage.value) return
  if (e.touches.length === 1) {
    dragging = true
    dragStartX = e.touches[0].clientX
    dragStartY = e.touches[0].clientY
    dragOffsetX = offsetX
    dragOffsetY = offsetY
  } else if (e.touches.length === 2) {
    dragging = false
    pinching = true
    pinchStartDist = touchDist(e.touches[0], e.touches[1])
    pinchStartScale = scale
    pinchStartOffsetX = offsetX
    pinchStartOffsetY = offsetY
    const rect = leftCanvasRef.value.getBoundingClientRect()
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top
    pinchCenterX = cx
    pinchCenterY = cy
  }
  e.preventDefault()
}

function onTouchMove(e) {
  if (!hasImage.value) return
  if (pinching && e.touches.length === 2) {
    const dist = touchDist(e.touches[0], e.touches[1])
    const ratio = dist / pinchStartDist
    const newScale = clamp(pinchStartScale * ratio, MIN_SCALE, MAX_SCALE)
    const real = newScale / pinchStartScale
    offsetX = pinchCenterX - (pinchCenterX - pinchStartOffsetX) * real
    offsetY = pinchCenterY - (pinchCenterY - pinchStartOffsetY) * real
    scale = newScale
    zoomPercent.value = Math.round(scale * 100)
    render()
  } else if (dragging && e.touches.length === 1) {
    offsetX = dragOffsetX + (e.touches[0].clientX - dragStartX)
    offsetY = dragOffsetY + (e.touches[0].clientY - dragStartY)
    render()
  }
  e.preventDefault()
}

function onTouchEnd(e) {
  if (e.touches.length < 2) pinching = false
  if (e.touches.length === 0) dragging = false
}

/* ---------------- 缩放控制 ---------------- */
function setZoomFromSlider() {
  if (!hasImage.value) return
  const target = zoomPercent.value / 100
  const newScale = clamp(target, MIN_SCALE, MAX_SCALE)
  const cx = frameX + frameSize / 2
  const cy = frameY + frameSize / 2
  const real = newScale / scale
  offsetX = cx - (cx - offsetX) * real
  offsetY = cy - (cy - offsetY) * real
  scale = newScale
  render()
}

function zoomIn() {
  zoomPercent.value = clamp(zoomPercent.value + 10, 1, 3000)
  setZoomFromSlider()
}
function zoomOut() {
  zoomPercent.value = clamp(zoomPercent.value - 10, 1, 3000)
  setZoomFromSlider()
}

function resetView() {
  fitImage()
  render()
}

function setColorCount(n) {
  maxColors.value = n
  if (hasImage.value) render()
}

function setAlgorithm(id) {
  algorithm.value = id
  if (hasImage.value) render()
}

function toggleNumbers() {
  showNumbers.value = !showNumbers.value
  if (hasImage.value) render()
}

/* ---------------- 下载 ---------------- */
function downloadPng() {
  if (!previewReady.value) return
  downloadCanvas(false)
}

function downloadNumbered() {
  if (!previewReady.value) return
  downloadCanvas(true)
}

function downloadCanvas(withNumbers) {
  const out = document.createElement('canvas')
  const upscale = 32
  out.width = BLOCK_SIZE * upscale
  out.height = BLOCK_SIZE * upscale
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const idx = blockIndices.value
  for (let by = 0; by < BLOCK_SIZE; by++) {
    for (let bx = 0; bx < BLOCK_SIZE; bx++) {
      const colorIdx = idx[by * BLOCK_SIZE + bx]
      ctx.fillStyle = PALETTE_HEX[colorIdx]
      ctx.fillRect(bx * upscale, by * upscale, upscale, upscale)

      if (withNumbers) {
        const num = colorIdx + 1
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.font = `${Math.floor(upscale * 0.4)}px monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(num, bx * upscale + upscale / 2, by * upscale + upscale / 2)
      }
    }
  }
  const a = document.createElement('a')
  a.download = withNumbers ? 'pixel-art-numbered.png' : 'pixel-art.png'
  a.href = out.toDataURL('image/png')
  a.click()
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}

/* ---------------- 生命周期 ---------------- */
onMounted(() => {
  resizeLeftCanvas()
  resizePreviewCanvas()
  if (roLeft) roLeft.disconnect()
  if (roPreview) roPreview.disconnect()
  roLeft = new ResizeObserver(onResizeLeft)
  roPreview = new ResizeObserver(onResizePreview)
  if (leftWrapRef.value) roLeft.observe(leftWrapRef.value)
  if (previewWrapRef.value) roPreview.observe(previewWrapRef.value)
})

onBeforeUnmount(() => {
  roLeft?.disconnect()
  roPreview?.disconnect()
  if (rafId) cancelAnimationFrame(rafId)
})

const colorCount = PALETTE.length
</script>

<template>
  <div class="converter">
    <!-- 工具栏 -->
    <div class="toolbar card">
      <div class="tool-group">
        <button class="btn primary" @click="triggerUpload">
          <span class="btn-icon">↑</span>
          <span>上传图片</span>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*"
          class="hidden-file"
          @change="onFileChange"
        />
      </div>

      <template v-if="hasImage">
        <div class="divider"></div>
        <div class="zoom-controls tool-group">
          <button class="btn icon" @click="zoomOut" title="缩小">−</button>
          <div class="slider-wrap">
            <input
              type="range"
              min="1"
              max="3000"
              v-model.number="zoomPercent"
              @input="setZoomFromSlider"
              class="zoom-slider"
              :style="{
                '--fill': Math.min(100, Math.max(0, (zoomPercent - 1) / 29.99)) + '%'
              }"
            />
          </div>
          <button class="btn icon" @click="zoomIn" title="放大">+</button>
          <span class="zoom-value">{{ zoomPercent }}%</span>
        </div>

        <div class="divider"></div>

        <div class="tool-group color-controls">
          <span class="color-label">颜色数</span>
          <button
            v-for="n in [4, 8, 16, 24, 40]"
            :key="n"
            class="btn chip"
            :class="{ active: maxColors === n }"
            @click="setColorCount(n)"
          >{{ n }}</button>
        </div>

        <div class="divider"></div>

        <div class="tool-group algo-controls">
          <span class="color-label">算法</span>
          <select
            class="algo-select"
            :value="algorithm"
            @change="setAlgorithm($event.target.value)"
          >
            <option v-for="a in algorithms" :key="a.id" :value="a.id">
              {{ a.name }} — {{ a.desc }}
            </option>
          </select>
        </div>

        <div class="divider"></div>

        <div class="tool-group">
          <button class="btn soft" @click="resetView">
            <span class="btn-icon">⟲</span>
            <span>重置</span>
          </button>
          <button
            class="btn"
            :class="{ accent: showNumbers, soft: !showNumbers }"
            @click="toggleNumbers"
          >
            <span class="btn-icon">#</span>
            <span>{{ showNumbers ? '隐藏标号' : '显示标号' }}</span>
          </button>
          <button class="btn accent" @click="downloadPng">
            <span class="btn-icon">↓</span>
            <span>下载像素画</span>
          </button>
          <button class="btn accent" @click="downloadNumbered">
            <span class="btn-icon">#</span>
            <span>下载标号版</span>
          </button>
        </div>
      </template>

      <span class="spacer"></span>

      <div class="tool-group info-group">
        <div class="info-chip" v-if="hasImage">
          <span class="dot dot-img"></span>
          <span>原图 {{ sourceInfo.w }} × {{ sourceInfo.h }}</span>
        </div>
        <div class="info-chip">
          <span class="dot dot-palette"></span>
          <span>调色板 {{ colorCount }} 色</span>
        </div>
      </div>
    </div>

    <!-- 主体：左右两张卡片 -->
    <div class="panels">
      <!-- 左侧 -->
      <section class="panel card left-panel">
        <header class="panel-head">
          <div class="panel-title">
            <span class="title-dot title-dot-blue"></span>
            原图编辑
          </div>
          <div class="panel-tips" v-if="hasImage">
            <span class="tip tip-desktop">🖱 拖拽</span>
            <span class="tip tip-desktop">🔍 滚轮缩放</span>
            <span class="tip tip-mobile">👆 拖动</span>
            <span class="tip tip-mobile">🤏 双指缩放</span>
          </div>
          <div class="panel-tips" v-else>
            <span class="tip">点击下方卡片上传</span>
          </div>
        </header>
        <div class="canvas-wrap" ref="leftWrapRef">
          <canvas
            v-show="hasImage"
            ref="leftCanvasRef"
            class="stage"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @wheel="onWheel"
            @touchstart.passive="onTouchStart"
            @touchmove.passive="onTouchMove"
            @touchend="onTouchEnd"
            @touchcancel="onTouchEnd"
          ></canvas>
          <div
            v-if="!hasImage"
            class="empty-state"
            @click="triggerUpload"
            @dragover.prevent
            @dragenter.prevent
            @drop.prevent="onDropFile"
          >
            <div class="empty-frame">
              <div class="empty-pix-grid" aria-hidden="true">
                <span v-for="n in 16" :key="n" class="empty-pix" :class="'p' + n"></span>
              </div>
              <div class="empty-plus">＋</div>
            </div>
            <div class="empty-text">点击这里上传图片</div>
            <div class="empty-hint">支持 JPG / PNG / WebP 等常见格式</div>
          </div>
        </div>
      </section>

      <!-- 中间分隔条 -->
      <div class="vs-sep" aria-hidden="true">
        <div class="sep-glow"></div>
      </div>

      <!-- 右侧 -->
      <section class="panel card right-panel">
        <header class="panel-head">
          <div class="panel-title">
            <span class="title-dot title-dot-warm"></span>
            像素画预览
            <span class="badge-24">{{ BLOCK_SIZE }}×{{ BLOCK_SIZE }}</span>
          </div>
          <div class="panel-tips" v-if="previewReady">
            <span class="tip tip-good">
              使用 {{ previewStats.unique }} / {{ colorCount }} 色
            </span>
            <span
              class="tip"
              v-if="previewStats.topColor >= 0"
              :style="{ color: PALETTE_HEX[previewStats.topColor] }"
            >
              <span class="swatch-dot" :style="{ background: PALETTE_HEX[previewStats.topColor] }"></span>
              主色 {{ previewStats.topPercent }}%
            </span>
          </div>
        </header>

        <div class="canvas-wrap preview-wrap" ref="previewWrapRef">
          <canvas ref="previewCanvasRef" class="stage"></canvas>
          <div v-if="!hasImage" class="empty-state muted">
            <div class="empty-frame empty-frame-muted">
              <div class="empty-pix-grid mono" aria-hidden="true">
                <span v-for="n in 16" :key="n" class="empty-pix mono"></span>
              </div>
            </div>
            <div class="empty-text">上传图片后显示像素画预览</div>
            <div class="empty-hint">实时量化为 40 色调色板</div>
          </div>
        </div>

        <!-- 调色板：1-40 平铺编号 -->
        <div class="palette-panel">
          <div class="palette-title">40 色调色板</div>
          <div class="palette-flat">
            <div
              v-for="(hex, i) in PALETTE_HEX"
              :key="i"
              class="swatch-wrap"
            >
              <div
                class="swatch"
                :class="{ 'swatch-used': usedColorSet.has(i) }"
                :style="{ background: hex }"
                :title="`#${i + 1}`"
              ></div>
              <span class="swatch-num">{{ i + 1 }}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.converter {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  flex: 1;
  min-height: 0;
}

/* 卡片通用 */
.card {
  background: linear-gradient(
    180deg,
    rgba(32, 36, 50, 0.72) 0%,
    rgba(22, 25, 36, 0.72) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow:
    0 10px 30px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  border-radius: 14px;
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.info-group {
  gap: 6px;
}

.divider {
  width: 1px;
  align-self: stretch;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(255, 255, 255, 0.1) 20%,
    rgba(255, 255, 255, 0.1) 80%,
    transparent
  );
  margin: 2px 4px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: linear-gradient(180deg, #3b4154 0%, #303548 100%);
  color: #e6e6e6;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  transition:
    transform 0.12s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease,
    filter 0.18s ease;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}
.btn:hover {
  filter: brightness(1.1);
  border-color: rgba(255, 255, 255, 0.18);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
}
.btn:active {
  transform: translateY(0);
}
.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
  opacity: 0.9;
}

.btn.primary {
  background: linear-gradient(180deg, #6b8cff 0%, #4a6dff 100%);
  border-color: rgba(150, 175, 255, 0.45);
  box-shadow:
    0 4px 14px rgba(90, 120, 255, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.btn.primary:hover {
  box-shadow:
    0 6px 18px rgba(90, 120, 255, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.btn.accent {
  background: linear-gradient(180deg, #42cf88 0%, #28a868 100%);
  border-color: rgba(130, 230, 180, 0.4);
  color: #0b2916;
  box-shadow:
    0 4px 14px rgba(50, 180, 110, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.btn.accent:hover {
  box-shadow:
    0 6px 18px rgba(50, 180, 110, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.btn.soft {
  background: linear-gradient(180deg, #3a3f52 0%, #313647 100%);
}

.btn.icon {
  width: 34px;
  padding: 8px 0;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
}

.hidden-file {
  display: none;
}

/* 颜色数控制 */
.color-controls {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 5px 10px;
  border-radius: 12px;
}
.color-label {
  font-size: 12px;
  color: #9aa3b8;
  margin-right: 4px;
}
.btn.chip {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #b3bcd1;
  transition: all 0.15s ease;
  min-width: 36px;
}
.btn.chip:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
  color: #e5e9f2;
  transform: none;
}
.btn.chip.active {
  background: linear-gradient(180deg, #6b8cff 0%, #4a6dff 100%);
  border-color: rgba(150, 175, 255, 0.5);
  color: #fff;
  box-shadow: 0 2px 8px rgba(90, 120, 255, 0.4);
}

/* 算法选择器 */
.algo-controls {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 5px 10px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.algo-select {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #d5dae8;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
  max-width: 220px;
  transition: border-color 0.15s ease;
}
.algo-select:hover {
  border-color: rgba(150, 175, 255, 0.4);
}
.algo-select:focus {
  border-color: rgba(120, 160, 255, 0.6);
}
.algo-select option {
  background: #1a1f2e;
  color: #d5dae8;
}

/* 缩放滑块 */
.zoom-controls {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 5px 10px 5px 5px;
  border-radius: 12px;
}

.slider-wrap {
  position: relative;
  padding: 2px 0;
}

.zoom-slider {
  width: 160px;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  background: linear-gradient(
    90deg,
    #4a6dff 0%,
    #4a6dff var(--fill, 30%),
    #2a2f3f var(--fill, 30%),
    #2a2f3f 100%
  );
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}
.zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  box-shadow:
    0 0 0 3px rgba(90, 120, 255, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: transform 0.12s;
}
.zoom-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}
.zoom-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  border: none;
  box-shadow:
    0 0 0 3px rgba(90, 120, 255, 0.35),
    0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.zoom-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #b3bcd1;
  width: 54px;
  text-align: right;
  background: rgba(255, 255, 255, 0.04);
  padding: 3px 7px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.spacer {
  flex: 1;
}

/* 信息 chip */
.info-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 12px;
  color: #b3bcd1;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot-img {
  background: #6b8cff;
  box-shadow: 0 0 6px rgba(107, 140, 255, 0.7);
}
.dot-palette {
  background: conic-gradient(
    from 0deg,
    #ff5c8a,
    #ffcf5c,
    #6bff9e,
    #5cc8ff,
    #b084ff,
    #ff5c8a
  );
}

/* 主体两栏 */
.panels {
  flex: 1;
  display: flex;
  gap: 14px;
  min-height: 0;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #e5e9f2;
}

.title-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  box-shadow: 0 0 8px currentColor;
}
.title-dot-blue {
  background: #6b8cff;
  color: rgba(107, 140, 255, 0.7);
}
.title-dot-warm {
  background: linear-gradient(135deg, #ffb36a 0%, #ff6b8a 100%);
  color: rgba(255, 150, 120, 0.7);
}

.badge-24 {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(255,179,106,0.15), rgba(255,107,138,0.15));
  border: 1px solid rgba(255, 150, 150, 0.25);
  color: #ffc6a5;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-left: 2px;
}

.panel-tips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tip {
  font-size: 11.5px;
  color: #9aa3b8;
  padding: 3px 9px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.tip-good {
  background: rgba(80, 200, 140, 0.1);
  border-color: rgba(80, 200, 140, 0.22);
  color: #88d6ad;
}

.swatch-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.3);
  display: inline-block;
}

/* 画布容器 */
.canvas-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
  margin: 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: #0e1016;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.preview-wrap {
  margin-bottom: 10px;
  background:
    radial-gradient(circle at 50% 0%, rgba(120, 175, 255, 0.08), transparent 60%),
    #0e1016;
}

.stage {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

/* 中间 vs 分隔 */
.vs-sep {
  align-self: stretch;
  width: 2px;
  position: relative;
  border-radius: 2px;
  background: linear-gradient(
    180deg,
    transparent 5%,
    rgba(255, 255, 255, 0.06) 20%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0.06) 80%,
    transparent 95%
  );
  flex-shrink: 0;
  margin: 30px 0;
}
.sep-glow {
  position: absolute;
  inset: 40% -3px 40% -3px;
  background: linear-gradient(
    180deg,
    transparent,
    rgba(120, 175, 255, 0.6) 50%,
    transparent
  );
  filter: blur(6px);
  pointer-events: none;
}

/* 空状态 */
.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  cursor: pointer;
  color: #8892a8;
  transition: background 0.2s;
}
.empty-state:hover {
  background: rgba(120, 175, 255, 0.04);
}
.empty-state.muted {
  cursor: default;
}
.empty-state.muted:hover {
  background: transparent;
}

.empty-frame {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 18px;
  background: linear-gradient(
    145deg,
    rgba(107, 140, 255, 0.15) 0%,
    rgba(255, 107, 138, 0.15) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.04),
    0 20px 40px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.empty-frame-muted {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.04);
}

.empty-pix-grid {
  position: absolute;
  inset: 16px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-template-rows: repeat(4, 1fr);
  gap: 2px;
  opacity: 0.7;
}
.empty-pix-grid.mono .empty-pix {
  background: #2a2f3f !important;
}
.empty-pix {
  border-radius: 2px;
}
.p1 { background: #ff5c8a; } .p2 { background: #ff9d5c; } .p3 { background: #ffcf5c; } .p4 { background: #6bff9e; }
.p5 { background: #ff9d5c; } .p6 { background: #ffcf5c; } .p7 { background: #ffffff; } .p8 { background: #5cc8ff; }
.p9 { background: #ffcf5c; } .p10 { background: #6bff9e; } .p11 { background: #5cc8ff; } .p12 { background: #b084ff; }
.p13 { background: #6bff9e; } .p14 { background: #5cc8ff; } .p15 { background: #b084ff; } .p16 { background: #ff6bff; }

.empty-plus {
  position: relative;
  z-index: 2;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(20, 24, 34, 0.85);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 300;
  backdrop-filter: blur(4px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.empty-text {
  font-size: 15px;
  color: #d7dbee;
  font-weight: 500;
}
.empty-state.muted .empty-text {
  color: #8690a6;
  font-weight: 400;
}
.empty-hint {
  font-size: 12px;
  color: #616a80;
}

/* 调色板面板 */
.palette-panel {
  padding: 12px 16px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0) 0%,
    rgba(0, 0, 0, 0.2) 100%
  );
}

.palette-title {
  font-size: 12px;
  font-weight: 600;
  color: #b3bcd1;
  margin-bottom: 10px;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.palette-title::before {
  content: '';
  width: 3px;
  height: 12px;
  border-radius: 2px;
  background: linear-gradient(180deg, #6b8cff, #ff6b8a);
}

/* 1-40 平铺 */
.palette-flat {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 6px 4px;
}

.swatch-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.swatch {
  width: 100%;
  aspect-ratio: 1;
  max-width: 28px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
  opacity: 0.4;
}
.swatch-used {
  opacity: 1;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.2),
    0 0 6px rgba(120, 175, 255, 0.4),
    0 1px 2px rgba(0, 0, 0, 0.25);
}
.swatch:hover {
  transform: scale(1.15) translateY(-1px);
  z-index: 2;
  opacity: 1;
}

.swatch-num {
  font-size: 9px;
  color: #616a80;
  font-variant-numeric: tabular-nums;
  font-family: monospace;
}
.swatch-used + .swatch-num {
  color: #9fc2ff;
}

/* 小屏自适应 */
@media (max-width: 900px) {
  .panels {
    flex-direction: column;
  }
  .vs-sep {
    width: auto;
    height: 2px;
    margin: 0 40px;
  }
  .sep-glow {
    inset: -3px 40% -3px 40%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(120, 175, 255, 0.6) 50%,
      transparent
    );
  }
}

@media (max-width: 600px) {
  .converter {
    gap: 10px;
  }

  /* 工具栏：压缩间距、分组换行、按钮缩小 */
  .toolbar {
    padding: 8px 10px;
    gap: 6px;
    align-items: flex-start;
  }
  .toolbar .divider {
    display: none;
  }
  .toolbar .tool-group {
    width: 100%;
    gap: 6px;
  }
  .toolbar .tool-group.info-group {
    order: 99;
    width: auto;
    margin-top: 2px;
  }
  .toolbar .color-controls {
    padding: 4px 8px;
  }
  .toolbar .algo-controls {
    padding: 4px 8px;
  }
  .algo-select {
    max-width: 140px;
    font-size: 11px;
  }
  .toolbar .zoom-controls {
    padding: 4px 6px;
  }
  .zoom-slider {
    width: 100px;
  }
  .zoom-value {
    width: 46px;
    font-size: 11px;
    padding: 2px 6px;
  }
  .btn {
    padding: 7px 12px;
    font-size: 12px;
    border-radius: 9px;
  }
  .btn.primary,
  .btn.accent {
    flex: 1;
    justify-content: center;
  }
  .btn.icon {
    width: 30px;
    font-size: 15px;
  }
  .btn.chip {
    padding: 4px 8px;
    font-size: 11px;
    min-width: 32px;
  }
  .spacer {
    display: none;
  }
  .info-chip {
    font-size: 11px;
    padding: 4px 8px;
  }
  .color-label {
    font-size: 11px;
  }

  /* 面板头部缩小 */
  .panel-head {
    padding: 10px 12px 8px;
    gap: 8px;
  }
  .panel-title {
    font-size: 13px;
    gap: 6px;
  }
  .badge-24 {
    font-size: 10px;
    padding: 1px 6px;
  }
  .panel-tips .tip {
    font-size: 10.5px;
    padding: 2px 7px;
  }
  .tip-desktop { display: none; }
  .tip-mobile { display: inline-flex; }

  /* 画布容器：用 flex:1 自然分配，不要 min-height 破坏布局 */
  .canvas-wrap {
    margin: 10px;
  }
  .preview-wrap {
    margin-bottom: 6px;
  }

  /* 两个面板均分可用高度 */
  .left-panel,
  .right-panel {
    flex: 1;
    min-height: 320px;
  }

  /* 空状态缩小 */
  .empty-frame {
    width: 72px;
    height: 72px;
    border-radius: 14px;
  }
  .empty-plus {
    width: 32px;
    height: 32px;
    font-size: 20px;
    border-radius: 9px;
  }
  .empty-text {
    font-size: 13px;
  }
  .empty-hint {
    font-size: 11px;
  }

  /* 调色板在手机端减小色块尺寸 */
  .palette-panel {
    padding: 10px 12px 12px;
  }
  .palette-flat {
    grid-template-columns: repeat(8, 1fr);
    gap: 4px 3px;
  }
  .swatch {
    max-width: 22px;
  }
  .swatch-num {
    font-size: 8px;
  }
}

@media (min-width: 601px) {
  .tip-mobile { display: none; }
}
</style>
