const state = {
  tab: null,
  page: null,
  status: null,
  databaseContext: null
};

const $ = id => document.getElementById(id);

const STORE_PAID   = 'onluyen_paid_keys';
const STORE_FREE   = 'onluyen_free_keys';
const STORE_STATES = 'onluyen_key_states';
const STORE_SAVED_DB = 'onluyen_saved_db';

function savedDbStorageKey(url = state.tab?.url) {
  try {
    const parsed = new URL(url || '');
    const match = parsed.pathname.match(/^\/school\/test\/(?:(?:step|docx|history|result)\/)?([^/]+)/)
      || parsed.pathname.match(/^\/practices\/([^/]+)/);
    const testId = match?.[1];
    return testId ? `${STORE_SAVED_DB}:${testId}` : STORE_SAVED_DB;
  } catch (_error) {
    return STORE_SAVED_DB;
  }
}

function keyPreview(k) {
  if (!k || k.length < 8) return k || '';
  return k.substring(0, 8) + '···' + k.slice(-4);
}

function isSupportedGeminiKey(value) {
  const key = String(value || '').trim();
  return /^(?:AIza|AQ\.)[A-Za-z0-9._~-]+$/.test(key);
}

function appendKeyItem(root, key, index, type) {
  const item = document.createElement('div');
  item.className = 'key-item';
  const label = document.createElement('span');
  const ordinal = document.createElement('b');
  ordinal.textContent = `#${index + 1}`;
  label.append(ordinal, document.createTextNode(` ${keyPreview(key)}`));
  const remove = document.createElement('span');
  remove.className = 'key-del';
  remove.dataset.type = type;
  remove.dataset.key = key;
  remove.textContent = '✕';
  item.append(label, remove);
  root.appendChild(item);
}

