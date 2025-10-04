const params = new URLSearchParams(window.location.search);
const config = window.STAR_ENGINE_CONFIG || {};

const endpoints = {
  lead: config.webhookUrl,
  quiz: config.quizUrl || config.webhookUrl,
  analysisStatus: config.analysisStatusUrl || `${config.webhookUrl}/status`,
  weeklyDraft: config.weeklyDraftUrl || '',
};

const reportUrl = config.reportUrl || config.report_url || '';
const formUrl = config.formUrl || config.form_url || window.location.href;
const trialUrl = config.trialUrl || 'https://line.me/ti/p/@star-up';
const planUrl = config.checkoutPrimaryUrl || config.checkout_primary_url || '#';
const sampleReportUrl = config.sampleReportUrl || 'https://app.mdzh.io/samples/report-v1.html';

const STAGES = ['s0', 's1', 's2', 's3', 's4', 's5'];
const PROGRESS_TICKS = [
  { percent: 45, label: '資料收集中… 進度 45%', eta: '最近 7 天評論載入中' },
  { percent: 60, label: '正在比對競品差距… 進度 60%', eta: '附近競品完成定位' },
  { percent: 75, label: '生成專屬草稿… 進度 75%', eta: 'AI 正撰寫回覆草稿與建議' }
];
const PROGRESS_TIMEOUT_MS = 75 * 1000;
const TRANSITION_DURATION_MS = 3000;
const POLL_INTERVAL_MS = 5000;
const MAX_TONE_SELECTION = 2;
const NINETY_HINT_DELAY_MS = 15_000;
const PROGRESS_FAKE_LIMIT = PROGRESS_TICKS[0].percent;

const els = {
  stages: {
    s0: document.getElementById('stage-s0'),
    s1: document.getElementById('stage-s1'),
    s2: document.getElementById('stage-s2'),
    s3: document.getElementById('stage-s3'),
    s4: document.getElementById('stage-s4'),
    s5: document.getElementById('stage-s5'),
  },
  leadForm: document.getElementById('lead-form'),
  submitBtn: document.getElementById('submit-btn'),
  quizForm: document.getElementById('quiz-form'),
  quizSubmit: document.getElementById('quiz-submit'),
  quizSkip: document.getElementById('quiz-skip'),
  quizError: document.getElementById('quiz-error'),
  quizCompetitors: document.getElementById('quiz-competitors'),
  summaryGoal: document.getElementById('summary-goal'),
  summaryTone: document.getElementById('summary-tone'),
  summaryCompetitors: document.getElementById('summary-competitors'),
  summaryConfirm: document.getElementById('summary-confirm'),
  progressBarS2: document.getElementById('progress-bar'),
  progressLabelS2: document.getElementById('progress-label'),
  progressEtaS2: document.getElementById('progress-eta'),
  progressBarS3: document.getElementById('progress-bar-s3'),
  progressLabelS3: document.getElementById('progress-label-s3'),
  progressEtaS3: document.getElementById('progress-eta-s3'),
  resultRadarList: document.getElementById('result-radar-list'),
  resultActionsList: document.getElementById('result-actions-list'),
  resultDraftsList: document.getElementById('result-drafts-list'),
  ctaTrial: document.getElementById('cta-trial'),
  ctaPlan: document.getElementById('cta-plan'),
  returnHome: document.getElementById('return-home'),
  timeoutSample: document.getElementById('timeout-sample'),
  timeoutWeekly: document.getElementById('timeout-weekly'),
  timeoutBack: document.getElementById('timeout-back'),
  copyActions: document.getElementById('copy-actions'),
  toast: document.getElementById('toast'),
  transitionBar: document.getElementById('transition-bar'),
  transitionCounter: document.getElementById('transition-counter'),
  aboutLink: document.getElementById('about-link'),
};

const state = {
  stage: 's0',
  liffReady: false,
  userId: '',
  leadId: '',
  leadPayload: null,
  quiz: {
    goal: '',
    tone: [],
    competitorsInput: [],
  },
  progress: {
    startAt: 0,
    percent: 0,
    frontPercent: 0,
    tickerIndex: 0,
    timerId: null,
    pollId: null,
    messageId: null,
    timeoutFired: false,
    ninetyReachedAt: 0,
    lastStage: '',
  },
  transition: {
    countdownId: null,
    timeoutId: null,
  },
  report: null,
  mode: params.get('view') === 'report' ? 'report' : 'form',
};

