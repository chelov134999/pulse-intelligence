const form = document.getElementById('lead-form');
const resultSection = document.getElementById('result');
const resultMessage = document.getElementById('result-message');
const resultJson = document.getElementById('result-json');
const copyButton = document.getElementById('copy-button');
const reportCard = document.getElementById('report-card');
const statusLine = document.getElementById('status-line');
const statusBadge = document.getElementById('webhook-status');
const submitButton = document.querySelector('.form__submit');

const config = window.STAR_ENGINE_CONFIG || {};
const defaultWebhookUrl = 'https://chelov134999.app.n8n.cloud/webhook/lead-entry';

let liffReady = false;
let liffInClient = false;
let liffId = new URLSearchParams(window.location.search).get('liffId') || config.liffId || window.LIFF_ID || '';
let cachedUserId = '';

const webhookUrl = config.webhookUrl || defaultWebhookUrl;
const googleApiKey = (config.googlePlacesApiKey || '').trim();
const scraperApiKey = (config.scraperApiKey || '').trim();

async function initLiff() {
  if (!window.liff || !liffId) {
    console.warn('[LIFF] SDK 未載入或缺少 LIFF ID');
    return;
  }
  try {
    await liff.init({ liffId });
    await liff.ready;

    if (!liff.isLoggedIn()) {
      liff.login({ scope: ['profile', 'openid'] });
      return;
    }

    liffInClient = liff.isInClient?.() ?? false;

    let profile = null;
    try {
      profile = await liff.getProfile();
    } catch (error) {
      console.warn('[LIFF] 無法取得使用者檔案：', error);
    }

    const context = liff.getContext?.();
    const decoded = liff.getDecodedIDToken?.();

    cachedUserId = profile?.userId || context?.userId || decoded?.sub || '';

    if (!cachedUserId) {
      console.warn('[LIFF] 尚未取得使用者 ID，將以無推播模式運作');
    }

    liffReady = true;
  } catch (error) {
    console.warn('[LIFF] 初始化失敗：', error);
  }
}

const getTrimmed = (value) => (value || '').trim();

function buildPayload(formData) {
  return {
    city: getTrimmed(formData.get('city')),
    route: getTrimmed(formData.get('route')),
    number: getTrimmed(formData.get('number')),
    name: getTrimmed(formData.get('name')),
    submittedAt: new Date().toISOString(),
  };
}

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? '分析中…' : '送出並分析';
}

function clearReport() {
  if (reportCard) {
    reportCard.hidden = true;
    reportCard.innerHTML = '';
  }
}

function createList(items) {
  const listItems = (items || []).filter(Boolean);
  if (!listItems.length) return null;
  const list = document.createElement('ul');
  list.className = 'report-card__list';
  listItems.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  return list;
}