function showMessage(text, type = 'info') {
  const el = $('message');
  el.textContent = text;
  el.className = `message show ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { el.className = 'message'; }, 4000);
}

function verificationSummary(report) {
  if (!report?.verified?.length) return '';
  const snapshot = report.verified.filter(item => item.basis === 'snapshot').length;
  return ` Xác minh: ${report.verified.length - snapshot} theo cấu trúc, ${snapshot} theo snapshot/nguồn gốc.`;
}

function showProgressError(error) {
  const text = error?.message || String(error);
  $('progressBox').className = 'progress-box show';
  $('progressBox').textContent = `❌ ${text}`;
  showMessage(text, 'error');
}

function setBusy(val) {
  document.querySelectorAll('button').forEach(b => {
    if (b.id !== 'btnStopBot') b.disabled = val;
  });
}

// ============================================================
// TAB CONTROLLER
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const target = $(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

// ============================================================
// COMMUNICATE WITH ONLUYEN TAB
// ============================================================
async function currentOnluyenTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/app\.onluyen\.vn\//.test(tab.url || '')) return null;
  return tab;
}

async function sendToPage(message, timeoutMs = ['OL_CALL_AI_SOLVE', 'OL_GET_AI_PROMPT', 'OL_LOAD_DATABASE', 'OL_VALIDATE_DATABASE', 'OL_START_BOT'].includes(message.action) ? 600000 : 15000) {
  if (!state.tab?.id) throw new Error('Không tìm thấy tab Onluyen đang mở.');
  const tabId = state.tab.id;
  const examKey = state.status?.examKey;
  let response;
  let timer;
  try {
    response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { ...message, examKey }).catch(() => {
        throw new Error('Chưa kết nối được trang. Hãy tải lại tab Onluyen (F5).');
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          message.action === 'OL_LOAD_DATABASE'
            ? 'Trang không phản hồi khi nạp JSON. Hãy tải lại tab Onluyen (F5) rồi mở lại tiện ích.'
            : 'Trang không phản hồi yêu cầu. Hãy tải lại tab Onluyen (F5) rồi mở lại tiện ích.'
        )), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (message.action !== 'OL_PING') {
    const currentTab = await currentOnluyenTab();
    if (currentTab?.id !== tabId || (examKey && savedDbStorageKey(currentTab.url) !== examKey)) {
      throw new Error('Đã chuyển sang bài khác. Tiện ích đang cập nhật đề hiện tại.');
    }
  }
  return response;
}

async function updateBotStatus() {
  state.tab = await currentOnluyenTab();
  if (!state.tab) {
    $('statusDot').className = 'dot bad';
    $('statusText').textContent = 'Tab hiện tại không phải app.onluyen.vn';
    return;
  }

  try {
    const res = await sendToPage({ action: 'OL_PING' });
    if (!res) return;
    state.status = res;
    const databaseContext = `${state.tab.id}:${res.examKey || savedDbStorageKey(res.url)}`;
    if (state.databaseContext !== databaseContext) {
      state.databaseContext = databaseContext;
      state.tab.url = res.url || state.tab.url;
      $('txtDatabase').value = res.databaseJson && res.databaseJson !== '[]' ? res.databaseJson : '';
      $('progressBox').className = 'progress-box';
      $('progressBox').textContent = '';
    }

    $('statusDot').className = 'dot ok';
    $('statusText').textContent = `Đã kết nối · ${res.route || 'Bài kiểm tra'}`;

    $('qCountPill').textContent = `${res.qCount || 0} câu`;
    $('apiStatusPill').textContent = res.hasApiData ? '🟢 API: Đã bắt trọn đề' : '🟡 DOM: Chờ dữ liệu';
    $('apiStatusPill').className = `pill ${res.hasApiData ? 'green' : ''}`;
    $('dbStatusPill').textContent = `DB: ${res.dbSize || 0} đáp án`;

    if (res.botRunning) {
      $('progressBox').className = 'progress-box show';
      $('progressBox').textContent = 'Bot đang tự động điền đáp án...';
    }
  } catch (err) {
    $('statusDot').className = 'dot warn';
    $('statusText').textContent = 'Chờ tải trang Onluyen (F5)...';
  }
}

// ============================================================
// CHẾ ĐỘ 1: PROMPT CHO AI NGOÀI & DATABASE
// ============================================================
$('btnCopyResultAnswers').addEventListener('click', async () => {
  setBusy(true);
  try {
    const res = await sendToPage({ action: 'OL_GET_HISTORY_ANSWERS' });
    if (!res?.ok) throw new Error(res?.error || 'Không đọc được đáp án từ trang Kết quả.');
    await navigator.clipboard.writeText(res.json);
    $('txtDatabase').value = res.json;
    showMessage(`Đã lấy và sao chép ${res.count} đáp án đúng!`, 'success');
  } catch (e) {
    showMessage(e.message, 'error');
  } finally {
    setBusy(false);
  }
});

$('btnCopyPrompt').addEventListener('click', async () => {
  setBusy(true);
  $('progressBox').className = 'progress-box show';
  $('progressBox').textContent = 'Đang đọc đủ đề và các phương án để tạo prompt...';
  try {
    const res = await sendToPage({ action: 'OL_GET_AI_PROMPT' });
    if (!res?.ok) throw new Error(res?.error || 'Không tạo được prompt.');
    await navigator.clipboard.writeText(res.parts?.[0] || res.prompt);
    if (res.parts?.length > 1) {
      for (let i = 0; i < res.parts.length; i++) await download(`OnluyenKit-prompt-${i + 1}.txt`, res.parts[i], 'text/plain');
    }
    const imageResults = await Promise.allSettled((res.images || []).map(image =>
      chrome.runtime.sendMessage({
        action: 'OL_DOWNLOAD_IMAGE',
        url: image.src,
        filename: image.filename
      }).then(result => {
        if (!result?.ok) throw new Error(result?.error || 'Không tải được ảnh.');
        return result;
      })
    ));
    const savedImages = imageResults.filter(result => result.status === 'fulfilled').length;
    const failedImages = imageResults.length - savedImages;
    $('progressBox').textContent = `✅ Đã tạo prompt cho ${res.count} câu.${res.parts?.length > 1 ? ` Đã lưu ${res.parts.length} phần vào Downloads; clipboard chứa phần 1. Gửi từng phần và gộp JSON trước khi nạp.` : ''}${failedImages ? ` Không tải được ${failedImages} ảnh; cần lấy lại ảnh trước khi giải.` : ''}`;
    showMessage(
      failedImages
        ? `Đã sao chép prompt; lưu được ${savedImages}/${imageResults.length} ảnh.`
        : `Đã sao chép prompt cho ${res.count} câu và lưu ${savedImages} ảnh vào Downloads!`,
      failedImages ? 'error' : 'success'
    );
  } catch (e) {
    showProgressError(e);
  } finally {
    setBusy(false);
  }
});

$('btnSaveDb').addEventListener('click', async () => {
  await updateBotStatus();
  const text = $('txtDatabase').value.trim();
  if (!text) {
    showMessage('Vui lòng dán JSON đáp án vào ô trước.', 'error');
    return;
  }
  setBusy(true);
  $('progressBox').className = 'progress-box show';
  $('progressBox').textContent = '📥 Đang nạp JSON...';
  try {
    const res = await sendToPage({ action: 'OL_LOAD_DATABASE', json: text });
    if (!res?.ok) throw new Error(res?.error || 'Lỗi nạp database.');
    const normalizedJson = res.json || text;
    $('txtDatabase').value = normalizedJson;
    await chrome.storage.local.set({ [savedDbStorageKey()]: normalizedJson });
    $('progressBox').textContent = `✅ Đã nạp ${res.count} câu vào Database.${verificationSummary(res.report)}`;
    showMessage(`Đã nạp thành công ${res.count} câu vào Database!`, 'success');
    updateBotStatus();
  } catch (e) {
    showProgressError(e);
  } finally {
    setBusy(false);
  }
});

$('btnClearDb').addEventListener('click', async () => {
  $('txtDatabase').value = '';
  await chrome.storage.local.remove([STORE_SAVED_DB, savedDbStorageKey()]);
  await sendToPage({ action: 'OL_LOAD_DATABASE', json: '[]' }).catch(() => {});
  showMessage('Đã xóa Database đáp án.');
  updateBotStatus();
});

// ============================================================
// CHẾ ĐỘ 2: GỌI GEMINI API TRỰC TIẾP
// ============================================================
$('btnAiSolve').addEventListener('click', async () => {
  setBusy(true);
  $('progressBox').className = 'progress-box show';
  $('progressBox').textContent = '⏳ Đang gửi đề lên Gemini API và chờ AI phân tích...';
  try {
    const res = await sendToPage({ action: 'OL_CALL_AI_SOLVE' });
    if (!res?.ok) throw new Error(res?.error || 'Gemini API gặp lỗi.');

    const normalizedJson = res.json || res.rawText || '';
    $('txtDatabase').value = normalizedJson;
    await chrome.storage.local.set({ [savedDbStorageKey()]: normalizedJson });
    $('progressBox').textContent = `✅ AI đã giải xong! Đã nạp ${res.dbCount} câu${res.imageCount ? ` cùng ${res.imageCount} ảnh` : ''} bằng model ${res.model} (${res.isPaid ? 'Paid Pro' : 'Free Flash'}).`;
    showMessage(`Hoàn tất! AI giải được ${res.dbCount} câu hỏi.`, 'success');
    updateBotStatus();
  } catch (e) {
    $('progressBox').textContent = `❌ Lỗi: ${e.message}`;
    showMessage(e.message, 'error');
  } finally {
    setBusy(false);
  }
});

// ============================================================
// ĐỘNG CƠ TỰ ĐIỀN ĐÁP ÁN (AUTO CLICKER)
// ============================================================
$('btnStartBot').addEventListener('click', async () => {
  setBusy(true);
  try {
    await updateBotStatus();
    $('progressBox').className = 'progress-box show';
    const databaseText = $('txtDatabase').value.trim();
    $('progressBox').textContent = '🚀 Đang xác minh và bắt đầu tự điền...';
    const res = await sendToPage({ action: 'OL_START_BOT', ...(databaseText ? { json: databaseText } : {}) });
    if (!res?.ok) throw new Error(res?.error || 'Không thể khởi chạy bot.');
    if (res.json) $('txtDatabase').value = res.json;
  } catch (e) {
    showProgressError(e);
  } finally {
    setBusy(false);
  }
});

$('btnStopBot').addEventListener('click', async () => {
  try {
    await sendToPage({ action: 'OL_STOP_BOT' });
    $('progressBox').textContent = '⏹️ Đã dừng bot.';
    showMessage('Đã gửi lệnh dừng bot.');
  } catch (e) {
    showMessage(e.message, 'error');
  }
});

$('btnValidateDb').addEventListener('click', async () => {
  setBusy(true);
  try {
    await updateBotStatus();
    $('progressBox').className = 'progress-box show';
    $('progressBox').textContent = 'Đang đọc và kiểm tra toàn bộ đề...';
    const result = await sendToPage({ action: 'OL_VALIDATE_DATABASE', json: $('txtDatabase').value.trim() || undefined });
    if (!result?.ok) throw new Error(result?.error || 'Kiểm tra thất bại.');
    $('progressBox').textContent = `Đã kiểm tra đủ ${result.count} câu. Có thể tự điền.${verificationSummary(result.report)}`;
  } catch (error) { showProgressError(error); }
  finally { setBusy(false); }
});

$('btnMatchReport').addEventListener('click', async () => {
  try {
    const result = await sendToPage({ action: 'OL_GET_MATCH_REPORT' });
    if (!result?.ok) throw new Error(result?.error || 'Chưa có báo cáo.');
    await download('onluyen-match-report.json', JSON.stringify(result.report, null, 2), 'application/json;charset=utf-8');
  } catch (error) { showMessage(error.message, 'error'); }
});

// Lắng nghe thông báo tiến độ từ content script
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'BOT_PROGRESS') {
    $('progressBox').className = 'progress-box show';
    $('progressBox').textContent = `⏳ ${message.text || ''}`;
  }
  if (message?.action === 'BOT_DONE') {
    $('progressBox').className = 'progress-box show';
    $('progressBox').textContent = `🎉 ${message.text || 'Hoàn tất!'}`;
    showMessage(message.text || 'Đã hoàn tất tự điền bài!', 'success');
  }
  if (message?.action === 'BOT_ERROR') {
    $('progressBox').className = 'progress-box show';
    $('progressBox').textContent = `❌ ${message.error || 'Lỗi bot'}`;
    showMessage(message.error || 'Lỗi khi chạy bot', 'error');
  }
});

// ============================================================
// QUẢN LÝ GEMINI KEY POOL (TAB 2)
// ============================================================
async function loadAndRenderKeys() {
  const data = await chrome.storage.local.get([STORE_PAID, STORE_FREE]);
  const paidKeys = data[STORE_PAID] || [];
  const freeKeys = data[STORE_FREE] || [];

  // Render Paid Keys
  const paidRoot = $('paidKeyList');
  paidRoot.replaceChildren();
  if (!paidKeys.length) {
    paidRoot.innerHTML = '<div style="color:var(--muted); font-size:10px;">Chưa có key trả phí nào.</div>';
  } else {
    paidKeys.forEach((key, idx) => appendKeyItem(paidRoot, key, idx, 'paid'));
  }

  // Render Free Keys
  const freeRoot = $('freeKeyList');
  freeRoot.replaceChildren();
  if (!freeKeys.length) {
    freeRoot.innerHTML = '<div style="color:var(--muted); font-size:10px;">Chưa có key miễn phí nào.</div>';
  } else {
    freeKeys.forEach((key, idx) => appendKeyItem(freeRoot, key, idx, 'free'));
  }

  // Gán sự kiện xóa key
  document.querySelectorAll('.key-del').forEach(el => {
    el.addEventListener('click', async () => {
      const type = el.dataset.type;
      const key = el.dataset.key;
      const storeKey = type === 'paid' ? STORE_PAID : STORE_FREE;
      const d = await chrome.storage.local.get(storeKey);
      const filtered = (d[storeKey] || []).filter(k => k !== key);
      await chrome.storage.local.set({ [storeKey]: filtered });
      loadAndRenderKeys();
      showMessage('Đã xóa key.', 'info');
    });
  });
}

$('btnAddPaidKey').addEventListener('click', async () => {
  const raw = $('txtPaidKeyInput').value.trim();
  if (!raw) return;
  const lines = raw.split(/[\r\n,; ]+/).map(s => s.trim()).filter(Boolean);
  const data = await chrome.storage.local.get(STORE_PAID);
  const existing = new Set(data[STORE_PAID] || []);
  let added = 0;
  for (const k of lines) {
    if (isSupportedGeminiKey(k) && !existing.has(k)) {
      existing.add(k);
      added++;
    }
  }
  await chrome.storage.local.set({ [STORE_PAID]: [...existing] });
  $('txtPaidKeyInput').value = '';
  loadAndRenderKeys();
  showMessage(`Đã thêm ${added} Paid Key hợp lệ.`, 'success');
});

$('btnAddFreeKey').addEventListener('click', async () => {
  const raw = $('txtFreeKeyInput').value.trim();
  if (!raw) return;
  const lines = raw.split(/[\r\n,; ]+/).map(s => s.trim()).filter(Boolean);
  const data = await chrome.storage.local.get(STORE_FREE);
  const existing = new Set(data[STORE_FREE] || []);
  let added = 0;
  for (const k of lines) {
    if (isSupportedGeminiKey(k) && !existing.has(k)) {
      existing.add(k);
      added++;
    }
  }
  await chrome.storage.local.set({ [STORE_FREE]: [...existing] });
  $('txtFreeKeyInput').value = '';
  loadAndRenderKeys();
  showMessage(`Đã thêm ${added} Free Key hợp lệ.`, 'success');
});

// ============================================================
// TAB 3: GHI CHÚ, XUẤT FILE (BẢO TOÀN TÍNH NĂNG CŨ)
// ============================================================
function safeFilename(value) {
  return String(value || 'onluyen')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'onluyen';
}

function pageToMarkdown(page) {
  const lines = [
    `# ${page.title}`,
    '',
    `- Nguồn: ${page.url}`,
    `- Loại trang: ${page.route}`,
    `- Thời điểm xuất: ${new Date(page.capturedAt).toLocaleString('vi-VN')}`,
    ''
  ];
  if (page.questions?.length) {
    lines.push('## Câu hỏi', '');
    for (const item of page.questions) lines.push(`### Câu ${item.number}`, '', item.text || item.prompt, '');
  } else {
    lines.push('## Nội dung', '', page.text || '_Không tìm thấy nội dung hiển thị._', '');
  }
  return lines.join('\n');
}