function generateLeadId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `se_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${rand}`;
}

function showToast(message, duration = 2600) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.hidden = false;
  setTimeout(() => {
    els.toast.hidden = true;
  }, duration);
}

function openAboutPage() {
  const fallbackUrl = 'about.html';
  if (state.liffReady && config.aboutUrl && window.liff?.openWindow) {
    window.liff.openWindow({ url: config.aboutUrl, external: false });
    return;
  }
  window.open(fallbackUrl, '_blank');
}

function setStage(nextStage) {
  state.stage = nextStage;
  STAGES.forEach((stage) => {
    if (!els.stages[stage]) return;
    const isActive = stage === nextStage;
    els.stages[stage].hidden = !isActive;
    if (isActive) {
      els.stages[stage].classList.add('stage--active');
    } else {
      els.stages[stage].classList.remove('stage--active');
    }
  });
}

function updateProgressUI(percent, etaSeconds, stageLabel = '') {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  if (safePercent >= 90 && !state.progress.ninetyReachedAt) {
    state.progress.ninetyReachedAt = Date.now();
  }

  const elapsedSinceNinety = state.progress.ninetyReachedAt
    ? Date.now() - state.progress.ninetyReachedAt
    : 0;
  const showAlmostDone = safePercent >= 90 && elapsedSinceNinety >= NINETY_HINT_DELAY_MS;

  let label = stageLabel || `資料收集中… 進度 ${safePercent}%`;
  if (showAlmostDone) {
    label = '快完成… 智能體正在整理結果';
  }

  if (els.progressBarS2) {
    els.progressBarS2.style.width = `${safePercent}%`;
  }
  if (els.progressBarS3) {
    els.progressBarS3.style.width = `${safePercent}%`;
  }
  if (els.progressLabelS2) {
    els.progressLabelS2.textContent = label;
  }
  if (els.progressLabelS3) {
    els.progressLabelS3.textContent = label;
  }

  let etaLabel = '預估完成時間 60 秒內';
  if (showAlmostDone) {
    etaLabel = '快完成… 正在合併專屬草稿';
  } else if (etaSeconds != null) {
    etaLabel = `預估完成 ${Math.max(0, Math.round(etaSeconds))} 秒`;
  }
  if (els.progressEtaS2) {
    els.progressEtaS2.textContent = etaLabel;
  }
  if (els.progressEtaS3) {
    els.progressEtaS3.textContent = etaLabel;
  }

  state.progress.percent = safePercent;
}

function animateFrontProgress(targetPercent, duration = TRANSITION_DURATION_MS) {
  const isStillInFakeZone = state.progress.percent < PROGRESS_FAKE_LIMIT;
  const effectiveTarget = isStillInFakeZone
    ? Math.min(targetPercent, PROGRESS_FAKE_LIMIT)
    : targetPercent;

  const startPercent = state.progress.frontPercent || 0;
  const start = performance.now();
  state.progress.frontPercent = Math.max(state.progress.frontPercent, startPercent);

  const step = (now) => {
    const elapsed = now - start;
    const ratio = Math.min(1, elapsed / duration);
    const current = startPercent + (effectiveTarget - startPercent) * ratio;
    if (current > state.progress.percent) {
      updateProgressUI(current);
    }
    if (ratio < 1 && state.stage !== 's4' && state.stage !== 's5') {
      requestAnimationFrame(step);
    } else {
      state.progress.frontPercent = Math.max(state.progress.frontPercent, effectiveTarget);
    }
  };

  requestAnimationFrame(step);
}

function startMessageTicker() {
  if (state.progress.messageId) {
    clearInterval(state.progress.messageId);
  }
  state.progress.tickerIndex = 0;
  state.progress.messageId = setInterval(() => {
    if (state.stage !== 's2' && state.stage !== 's3') return;
    const step = PROGRESS_TICKS[state.progress.tickerIndex % PROGRESS_TICKS.length];
    const target = step.percent;
    if (target > state.progress.percent) {
      updateProgressUI(target, null, step.label);
    } else if (step.label && els.progressLabelS2) {
      els.progressLabelS2.textContent = step.label;
      if (els.progressLabelS3) {
        els.progressLabelS3.textContent = step.label;
      }
    }
    if (step.eta && els.progressEtaS2) {
      els.progressEtaS2.textContent = step.eta;
    }
    state.progress.tickerIndex += 1;
  }, 10_000);
}

