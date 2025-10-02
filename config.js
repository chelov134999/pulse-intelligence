(function loadStarEngineConfig() {
  const runtime = window.__STAR_ENGINE_CONFIG__ || {};
  const defaults = {
    liffId: '2008215846-5LwXlWVN',
    webhookUrl: 'https://chelov134999.app.n8n.cloud/webhook/lead-entry',
  };

  const coalesce = (key) => (runtime[key] ?? defaults[key] ?? '');

  const config = {
    liffId: coalesce('liffId'),
    webhookUrl: coalesce('webhookUrl'),
    googlePlacesApiKey: coalesce('googlePlacesApiKey'),
    scraperApiKey: coalesce('scraperApiKey'),
    authorizationUrl: coalesce('authorizationUrl'),
    sampleReportUrl: coalesce('sampleReportUrl'),
  };

  const missing = Object.entries({
    googlePlacesApiKey: config.googlePlacesApiKey,
    scraperApiKey: config.scraperApiKey,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    console.warn('[star-engine] 以下設定缺失，部分功能將無法使用：', missing.join(', '));
  }

  window.STAR_ENGINE_CONFIG = Object.freeze(config);
})();