async function download(filename, content, mime) {
  const response = await chrome.runtime.sendMessage({
    action: 'OL_DOWNLOAD', filename, content, mime
  });
  if (!response?.ok) throw new Error(response?.error || 'Không thể tạo file tải xuống.');
}

async function loadNote() {
  if (!state.page?.url) return;
  const key = `note:${state.page.url}`;
  const data = await chrome.storage.local.get(key);
  $('note').value = data[key]?.text || '';
  $('bookmark').textContent = data[key]?.bookmarked ? '★ Đã đánh dấu' : '☆ Đánh dấu';
}

async function saveNote(toggleBookmark = false) {
  if (!state.page?.url) throw new Error('Chưa có trang để lưu ghi chú.');
  const key = `note:${state.page.url}`;
  const existing = (await chrome.storage.local.get(key))[key] || {};
  const entry = {
    title: state.page.title,
    url: state.page.url,
    text: $('note').value.trim(),
    bookmarked: toggleBookmark ? !existing.bookmarked : Boolean(existing.bookmarked),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [key]: entry });
  $('bookmark').textContent = entry.bookmarked ? '★ Đã đánh dấu' : '☆ Đánh dấu';
  showMessage(toggleBookmark ? (entry.bookmarked ? 'Đã đánh dấu.' : 'Đã bỏ đánh dấu.') : 'Đã lưu ghi chú.');
}