function stopProgressTimers() {
  if (state.progress.timerId) {
    clearTimeout(state.progress.timerId);
    state.progress.timerId = null;
  }
  if (state.progress.pollId) {
    clearInterval(state.progress.pollId);
    state.progress.pollId = null;
  }
  if (state.progress.messageId) {
    clearInterval(state.progress.messageId);
    state.progress.messageId = null;
  }
  if (state.transition.countdownId) {
    clearInterval(state.transition.countdownId);
    state.transition.countdownId = null;
  }
  if (state.transition.timeoutId) {
    clearTimeout(state.transition.timeoutId);
    state.transition.timeoutId = null;
  }
}

async function initLiff() {
  const liffId = config.formLiffId || config.liffId || '';
  if (!window.liff || !liffId) return;

  try {
    await liff.init({ liffId });
    await liff.ready;
    if (!liff.isLoggedIn()) {
      liff.login({ scope: ['profile', 'openid'] });
      return;
    }
    state.liffReady = true;
    state.userId = await liff.getProfile().then((profile) => profile?.userId || '')
      .catch(() => liff.getContext?.()?.userId || '') || '';
  } catch (error) {
    console.warn('[LIFF] init failed', error);
  }
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || response.statusText);
  }

  if (contentType.includes('application/json')) {
    try {
      return text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error('回應格式錯誤');
    }
  }

  // 部分 Webhook 以純文字 ok 回應
  const trimmed = (text || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'ok') {
    return { ok: true };
  }

  return { ok: true, message: text };
}

async function handleLeadSubmit(event) {
  event.preventDefault();
  if (!els.leadForm?.reportValidity?.()) return;

  const formData = new FormData(els.leadForm);
  const placeInput = {
    city: (formData.get('city') || '').trim(),
    route: (formData.get('route') || '').trim(),
    number: (formData.get('number') || '').trim(),
    name: (formData.get('name') || '').trim(),
  };

  if (!placeInput.city || !placeInput.route || !placeInput.number || !placeInput.name) {
    showToast('請完整填寫四個欄位');
    return;
  }

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = '送出中…';

  try {
    const leadId = generateLeadId();
    const payload = {
      lead_id: leadId,
      source: 'liff-web',
      line_user_id: state.userId || '',
      submitted_at: new Date().toISOString(),
      quiz: {
        goal: 'instant_lowstar',
        tone: [],
        competitors_input: [],
        competitors_auto: [],
      },
      place: {
        city: placeInput.city,
        road: placeInput.route,
        addr_no: placeInput.number,
        name: placeInput.name,
      },
    };
    const result = await requestJSON(endpoints.lead, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    state.leadId = result.lead_id || payload.lead_id;
    state.leadPayload = payload.place;
    state.quiz = { goal: '', tone: [], competitorsInput: [], skipped: false };
    state.progress.startAt = Date.now();
    state.progress.frontPercent = 0;
    state.progress.timeoutFired = false;
    state.progress.tickerIndex = 0;
    state.progress.ninetyReachedAt = 0;
    state.progress.lastStage = 'collecting';
    animateFrontProgress(PROGRESS_FAKE_LIMIT);
    startMessageTicker();
    setStage('s1');
    startTransitionToQuiz();
  } catch (error) {
    console.error(error);
    showToast(`送出失敗：${error.message}`);
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = '開始 30 秒初檢';
  }
}

function startTransitionToQuiz() {
  if (state.transition.countdownId) {
    clearInterval(state.transition.countdownId);
    state.transition.countdownId = null;
  }
  if (state.transition.timeoutId) {
    clearTimeout(state.transition.timeoutId);
    state.transition.timeoutId = null;
  }

  if (els.transitionBar) {
    els.transitionBar.style.transition = 'none';
    els.transitionBar.style.width = '0%';
    requestAnimationFrame(() => {
      els.transitionBar.style.transition = 'width 3s ease';
      els.transitionBar.style.width = '100%';
    });
  }

  if (els.transitionCounter) {
    let remaining = 3;
    els.transitionCounter.textContent = remaining;
    state.transition.countdownId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.transition.countdownId);
        state.transition.countdownId = null;
        els.transitionCounter.textContent = '0';
      } else {
        els.transitionCounter.textContent = remaining;
      }
    }, 1000);
  }

  state.transition.timeoutId = setTimeout(() => {
    setStage('s2');
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = '開始 30 秒初檢';
    updateProgressUI(PROGRESS_FAKE_LIMIT, null, PROGRESS_TICKS[0].label);
    if (els.progressEtaS2) {
      els.progressEtaS2.textContent = PROGRESS_TICKS[0].eta;
    }
    startPolling();
  }, TRANSITION_DURATION_MS);
}

