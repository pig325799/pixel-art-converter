<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { PALETTE, PALETTE_HEX, sampleToBlockIndices } from '../utils/palette.js'

const BLOCK_SIZE = 24

/* ---------------- DOM 引用 ---------------- */
const fileInputRef = ref(null)
const leftCanvasRef = ref(null)
const previewCanvasRef = ref(null)
const leftWrapRef = ref(null)
const previewWrapRef = ref(null)

/* ---------------- 响应式状态 ---------------- */
const hasImage = ref(false)
const zoomPercent = ref(100) // 显示用
const blockIndices = ref([]) // 预览色块索引
const previewReady = ref(false)

/* ---------------- 内部变量（非响应式） ---------------- */
let imgEl = null
let sourceCanvas = null // 离屏 canvas，缓存源图像像素
let sourceCtx = null
let sourceImageData = null

let dpr = 1
let leftW = 0
let leftH = 0
let previewW = 0
let previewH = 0

// 图像变换：图像左上角在画布坐标系中的位置 + 缩放
let offsetX = 0
let offsetY = 0
let scale = 1
const MIN_SCALE = 0.05
const MAX_SCALE = 30

// 选区框（画布坐标）
let frameSize = 0
let frameX = 0
let frameY = 0

// 拖拽状态
let dragging = false
let dragStartX = 0
let dragStartY = 0
let dragOffsetX = 0
let dragOffsetY = 0

let rafId = 0
let roLeft = null
let roPreview = null

/* ---------------- 文件上传 ---------------- */
function triggerUpload() {
  fileInputRef.value?.click()
}

function onFileChange(e) {
  const file = e.target.files?.[0]
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
  // 允许重复上传同一文件
  e.target.value = ''
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
  // 选区框：画布短边的 70%，且为正方形
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
  // 让图像刚好放进画布（留点边距），并居中
  const fit = Math.min(leftW / iw, leftH / ih) * 0.9
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

  // 画布背景（棋盘格表示透明）
  drawCheckerboard(ctx, leftW, leftH)

  // 绘制图像
  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(imgEl, 0, 0)
  ctx.restore()

  // 暗化选区外区域（选区内保持原亮度）
  ctx.save()
  ctx.fillStyle = 'rgba(10, 12, 18, 0.62)'
  ctx.beginPath()
  ctx.rect(0, 0, leftW, leftH)
  ctx.rect(frameX, frameY, frameSize, frameSize)
  ctx.fill('evenodd')
  ctx.restore()

  // 选区框边框
  ctx.save()
  ctx.strokeStyle = '#ffd54a'
  ctx.lineWidth = 2
  ctx.strokeRect(frameX, frameY, frameSize, frameSize)
  // 四角小标记
  const c = 10
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffd54a'
  drawCorner(ctx, frameX, frameY, c)
  drawCorner(ctx, frameX + frameSize, frameY, c, 1, 0)
  drawCorner(ctx, frameX, frameY + frameSize, c, 0, 1)
  drawCorner(ctx, frameX + frameSize, frameY + frameSize, c, 1, 1)
  ctx.restore()

  // 更新预览
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
  const s = 12
  ctx.fillStyle = '#2a2e36'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#262932'
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

  // 选区框在画布坐标 → 源图像坐标
  const sx = (frameX - offsetX) / scale
  const sy = (frameY - offsetY) / scale
  const sw = frameSize / scale
  const sh = frameSize / scale

  const indices = sampleToBlockIndices(
    sourceImageData,
    sx,
    sy,
    sw,
    sh,
    BLOCK_SIZE
  )
  blockIndices.value = indices
  previewReady.value = true

  // 计算预览绘制区域：正方形，居中
  const size = Math.min(previewW, previewH) * 0.9
  const px = (previewW - size) / 2
  const py = (previewH - size) / 2
  const cell = size / BLOCK_SIZE

  // 背景
  ctx.fillStyle = '#1a1d24'
  ctx.fillRect(px - 2, py - 2, size + 4, size + 4)

  for (let by = 0; by < BLOCK_SIZE; by++) {
    for (let bx = 0; bx < BLOCK_SIZE; bx++) {
      const idx = indices[by * BLOCK_SIZE + bx]
      ctx.fillStyle = PALETTE_HEX[idx]
      ctx.fillRect(
        Math.floor(px + bx * cell),
        Math.floor(py + by * cell),
        Math.ceil(cell),
        Math.ceil(cell)
      )
    }
  }

  // 网格线（淡）
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= BLOCK_SIZE; i++) {
    const p = Math.floor(px + i * cell) + 0.5
    ctx.moveTo(p, py)
    ctx.lineTo(p, py + size)
    const q = Math.floor(py + i * cell) + 0.5
    ctx.moveTo(px, q)
    ctx.lineTo(px + size, q)
  }
  ctx.stroke()
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
  // 以鼠标为中心缩放
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE)
  const real = newScale / scale
  offsetX = cx - (cx - offsetX) * real
  offsetY = cy - (cy - offsetY) * real
  scale = newScale
  zoomPercent.value = Math.round(scale * 100)
  render()
}

