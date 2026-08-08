<script setup>
import PixelConverter from './components/PixelConverter.vue'
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="brand">
        <div class="logo" aria-hidden="true">
          <div class="pix pix-1"></div>
          <div class="pix pix-2"></div>
          <div class="pix pix-3"></div>
          <div class="pix pix-4"></div>
          <div class="pix pix-5"></div>
          <div class="pix pix-6"></div>
          <div class="pix pix-7"></div>
          <div class="pix pix-8"></div>
          <div class="pix pix-9"></div>
        </div>
        <div class="titles">
          <h1>像素画转换工具</h1>
          <div class="subtitle-row">
            <span class="chip">24 × 24 色块</span>
            <span class="chip chip-warm">40 色调色板</span>
            <span class="chip chip-cool">实时光栅化</span>
          </div>
        </div>
      </div>
      <div class="header-deco" aria-hidden="true"></div>
    </header>
    <div class="top-stripe" aria-hidden="true"></div>
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
  position: relative;
  z-index: 1;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 26px;
  background: linear-gradient(
    180deg,
    rgba(30, 33, 44, 0.92) 0%,
    rgba(22, 25, 35, 0.82) 100%
  );
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.logo {
  position: relative;
  width: 44px;
  height: 44px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 3px;
  padding: 5px;
  background: #12151c;
  border-radius: 10px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    0 6px 16px rgba(0, 0, 0, 0.35);
}
.pix {
  border-radius: 2px;
  animation: flicker 4s ease-in-out infinite;
}
.pix-1 { background: #ff5c8a; animation-delay: 0s; }
.pix-2 { background: #ffcf5c; animation-delay: 0.2s; }
.pix-3 { background: #6bff9e; animation-delay: 0.4s; }
.pix-4 { background: #5cc8ff; animation-delay: 0.6s; }
.pix-5 { background: #ffffff; animation-delay: 0.8s; }
.pix-6 { background: #b084ff; animation-delay: 1.0s; }
.pix-7 { background: #ff9d5c; animation-delay: 1.2s; }
.pix-8 { background: #5cffd7; animation-delay: 1.4s; }
.pix-9 { background: #ff6bff; animation-delay: 1.6s; }

@keyframes flicker {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.35); }
}

.titles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.app-header h1 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.2px;
  background: linear-gradient(90deg, #ffffff 0%, #cfd8ff 60%, #ffd7f0 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.subtitle-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: #aeb8cb;
  border: 1px solid rgba(255, 255, 255, 0.08);
  letter-spacing: 0.3px;
}
.chip-warm {
  background: rgba(255, 185, 100, 0.12);
  border-color: rgba(255, 185, 100, 0.28);
  color: #ffc786;
}
.chip-cool {
  background: rgba(120, 175, 255, 0.12);
  border-color: rgba(120, 175, 255, 0.28);
  color: #9fc2ff;
}

.header-deco {
  width: 120px;
  height: 28px;
  background:
    linear-gradient(90deg, transparent 0%, rgba(120,175,255,0.35) 40%, rgba(255,150,200,0.35) 60%, transparent 100%);
  filter: blur(1px);
  mask: linear-gradient(90deg, transparent, #000 20%, #000 80%, transparent);
  -webkit-mask: linear-gradient(90deg, transparent, #000 20%, #000 80%, transparent);
}

.top-stripe {
  height: 2px;
  flex-shrink: 0;
  background: linear-gradient(
    90deg,
    #ff5c8a 0%,
    #ffcf5c 18%,
    #6bff9e 36%,
    #5cc8ff 54%,
    #b084ff 72%,
    #ff9d5c 90%,
    #ff6bff 100%
  );
  box-shadow: 0 0 18px rgba(120, 175, 255, 0.3);
}

.app-main {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 18px 22px 22px;
}

@media (max-width: 600px) {
  .app-header {
    padding: 10px 14px;
    gap: 10px;
  }
  .logo {
    width: 34px;
    height: 34px;
    gap: 2px;
    padding: 4px;
    border-radius: 8px;
  }
  .app-header h1 {
    font-size: 16px;
  }
  .subtitle-row {
    display: none;
  }
  .header-deco {
    display: none;
  }
  .app-main {
    padding: 12px 12px 24px;
  }
}
</style>