function collectQuizValues() {
  const form = els.quizForm;
  if (!form) return null;

  const formData = new FormData(form);
  const goal = formData.get('quiz-goal');
  const tone = formData.getAll('quiz-tone');
  const competitorsRaw = (formData.get('quiz-competitors') || '')
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  return { goal, tone, competitorsInput: competitorsRaw };
}

function validateQuiz(values) {
  if (!values.goal) {
    return '請選擇您最想先解決的目標。';
  }
  if (values.tone.length === 0) {
    return '請至少選擇一個回覆語氣，或使用「稍後再答」。';
  }
  if (values.tone.length > MAX_TONE_SELECTION) {
    return '回覆語氣最多選擇 2 項。';
  }
  return '';
}

async function handleQuizSubmit(event) {
  event.preventDefault();
  const values = collectQuizValues();
  if (!values) return;
  const error = validateQuiz(values);
  if (error) {
    els.quizError.textContent = error;
    els.quizError.hidden = false;
    return;
  }
  els.quizError.hidden = true;
  await submitQuiz(values);
}

async function handleQuizSkip() {
  const fallback = {
    goal: state.quiz.goal || 'instant_lowstar',
    tone: ['direct_fix', 'soothing'],
    competitorsInput: [],
  };
  await submitQuiz(fallback, true);
}

async function submitQuiz(values, skipped = false) {
  if (!state.leadId) {
    showToast('尚未建立 Lead，請重新填寫。');
    resetFlow();
    return;
  }

  state.quiz = { ...values, skipped };
  els.quizSubmit.disabled = true;
  els.quizSkip.disabled = true;
  els.quizSubmit.textContent = skipped ? '使用預設語氣…' : '送出設定…';

  try {
    await requestJSON(endpoints.quiz, {
      method: 'POST',
      body: JSON.stringify({
        lead_id: state.leadId,
        quiz: {
          goal: values.goal,
          tone: values.tone,
          competitors_input: values.competitorsInput,
          skipped,
        },
        intent: 'quiz',
      }),
    });

    updateSummary(values, skipped);
    setStage('s3');
    animateFrontProgress(Math.max(30, state.progress.frontPercent));
  } catch (error) {
    console.error(error);
    showToast(`儲存設定失敗：${error.message}`);
  } finally {
    els.quizSubmit.disabled = false;
    els.quizSkip.disabled = false;
    els.quizSubmit.textContent = '完成設定';
  }
}

function updateSummary(values, skipped) {
  const goalMap = {
    instant_lowstar: '立即掌握 1–3★ 低星',
    save_time: '省時，一鍵回覆草稿',
    beat_competitors: '看我與附近對手差距',
    weekly_focus: '幫我列出本週三件事',
  };
  const toneMap = {
    soothing: '溫和安撫',
    direct_fix: '直接解決',
    authority: '專業權威',
    apology: '道歉＋補救',
  };

  els.summaryGoal.textContent = goalMap[values.goal] || values.goal || '—';
  els.summaryTone.textContent = values.tone.length
    ? values.tone.map((key) => toneMap[key] || key).join('、')
    : '預設：直接解決＋溫和安撫';
  els.summaryCompetitors.textContent = values.competitorsInput.length
    ? values.competitorsInput.join('、')
    : skipped ? '系統自動挑選中…（預設）' : '系統自動挑選中…';
}

function acknowledgeSummary() {
  showToast('設定已鎖定，稍待即可收到完整報告。', 2000);
  // Prevent double submission
  els.summaryConfirm.disabled = true;
  els.summaryConfirm.textContent = '已確認';
}

function startPolling() {
  if (!state.leadId || !endpoints.analysisStatus) return;
  if (state.progress.pollId) {
    clearInterval(state.progress.pollId);
  }
  state.progress.ninetyReachedAt = 0;
  state.progress.lastStage = '';
  state.progress.timeoutFired = false;
  const poll = async () => {
    try {
      const url = new URL(endpoints.analysisStatus);
      url.searchParams.set('lead_id', state.leadId);
      const result = await requestJSON(url.toString(), { method: 'GET' });
      handleStatusResponse(result);
    } catch (error) {
      console.warn('[analysis-status]', error.message);
    }
  };
  poll();
  state.progress.pollId = setInterval(poll, POLL_INTERVAL_MS);

  if (state.progress.timerId) {
    clearTimeout(state.progress.timerId);
  }
  state.progress.timerId = setTimeout(() => {
    if (state.stage !== 's4' && !state.progress.timeoutFired) {
      triggerTimeout();
    }
  }, PROGRESS_TIMEOUT_MS);
}