function renderReport(report) {
  clearReport();
  if (!report) return;

  reportCard.hidden = false;

  const primary = report.primary || {};
  const competitors = report.competitors || [];
  const external = report.externalInsights || { status: 'idle', items: [] };

  const mainSection = document.createElement('div');
  mainSection.className = 'report-card__section';
  const mainTitle = document.createElement('p');
  mainTitle.className = 'report-card__title';
  mainTitle.textContent = '初檢鉤子摘要';
  mainSection.appendChild(mainTitle);

  const summaryLines = [];
  if (primary.name) summaryLines.push(`店名：${primary.name}`);
  if (primary.address) summaryLines.push(`地址：${primary.address}`);
  if (primary.rating || primary.reviewCount) {
    const ratingText = primary.rating ? `${primary.rating} 分` : '暫無評分';
    const reviewText = primary.reviewCount != null ? `${primary.reviewCount} 則評論` : '尚無評論資料';
    summaryLines.push(`Google 評價：${ratingText}｜${reviewText}`);
  }
  if (primary.phone) summaryLines.push(`電話：${primary.phone}`);
  if (primary.website) summaryLines.push(`網站：${primary.website}`);

  const summaryList = createList(summaryLines);
  if (summaryList) mainSection.appendChild(summaryList);

  if (primary.reviews && primary.reviews.length) {
    const review = primary.reviews[0];
    const reviewParagraph = document.createElement('p');
    reviewParagraph.className = 'report-card__muted';
    reviewParagraph.textContent = `最新評論：${review.author}（${review.relativePublishTimeDescription || '近期'}）－${review.originalText || '（無文字）'}`;
    mainSection.appendChild(reviewParagraph);
  }

  if (report.generatedAt) {
    const generated = document.createElement('p');
    generated.className = 'report-card__muted';
    generated.textContent = `生成時間：${new Date(report.generatedAt).toLocaleString('zh-TW')}`;
    mainSection.appendChild(generated);
  }

  reportCard.appendChild(mainSection);

  if (competitors.length) {
    const compSection = document.createElement('div');
    compSection.className = 'report-card__section';
    const compTitle = document.createElement('p');
    compTitle.className = 'report-card__title';
    compTitle.textContent = '同區競品對比';
    compSection.appendChild(compTitle);

    const compLines = competitors.map((comp) => {
      const ratingDiff = primary.rating && comp.rating ? (comp.rating - primary.rating).toFixed(1) : null;
      const diffText = ratingDiff ? (Number(ratingDiff) >= 0 ? `+${ratingDiff}` : ratingDiff) : '';
      const reviewText = comp.reviewCount != null ? `${comp.reviewCount} 則` : '評論量未知';
      return `${comp.rank}. ${comp.name} ${diffText ? `(${diffText} 分)` : ''}｜${reviewText}`;
    });

    const compList = createList(compLines);
    if (compList) compSection.appendChild(compList);
    reportCard.appendChild(compSection);
  }

  const externalSection = document.createElement('div');
  externalSection.className = 'report-card__section';
  const externalTitle = document.createElement('p');
  externalTitle.className = 'report-card__title';
  externalTitle.textContent = '外部口碑聲量';
  externalSection.appendChild(externalTitle);

  if (external.status === 'ready' && external.items.length) {
    const extLines = external.items.map((item) => {
      const source = item.source ? `（${item.source}）` : '';
      const snippet = item.snippet ? ` - ${item.snippet}` : '';
      return `${item.title || '未命名消息'}${source}${snippet}`;
    });
    const extList = createList(extLines);
    if (extList) externalSection.appendChild(extList);
  } else {
    const info = document.createElement('p');
    info.className = 'report-card__muted';
    if (external.status === 'error') {
      info.textContent = `抓取外部口碑時發生錯誤：${external.message || '請稍後再試'}`;
    } else if (external.status === 'empty') {
      info.textContent = '暫無外部口碑資料。';
    } else {
      info.textContent = '尚未啟用外部口碑抓取。';
    }
    externalSection.appendChild(info);
  }

  reportCard.appendChild(externalSection);

  const cta = document.createElement('p');
  cta.className = 'report-card__tagline';
  cta.textContent = '下一步：授權 Google 帳號，即可生成 60 天深度診斷與升星方案。';
  reportCard.appendChild(cta);
}

function buildHookLine(report) {
  const primary = report?.primary || {};
  const topCompetitor = (report?.competitors || [])[0];

  if (primary.rating && topCompetitor?.rating) {
    const diff = Number((topCompetitor.rating - primary.rating).toFixed(1));
    if (Math.abs(diff) >= 0.2) {
      return `同區競品「${topCompetitor.name}」評分${diff > 0 ? '高' : '低'} ${Math.abs(diff)} 分，建議立即提出改善計畫。`;
    }
  }

  if (primary.reviewCount != null && primary.reviewCount < 20) {
    return `目前僅有 ${primary.reviewCount} 則評論，拉開差距的關鍵在於加速累積好評與即時回覆。`;
  }

  return '初檢鉤子已生成，以下是你與商圈競品的差距摘要。';
}

function updateWebhookStatus({ attempted, success }) {
  if (!statusLine || !statusBadge) return;
  if (!attempted) {
    statusLine.hidden = true;
    statusBadge.textContent = '';
    statusBadge.classList.remove('status-badge--warn');
    return;
  }
  statusLine.hidden = false;
  const message = success
    ? 'LINE 已同步推播鉤子報告'
    : 'LINE 推播未確認，建議手動回貼結果';
  statusBadge.textContent = message;
  statusBadge.classList.toggle('status-badge--warn', !success);
}

