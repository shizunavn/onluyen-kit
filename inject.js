// inject.js — chạy trong PAGE CONTEXT của https://app.onluyen.vn/
// Hook API để bắt trọn bộ dữ liệu đề thi (Doing data) và gửi sang content.js

(function hookOnluyenAPI() {
  if (window.__ONLUYEN_INJECT_LOADED__) return;
  window.__ONLUYEN_INJECT_LOADED__ = true;

  console.log('🦉 [OnluyenBot] Inject script đã kích hoạt trong Page Context');

  function questionArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.questions)) return raw.questions;
    if (Array.isArray(raw?.data)) return raw.data;
    if (Array.isArray(raw?.data?.data)) return raw.data.data;
    if (Array.isArray(raw?.data?.questions)) return raw.data.questions;
    return [];
  }

  function isQuestionData(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const questions = questionArray(obj);
    const first = questions[0];
    return !!(first && (first.dataStandard || first.dataMaterial));
  }

  function emitData(raw) {
    try {
      const questions = questionArray(raw);
      const assignmentInfo = raw?.data && !Array.isArray(raw.data) ? raw.data : null;

      if (questions.length > 0) {
        window.__ONLUYEN_CACHED_QUESTIONS__ = questions;
        window.__ONLUYEN_ASSIGNMENT_INFO__ = assignmentInfo;
        window.postMessage({
          type: 'ONLUYEN_RAW_TEST_DATA',
          payload: {
            questions,
            assignmentInfo
          }
        }, '*');
        console.log(`🔥 [OnluyenBot] Đã hook thành công ${questions.length} câu hỏi!`);
      }
    } catch (err) {
      console.warn('⚠️ [OnluyenBot] Lỗi emitData:', err);
    }
  }

  // 1. Hook XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._ol_url = url;
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      try {
        const url = String(this._ol_url || '');
        if (url.includes('/school-online/assignment/doing/') || url.includes('/check-assign/doing/') || url.includes('/tests/')) {
          if (this.responseText) {
            const parsed = JSON.parse(this.responseText);
            if (isQuestionData(parsed)) {
              emitData(parsed);
            }
          }
        }
      } catch (_) {}
    });
    return originalXhrSend.apply(this, arguments);
  };

  // 2. Hook Fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = String(args[0]?.url || args[0] || '');
      if (url.includes('/school-online/assignment/doing/') || url.includes('/check-assign/doing/') || url.includes('/tests/')) {
        const clone = response.clone();
        clone.json().then(data => {
          if (isQuestionData(data)) {
            emitData(data);
          }
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  // 3. Hook JSON.parse (bắt mọi luồng Deserialize của Angular)
  const originalJsonParse = JSON.parse;
  JSON.parse = function(text, reviver) {
    const res = originalJsonParse(text, reviver);
    try {
      if (isQuestionData(res)) {
        emitData(res);
      }
    } catch (_) {}
    return res;
  };
})();