/* ---------------- 缩放控制 ---------------- */
function setZoomFromSlider() {
  if (!hasImage.value) return
  const target = zoomPercent.value / 100
  const newScale = clamp(target, MIN_SCALE, MAX_SCALE)
  // 以选区框中心为锚点缩放
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

/* ---------------- 下载 ---------------- */
function downloadPng() {
  if (!previewReady.value) return
  // 输出原始 24x24 像素 + 放大版
  const out = document.createElement('canvas')
  const upscale = 32
  out.width = BLOCK_SIZE * upscale
  out.height = BLOCK_SIZE * upscale
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const idx = blockIndices.value
  for (let by = 0; by < BLOCK_SIZE; by++) {
    for (let bx = 0; bx < BLOCK_SIZE; bx++) {
      ctx.fillStyle = PALETTE_HEX[idx[by * BLOCK_SIZE + bx]]
      ctx.fillRect(bx * upscale, by * upscale, upscale, upscale)
    }
  }
  const a = document.createElement('a')
  a.download = 'pixel-art.png'
  a.href = out.toDataURL('image/png')
  a.click()
}

/* ---------------- 工具 ---------------- */
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
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <button class="btn primary" @click="triggerUpload">上传图片</button>
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="hidden-file"
        @change="onFileChange"
      />
      <template v-if="hasImage">
        <div class="zoom-controls">
          <button class="btn icon" @click="zoomOut" title="缩小">−</button>
          <input
            type="range"
            min="1"
            max="3000"
            v-model.number="zoomPercent"
            @input="setZoomFromSlider"
            class="zoom-slider"
          />
          <button class="btn icon" @click="zoomIn" title="放大">+</button>
          <span class="zoom-value">{{ zoomPercent }}%</span>
        </div>
        <button class="btn" @click="resetView">重置视图</button>
        <button class="btn accent" @click="downloadPng">下载像素画</button>
      </template>
      <span class="spacer"></span>
      <span class="palette-count">调色板：{{ colorCount }} 色</span>
    </div>

    <!-- 主体：左右两栏 -->
    <div class="panels">
      <!-- 左侧：上传 + 选区 -->
      <section class="panel left-panel">
        <div class="panel-label">原图（拖拽移动 · 滚轮缩放）</div>
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
          ></canvas>
          <div v-if="!hasImage" class="empty-state" @click="triggerUpload">
            <div class="empty-icon">＋</div>
            <div class="empty-text">点击上传图片</div>
            <div class="empty-hint">支持拖拽与滚轮缩放调整选区</div>
          </div>
        </div>
      </section>

      <!-- 右侧：预览 -->
      <section class="panel right-panel">
        <div class="panel-label">像素画预览（{{ BLOCK_SIZE }}×{{ BLOCK_SIZE }} 色块）</div>
        <div class="canvas-wrap preview-wrap" ref="previewWrapRef">
          <canvas ref="previewCanvasRef" class="stage"></canvas>
          <div v-if="!hasImage" class="empty-state muted">
            <div class="empty-text">上传图片后显示预览</div>
          </div>
        </div>

        <!-- 调色板展示 -->
        <div class="palette-bar">
          <div
            v-for="(hex, i) in PALETTE_HEX"
            :key="i"
            class="swatch"
            :style="{ background: hex }"
            :title="`#${i + 1}`"
          ></div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.converter {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #22262e;
  border-bottom: 1px solid #333843;
  flex-wrap: wrap;
}

.btn {
  background: #353b47;
  color: #e6e6e6;
  border: 1px solid #444b58;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover {
  background: #3f4654;
}
.btn.primary {
  background: #4a7cff;
  border-color: #4a7cff;
  color: #fff;
}
.btn.primary:hover {
  background: #5d8bff;
}
.btn.accent {
  background: #2faa6a;
  border-color: #2faa6a;
  color: #fff;
}
.btn.accent:hover {
  background: #36c178;
}
.btn.icon {
  width: 30px;
  padding: 7px 0;
  text-align: center;
  font-size: 16px;
  line-height: 1;
}

.hidden-file {
  display: none;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zoom-slider {
  width: 150px;
  accent-color: #4a7cff;
}
.zoom-value {
  font-size: 12px;
  color: #9aa3b2;
  width: 48px;
  text-align: right;
}

.spacer {
  flex: 1;
}

.palette-count {
  font-size: 12px;
  color: #8b93a3;
}

.panels {
  flex: 1;
  display: flex;
  min-height: 0;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.left-panel {
  border-right: 1px solid #333843;
}

.panel-label {
  padding: 8px 14px;
  font-size: 12px;
  color: #8b93a3;
  background: #1e2128;
  border-bottom: 1px solid #2a2e36;
}

.canvas-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #15171c;
  min-height: 0;
}

.stage {
  display: block;
  touch-action: none;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  color: #6b7382;
}
.empty-state.muted {
  cursor: default;
}
.empty-icon {
  font-size: 48px;
  color: #4a7cff;
  line-height: 1;
}
.empty-text {
  font-size: 15px;
}
.empty-hint {
  font-size: 12px;
  color: #555c6a;
}

.palette-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  padding: 10px 14px;
  background: #1e2128;
  border-top: 1px solid #2a2e36;
}
.swatch {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
