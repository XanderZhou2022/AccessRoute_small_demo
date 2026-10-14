const profileLabels = {
  wheelchair: '輪椅・避開樓梯',
  stroller: '嬰兒車・優先無台階',
  elderly: '長者・優先升降機',
  walking: '步行・一般路線',
  heavy_luggage: '重行李・優先無台階',
};
const profileNeeds = {
  wheelchair: ['wheelchair', 'elevator'],
  stroller: ['stroller', 'elevator'],
  elderly: ['elderly', 'elevator'],
  walking: [],
  heavy_luggage: ['heavy', 'elevator'],
};
const profileWalkingSpeeds = {
  walking: 1.3,
  wheelchair: 0.8,
  elderly: 0.7,
  stroller: 0.9,
  heavy_luggage: 0.8,
};
const tripPairs = {
  'cheung-sha-wan-government': {
    origin: '長沙灣政府合署',
  },
  'hysan-place': {
    origin: '希慎廣場',
  },
  'java-road-market': {
    origin: '渣華道市政大廈',
  },
  'kowloon-city-market': {
    origin: '九龍城市政大廈',
  },
  'kowloon-tong-festival-walk': {
    origin: '又一城・九龍塘站天橋',
  },
  'kwai-hing-government': {
    origin: '葵興政府合署',
  },
  'north-point-government': {
    origin: '北角政府合署',
  },
  'pei-ho-market': {
    origin: '北河街市政大廈',
  },
  'popcorn-2': {
    origin: 'PopCorn 2',
  },
  'sha-tin-government': {
    origin: '沙田政府合署',
  },
  'shek-kip-mei-services': {
    origin: '石硤尾邨服務設施大樓',
  },
  'tai-po-market': {
    origin: '大埔墟街市及熟食中心',
  },
};
function getDemoState() {
  try {
    return JSON.parse(localStorage.getItem('accessroute-map-demo') || '{}');
  } catch {
    return {};
  }
}
function setDemoState(patch) {
  const next = { ...getDemoState(), ...patch };
  localStorage.setItem('accessroute-map-demo', JSON.stringify(next));
  syncMapFrame(next);
  return next;
}
async function sendSessionCommand(command) {
  const state = getDemoState();
  if (!state.sessionId) return null;
  const operationId = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`/api/sessions/${encodeURIComponent(state.sessionId)}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId,
        expectedRevision: Number.isInteger(state.sessionRevision) ? state.sessionRevision : 1,
        command,
      }),
    });
    const result = await response.json().catch(() => null);
    if (response.status === 409 && result?.session && attempt === 0) {
      setDemoState({ sessionRevision: result.session.revision });
      continue;
    }
    if (!response.ok)
      throw new Error(result?.error || `配對行程更新失敗（HTTP ${response.status}）`);
    setDemoState({ sessionRevision: result.session.revision });
    return result.session;
  }
  throw new Error('配對行程更新衝突，請重新連線後再試。');
}
async function createPairedSession(routeResult) {
  const state = getDemoState();
  const trip = selectedTrip(state);
  const createResponse = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originSceneId: trip.originKey,
      destinationSceneId: trip.destinationKey,
      profile: state.profile || 'wheelchair',
      weather: state.weather || 'sunny',
    }),
  });
  const created = await createResponse.json().catch(() => null);
  if (!createResponse.ok) throw new Error(created?.error || '無法建立配對行程');
  setDemoState({ sessionId: created.id, sessionRevision: created.revision });
  let current = await sendSessionCommand({
    type: 'set_preferences',
    profile: state.profile || 'wheelchair',
    objective:
      state.route === 'short' ? 'shortest' : state.weather === 'heat' ? 'indoor' : 'sheltered',
  });
  current = await sendSessionCommand({
    type: 'plan',
    steps: routeResult.steps.map((item) => ({
      title: item.title,
      detail: item.detail,
      distanceM: item.distanceM,
      sceneId: item.sceneId,
      ...(item.levelId ? { levelId: item.levelId } : {}),
      ...(item.fromNodeId ? { fromNodeId: item.fromNodeId } : {}),
      ...(item.toNodeId ? { toNodeId: item.toNodeId } : {}),
    })),
  });
  current = await sendSessionCommand({ type: 'start' });
  setDemoState({ sessionId: created.id, sessionRevision: current.revision });
  return current;
}
function syncMapFrame(state = getDemoState()) {
  const frame = document.querySelector('[data-map-frame]');
  if (!frame) return;
  const trip = selectedTrip(state);
  const route = state.route || 'sheltered';
  const profile = state.profile || 'wheelchair';
  const weather = state.weather || 'sunny';
  const preferences = state.preferences || {};
  const needs = Array.isArray(preferences.needs) ? preferences.needs : [];
  const slope = { gentle: '0.05', moderate: '0.0833', any: '0.12' }[preferences.slope] || '0.0833';
  const needsElevator = needs.includes('elevator');
  const stepFreeProfile = ['wheelchair', 'stroller', 'heavy_luggage'].includes(profile);
  const allowStairs =
    !stepFreeProfile && !needsElevator && (needs.includes('stairs') || profile === 'walking');
  const allowEscalators =
    !stepFreeProfile && !needsElevator && (needs.includes('escalators') || profile === 'walking');
  const avoidLifts = needs.includes('avoid_lifts');
  const pace = preferences.pace || 'auto';
  const walkingSpeed = pace === 'auto' ? profileWalkingSpeeds[profile] || 0.8 : Number(pace);
  const viewSceneId = tripPairs[state.mapSceneId] ? state.mapSceneId : trip.originKey;
  const mapView = state.mapView === 'floor' ? 'floor' : 'macro';
  const mapLevel = typeof state.mapLevel === 'string' ? state.mapLevel : '';
  const closedFacilities = (state.facilityEvents || [])
    .filter((entry) => entry.sceneId === viewSceneId && entry.event.status === 'active')
    .map((entry) => entry.event.target.facilityId)
    .filter(Boolean)
    .sort();
  const signature = `${route}:${profile}:${weather}:${slope}:${allowStairs}:${allowEscalators}:${avoidLifts}:${walkingSpeed}:${closedFacilities.join(',')}:${trip.originKey}:${trip.destinationKey}:${viewSceneId}:${mapView}:${mapLevel}`;
  if (frame.dataset.mapState === signature) return;
  frame.dataset.mapState = signature;
  const query = new URLSearchParams({
    mapOnly: '1',
    route,
    profile,
    weather,
    stairs: String(allowStairs),
    escalators: String(allowEscalators),
    avoidLifts: String(avoidLifts),
    slope,
    speed: String(walkingSpeed),
    origin: trip.originKey,
    destination: trip.destinationKey,
    view: viewSceneId,
    mapView,
    level: mapLevel,
  });
  closedFacilities.forEach((facilityId) => query.append('closedFacility', facilityId));
  frame.src = `../?${query.toString()}`;
}
function updateStatus(message) {
  const status = document.querySelector('[data-status]');
  if (status) status.textContent = message;
}
function bindSpeechToTextarea({
  button,
  textarea,
  statusNode,
  listeningText,
  readyText,
  unsupportedText,
  labelIdle = '開始語音輸入',
  labelListening = '停止語音輸入',
}) {
  if (!(button instanceof HTMLButtonElement) || !(textarea instanceof HTMLTextAreaElement)) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    button.disabled = true;
    if (statusNode) statusNode.textContent = unsupportedText;
    return;
  }
  let recognition = null;
  button.addEventListener('click', () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = 'zh-HK';
    recognition.interimResults = true;
    recognition.continuous = false;
    button.textContent = labelListening;
    button.setAttribute('aria-pressed', 'true');
    if (statusNode) statusNode.textContent = listeningText;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');
      textarea.value = transcript;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognition.onerror = (event) => {
      if (statusNode)
        statusNode.textContent =
          event.error === 'not-allowed'
            ? '瀏覽器未允許麥克風；請在網站權限中允許麥克風，或直接輸入文字。'
            : event.error === 'no-speech'
              ? '未聽到語音；請再試一次，或直接輸入文字。'
              : `語音輸入失敗（${event.error}）；請重試或直接輸入文字。`;
    };
    recognition.onend = () => {
      recognition = null;
      button.textContent = labelIdle;
      button.removeAttribute('aria-pressed');
      if (statusNode && textarea.value.trim()) statusNode.textContent = readyText;
    };
    try {
      recognition.start();
    } catch {
      recognition = null;
      button.textContent = labelIdle;
      button.removeAttribute('aria-pressed');
      if (statusNode) statusNode.textContent = '無法啟動麥克風；請改用文字輸入。';
    }
  });
}
function initializeMapViewSync() {
  const frame = document.querySelector('[data-map-frame]');
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (
      event.origin !== window.location.origin ||
      !frame ||
      event.source !== frame.contentWindow ||
      message?.type !== 'accessroute-map-view-change' ||
      !['macro', 'floor'].includes(message.mapView) ||
      typeof message.level !== 'string'
    )
      return;
    const state = getDemoState();
    if (state.mapView === message.mapView && state.mapLevel === message.level) return;
    setDemoState({ mapView: message.mapView, mapLevel: message.level });
  });
}
function enableEscapeToClose(dialog) {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !dialog.open) return;
      event.preventDefault();
      dialog.close();
    },
    true,
  );
}
function currentProfile() {
  return profileLabels[getDemoState().profile] || profileLabels.wheelchair;
}
function selectedTrip(state = getDemoState()) {
  const originKey =
    state.originKey ||
    Object.keys(tripPairs).find((key) => tripPairs[key].origin === state.origin) ||
    'popcorn-2';
  const destinationKey =
    tripPairs[state.destinationKey] && state.destinationKey !== originKey
      ? state.destinationKey
      : originKey === 'popcorn-2'
        ? 'kowloon-tong-festival-walk'
        : Object.keys(tripPairs).find((key) => key !== originKey);
  return {
    originKey,
    destinationKey,
    origin: tripPairs[originKey].origin,
    destination: tripPairs[destinationKey].origin,
  };
}
function setTrip(originKey, destinationKey) {
  const origin = tripPairs[originKey];
  const destination = tripPairs[destinationKey];
  if (!origin || !destination || originKey === destinationKey) return null;
  const next = setDemoState({
    originKey,
    destinationKey,
    origin: origin.origin,
    destination: destination.origin,
    mapSceneId: originKey,
    step: 0,
    navigationSteps: [],
    navigationRouteStatus: null,
    sessionId: null,
    sessionRevision: null,
  });
  window.dispatchEvent(new Event('accessroute-trip-updated'));
  return next;
}
function initializeSearch() {
  const dialog = document.querySelector('[data-search-dialog]');
  const form = document.querySelector('[data-search-form]');
  const origin = document.querySelector('[data-search-origin]');
  const destination = document.querySelector('[data-search-destination]');
  const state = getDemoState();
  const trip = selectedTrip(state);
  if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement)) return;
  enableEscapeToClose(dialog);
  const error = document.querySelector('[data-search-error]');
  const voiceButton = document.querySelector('[data-search-voice]');
  const voiceStatus = document.querySelector('[data-search-voice-status]');
  const clearSearchError = () => {
    if (error) error.textContent = '';
    origin?.removeAttribute('aria-invalid');
    destination?.removeAttribute('aria-invalid');
  };
  if (origin instanceof HTMLSelectElement) origin.value = trip.originKey;
  if (destination instanceof HTMLSelectElement) destination.value = trip.destinationKey;
  origin?.addEventListener('change', clearSearchError);
  destination?.addEventListener('change', clearSearchError);

  voiceButton?.addEventListener('click', () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (voiceStatus)
        voiceStatus.textContent = '此瀏覽器不支援語音辨識；請使用上方出發地和目的地選單。';
      return;
    }

    if (!(origin instanceof HTMLSelectElement) || !(destination instanceof HTMLSelectElement))
      return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-HK';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    if (voiceButton instanceof HTMLButtonElement) voiceButton.disabled = true;
    if (voiceStatus)
      voiceStatus.textContent = '請說出出發地和目的地，例如「由 PopCorn 2 到又一城」。';
    recognition.onresult = async (event) => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '');
      if (!transcript) {
        if (voiceStatus) voiceStatus.textContent = '未能辨認語音；請再試一次。';
        return;
      }
      if (voiceStatus) voiceStatus.textContent = `正在讓 Qwen 辨認「${transcript}」中的地點…`;
      try {
        const response = await fetch('/api/genai/location-resolution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            transcript,
            locations: Array.from(origin.options).map((option) => ({
              id: option.value,
              name: option.textContent || option.value,
            })),
          }),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(result?.error || `Qwen 服務暫時無法使用（HTTP ${response.status}）`);
        const hasOrigin = [...origin.options].some((option) => option.value === result?.origin_id);
        const hasDestination = [...destination.options].some(
          (option) => option.value === result?.destination_id,
        );
        if (result?.status !== 'ready' || !hasOrigin || !hasDestination) {
          if (voiceStatus)
            voiceStatus.textContent =
              result?.message || 'Qwen 未能可靠辨認地點；請用選單選擇或再試一次。';
          return;
        }
        origin.value = result.origin_id;
        destination.value = result.destination_id;
        if (voiceStatus)
          voiceStatus.textContent = `${result.message} 請核對出發地和目的地，再按套用。`;
      } catch (error) {
        if (voiceStatus)
          voiceStatus.textContent = `Qwen 地點辨認失敗：${error instanceof Error ? error.message : String(error)}。請用選單選擇或再試一次。`;
      }
    };
    recognition.onerror = (event) => {
      const message =
        event.error === 'not-allowed'
          ? '未獲麥克風授權；請允許使用麥克風，或改用選單。'
          : event.error === 'no-speech'
            ? '未聽到語音；請再試一次，或改用選單。'
            : '語音辨識未能完成；請改用選單。';
      if (voiceStatus) voiceStatus.textContent = message;
    };
    recognition.onend = () => {
      if (voiceButton instanceof HTMLButtonElement) voiceButton.disabled = false;
    };
    try {
      recognition.start();
    } catch {
      if (voiceStatus) voiceStatus.textContent = '無法啟動麥克風；請改用選單。';
      if (voiceButton instanceof HTMLButtonElement) voiceButton.disabled = false;
    }
  });

  document.querySelector('[data-search-open]')?.addEventListener('click', () => {
    const selected = selectedTrip();
    if (origin instanceof HTMLSelectElement) origin.value = selected.originKey;
    if (destination instanceof HTMLSelectElement) destination.value = selected.destinationKey;
    clearSearchError();
    dialog.showModal();
  });
  document.querySelector('[data-search-cancel]')?.addEventListener('click', () => {
    clearSearchError();
    dialog.close();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const originKey = origin instanceof HTMLSelectElement ? origin.value : trip.originKey;
    const destinationKey =
      destination instanceof HTMLSelectElement ? destination.value : trip.destinationKey;
    if (originKey === destinationKey) {
      if (error) error.textContent = '出發地和目的地相同，請選擇另一個目的地。';
      destination?.setAttribute('aria-invalid', 'true');
      if (destination instanceof HTMLSelectElement) destination.focus();
      return;
    }
    const next = setTrip(originKey, destinationKey);
    if (!next) {
      if (error) error.textContent = '無法套用地點，請重新選擇出發地和目的地。';
      origin?.setAttribute('aria-invalid', 'true');
      destination?.setAttribute('aria-invalid', 'true');
      if (origin instanceof HTMLSelectElement) origin.focus();
      return;
    }
    document.querySelectorAll('[data-origin-summary]').forEach((node) => {
      node.textContent = next.origin;
    });
    document.querySelectorAll('[data-destination-summary]').forEach((node) => {
      node.textContent = next.destination;
    });
    clearSearchError();
    dialog.close();
  });
}

function initializeAccessibilitySettings() {
  const trigger = document.querySelector('[data-accessibility-open]');
  if (!(trigger instanceof HTMLButtonElement)) return;
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('accessroute-accessibility') || '{}');
    } catch {
      return {};
    }
  })();
  const panel = document.createElement('section');
  panel.id = 'accessibility-panel';
  panel.className = 'accessibility-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', '顯示與操作設定');
  panel.innerHTML = `
    <h2>顯示與操作</h2>
    <p>設定會保存在這部裝置。</p>
    <label><input type="checkbox" data-a11y-setting="largeText"> 大字</label>
    <label><input type="checkbox" data-a11y-setting="highContrast"> 高對比</label>
    <label><input type="checkbox" data-a11y-setting="reducedMotion"> 減少動畫</label>
    <label><input type="checkbox" data-a11y-setting="largeTargets"> 放大按鈕</label>
    <label><input type="checkbox" data-a11y-setting="textOnly"> 文字導航模式</label>
    <p class="accessibility-status" data-a11y-status role="status" aria-live="polite"></p>
  `;
  document.querySelector('.screen')?.append(panel);
  const settings = {
    largeText: Boolean(saved.largeText),
    highContrast: Boolean(saved.highContrast),
    reducedMotion: Boolean(saved.reducedMotion),
    largeTargets: Boolean(saved.largeTargets),
    textOnly: Boolean(saved.textOnly),
  };
  const classNames = {
    largeText: 'large-text',
    highContrast: 'high-contrast',
    reducedMotion: 'reduced-motion',
    largeTargets: 'large-targets',
    textOnly: 'textOnly',
  };
  const apply = () => {
    Object.entries(settings).forEach(([key, value]) => {
      document.documentElement.classList.toggle(`accessibility-${classNames[key]}`, value);
      const input = panel.querySelector(`[data-a11y-setting="${key}"]`);
      if (input instanceof HTMLInputElement) input.checked = value;
    });
    localStorage.setItem('accessroute-accessibility', JSON.stringify(settings));
  };
  const status = panel.querySelector('[data-a11y-status]');
  const labels = {
    largeText: ['已套用大字。', '已關閉大字。'],
    highContrast: ['已套用高對比。', '已關閉高對比。'],
    reducedMotion: ['已減少動畫。', '已恢復動畫。'],
    largeTargets: ['已放大按鈕。', '已恢復標準按鈕大小。'],
    textOnly: ['已開啟文字導航模式；地圖已隱藏。', '已恢復地圖導航模式。'],
  };
  panel.querySelectorAll('input[data-a11y-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!(input instanceof HTMLInputElement)) return;
      const key = input.dataset.a11ySetting;
      if (!key || !(key in settings)) return;
      settings[key] = input.checked;
      apply();
      if (status) status.textContent = labels[key][input.checked ? 0 : 1];
    });
  });
  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    trigger.setAttribute('aria-expanded', String(!panel.hidden));
  });
  apply();
}

function initializeSheets() {
  document.querySelectorAll('.map-sheet').forEach((sheet) => {
    const handle = sheet.querySelector('[data-sheet-handle]');
    if (!(handle instanceof HTMLButtonElement)) return;
    const screen = sheet.closest('.screen');
    const floatingAction = screen?.querySelector('.floating-action');
    const originalFloatingNextSibling = floatingAction?.nextSibling || null;
    let pointerStart = 0;
    let offsetStart = 0;
    let dragging = false;
    let suppressClick = false;
    let sheetTransitioning = false;
    let positionFrame = 0;

    const positionFloatingAction = () => {
      if (!(floatingAction instanceof HTMLElement) || !screen) return;
      const screenBounds = screen.getBoundingClientRect();
      const sheetBounds = sheet.getBoundingClientRect();
      const topbarBounds = screen.querySelector('.map-topbar')?.getBoundingClientRect();
      const minimumTop = Math.max(
        12,
        (topbarBounds?.bottom || screenBounds.top) - screenBounds.top + 12,
      );
      const maximumTop = sheetBounds.top - screenBounds.top - floatingAction.offsetHeight - 12;
      if (maximumTop < minimumTop) {
        if (!floatingAction.classList.contains('in-sheet'))
          sheet.insertBefore(floatingAction, handle.nextSibling);
        floatingAction.classList.add('in-sheet');
        floatingAction.style.removeProperty('top');
        floatingAction.style.removeProperty('bottom');
        return;
      }
      if (floatingAction.classList.contains('in-sheet')) {
        screen.insertBefore(
          floatingAction,
          originalFloatingNextSibling?.parentNode === screen ? originalFloatingNextSibling : sheet,
        );
        floatingAction.classList.remove('in-sheet');
      }
      floatingAction.style.bottom = 'auto';
      floatingAction.style.top = `${Math.max(minimumTop, maximumTop)}px`;
    };
    const followSheetTransition = () => {
      positionFloatingAction();
      if (sheetTransitioning) positionFrame = window.requestAnimationFrame(followSheetTransition);
    };
    const stopFollowingSheet = () => {
      sheetTransitioning = false;
      if (positionFrame) window.cancelAnimationFrame(positionFrame);
      positionFrame = 0;
      positionFloatingAction();
    };
    sheet.addEventListener('transitionrun', (event) => {
      if (event.propertyName !== 'transform') return;
      sheetTransitioning = true;
      if (positionFrame) window.cancelAnimationFrame(positionFrame);
      positionFrame = window.requestAnimationFrame(followSheetTransition);
    });
    sheet.addEventListener('transitionend', (event) => {
      if (event.propertyName === 'transform') stopFollowingSheet();
    });
    const compactCardHeight = () =>
      Math.min(320, Math.max(220, Math.round(window.innerHeight * 0.36)));
    const setCompact = () => {
      const height = compactCardHeight();
      sheet.dataset.compact = 'true';
      sheet.dataset.collapsed = 'false';
      sheet.dataset.sheetOffset = '0';
      sheet.style.height = `${height}px`;
      sheet.style.maxHeight = `${height}px`;
      sheet.style.transform = '';
      handle.setAttribute('aria-expanded', 'true');
      handle.setAttribute('aria-label', '展開資訊卡');
      const toggleLabel = handle.querySelector('[data-sheet-toggle-label]');
      if (toggleLabel) toggleLabel.textContent = '展開卡片';
      sheet.querySelectorAll(':scope > :not([data-sheet-handle])').forEach((content) => {
        content.inert = false;
      });
      sheet.scrollTop = 0;
      window.requestAnimationFrame(positionFloatingAction);
    };
    const expandCompact = () => {
      if (sheet.dataset.compact !== 'true') return false;
      delete sheet.dataset.compact;
      sheet.style.removeProperty('height');
      sheet.style.removeProperty('max-height');
      setOffset(0);
      return true;
    };
    const resizeSheet = () => {
      if (sheet.dataset.compact === 'true') setCompact();
      else positionFloatingAction();
    };
    window.addEventListener('resize', resizeSheet);
    window.addEventListener('orientationchange', positionFloatingAction);
    if ('ResizeObserver' in window) new ResizeObserver(positionFloatingAction).observe(sheet);

    const maxOffset = () =>
      Math.max(0, sheet.offsetHeight - (document.body.dataset.screen === 'plan' ? 156 : 76));
    const setOffset = (value) => {
      const offset = Math.max(0, Math.min(maxOffset(), value));
      const collapsed = offset >= maxOffset() - 1;
      sheet.dataset.sheetOffset = String(offset);
      sheet.dataset.collapsed = String(collapsed);
      sheet.style.transform = offset ? `translateY(${offset}px)` : '';
      handle.setAttribute('aria-expanded', String(!collapsed));
      handle.setAttribute('aria-label', collapsed ? '展開資訊卡' : '收合資訊卡');
      const toggleLabel = handle.querySelector('[data-sheet-toggle-label]');
      if (toggleLabel) toggleLabel.textContent = collapsed ? '展開卡片' : '收合卡片';
      sheet.querySelectorAll(':scope > :not([data-sheet-handle])').forEach((content) => {
        content.inert = collapsed;
      });
      if (collapsed) sheet.scrollTop = 0;
      window.requestAnimationFrame(positionFloatingAction);
    };

    handle.addEventListener('click', (event) => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      if (expandCompact()) return;
      setOffset(sheet.dataset.collapsed === 'true' ? 0 : maxOffset());
    });
    handle.addEventListener('keydown', (event) => {
      if (
        sheet.dataset.compact === 'true' &&
        (event.key === 'ArrowUp' || event.key === 'Home')
      ) {
        event.preventDefault();
        expandCompact();
        return;
      }
      const offset = Number(sheet.dataset.sheetOffset || 0);
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setOffset(offset - 32);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOffset(offset + 32);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setOffset(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setOffset(maxOffset());
      }
    });
    handle.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (sheet.dataset.compact === 'true') return;
      pointerStart = event.clientY;
      offsetStart = Number(sheet.dataset.sheetOffset || 0);
      dragging = false;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const delta = event.clientY - pointerStart;
      if (!dragging && Math.abs(delta) < 6) return;
      dragging = true;
      sheet.classList.add('is-dragging');
      const offset = Math.max(0, Math.min(maxOffset(), offsetStart + delta));
      sheet.style.transform = `translateY(${offset}px)`;
      positionFloatingAction();
      event.preventDefault();
    });
    const finishDrag = (event) => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      if (!dragging) return;
      const offset = Math.max(0, Math.min(maxOffset(), offsetStart + event.clientY - pointerStart));
      suppressClick = true;
      sheet.classList.remove('is-dragging');
      setOffset(offset);
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    setOffset(0);

    const frame = screen?.querySelector('[data-map-frame]');
    const frameHasRoute =
      frame instanceof HTMLIFrameElement &&
      new URL(frame.src, window.location.href).searchParams.has('route');
    if (document.body.dataset.screen === 'plan' && (getDemoState().route || frameHasRoute)) {
      setCompact();
    }
  });
}
function initializePlan() {
  if (document.body.dataset.screen !== 'plan') return;
  const state = getDemoState();
  const profile = state.profile || 'wheelchair';
  document.querySelectorAll('[data-profile]').forEach((button) => {
    const active = button.dataset.profile === profile;
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => {
      document
        .querySelectorAll('[data-profile]')
        .forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      const summary = document.querySelector('[data-profile-summary]');
      if (summary) summary.textContent = profileLabels[button.dataset.profile];
      const current = getDemoState();
      const mobilityNeeds = ['wheelchair', 'stroller', 'heavy', 'elderly'];
      const existingNeeds = Array.isArray(current.preferences?.needs)
        ? current.preferences.needs.filter((need) => !mobilityNeeds.includes(need))
        : [];
      setDemoState({
        profile: button.dataset.profile,
        preferences: {
          ...(current.preferences || {}),
          needs: [...existingNeeds, ...(profileNeeds[button.dataset.profile] || [])],
        },
      });
    });
  });
  const summary = document.querySelector('[data-profile-summary]');
  if (summary) summary.textContent = profileLabels[profile];
  const voiceNeeds = document.querySelector('[data-voice-needs]');
  const voiceStart = document.querySelector('[data-voice-start]');
  const voiceAnalyze = document.querySelector('[data-voice-analyze]');
  const voiceStatus = document.querySelector('[data-voice-status]');
  const updateVoiceActions = () => {
    if (voiceAnalyze instanceof HTMLButtonElement)
      voiceAnalyze.disabled = !(voiceNeeds instanceof HTMLTextAreaElement && voiceNeeds.value.trim());
  };
  voiceNeeds?.addEventListener('input', updateVoiceActions);
  bindSpeechToTextarea({
    button: voiceStart,
    textarea: voiceNeeds,
    statusNode: voiceStatus,
    listeningText: '正在聆聽；請描述你的出行需要。',
    readyText: '已完成語音轉文字；可交給 Qwen 分析或直接搜尋路線。',
    unsupportedText: '此瀏覽器不支援語音輸入；你仍可直接輸入文字。',
  });
  voiceAnalyze?.addEventListener('click', async () => {
    if (!(voiceNeeds instanceof HTMLTextAreaElement) || !voiceNeeds.value.trim()) return;
    const frame = document.querySelector('[data-map-frame]');
    const bridge = frame?.contentWindow?.accessrouteGenAI;
    if (!bridge?.getWorkflowContext) {
      if (voiceStatus) voiceStatus.textContent = '地圖仍在載入，請稍候再分析。';
      return;
    }
    if (voiceAnalyze instanceof HTMLButtonElement) voiceAnalyze.disabled = true;
    if (voiceStatus) voiceStatus.textContent = 'Qwen 正在分析你的出行需要…';
    try {
      const response = await fetch('/api/genai/workflows/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ context: bridge.getWorkflowContext(), text: voiceNeeds.value.trim() }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || `Qwen 服務暫時無法使用（HTTP ${response.status}）`);
      const preferences = payload?.result?.payload;
      if (payload?.status !== 'ready' || payload?.result?.agent !== 'preferences' || !preferences)
        throw new Error(payload?.message || 'Qwen 未能產生可套用的出行設定');
      const mobilityProfile = {
        wheelchair: 'wheelchair',
        manual_wheelchair: 'wheelchair',
        stroller: 'stroller',
        heavy_luggage: 'heavy_luggage',
        elderly: 'elderly',
        walking: 'walking',
      }[preferences.mobility_type];
      const slope =
        preferences.max_slope <= 0.05
          ? 'gentle'
          : preferences.max_slope <= 0.0833
            ? 'moderate'
            : 'any';
      const current = getDemoState();
      const needs = [
        ...(mobilityProfile === 'wheelchair' ? ['wheelchair', 'elevator'] : []),
        ...(mobilityProfile === 'stroller' ? ['stroller', 'elevator'] : []),
        ...(mobilityProfile === 'heavy_luggage' ? ['heavy', 'elevator'] : []),
        ...(mobilityProfile === 'elderly' ? ['elderly', 'elevator'] : []),
        ...(preferences.allow_escalators ? ['escalators'] : []),
        ...(preferences.avoid_lifts ? ['avoid_lifts'] : []),
      ];
      setDemoState({
        profile: mobilityProfile || current.profile || 'wheelchair',
        preferences: {
          ...(current.preferences || {}),
          needs,
          goal: preferences.route_objective === 'shortest' ? 'shortest' : 'sheltered',
          slope,
        },
      });
      if (summary) summary.textContent = profileLabels[mobilityProfile] || profileLabels.wheelchair;
      if (voiceStatus) voiceStatus.textContent = 'Qwen 已分析並套用出行需要；你可以搜尋路線。';
    } catch (error) {
      if (voiceStatus)
        voiceStatus.textContent = `Qwen 分析失敗：${error instanceof Error ? error.message : String(error)}。你仍可直接搜尋路線。`;
    } finally {
      updateVoiceActions();
    }
  });
  document.querySelector('[data-plan-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const saved = getDemoState();
    const trip = selectedTrip(saved);
    const route = saved.preferences?.goal === 'shortest' ? 'short' : 'sheltered';
    setDemoState({
      ...trip,
      step: 0,
      route,
      report: '',
      navigationSteps: [],
      navigationRouteStatus: null,
      facilityEvents: [],
    });
    location.href = 'routes.html';
  });
}

function initializePreferences() {
  if (document.body.dataset.screen !== 'preferences') return;
  const state = getDemoState();
  const form = document.querySelector('[data-preferences-form]');
  if (!form) return;
  const preferences = state.preferences || {};
  if (preferences.needs) {
    form.querySelectorAll('input[name="need"]').forEach((input) => {
      input.checked = preferences.needs.includes(input.value);
    });
  }
  if (preferences.goal) form.querySelector('#goal').value = preferences.goal;
  if (preferences.slope) form.querySelector('#slope').value = preferences.slope;
  if (preferences.pace) form.querySelector('#pace').value = preferences.pace;
  if (preferences.modes) {
    form.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.checked = preferences.modes.includes(input.value);
    });
  }
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const needs = Array.from(
      form.querySelectorAll('input[name="need"]:checked'),
      (input) => input.value,
    );
    const modes = Array.from(
      form.querySelectorAll('input[name="mode"]:checked'),
      (input) => input.value,
    );
    const current = getDemoState();
    const profile = needs.includes('wheelchair')
      ? 'wheelchair'
      : needs.includes('stroller')
        ? 'stroller'
        : needs.includes('heavy')
          ? 'heavy_luggage'
          : needs.includes('elderly')
            ? 'elderly'
            : 'walking';
    const route = form.querySelector('#goal').value === 'shortest' ? 'short' : 'sheltered';
    setDemoState({
      profile,
      route,
      preferences: {
        needs,
        modes,
        goal: form.querySelector('#goal').value,
        slope: form.querySelector('#slope').value,
        pace: form.querySelector('#pace').value,
      },
    });
    updateStatus(
      '出行設定已儲存，規劃時會套用。' + (current.origin ? ` 目前起點：${current.origin}。` : ''),
    );
  });
}

function initializeRoutes() {
  if (document.body.dataset.screen !== 'routes') return;
  const trip = selectedTrip();
  document.querySelectorAll('[data-origin-summary]').forEach((node) => {
    node.textContent = trip.origin;
  });
  document.querySelectorAll('[data-destination-summary]').forEach((node) => {
    node.textContent = trip.destination;
  });
  const state = getDemoState();
  const buttons = [...document.querySelectorAll('[data-route-choice]')];
  const summary = document.querySelector('[data-route-summary]');
  const transitSummary = document.querySelector('[data-transit-summary]');
  const frame = document.querySelector('[data-map-frame]');
  let currentRouteResults = null;
  const selectedRoute = () => getDemoState().route || 'sheltered';
  const updateRoutePresentation = () => {
    const selected = selectedRoute();
    const result = currentRouteResults?.routes?.[selected];
    for (const button of buttons) {
      const routeKey = button.dataset.routeChoice;
      const active = routeKey === selected;
      button.setAttribute('aria-pressed', String(active));
      const route = currentRouteResults?.routes?.[routeKey];
      const label = button.querySelector('[data-route-label]');
      const distance = button.querySelector('[data-route-distance]');
      const description = button.querySelector('[data-route-description]');
      if (label) {
        label.textContent =
          routeKey === 'short'
            ? '較短路線'
            : getDemoState().weather === 'heat'
              ? '室內優先'
              : '無障礙・有蓋';
      }
      if (!route) {
        if (distance) distance.textContent = '正在計算';
        if (description) description.textContent = '根據目前出行需要計算路線';
        button.disabled = false;
        continue;
      }
      if (route.status !== 'ok') {
        if (distance) distance.textContent = '目前無可行路線';
        if (description) description.textContent = '目前出行設定或設施狀況下，無法計算這條路線';
        button.disabled = true;
        continue;
      }
      if (distance) {
        const minutes = Math.max(1, Math.round(route.durationS / 60));
        distance.textContent = `步行 ${Math.round(route.distanceM)} 米 · 約 ${minutes} 分鐘`;
      }
      const otherKey = routeKey === 'short' ? 'sheltered' : 'short';
      const other = currentRouteResults.routes[otherKey];
      const samePath =
        other?.status === 'ok' &&
        route.edgeIds.length === other.edgeIds.length &&
        route.edgeIds.every((edgeId, index) => edgeId === other.edgeIds[index]);
      const sameDistance =
        other?.status === 'ok' && Math.abs(route.distanceM - other.distanceM) < 1;
      if (description) {
        const preference =
          routeKey === 'short'
            ? '在無障礙限制內優先縮短距離'
            : getDemoState().weather === 'heat'
              ? '在無障礙限制內優先室內路段'
              : '在無障礙限制內優先減少露天路段';
        const qualityNote = route.warnings?.includes('ACCESSIBILITY_UNVERIFIED')
          ? ' · 部分通行資料未核實'
          : '';
        description.textContent = samePath
          ? `${preference} · 本地首末段沒有不同的替代路徑${qualityNote}`
          : sameDistance
            ? `${preference} · 兩個方案路徑不同，但距離相同${qualityNote}`
            : `${preference}${qualityNote}`;
      }
      button.disabled = false;
    }
    if (!summary) return;
    if (transitSummary)
      transitSummary.textContent = currentRouteResults?.transitSummary
        ? `鐵路站序：${currentRouteResults.transitSummary}`
        : '';
    if (!currentRouteResults) {
      summary.textContent = '正在計算所選地點可行的路線…';
    } else if (result?.status !== 'ok') {
      summary.textContent = '目前出行設定下無法計算所選路線，請嘗試另一方案或調整偏好。';
    } else {
      const label =
        selected === 'short'
          ? '較短路線'
          : getDemoState().weather === 'heat'
            ? '室內優先路線'
            : '有蓋路線';
      const minutes = Math.max(1, Math.round(result.durationS / 60));
      summary.textContent = `已選${label} · 首末段步行 ${Math.round(result.distanceM)} 米 · 約 ${minutes} 分鐘；不含列車車程`;
    }
  };
  const onRouteResult = (event) => {
    const frameWindow = frame?.contentWindow;
    const message = event.data;
    if (
      event.origin !== window.location.origin ||
      !frameWindow ||
      event.source !== frameWindow ||
      !message ||
      message.type !== 'accessroute-map-route-update' ||
      !['ok', 'no_route'].includes(message.activeStatus) ||
      message.sceneId !== selectedTrip().originKey ||
      message.originSceneId !== selectedTrip().originKey ||
      message.destinationSceneId !== selectedTrip().destinationKey ||
      message.viewSceneId !== (getDemoState().mapSceneId || selectedTrip().originKey) ||
      typeof message.transitSummary !== 'string' ||
      message.activeRoute !== selectedRoute() ||
      message.profile !== (getDemoState().profile || 'wheelchair') ||
      message.weather !== (getDemoState().weather || 'sunny') ||
      !message.routes ||
      !Array.isArray(message.steps) ||
      !message.steps.every(
        (step) =>
          typeof step.title === 'string' &&
          typeof step.detail === 'string' &&
          Number.isFinite(step.distanceM) &&
          [selectedTrip().originKey, selectedTrip().destinationKey].includes(step.sceneId),
      ) ||
      !['short', 'sheltered'].every((key) => {
        const route = message.routes[key];
        return (
          route &&
          (route.status === 'no_route' ||
            (route.status === 'ok' &&
              Number.isFinite(route.distanceM) &&
              Number.isFinite(route.durationS) &&
              Array.isArray(route.edgeIds)))
        );
      })
    ) {
      return;
    }
    currentRouteResults = message;
    setDemoState({
      navigationSteps: message.steps,
      navigationRouteStatus: message.activeStatus,
      facilityEvents: [],
      step: 0,
      mapSceneId: selectedTrip().originKey,
    });
    updateRoutePresentation();
  };
  window.addEventListener('message', onRouteResult);
  window.addEventListener('accessroute-trip-updated', () => {
    currentRouteResults = null;
    updateRoutePresentation();
  });
  buttons.forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.routeChoice === (state.route || 'sheltered')),
    );
    button.addEventListener('click', () => {
      const choice = button.dataset.routeChoice;
      if (button.disabled || !choice) return;
      setDemoState({
        route: choice,
        step: 0,
        mapSceneId: selectedTrip().originKey,
        navigationSteps: [],
        navigationRouteStatus: null,
      });
      currentRouteResults = null;
      updateRoutePresentation();
    });
  });
  const navigationLink = document.querySelector('a[href="./navigation.html"]');
  navigationLink?.addEventListener('click', (event) => {
    const result = currentRouteResults?.routes?.[selectedRoute()];
    if (!result || result.status !== 'ok') {
      event.preventDefault();
      if (summary) {
        summary.textContent = result
          ? '目前出行設定下無法計算所選路線，請選擇可行路線後再開始。'
          : '路線仍在計算中，請稍候再開始導航。';
      }
      return;
    }
    event.preventDefault();
    if (navigationLink instanceof HTMLAnchorElement)
      navigationLink.setAttribute('aria-disabled', 'true');
    const activeRouteResult = currentRouteResults;
    void (async () => {
      try {
        await createPairedSession(activeRouteResult);
      } catch (error) {
        setDemoState({ sessionId: null, sessionRevision: null });
        if (summary)
          summary.textContent = `配對後端暫時不可用，繼續本機示範導航；此旅程不會同步至另一裝置。${error instanceof Error ? error.message : String(error)}`;
      } finally {
        location.href = './navigation.html';
      }
    })();
  });
  updateRoutePresentation();
}

function initializeNavigation() {
  if (document.body.dataset.screen !== 'navigation') return;
  let routeStatus = getDemoState().navigationRouteStatus;
  let instructions = Array.isArray(getDemoState().navigationSteps)
    ? getDemoState().navigationSteps
    : [];
  let step = Math.min(
    Number.isInteger(getDemoState().step) ? getDemoState().step : 0,
    Math.max(0, instructions.length - 1),
  );
  const titleNode = document.querySelector('[data-instruction]');
  const detailNode = document.querySelector('[data-instruction-detail]');
  const distanceNode = document.querySelector('[data-instruction-distance]');
  const countNode = document.querySelector('[data-step-count]');
  const progress = document.querySelector('[data-progress]');
  const next = document.querySelector('[data-next-step]');
  const sessionStatus = document.querySelector('[data-session-status]');
  const narrationStatus = document.querySelector('[data-narration-status]');
  const speakButton = document.querySelector('[data-speak-step]');
  const guidanceButton = document.querySelector('[data-guidance-step]');
  const guidanceText = document.querySelector('[data-guidance-text]');
  let lastNarratedInstruction = '';
  const speakInstruction = (instruction, overrideText) => {
    const text = overrideText || (instruction ? `${instruction.title}。${instruction.detail}` : '');
    if (!text) {
      if (narrationStatus) narrationStatus.textContent = '目前沒有可朗讀的路線指示。';
      return;
    }
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      if (narrationStatus) narrationStatus.textContent = '此瀏覽器不支援語音播報；請閱讀文字指示。';
      return;
    }
    const synth = window.speechSynthesis;
    const cantoneseVoices = synth.getVoices().filter((voice) => /^(zh-HK|yue)/i.test(voice.lang));
    if (!cantoneseVoices.length) {
      if (narrationStatus)
        narrationStatus.textContent =
          '裝置未提供粵語語音；請在系統語音設定加入香港中文，或閱讀文字指示。';
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = cantoneseVoices[0].lang;
    utterance.voice = cantoneseVoices[0];
    utterance.onstart = () => {
      if (narrationStatus) narrationStatus.textContent = '正在朗讀目前的路線指示。';
    };
    utterance.onend = () => {
      if (narrationStatus) narrationStatus.textContent = '語音提示已完成。';
    };
    utterance.onerror = (event) => {
      if (narrationStatus)
        narrationStatus.textContent = `語音播報失敗（${event.error}）；請閱讀文字指示。`;
    };
    synth.cancel();
    synth.speak(utterance);
  };
  const workflowContext = () => {
    const instruction = instructions[step];
    if (!instruction) return null;
    const frameNode = document.querySelector('[data-map-frame]');
    const bridge = frameNode?.contentWindow?.accessrouteGenAI;
    if (!bridge?.getWorkflowContext) return null;
    return bridge.getWorkflowContext(instruction.sceneId, instruction.fromNodeId);
  };
  const requestGuidance = async ({ speak = false } = {}) => {
    const instruction = instructions[step];
    if (!instruction) {
      if (narrationStatus) narrationStatus.textContent = '目前沒有可用的路線步驟。';
      return;
    }
    const context = workflowContext();
    if (!context) {
      if (narrationStatus) narrationStatus.textContent = '地圖仍在載入，暫時無法取得 Qwen 指引。';
      if (speak) speakInstruction(instruction);
      return;
    }
    if (guidanceButton instanceof HTMLButtonElement) guidanceButton.disabled = true;
    if (narrationStatus) narrationStatus.textContent = 'Qwen 正在生成目前步驟導航提示…';
    try {
      const response = await fetch('/api/genai/workflows/guidance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ context }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error || payload?.message || `導航助手暫不可用（HTTP ${response.status}）`);
      const result = payload?.result;
      if (payload?.status !== 'ready' || result?.agent !== 'guidance' || !result.payload?.text)
        throw new Error(payload?.message || 'Qwen 未提供可用的導航提示。');
      const text = result.payload.text;
      if (guidanceText) guidanceText.textContent = `Qwen 提示：${text}`;
      if (speak) speakInstruction(instruction, text);
      if (narrationStatus) narrationStatus.textContent = '已取得 Qwen 導航提示。';
      return text;
    } catch (error) {
      if (guidanceText) guidanceText.textContent = '';
      if (narrationStatus)
        narrationStatus.textContent = `Qwen 指引暫不可用：${error instanceof Error ? error.message : String(error)}`;
      if (speak) speakInstruction(instruction);
      return null;
    } finally {
      if (guidanceButton instanceof HTMLButtonElement)
        guidanceButton.disabled = instructions.length === 0 || routeStatus === 'no_route';
    }
  };
  speakButton?.addEventListener('click', () => {
    void requestGuidance({ speak: true });
  });
  guidanceButton?.addEventListener('click', () => {
    void requestGuidance({ speak: false });
  });
  const renderStep = () => {
    const state = getDemoState();
    const instruction = routeStatus === 'no_route' ? null : instructions[step];
    const percent = instructions.length ? Math.round(((step + 1) / instructions.length) * 100) : 0;
    if (titleNode)
      titleNode.textContent =
        instruction?.title ||
        (routeStatus === 'no_route' ? '設施故障，暫無可行改道路線' : '正在載入路線指引…');
    if (detailNode)
      detailNode.textContent = instruction
        ? state.report
          ? `${state.facility || '設施'}問題已回報；請依更新後路線前往`
          : instruction.detail
        : routeStatus === 'no_route'
          ? '目前位置至目的地之間沒有可行路線。請等待設施恢復，或聯絡協助。'
          : '正在讀取目前所選路線的逐段指引。';
    if (instruction) {
      const mapView = instruction.levelId ? 'floor' : 'macro';
      const mapLevel = instruction.levelId || '';
      if (state.mapView !== mapView || state.mapLevel !== mapLevel)
        setDemoState({ mapView, mapLevel });
    }
    if (distanceNode)
      distanceNode.textContent = instruction?.distanceM
        ? `約 ${Math.round(instruction.distanceM)} 米`
        : '';
    if (countNode)
      countNode.textContent = instructions.length
        ? `第 ${step + 1} 步，共 ${instructions.length} 步`
        : routeStatus === 'no_route'
          ? '目前無可行路線'
          : '路線計算中';
    if (progress) progress.style.width = `${percent}%`;
    progress?.parentElement?.setAttribute('aria-valuenow', String(percent));
    if (next)
      next.textContent =
        instructions.length && step === instructions.length - 1 ? '完成旅程' : '已到達・下一步';
    if (next instanceof HTMLButtonElement)
      next.disabled =
        instructions.length === 0 ||
        state.sessionStatus === 'waiting' ||
        routeStatus === 'no_route';
    if (guidanceButton instanceof HTMLButtonElement)
      guidanceButton.disabled = instructions.length === 0 || routeStatus === 'no_route';
    const instructionKey = instruction ? `${step}:${instruction.title}:${instruction.detail}` : '';
    if (
      instructionKey &&
      instructionKey !== lastNarratedInstruction &&
      state.preferences?.modes?.includes('voice')
    ) {
      lastNarratedInstruction = instructionKey;
      void requestGuidance({ speak: true });
    }
  };
  renderStep();
  window.addEventListener('accessroute-trip-updated', () => {
    instructions = [];
    routeStatus = null;
    step = 0;
    renderStep();
  });
  const frame = document.querySelector('[data-map-frame]');
  const sessionId = getDemoState().sessionId;
  let latestSessionRevision = Number(getDemoState().sessionRevision) || 0;
  let eventStream;
  if (sessionStatus) {
    sessionStatus.textContent = sessionId
      ? '正在連接配對行程…'
      : '本機示範模式：尚未連接共享行程，另一裝置不會同步。';
  }
  if (sessionId) {
    eventStream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
    eventStream.addEventListener('session', (event) => {
      const session = JSON.parse(event.data);
      if (session.id !== sessionId || session.revision < latestSessionRevision) return;
      latestSessionRevision = session.revision;
      const serverState = session.state;
      instructions = serverState.steps;
      routeStatus = serverState.routeStatus || (instructions.length ? 'ok' : routeStatus);
      step = Math.min(serverState.currentStep, Math.max(0, instructions.length - 1));
      setDemoState({
        sessionId,
        sessionRevision: session.revision,
        navigationSteps: instructions,
        step,
        sessionStatus: serverState.status,
        navigationRouteStatus: routeStatus,
        facilityEvents: serverState.facilityEvents,
        mapSceneId: serverState.position.sceneId,
      });
      if (next instanceof HTMLButtonElement)
        next.disabled =
          instructions.length === 0 ||
          serverState.status === 'waiting' ||
          routeStatus === 'no_route';
      if (sessionStatus)
        sessionStatus.textContent = `配對行程已同步 · ${serverState.status} · 版本 ${session.revision}`;
      renderStep();
    });
    eventStream.onerror = () => {
      if (sessionStatus)
        sessionStatus.textContent = '配對連線中斷；本機步驟仍可操作，正在嘗試重新連線。';
    };
    window.addEventListener('storage', (event) => {
      if (event.key !== 'accessroute-map-demo' || !event.newValue) return;
      const shared = JSON.parse(event.newValue);
      if (shared.sessionId !== sessionId || !Array.isArray(shared.navigationSteps)) return;
      instructions = shared.navigationSteps;
      step = Math.min(shared.step || 0, Math.max(0, instructions.length - 1));
      routeStatus = shared.navigationRouteStatus || routeStatus;
      if (next instanceof HTMLButtonElement)
        next.disabled =
          instructions.length === 0 ||
          shared.sessionStatus === 'waiting' ||
          routeStatus === 'no_route';
      renderStep();
    });
  }
  const onRouteResult = (event) => {
    const message = event.data;
    if (sessionId) return;
    if (
      event.origin !== window.location.origin ||
      event.source !== frame?.contentWindow ||
      !message ||
      message.type !== 'accessroute-map-route-update' ||
      !['ok', 'no_route'].includes(message.activeStatus) ||
      message.sceneId !== selectedTrip().originKey ||
      message.originSceneId !== selectedTrip().originKey ||
      message.destinationSceneId !== selectedTrip().destinationKey ||
      message.viewSceneId !== (getDemoState().mapSceneId || selectedTrip().originKey) ||
      typeof message.transitSummary !== 'string' ||
      message.activeRoute !== (getDemoState().route || 'sheltered') ||
      message.profile !== (getDemoState().profile || 'wheelchair') ||
      message.weather !== (getDemoState().weather || 'sunny') ||
      !Array.isArray(message.steps) ||
      !message.steps.every(
        (item) =>
          typeof item.title === 'string' &&
          typeof item.detail === 'string' &&
          Number.isFinite(item.distanceM) &&
          [selectedTrip().originKey, selectedTrip().destinationKey].includes(item.sceneId) &&
          (item.levelId === undefined || typeof item.levelId === 'string'),
      )
    ) {
      return;
    }
    instructions = message.steps;
    routeStatus = message.activeStatus;
    const savedStep = getDemoState().step;
    step = Math.min(
      Number.isInteger(savedStep) ? savedStep : 0,
      Math.max(0, instructions.length - 1),
    );
    setDemoState({
      navigationSteps: instructions,
      navigationRouteStatus: routeStatus,
      step,
      mapSceneId: instructions[step]?.sceneId || selectedTrip().originKey,
    });
    renderStep();
  };
  window.addEventListener('message', onRouteResult);
  if (next) {
    next.addEventListener('click', () => {
      if (!instructions.length) return;
      if (step < instructions.length - 1) {
        step += 1;
        setDemoState({ step, mapSceneId: instructions[step].sceneId });
        renderStep();
        void sendSessionCommand({ type: 'advance' }).catch((error) => {
          if (sessionStatus)
            sessionStatus.textContent = `步驟已在本機前進，但共享更新失敗：${error.message}`;
        });
      } else {
        void sendSessionCommand({ type: 'advance' }).catch(() => {});
        setDemoState({ step: 0, report: '' });
        location.href = 'index.html';
      }
    });
  }
  const operatorLink = document.querySelector('[data-operator-link]');
  if (operatorLink instanceof HTMLAnchorElement && sessionId) {
    operatorLink.href = `./operator.html?session=${encodeURIComponent(sessionId)}`;
    operatorLink.textContent = '開啟／分享配對控制頁';
  }
}

function initializeOperator() {
  if (document.body.dataset.screen !== 'operator') return;
  const form = document.querySelector('[data-operator-connect]');
  const sessionInput = document.querySelector('[data-operator-session]');
  const statePanel = document.querySelector('[data-operator-state]');
  const status = document.querySelector('[data-operator-status]');
  const trip = document.querySelector('[data-operator-trip]');
  const journeyStatus = document.querySelector('[data-operator-journey-status]');
  const position = document.querySelector('[data-operator-position]');
  const stepNode = document.querySelector('[data-operator-step]');
  const shareLink = document.querySelector('[data-operator-share-link]');
  const routeStatus = document.querySelector('[data-operator-route-status]');
  const facilityScene = document.querySelector('[data-operator-facility-scene]');
  const facilitySelect = document.querySelector('[data-operator-facility]');
  let sessionId = new URLSearchParams(location.search).get('session') || '';
  let currentSession = null;
  let stream = null;
  let latestRevision = 0;
  if (sessionInput instanceof HTMLInputElement) sessionInput.value = sessionId;

  const display = (session) => {
    if (session.id !== sessionId || session.revision < latestRevision) return;
    currentSession = session;
    latestRevision = session.revision;
    const data = session.state;
    if (statePanel) statePanel.hidden = false;
    if (trip) trip.textContent = `${data.originSceneId} → ${data.destinationSceneId}`;
    if (journeyStatus) journeyStatus.textContent = `${data.status} · revision ${session.revision}`;
    if (position)
      position.textContent = `${data.position.sceneId}${data.position.nodeId ? ` · ${data.position.nodeId}` : ''}`;
    if (stepNode)
      stepNode.textContent = data.steps.length
        ? `${data.currentStep + 1}/${data.steps.length} · ${data.steps[data.currentStep]?.title || ''}`
        : '尚未規劃';
    if (routeStatus)
      routeStatus.textContent =
        data.routeStatus === 'no_route'
          ? '目前沒有可行改道路線；請等待設施恢復或協助使用者。'
          : data.facilityEvents?.some((entry) => entry.event.status === 'active')
            ? '已按目前設施狀態重新計算路線。'
            : '目前路線可用。';
    if (shareLink instanceof HTMLInputElement)
      shareLink.value = `${location.origin}${location.pathname}?session=${encodeURIComponent(sessionId)}`;
    if (status)
      status.textContent = `已同步 · ${new Date(session.updatedAt).toLocaleString('zh-HK')}`;
    setDemoState({
      sessionId,
      sessionRevision: session.revision,
      navigationSteps: data.steps,
      step: data.currentStep,
      sessionStatus: data.status,
      mapSceneId: data.position.sceneId,
      mapView: data.steps[data.currentStep]?.levelId ? 'floor' : 'macro',
      mapLevel: data.steps[data.currentStep]?.levelId || '',
      navigationRouteStatus: data.routeStatus || 'ok',
      facilityEvents: data.facilityEvents || [],
    });
    document.querySelectorAll('[data-operator-command]').forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.dataset.operatorCommand === 'advance')
        button.disabled =
          data.status !== 'navigating' || !data.steps.length || data.routeStatus === 'no_route';
      else if (button.dataset.operatorCommand === 'waiting')
        button.disabled = data.status !== 'navigating';
      else if (button.dataset.operatorCommand === 'navigating')
        button.disabled = data.status !== 'waiting';
    });
  };
  const connect = async (id) => {
    if (!id) throw new Error('請輸入行程 session ID。');
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    const session = await response.json().catch(() => null);
    if (!response.ok) throw new Error(session?.error || `無法讀取行程（HTTP ${response.status}）`);
    sessionId = id;
    latestRevision = 0;
    stream?.close();
    display(session);
    if (facilityScene instanceof HTMLSelectElement && facilitySelect instanceof HTMLSelectElement) {
      const facilitiesResponse = await fetch(`/api/sessions/${encodeURIComponent(id)}/facilities`);
      const sceneFacilities = await facilitiesResponse.json().catch(() => null);
      if (!facilitiesResponse.ok) throw new Error(sceneFacilities?.error || '無法讀取行程設施');
      facilityScene.replaceChildren(
        ...sceneFacilities.map((item) => {
          const option = document.createElement('option');
          option.value = item.sceneId;
          option.textContent = item.name;
          return option;
        }),
      );
      const updateFacilities = () => {
        const selectedScene = sceneFacilities.find((item) => item.sceneId === facilityScene.value);
        facilitySelect.replaceChildren(
          ...(selectedScene?.facilities || []).map((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = `${item.label}（${item.kind}）`;
            return option;
          }),
        );
      };
      facilityScene.onchange = updateFacilities;
      updateFacilities();
    }
    const input = new URLSearchParams(location.search);
    input.set('session', sessionId);
    history.replaceState(null, '', `${location.pathname}?${input.toString()}`);
    stream = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/stream`);
    stream.addEventListener('session', (event) => {
      try {
        display(JSON.parse(event.data));
      } catch {
        if (status) status.textContent = '收到無法讀取的 session 更新；仍會等待下一次同步。';
      }
    });
    stream.onerror = () => {
      if (status) status.textContent = '配對連線中斷，瀏覽器會自動重試。';
    };
  };
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = sessionInput instanceof HTMLInputElement ? sessionInput.value.trim() : '';
    if (status) status.textContent = '正在連接行程…';
    void connect(id).catch((error) => {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
      if (statePanel) statePanel.hidden = true;
    });
  });
  document.querySelectorAll('[data-operator-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!currentSession) return;
      const action = button.dataset.operatorCommand;
      const command =
        action === 'advance' ? { type: 'advance' } : { type: 'set_status', status: action };
      void sendSessionCommand(command)
        .then((session) => session && display(session))
        .catch((error) => {
          if (status) status.textContent = error instanceof Error ? error.message : String(error);
        });
    });
  });
  document.querySelectorAll('[data-operator-facility-status]').forEach((button) => {
    button.addEventListener('click', () => {
      if (
        !currentSession ||
        !(facilityScene instanceof HTMLSelectElement) ||
        !(facilitySelect instanceof HTMLSelectElement)
      )
        return;
      const facilityId = facilitySelect.value;
      if (!facilityId) {
        if (routeStatus) routeStatus.textContent = '此場景沒有可操作的設施。';
        return;
      }
      const statusValue = button.dataset.operatorFacilityStatus;
      const event = {
        id: `session-${sessionId}-${facilityScene.value}-${facilityId}`,
        type: 'facility_closed',
        target: { facilityId },
        status: statusValue,
        validFrom: '2000-01-01T00:00:00.000Z',
        source: 'demo',
        confidence: 1,
      };
      void sendSessionCommand({
        type: 'set_facility_event',
        sceneId: facilityScene.value,
        event,
      })
        .then((session) => {
          if (session) display(session);
          if (routeStatus)
            routeStatus.textContent =
              statusValue === 'active'
                ? '設施已標示故障，正在更新手機路線。'
                : '設施已標示恢復，正在重新計算手機路線。';
        })
        .catch((error) => {
          if (routeStatus)
            routeStatus.textContent = error instanceof Error ? error.message : String(error);
        });
    });
  });
  document.querySelector('[data-operator-copy]')?.addEventListener('click', () => {
    if (!(shareLink instanceof HTMLInputElement) || !shareLink.value) return;
    void navigator.clipboard
      .writeText(shareLink.value)
      .then(() => {
        if (status) status.textContent = '配對連結已複製。';
      })
      .catch(() => {
        shareLink.select();
        if (status) status.textContent = '無法自動複製；已選取連結，請自行複製。';
      });
  });
  if (sessionId)
    void connect(sessionId).catch((error) => {
      if (status) status.textContent = error instanceof Error ? error.message : String(error);
    });
}