function handleStatusResponse(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (!state.leadId || payload.lead_id !== state.leadId) return;

  const stage = (payload.stage || '').toLowerCase();
  const percent = typeof payload.percent === 'number' ? payload.percent : state.progress.percent;
  const etaSeconds = typeof payload.eta_seconds === 'number' ? payload.eta_seconds : null;
  const stageHints = {
    collecting: '正在定位您的門市與商圈…',
    processing: '正在抓取 DataForSEO 與附近競品…',
    analyzing: '正在生成差距雷達與回覆草稿…',
    scheduled: '資料量較大，已排程推送完成結果',
    timeout: '資料量較大，已排程推送完成結果',
    ready: '分析完成！正在回傳結果…',
  };

  if (stage === 'collecting' && state.stage === 's1') {
    setStage('s2');
  }

  if (typeof percent === 'number') {
    const mergedPercent = Math.max(state.progress.frontPercent, percent);
    updateProgressUI(mergedPercent, etaSeconds, stageHints[stage]);
    state.progress.frontPercent = Math.max(state.progress.frontPercent, mergedPercent);
  }

  if (payload.report) {
    state.report = payload.report;
  }

  state.progress.lastStage = stage;

  if (stage === 'processing' && state.progress.frontPercent < 55) {
    animateFrontProgress(55, 2000);
  }

  if (stage === 'analyzing' && state.progress.frontPercent < 85) {
    animateFrontProgress(85, 2000);
  }

  if (stage === 'ready') {
    stopProgressTimers();
    updateProgressUI(100, 0, stageHints.ready);
    renderAnalysisReport();
  } else if (stage === 'scheduled' || stage === 'timeout') {
    triggerTimeout();
  } else if (stage === 'failed') {
    showToast('分析失敗，請稍後再試或聯絡支援。');
    triggerTimeout();
  }
}

function buildListItems(target, items = [], formatter) {
  if (!target) return;
  target.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = '資料準備中，稍後自動更新。';
    li.className = 'muted';
    target.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = formatter ? formatter(item) : String(item);
    target.appendChild(li);
  });
}

function renderAnalysisReport() {
  if (!state.report) {
    showToast('尚未取得報告內容，請稍後再試。');
    return;
  }

  const {
    goal_label: goalLabel,
    tone_label: toneLabel,
    competitors_auto: competitorsAuto = [],
    competitors_selected: competitorsSelected = [],
    weekly_actions: weeklyActions = [],
    reply_drafts: replyDrafts = [],
  } = state.report;

  const combinedCompetitors = competitorsSelected.concat(competitorsAuto);
  buildListItems(els.resultRadarList, combinedCompetitors.slice(0, 5), (item) => {
    const name = item.name || '未命名店家';
    const rating = typeof item.rating === 'number' ? `${item.rating.toFixed(1)} ★` : '— ★';
    const reviews = item.reviews_total != null ? `${item.reviews_total} 則` : '評論數不足';
    const distance = item.distance_m != null ? `${Math.round(item.distance_m)} 公尺` : '距離未知';
    return `${name}｜${rating}｜${reviews}｜${distance}`;
  });

  buildListItems(els.resultActionsList, weeklyActions.slice(0, 3));

  if (els.resultDraftsList) {
    els.resultDraftsList.innerHTML = '';
    if (!replyDrafts.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '草稿準備中，稍後會自動推送至 LINE。';
      els.resultDraftsList.appendChild(empty);
    } else {
      replyDrafts.slice(0, 3).forEach((draft, index) => {
        const card = document.createElement('div');
        card.className = 'draft-item';
        const title = document.createElement('strong');
        title.textContent = `草稿 #${index + 1}`;
        const body = document.createElement('p');
        body.textContent = draft.text || draft;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--ghost';
        btn.textContent = '複製草稿';
        btn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(draft.text || draft);
            showToast('已複製草稿', 1800);
          } catch (error) {
            showToast('複製失敗，請手動複製');
          }
        });
        card.append(title, body, btn);
        els.resultDraftsList.appendChild(card);
      });
    }
  }

  if (els.copyActions) {
    els.copyActions.onclick = async () => {
      const content = weeklyActions.join('\n• ');
      if (!content) {
        showToast('尚無可複製的任務');
        return;
      }
      try {
        await navigator.clipboard.writeText(`• ${content}`);
        showToast('已複製本週三件事', 1800);
      } catch (error) {
        showToast('複製失敗，請手動複製');
      }
    };
  }

  if (els.summaryGoal) {
    els.summaryGoal.textContent = goalLabel || els.summaryGoal.textContent;
  }
  if (els.summaryTone) {
    els.summaryTone.textContent = toneLabel || els.summaryTone.textContent;
  }

  if (els.ctaTrial) {
    els.ctaTrial.href = trialUrl;
  }
  if (els.ctaPlan) {
    els.ctaPlan.href = planUrl || '#';
  }

  setStage('s4');
}

