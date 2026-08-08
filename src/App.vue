<script setup>
import PixelConverter from './components/PixelConverter.vue'
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>像素画转换工具</h1>
      <span class="subtitle">24×24 色块 · 40 色调色板</span>
    </header>
    <main class="app-main">
      <PixelConverter />
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.app-header {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding: 14px 24px;
  background: #22262e;
  border-bottom: 1px solid #333843;
  flex-shrink: 0;
}

.app-header h1 {
  font-size: 20px;
  font-weight: 600;
  color: #f0f0f0;
}

.subtitle {
  font-size: 13px;
  color: #8b93a3;
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
