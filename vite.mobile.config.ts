import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// 移动端（Capacitor）构建配置：复用桌面端 renderer 源码，注入 localStorage 版数据层
export default defineConfig({
  root: resolve(__dirname, 'src/mobile'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'mobile-dist'),
    emptyOutDir: true,
    target: 'es2019'
  }
})