function triggerTimeout() {
  if (state.progress.timeoutFired) return;
  state.progress.timeoutFired = true;
  stopProgressTimers();
  updateProgressUI(Math.max(state.progress.percent || 90, 90), null, '資料量較大，已排程推送完成結果');
  setStage('s5');
}

async function handleWeeklyDraft() {
  if (!endpoints.weeklyDraft) {
    showToast('尚未設定試算服務');
    return;
  }
  if (!state.leadId) {
    showToast('尚未取得 Lead 編號');
    return;
  }
  try {
    await requestJSON(endpoints.weeklyDraft, {
      method: 'POST',
      body: JSON.stringify({
        lead_id: state.leadId,
        mode: 'trial',
        tone: state.quiz.tone.length ? state.quiz.tone : ['direct_fix', 'soothing'],
        goal: state.quiz.goal || 'instant_lowstar',
      }),
    });
    showToast('已推送試算三件事，請查看 LINE。');
  } catch (error) {
    showToast(`推送失敗：${error.message}`);
  }
}

function resetFlow() {
  stopProgressTimers();
  state.stage = 's0';
  state.leadId = '';
  state.leadPayload = null;
  state.quiz = { goal: '', tone: [], competitorsInput: [], skipped: false };
  state.progress = {
    startAt: 0,
    percent: 0,
    frontPercent: 0,
    tickerIndex: 0,
    timerId: null,
    pollId: null,
    messageId: null,
    timeoutFired: false,
    ninetyReachedAt: 0,
    lastStage: '',
  };
  state.report = null;

  if (els.leadForm) {
    els.leadForm.reset();
  }
  if (els.quizForm) {
    els.quizForm.reset();
    els.quizError.hidden = true;
  }
  if (els.summaryConfirm) {
    els.summaryConfirm.disabled = false;
    els.summaryConfirm.textContent = '保持這樣，很好';
  }
  updateProgressUI(0);
  setStage('s0');
}

function redirectToReport() {
  if (!state.report || !reportUrl) return;
  const token = state.report.token || '';
  const target = token
    ? `${reportUrl}${reportUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
    : reportUrl;
  window.location.href = target;
}

function attachEventListeners() {
  els.leadForm?.addEventListener('submit', handleLeadSubmit);
  els.quizForm?.addEventListener('submit', handleQuizSubmit);
  els.quizSkip?.addEventListener('click', handleQuizSkip);
  els.summaryConfirm?.addEventListener('click', acknowledgeSummary);
  els.returnHome?.addEventListener('click', resetFlow);
  els.timeoutBack?.addEventListener('click', resetFlow);
  els.timeoutWeekly?.addEventListener('click', handleWeeklyDraft);
  els.copyActions?.addEventListener('click', (event) => {
    event.preventDefault();
  });
  els.aboutLink?.addEventListener('click', (event) => {
    event.preventDefault();
    openAboutPage();
  });
}

(function bootstrap() {
  const viewMode = params.get('view');
  if (state.mode === 'report') {
    redirectToReport();
    return;
  }

  if (viewMode === 'about') {
    window.location.replace('about.html');
    return;
  }

  if (els.timeoutSample && sampleReportUrl) {
    els.timeoutSample.href = sampleReportUrl;
  }
  if (els.ctaTrial && trialUrl) {
    els.ctaTrial.href = trialUrl;
  }
  if (els.ctaPlan && planUrl) {
    els.ctaPlan.href = planUrl;
  }
  if (els.aboutLink) {
    els.aboutLink.href = 'about.html';
  }

  attachEventListeners();
  resetFlow();
  initLiff();
})();