async function collectPageData() {
  setBusy(true);
  try {
    const res = await sendToPage({ action: 'OL_COLLECT' });
    if (!res?.ok) throw new Error('Không thể đọc nội dung trang.');
    state.page = res.page;
    await loadNote();
  } finally {
    setBusy(false);
  }
}

$('refresh').addEventListener('click', () => {
  collectPageData().then(updateBotStatus).catch(e => showMessage(e.message, 'error'));
});

$('copyTutor').addEventListener('click', async () => {
  setBusy(true);
  try {
    const res = await sendToPage({ action: 'OL_TUTOR_PROMPT' });
    if (!res?.ok) throw new Error('Không tạo được prompt gợi ý.');
    await navigator.clipboard.writeText(res.prompt);
    showMessage('Đã sao chép prompt gợi ý Socratic.', 'success');
  } catch (e) {
    showMessage(e.message, 'error');
  } finally {
    setBusy(false);
  }
});

$('exportMd').addEventListener('click', async () => {
  try {
    if (!state.page) await collectPageData();
    await download(`${safeFilename(state.page.title)}.md`, pageToMarkdown(state.page), 'text/markdown;charset=utf-8');
    showMessage('Đã xuất file Markdown.', 'success');
  } catch (e) { showMessage(e.message, 'error'); }
});