function initializeHelp() {
  const dialog = document.querySelector('[data-help-dialog]');
  const open = document.querySelector('[data-help-open]');
  const close = document.querySelector('[data-help-close]');
  const helpTitle = dialog?.querySelector('h2');
  const form = document.querySelector('[data-report-form]');
  const photoInput = document.querySelector('[data-report-photo]');
  const photoPreview = document.querySelector('[data-report-preview]');
  const reportDescription = document.querySelector('[data-report-description]');
  const consent = document.querySelector('[data-report-consent]');
  const locationButton = document.querySelector('[data-report-location]');
  const locationStatus = document.querySelector('[data-report-location-status]');
  const reportVoiceButton = document.querySelector('[data-report-voice-start]');
  const reportVoiceStatus = document.querySelector('[data-report-voice-status]');
  const submit = document.querySelector('[data-report-submit]');
  const reportResults = document.querySelector('[data-report-results]');
  const lostForm = document.querySelector('[data-localization-form]');
  const lostPhotoInput = document.querySelector('[data-localization-photo]');
  const lostPreview = document.querySelector('[data-localization-preview]');
  const lostDescription = document.querySelector('[data-localization-description]');
  const lostVoiceButton = document.querySelector('[data-localization-voice-start]');
  const lostVoiceStatus = document.querySelector('[data-localization-voice-status]');
  const lostConsent = document.querySelector('[data-localization-consent]');
  const lostSubmit = document.querySelector('[data-localization-submit]');
  const lostResults = document.querySelector('[data-localization-results]');
  if (!(form instanceof HTMLFormElement) && !(lostForm instanceof HTMLFormElement)) return;
  if (dialog instanceof HTMLDialogElement) enableEscapeToClose(dialog);
  bindSpeechToTextarea({
    button: reportVoiceButton,
    textarea: reportDescription,
    statusNode: reportVoiceStatus,
    listeningText: '正在聆聽；請描述設施問題。',
    readyText: '已完成語音轉文字；可檢查內容後提交辨識。',
    unsupportedText: '此瀏覽器不支援語音輸入；你仍可手動輸入故障線索。',
  });
  bindSpeechToTextarea({
    button: lostVoiceButton,
    textarea: lostDescription,
    statusNode: lostVoiceStatus,
    listeningText: '正在聆聽；請描述你看到的地標。',
    readyText: '已完成語音轉文字；可檢查內容後提交定位。',
    unsupportedText: '此瀏覽器不支援語音輸入；你仍可手動輸入地標線索。',
  });
  const capabilityStatus = document.createElement('p');
  capabilityStatus.className = 'inline-status service-note';
  capabilityStatus.setAttribute('role', 'status');
  capabilityStatus.setAttribute('aria-live', 'polite');
  capabilityStatus.textContent = '正在檢查智能導航助手連線…';
  if (helpTitle) helpTitle.insertAdjacentElement('afterend', capabilityStatus);
  void fetch('/api/genai/capabilities', { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(payload?.error || `智能導航助手服務暫時無法使用（HTTP ${response.status}）`);
      return payload;
    })
    .then((payload) => {
      if (payload?.configured === true) {
        capabilityStatus.textContent = '智能導航助手已連線，可使用照片辨識、位置確認和語音導航。';
      } else {
        capabilityStatus.textContent =
          '智能導航助手後端已連線，但尚未設定 Qwen 金鑰；路線地圖和離線導航仍可使用。';
      }
    })
    .catch((error) => {
      capabilityStatus.textContent = `智能導航助手未連線；照片辨識和語音工作流程暫不可用。${error instanceof Error ? ` ${error.message}` : ''}`;
    });
  let results = reportResults;
  let image = '';
  let position = null;
  let lostImage = '';
  let lostPosition = null;
  let busy = false;
  let responseState = null;
  const refreshSubmit = () => {
    if (submit instanceof HTMLButtonElement)
      submit.disabled = busy || !image || !position || !consent?.checked;
    if (lostSubmit instanceof HTMLButtonElement)
      lostSubmit.disabled = busy || !lostImage || !lostConsent?.checked;
  };
  const clearResults = () => {
    responseState = null;
    reportResults?.replaceChildren();
    lostResults?.replaceChildren();
  };
  const appendText = (container, tag, text, className) => {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    container.append(element);
    return element;
  };
  const postWorkflow = async (path, body) => {
    const result = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await result.json().catch(() => null);
    if (!result.ok)
      throw new Error(
        payload?.error || payload?.message || `Agent 服務暫時無法使用（HTTP ${result.status}）`,
      );
    return payload;
  };
  const workflowContext = () => {
    const frame = document.querySelector('[data-map-frame]');
    const bridge = frame?.contentWindow?.accessrouteGenAI;
    if (!bridge?.getWorkflowContext)
      throw new Error('地圖仍在載入，請稍候再試；若一直未載入，請重新整理頁面。');
    const state = getDemoState();
    const sceneId = tripPairs[state.mapSceneId] ? state.mapSceneId : selectedTrip().originKey;
    const currentStep = state.navigationSteps?.[state.step];
    const currentNodeId = currentStep?.sceneId === sceneId ? currentStep.fromNodeId : undefined;
    return { context: bridge.getWorkflowContext(sceneId, currentNodeId), bridge };
  };
  const renderWorkflowResponse = (workflowResponse, context, bridge, workflow) => {
    clearResults();
    responseState = { workflowResponse, context, bridge, workflow };
    appendText(results, 'p', workflowResponse.message, 'inline-status');
    for (const trace of workflowResponse.trace || [])
      appendText(results, 'p', trace.summary, 'help-trace');

    if (workflowResponse.status === 'no_match') return;
    const responseCandidate =
      workflowResponse.result?.agent === 'localization'
        ? workflowResponse.candidates?.find(
            (candidate) => candidate.node_id === workflowResponse.result.payload.map_db_node_id,
          )
        : workflowResponse.result?.agent === 'obstacle'
          ? workflowResponse.candidates?.find(
              (candidate) =>
                candidate.facility_id === workflowResponse.result.payload.target.facility_id ||
                candidate.edge_ids?.some((id) =>
                  workflowResponse.result.payload.target.edge_ids?.includes(id),
                ),
            )
          : undefined;
    const candidate = responseCandidate || workflowResponse.candidates?.[0];
    const previewButton = (item) => {
      const preview = document.createElement('button');
      preview.type = 'button';
      preview.className = 'secondary-action';
      preview.textContent = '在地圖預覽';
      preview.addEventListener('click', () => {
        const receipt = bridge.previewMapCandidate?.(context.scene_id, item);
        if (!receipt || receipt.status !== 'applied') {
          updateStatus(receipt?.message || '地圖尚未準備好顯示候選位置。');
          return;
        }
        dialog?.close();
        updateStatus(`${receipt.message} 按「？」可返回確認。`);
      });
      return preview;
    };
    if (workflowResponse.status === 'needs_confirmation') {
      appendText(
        results,
        'p',
        workflow === 'localization'
          ? '請比較照片和地圖候選；可以先在地圖預覽，再回來確認位置。'
          : '請從候選設施中選擇照片所示的位置；可以先在地圖預覽，再回來確認。',
      );
      const choices = document.createElement('div');
      choices.className = 'help-candidates';
      for (const candidate of workflowResponse.candidates || []) {
        const choice = document.createElement('div');
        choice.className = 'help-candidate';
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `${workflow}-candidate`;
        radio.value = candidate.id;
        label.append(radio);
        const text = document.createElement('span');
        text.textContent = `${candidate.names.join(' / ')} · 約 ${Math.round(candidate.distance_m)} 米${candidate.evidence?.length ? ` · ${candidate.evidence.join('、')}` : ''}`;
        label.append(text);
        choice.append(label, previewButton(candidate));
        choices.append(choice);
      }
      results.append(choices);
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary-action';
      confirm.textContent = workflow === 'localization' ? '確認所選位置' : '確認所選設施';
      confirm.disabled = !workflowResponse.candidates?.length;
      confirm.addEventListener('click', async () => {
        const selected = choices.querySelector(`input[name="${workflow}-candidate"]:checked`);
        if (!selected) {
          updateStatus(
            workflow === 'localization' ? '請先選擇照片中的位置。' : '請先選擇照片中的設施。',
          );
          return;
        }
        await runBusy(
          async () => {
            const confirmed = await postWorkflow('/api/genai/confirm', {
              confirmation_id: workflowResponse.confirmation_id,
              candidate_id: selected.value,
              context,
            });
            renderWorkflowResponse(confirmed, context, bridge, workflow);
          },
          workflow === 'localization' ? lostSubmit : submit,
        );
      });
      results.append(confirm);
      return;
    }

    if (candidate)
      appendText(
        results,
        'p',
        `${workflow === 'localization' ? '定位候選' : '辨識到'}：${candidate.names.join(' / ')} · ${(candidate.score * 100).toFixed(0)}%${candidate.level_id ? ` · ${candidate.level_id}` : ' · 室外'}`,
      );
    if (candidate) results.append(previewButton(candidate));
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'primary-action';
    apply.textContent = workflow === 'localization' ? '確認位置並更新路線' : '確認故障並重新規劃';
    apply.addEventListener('click', async () => {
      await runBusy(
        async () => {
          const receipt =
            workflow === 'localization'
              ? bridge.applyMapLocalizationResult?.(workflowResponse.result)
              : bridge.applyMapObstacleResult?.(workflowResponse.result);
          if (!receipt) throw new Error('地圖尚未準備好接收辨識結果，請重新整理後再試。');
          if (receipt.status !== 'applied')
            throw new Error(receipt.message || '系統拒絕套用辨識結果。');
          setDemoState({
            ...(workflow === 'localization'
              ? { location: candidate?.names.join(' / ') || '已確認照片位置' }
              : {
                  report: candidate?.names.join(' / ') || '照片辨識的設施問題',
                  facility: candidate?.names.join(' / ') || '已確認設施',
                }),
            step: 0,
            navigationSteps: [],
            navigationRouteStatus: null,
          });
          updateStatus(`${receipt.message} ${workflowResponse.message}`);
          clearResults();
          dialog?.close();
        },
        workflow === 'localization' ? lostSubmit : submit,
      );
    });
    results.append(apply);
  };
  const runBusy = async (action, activeButton = submit) => {
    busy = true;
    refreshSubmit();
    if (activeButton instanceof HTMLButtonElement) activeButton.textContent = '正在辨識…';
    try {
      await action();
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
      if (activeButton instanceof HTMLButtonElement)
        activeButton.textContent = activeButton === submit ? '以照片和 GPS 辨識' : '以照片定位';
      refreshSubmit();
    }
  };

  open?.addEventListener('click', () => {
    if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
  });
  close?.addEventListener('click', () => {
    if (dialog instanceof HTMLDialogElement) dialog.close();
  });
  photoInput?.addEventListener('change', () => {
    results = reportResults;
    if (consent instanceof HTMLInputElement) consent.checked = false;
    clearResults();
    const file = photoInput.files?.[0];
    image = '';
    if (photoPreview instanceof HTMLImageElement) {
      photoPreview.hidden = true;
      photoPreview.removeAttribute('src');
    }
    if (!file) {
      refreshSubmit();
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 6_000_000) {
      updateStatus('請選擇 JPEG、PNG 或 WebP 格式且不超過 6 MB 的照片。');
      photoInput.value = '';
      refreshSubmit();
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => updateStatus('無法讀取照片，請重新選擇。');
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        updateStatus('無法讀取照片，請重新選擇。');
        return;
      }
      image = reader.result;
      if (photoPreview instanceof HTMLImageElement) {
        photoPreview.src = image;
        photoPreview.hidden = false;
      }
      updateStatus('照片已就緒；確認分享同意後即可交由路障辨識 agent 檢查。');
      refreshSubmit();
    };
    reader.readAsDataURL(file);
  });
  document.querySelector('[data-report-description]')?.addEventListener('input', () => {
    if (consent instanceof HTMLInputElement) consent.checked = false;
    refreshSubmit();
  });
  consent?.addEventListener('change', refreshSubmit);
  locationButton?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      if (locationStatus) locationStatus.textContent = '此瀏覽器不支援 GPS 定位。';
      return;
    }
    locationButton.disabled = true;
    if (locationStatus) locationStatus.textContent = '正在向瀏覽器要求 GPS 權限…';
    navigator.geolocation.getCurrentPosition(
      (result) => {
        position = {
          lat: result.coords.latitude,
          lon: result.coords.longitude,
          accuracy_m: result.coords.accuracy,
        };
        if (consent instanceof HTMLInputElement) consent.checked = false;
        if (locationStatus)
          locationStatus.textContent = `已取得位置，精度約 ${Math.round(position.accuracy_m)} 米。位置只會在你同意並提交照片後送出。`;
        locationButton.disabled = false;
        clearResults();
        refreshSubmit();
      },
      (error) => {
        position = null;
        if (consent instanceof HTMLInputElement) consent.checked = false;
        if (locationStatus)
          locationStatus.textContent =
            error.code === error.PERMISSION_DENIED
              ? '你未允許定位。請在瀏覽器位置設定中允許後重試。'
              : error.code === error.TIMEOUT
                ? '定位逾時，請移至較開闊位置再試。'
                : '暫時無法取得位置，請檢查裝置 GPS 後重試。';
        locationButton.disabled = false;
        refreshSubmit();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!image || !position || !consent?.checked) {
      updateStatus('請選擇照片、分享 GPS 位置並同意傳送資料後再辨識。');
      return;
    }
    void runBusy(async () => {
      results = reportResults;
      const { context, bridge } = workflowContext();
      const capabilityResponse = await fetch('/api/genai/capabilities');
      const capability = await capabilityResponse.json().catch(() => null);
      if (!capabilityResponse.ok)
        throw new Error('未連接 Agent 後端。請啟動完整 demo 服務後再試。');
      if (!capability?.configured)
        throw new Error('Agent 尚未設定模型服務。請由管理員設定 vision provider 後再試。');
      updateStatus('正在把照片與 GPS 位置送交路障辨識 agent…');
      const workflowResponse = await postWorkflow('/api/genai/workflows/obstacle', {
        context,
        image,
        description: document.querySelector('[data-report-description]')?.value.trim() || undefined,
        position,
      });
      renderWorkflowResponse(workflowResponse, context, bridge, 'obstacle');
    });
  });
  lostConsent?.addEventListener('change', refreshSubmit);
  document.querySelector('[data-localization-description]')?.addEventListener('input', () => {
    if (lostConsent instanceof HTMLInputElement) lostConsent.checked = false;
    refreshSubmit();
  });
  document.querySelector('[data-localization-location]')?.addEventListener('click', () => {
    const status = document.querySelector('[data-localization-location-status]');
    if (!navigator.geolocation) {
      if (status) status.textContent = '此瀏覽器不支援 GPS 定位。';
      return;
    }
    if (status) status.textContent = '正在向瀏覽器要求 GPS 權限…';
    navigator.geolocation.getCurrentPosition(
      (result) => {
        lostPosition = {
          lat: result.coords.latitude,
          lon: result.coords.longitude,
          accuracy_m: result.coords.accuracy,
        };
        if (lostConsent instanceof HTMLInputElement) lostConsent.checked = false;
        if (status)
          status.textContent = `已取得位置，精度約 ${Math.round(lostPosition.accuracy_m)} 米。只有勾選同意並提交後才會傳送。`;
      },
      (error) => {
        lostPosition = null;
        if (lostConsent instanceof HTMLInputElement) lostConsent.checked = false;
        if (status)
          status.textContent =
            error.code === error.PERMISSION_DENIED
              ? '你未允許定位；仍可用照片和地標文字嘗試定位。'
              : '暫時無法取得 GPS；仍可用照片和地標文字嘗試定位。';
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
  lostPhotoInput?.addEventListener('change', () => {
    results = lostResults;
    if (lostConsent instanceof HTMLInputElement) lostConsent.checked = false;
    clearResults();
    lostImage = '';
    const file = lostPhotoInput.files?.[0];
    if (lostPreview instanceof HTMLImageElement) {
      lostPreview.hidden = true;
      lostPreview.removeAttribute('src');
    }
    if (!file) {
      refreshSubmit();
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 6_000_000) {
      updateStatus('請選擇 JPEG、PNG 或 WebP 格式且不超過 6 MB 的照片。');
      lostPhotoInput.value = '';
      refreshSubmit();
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => updateStatus('無法讀取照片，請重新選擇。');
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        updateStatus('無法讀取照片，請重新選擇。');
        return;
      }
      lostImage = reader.result;
      if (lostPreview instanceof HTMLImageElement) {
        lostPreview.src = lostImage;
        lostPreview.hidden = false;
      }
      refreshSubmit();
    };
    reader.readAsDataURL(file);
  });
  lostForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!lostImage || !lostConsent?.checked) {
      updateStatus('請選擇照片、同意傳送資料後再定位。GPS 和地標文字為可選。');
      return;
    }
    void runBusy(async () => {
      results = lostResults;
      const { context, bridge } = workflowContext();
      const capabilityResponse = await fetch('/api/genai/capabilities');
      const capability = await capabilityResponse.json().catch(() => null);
      if (!capabilityResponse.ok)
        throw new Error('未連接 Agent 後端。請啟動完整 demo 服務後再試。');
      if (!capability?.configured)
        throw new Error('Agent 尚未設定模型服務。請由管理員設定 vision provider 後再試。');
      const description =
        document.querySelector('[data-localization-description]')?.value.trim() || undefined;
      updateStatus('正在把照片、可選 GPS 和地標線索送交照片定位 agent…');
      const workflowResponse = await postWorkflow('/api/genai/workflows/localization', {
        context,
        image: lostImage,
        ...(lostPosition ? { position: lostPosition } : {}),
        ...(description ? { description } : {}),
      });
      renderWorkflowResponse(workflowResponse, context, bridge, 'localization');
    }, lostSubmit);
  });
}