function showResult({ payload, message, report, webhookSuccess, webhookAttempted }) {
  resultSection.hidden = false;
  resultMessage.textContent = report ? `${message} ${buildHookLine(report)}` : message;
  updateWebhookStatus({ attempted: webhookAttempted, success: webhookSuccess });
  renderReport(report || null);

  resultJson.textContent = JSON.stringify(
    {
      payload,
      webhookSuccess,
      report,
    },
    null,
    2
  );
}

async function postToN8n(payload, userId) {
  if (!userId) return false;
  try {
    const body = {
      destination: userId,
      events: [
        {
          type: 'message',
          message: {
            type: 'text',
            text: JSON.stringify({ action: 'form_submit', ...payload }),
          },
          timestamp: Date.now(),
          source: { type: 'user', userId },
          replyToken: '',
          mode: 'active',
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.warn('[n8n] webhook 回應非 2xx', response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error('[n8n] webhook 呼叫失敗', error);
    return false;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}：${text}`);
  }
  return response.json();
}

function buildPlacesQuery(payload) {
  return [payload.name, payload.city, payload.route, payload.number].filter(Boolean).join(' ');
}

async function searchPlaces(payload) {
  if (!googleApiKey) {
    throw new Error('尚未設定 Google Places API Key');
  }

  const query = buildPlacesQuery(payload);
  if (!query) {
    throw new Error('表單資料不完整，請確認四個欄位皆已填寫。');
  }

  const data = await fetchJson('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleApiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.internationalPhoneNumber,places.websiteUri',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'zh-TW',
      regionCode: 'TW',
      maxResultCount: 5,
    }),
  });

  const places = Array.isArray(data?.places) ? data.places : [];
  if (!places.length) {
    throw new Error('找不到符合的 Google 商家，請確認地址是否正確。');
  }
  return places;
}

async function fetchPlaceDetails(placeId) {
  const detailUrl = new URL(`https://places.googleapis.com/v1/${placeId}`);
  detailUrl.searchParams.set('languageCode', 'zh-TW');
  detailUrl.searchParams.set('regionCode', 'TW');
  try {
    return await fetchJson(detailUrl.toString(), {
      headers: {
        'X-Goog-Api-Key': googleApiKey,
        'X-Goog-FieldMask': 'displayName,formattedAddress,primaryTypeDisplayName,internationalPhoneNumber,regularOpeningHours,websiteUri,rating,userRatingCount,reviews',
      },
    });
  } catch (error) {
    console.warn('[places] 取得詳細資料失敗，改用搜尋結果', error.message);
    return null;
  }
}

function mapReview(review) {
  return {
    author: review?.authorAttribution?.displayName || '匿名',
    rating: review?.rating || null,
    relativePublishTimeDescription: review?.relativePublishTimeDescription || '',
    originalText: review?.originalText?.text || review?.text?.text || '',
  };
}

function normalizeCompetitors(primary, competitors) {
  return competitors.map((item, index) => ({
    rank: index + 1,
    id: item.id,
    name: item.displayName?.text || '未命名商家',
    address: item.formattedAddress || '',
    rating: item.rating || null,
    reviewCount: item.userRatingCount || null,
    primaryType: item.primaryTypeDisplayName?.text || '',
  })).filter((item) => item.id !== primary.id);
}

async function fetchExternalInsights(name, city) {
  if (!scraperApiKey) {
    return { status: 'disabled', items: [] };
  }
  const query = [name, city].filter(Boolean).join(' ');
  if (!query) {
    return { status: 'empty', items: [] };
  }
  try {
    const url = new URL('https://api.scraperapi.com/structured/google/search');
    url.searchParams.set('api_key', scraperApiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '5');
    url.searchParams.set('hl', 'zh-tw');
    const data = await fetchJson(url.toString());
    const items = Array.isArray(data?.organic_results)
      ? data.organic_results.slice(0, 3).map((item) => ({
          title: item.title || '',
          snippet: item.snippet || '',
          link: item.link || '',
          source: item.source || '',
        }))
      : [];
    if (!items.length) {
      return { status: 'empty', items: [] };
    }
    return { status: 'ready', items };
  } catch (error) {
    console.warn('[scraper] 抓取失敗', error.message);
    return { status: 'error', message: error.message, items: [] };
  }
}

async function generateDiagnosis(payload) {
  const places = await searchPlaces(payload);
  const primary = places[0];
  const detail = (await fetchPlaceDetails(primary.id)) || {};

  const reviewItems = Array.isArray(detail.reviews)
    ? detail.reviews.slice(0, 5).map(mapReview)
    : [];

  const summary = {
    id: primary.id,
    name: detail.displayName?.text || primary.displayName?.text || payload.name,
    address: detail.formattedAddress || primary.formattedAddress || buildPlacesQuery(payload),
    primaryType: detail.primaryTypeDisplayName?.text || primary.primaryTypeDisplayName?.text || '',
    rating: detail.rating || primary.rating || null,
    reviewCount: detail.userRatingCount || primary.userRatingCount || null,
    phone: detail.internationalPhoneNumber || primary.internationalPhoneNumber || '',
    website: detail.websiteUri || primary.websiteUri || '',
    reviews: reviewItems,
  };

  const competitors = normalizeCompetitors(summary, places.slice(1, 4));
  const externalInsights = await fetchExternalInsights(summary.name, payload.city);

  return {
    generatedAt: new Date().toISOString(),
    primary: summary,
    competitors,
    externalInsights,
    sourceQuery: buildPlacesQuery(payload),
  };
}

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(resultJson.textContent);
    copyButton.textContent = '已複製';
    setTimeout(() => (copyButton.textContent = '複製資料'), 2000);
  } catch (error) {
    console.warn('複製失敗：', error);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = buildPayload(formData);

  if (!payload.city || !payload.route || !payload.number || !payload.name) {
    showResult({
      payload,
      message: '請確認四個欄位都已填寫完整，再試一次。',
      report: null,
      webhookSuccess: false,
      webhookAttempted: false,
    });
    return;
  }

  setLoading(true);
  clearReport();
  resultMessage.textContent = '正在分析，請稍候…';
  resultSection.hidden = false;
  resultJson.textContent = JSON.stringify({ payload }, null, 2);
  updateWebhookStatus({ attempted: false, success: false });

  const webhookPromise = liffReady && cachedUserId ? postToN8n(payload, cachedUserId) : Promise.resolve(false);
  const diagnosisPromise = generateDiagnosis(payload);

  const [webhookResult, diagnosisResult] = await Promise.allSettled([webhookPromise, diagnosisPromise]);

  const webhookSuccess = webhookResult.status === 'fulfilled' ? webhookResult.value : false;
  const webhookAttempted = liffReady && Boolean(cachedUserId);
  const diagnosis = diagnosisResult.status === 'fulfilled' ? diagnosisResult.value : null;
  const diagnosisError = diagnosisResult.status === 'rejected' ? diagnosisResult.reason : null;

  if (diagnosisError) {
    showResult({
      payload,
      message: `鉤子報告生成失敗：${diagnosisError.message || diagnosisError}`,
      report: null,
      webhookSuccess,
      webhookAttempted,
    });
  } else {
    let baseMessage;
    if (webhookSuccess) {
      baseMessage = '資料已送出，我們會在 LINE 視窗推播鉤子報告，此視窗可關閉。';
    } else if (webhookAttempted) {
      baseMessage = '已生成鉤子報告，但目前無法確認 LINE 推播，建議手動複製回貼。';
    } else if (liffReady) {
      baseMessage = '已生成鉤子報告；目前無法取得 LINE 使用者 ID，請複製下列內容貼回 LINE 或重新授權 LIFF。';
    } else {
      baseMessage = '已生成鉤子報告，下方提供完整摘要與原始資料。';
    }

    showResult({
      payload,
      message: baseMessage,
      report: diagnosis,
      webhookSuccess,
      webhookAttempted,
    });
  }

  if (webhookSuccess && liffReady && liffInClient && liff.closeWindow) {
    setTimeout(() => liff.closeWindow(), 1800);
  }

  setLoading(false);
});

initLiff();
