import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.wokao.app',
  appName: 'wokao',
  webDir: 'mobile-dist',
  android: {
    allowMixedContent: true
  },
  server: {
    androidScheme: 'https'
  },
  plugins: {
    // 通过原生 HTTP 发起请求，绕过 WebView 的 CORS 限制（调用 DeepSeek 接口需要）
    CapacitorHttp: {
      enabled: true
    }
  }
}

export default config