function initialize() {
  initializeMapViewSync();
  syncMapFrame();
  initializeSheets();
  initializeSearch();
  initializeAccessibilitySettings();
  initializePlan();
  initializePreferences();
  initializeRoutes();
  initializeNavigation();
  initializeOperator();
  initializeHelp();
  const state = getDemoState();
  const trip = selectedTrip(state);
  document.querySelectorAll('[data-origin-summary]').forEach((node) => {
    node.textContent = trip.origin;
  });
  document.querySelectorAll('[data-destination-summary]').forEach((node) => {
    node.textContent = trip.destination;
  });
  document.querySelectorAll('[data-needs-summary]').forEach((node) => {
    node.textContent = currentProfile();
  });
  const simulation = document.querySelector('[data-weather-choice]');
  if (simulation && state.weather) simulation.value = state.weather;
  const weatherSummary = document.querySelector('[data-weather-summary]');
  const weatherDebugDetails = document.querySelector('[data-weather-debug]');
  const debugMode = new URLSearchParams(window.location.search).get('debug') === '1';
  if (weatherDebugDetails instanceof HTMLDetailsElement) {
    weatherDebugDetails.hidden = !debugMode;
    weatherDebugDetails.open = false;
  }
  const weatherLabels = {
    sunny: '晴天，維持路線偏好',
    rain: '雨天，建議有蓋路線',
    heat: '高溫，建議室內路線',
  };
  const updateWeatherSummary = (weather, source = 'manual') => {
    if (!weatherSummary) return;
    weatherSummary.textContent =
      source === 'hko'
        ? `天文台天氣 · ${weatherLabels[weather] || weatherLabels.sunny}`
        : `天氣偏好 · ${weatherLabels[weather] || weatherLabels.sunny}`;
  };
  updateWeatherSummary(state.weather || 'sunny', state.weatherSource || 'manual');
  const refreshWeatherButton = document.querySelector('[data-weather-refresh]');
  const weatherLocationButton = document.querySelector('[data-weather-location]');
  const weatherLocationStatus = document.querySelector('[data-weather-location-status]');
  const refreshWeather = async (location) => {
    if (refreshWeatherButton instanceof HTMLButtonElement) refreshWeatherButton.disabled = true;
    if (weatherSummary) weatherSummary.textContent = '正在讀取香港天文台天氣…';
    try {
      const query = new URLSearchParams();
      if (location) {
        query.set('latitude', String(location.latitude));
        query.set('longitude', String(location.longitude));
      }
      const response = await fetch(`/api/weather${query.size ? `?${query}` : ''}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error || `天氣服務暫時無法使用（HTTP ${response.status}）`);
      if (
        typeof data?.fetchedAt !== 'string' ||
        typeof data?.observedAt !== 'string' ||
        typeof data?.signals?.rainObserved !== 'boolean' ||
        typeof data?.signals?.hotForecast !== 'boolean' ||
        !['gps', 'ip', 'territory'].includes(data?.locationSource)
      )
        throw new Error('香港天文台天氣回應資料不完整');
      const weather = data.signals.rainObserved
        ? 'rain'
        : data.signals.hotForecast
          ? 'heat'
          : 'sunny';
      if (simulation instanceof HTMLSelectElement) simulation.value = weather;
      setDemoState({ weather, weatherSource: 'hko', weatherFetchedAt: data.fetchedAt });
      updateWeatherSummary(weather, 'hko');
      const locationSummary =
        data.location?.scope === 'nearby'
          ? `附近天氣：${data.location.temperatureStation} 氣溫、${data.location.rainfallArea} 雨量（最近氣溫站約 ${data.location.distanceKm} 公里）`
          : data.location?.scope === 'partial'
            ? '附近觀測站資料不完整，部分天氣指標使用全港資料。'
            : '';
      const observed = new Date(data.observedAt).toLocaleTimeString('zh-HK', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Hong_Kong',
      });
      if (weatherLocationStatus)
        weatherLocationStatus.textContent = `${data.locationSource === 'ip' ? '依據伺服器 IP 約略位置（可能不準確；託管平台可能按其政策處理連線 IP）。' : data.locationSource === 'gps' ? '依據你允許使用的 GPS 位置。' : '目前使用全港觀測資料。'}${locationSummary ? ` ${locationSummary}` : ''} 天氣更新時間 ${observed}；氣溫 ${data.temperatureC}°C、過去一小時雨量 ${data.rainfallLastHourMm} mm。天氣建議只影響路線排序，仍受通行條件限制。`;
      updateStatus(`天氣已更新：${weatherLabels[weather] || weatherLabels.sunny}。`);
    } catch (error) {
      if (weatherSummary) weatherSummary.textContent = '天氣資料暫不可用，自動建議暫停';
      if (weatherLocationStatus)
        weatherLocationStatus.textContent = `香港天文台天氣讀取失敗：${error instanceof Error ? error.message : String(error)}。未有自動更改路線，可重試或手動選擇天氣偏好。${location ? '本次 GPS 座標未保存。' : ''}`;
      updateStatus(
        `香港天文台天氣目前不可用；沒有自動更改路線。${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (refreshWeatherButton instanceof HTMLButtonElement) refreshWeatherButton.disabled = false;
    }
  };
  refreshWeatherButton?.addEventListener('click', refreshWeather);
  weatherLocationButton?.addEventListener('click', () => {
    if (!(weatherLocationButton instanceof HTMLButtonElement)) return;
    if (!navigator.geolocation) {
      if (weatherLocationStatus)
        weatherLocationStatus.textContent = '此瀏覽器不支援定位；可改用全港天氣資料。';
      return;
    }
    weatherLocationButton.disabled = true;
    if (weatherLocationStatus)
      weatherLocationStatus.textContent = '正在取得位置；瀏覽器可能會要求允許定位…';
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        void refreshWeather({ latitude: coords.latitude, longitude: coords.longitude }).finally(
          () => {
            weatherLocationButton.disabled = false;
          },
        );
      },
      (error) => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? '你未允許定位'
            : error.code === error.POSITION_UNAVAILABLE
              ? '目前無法取得位置'
              : '定位逾時';
        if (weatherLocationStatus)
          weatherLocationStatus.textContent = `${reason}；位置未保存，可改用全港天氣資料或重試。`;
        weatherLocationButton.disabled = false;
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  });
  if (simulation) void refreshWeather();
  simulation?.addEventListener('change', () => {
    const label =
      simulation.value === 'rain'
        ? '模擬大雨'
        : simulation.value === 'heat'
          ? '模擬高溫'
          : '模擬晴天';
    updateWeatherSummary(simulation.value, 'manual');
    setDemoState({
      weather: simulation.value,
      weatherSource: 'manual',
      ...(simulation.value === 'rain' || simulation.value === 'heat' ? { route: 'sheltered' } : {}),
    });
    const recommendation = simulation.value === 'sunny' ? '維持已選路線偏好' : '已建議有蓋優先';
    updateStatus(`${label}：${recommendation}。此路線天氣偏好由你手動選擇。`);
  });
}
initialize();
