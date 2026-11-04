// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-10-30',
  devtools: {
    enabled: false,
  },
  modules: ['@vueuse/nuxt', '@nuxt/ui', '@pinia/nuxt'],
  ssr: false,
  // 监听所有网卡: 局域网内其他电脑可打开 http://<本机IP>:3000 使用识别+求解
  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },
});