$('exportJson').addEventListener('click', async () => {
  try {
    if (!state.page) await collectPageData();
    await download(`${safeFilename(state.page.title)}.json`, JSON.stringify(state.page, null, 2), 'application/json;charset=utf-8');
    showMessage('Đã xuất file JSON.', 'success');
  } catch (e) { showMessage(e.message, 'error'); }
});

$('saveNote').addEventListener('click', () => saveNote(false).catch(e => showMessage(e.message, 'error')));
$('bookmark').addEventListener('click', () => saveNote(true).catch(e => showMessage(e.message, 'error')));

$('openFeedback').addEventListener('click', () => {
  document.querySelector('[data-tab="tabNotes"]').click();
  $('feedbackCard').scrollIntoView({ block: 'start' });
});

$('copyDiscord').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('lam017367');
    showMessage('Đã sao chép Discord: lam017367.', 'success');
  } catch (e) { showMessage(e.message, 'error'); }
});

$('copyFeedback').addEventListener('click', async () => {
  try {
    const version = chrome.runtime.getManifest().version;
    const template = [
      'Báo lỗi OnluyenKit',
      `Phiên bản extension: ${version}`,
      'Trình duyệt và phiên bản: ',
      'Loại câu hỏi (MCQ / Đúng-Sai / Trả lời ngắn): ',
      '',
      'Các bước tái hiện:',
      '1. ',
      '2. ',
      '',
      'Kết quả mong đợi: ',
      'Kết quả thực tế / thông báo lỗi: ',
      'Ảnh minh họa (che thông tin cá nhân): ',
      '',
      'Không đính kèm API key, mật khẩu hoặc dữ liệu tài khoản.'
    ].join('\n');
    await navigator.clipboard.writeText(template);
    showMessage('Đã sao chép mẫu. Điền nội dung rồi gửi qua kênh bạn chọn.', 'success');
  } catch (e) { showMessage(e.message, 'error'); }
});

// ============================================================
// KHỞI ĐỘNG
// ============================================================
(async () => {
  // Nạp danh sách key
  await loadAndRenderKeys();

  // Kiểm tra trạng thái kết nối
  await updateBotStatus();
  setInterval(updateBotStatus, 1000);
})();
