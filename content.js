(() => {
  if (window.__ONLUYEN_STUDY_HELPER__) return;
  window.__ONLUYEN_STUDY_HELPER__ = true;
  const math = globalThis.OnluyenMath;
  if (!math) throw new Error('Thiếu math-content.js; hãy reload extension.');

  // ============================================================
  // 1. TIÊM INJECT.JS VÀO PAGE CONTEXT ĐỂ HOOK API ĐỀ THI
  // ============================================================
  function injectHookScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (e) {
      console.warn('⚠️ [OnluyenBot] Không thể tiêm inject.js:', e);
    }
  }
  injectHookScript();

  // Biến lưu trữ dữ liệu đề thi bắt được từ API và cơ sở dữ liệu đáp án
  window.__ONLUYEN_RAW_DATA__ = null;
  window.__ONLUYEN_RAW_DATA_SCORE__ = 0;
  window.__ONLUYEN_DATABASE__ = new Map(); // key: questionNumber (1..N) -> { type, answer, raw }
  window.__ONLUYEN_DATABASE_BY_ID__ = new Map();
  window.__ONLUYEN_DATABASE_BY_PROMPT__ = new Map();
  window.__ONLUYEN_DATABASE_EXPORT__ = [];
  window.__BOT_RUNNING__ = false;

  function examStorageKey(url = location.href) {
    const path = new URL(url).pathname;
    const match = path.match(/^\/school\/test\/(?:(?:step|history|result)\/)?([^/]+)/)
      || path.match(/^\/practices\/([^/]+)/);
    return match ? `onluyen_saved_db:${match[1]}` : null;
  }

  let activeExamKey = examStorageKey();
  let examRevision = 0;
  let examRestore = Promise.resolve();
  let examSnapshot = null;
  let examSnapshotContext = null;
  let examCollection = null;
  let collectionCancelled = false;
  let promptSnapshot = null;
  let lastMatchReport = null;
  let databaseValidation = null;
  let stagedDatabaseInput = null;
  let preflightRunning = false;
  let validationCancelled = false;

  function restoreExamDatabase(key, revision) {
    return new Promise(resolve => {
      if (!key) return resolve();
      chrome.storage.local.get([key], saved => {
        if (revision === examRevision && key === examStorageKey()) {
          stagedDatabaseInput = saved[key] || null;
        }
        resolve();
      });
    });
  }

  function syncExamContext() {
    const key = examStorageKey();
    if (key === activeExamKey) return examRestore;
    activeExamKey = key;
    const revision = ++examRevision;
    stopAutoBot();
    examSnapshot = null;
    examSnapshotContext = null;
    promptSnapshot = null;
    databaseValidation = null;
    lastMatchReport = null;
    stagedDatabaseInput = null;
    window.__ONLUYEN_RAW_DATA__ = null;
    window.__ONLUYEN_RAW_DATA_SCORE__ = 0;
    parseAndLoadDatabase([]);
    examRestore = restoreExamDatabase(key, revision);
    return examRestore;
  }

  function persistExamDatabase(key = activeExamKey, json = databaseExportJson()) {
    return key ? chrome.storage.local.set({ [key]: json }) : Promise.resolve();
  }

  function rawDataScore(payload) {
    try {
      return JSON.stringify(payload?.questions || []).length;
    } catch (_error) {
      return 0;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'ONLUYEN_RAW_TEST_DATA') {
      syncExamContext();
      const nextPayload = event.data.payload;
      const nextScore = rawDataScore(nextPayload);
      if (nextScore < window.__ONLUYEN_RAW_DATA_SCORE__) {
        console.log(`📦 [OnluyenBot] Bỏ qua payload rút gọn (${nextScore} < ${window.__ONLUYEN_RAW_DATA_SCORE__}).`);
        return;
      }
      window.__ONLUYEN_RAW_DATA__ = nextPayload;
      window.__ONLUYEN_RAW_DATA_SCORE__ = nextScore;
      console.log(`📦 [OnluyenBot] Đã đồng bộ ${nextPayload.questions?.length || 0} câu (độ đầy đủ ${nextScore}).`);
      const parsedQuestions = parseQuestionsFromRawAPI() || [];
      refreshExamSnapshot(false);
      const completeQuestions = parsedQuestions.filter(question =>
        question.prompt && (question.answerType === 'SHORT' || question.choices.length)
      );
      console.log(`📚 [OnluyenBot] Parser API: ${completeQuestions.length}/${parsedQuestions.length} câu có đủ đề và lựa chọn.`);
      chrome.runtime.sendMessage({
        action: 'OL_BADGE',
        text: `${nextPayload.questions?.length || 'OK'}`,
        type: 'saved'
      }).catch(() => {});
    }
  });

  // ============================================================
  // 2. CẤU HÌNH AI & GEMINI MODELS (2026 Ready)
  // ============================================================
  // Paid Keys: Ưu tiên Pro model mới nhất
  const CS_MODEL_PRO       = 'gemini-3.5-pro';
  // Free Keys: Chỉ dùng Flash và Flash-lite (KHÔNG dùng Pro cho free keys)
  const CS_MODEL_FLASH     = 'gemini-3.5-flash';
  const CS_MODEL_FALLBACK  = 'gemini-3.5-flash-lite';
  const CS_MODEL_PREVIEW   = 'gemini-3-flash-preview';

  const CS_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1alpha/models';

  const STORE_PAID   = 'onluyen_paid_keys';
  const STORE_FREE   = 'onluyen_free_keys';
  const STORE_STATES = 'onluyen_key_states';

  const ROUTES = [
    [/\/profile(?:\/|$)/, 'Hồ sơ'],
    [/\/school\/test(?:\/|$)/, 'Bài kiểm tra'],
    [/\/school\/student\/assignment(?:\/|$)/, 'Bài tập'],
    [/\/practices(?:\/|$)/, 'Tự luyện'],
    [/\/self-learning(?:\/|$)/, 'Tự học'],
    [/\/learn(?:\/|$)/, 'Khóa học'],
    [/\/onluyenplus(?:\/|$)/, 'Ôn luyện Plus'],
    [/\/home-student(?:\/|$)/, 'Trang chủ']
  ];

  const QUESTION_SELECTORS = [
    '#test-step-question',
    '.test-step-question',
    'app-practice-step-question-option',
    'app-practice-step-question-true-false',
    'app-practice-step-data-question-nonresult',
    'app-practice-step-question-judge',
    '.question-container',
    '[data-question-id]',
    '[class~="question"]',
    '[class*="question-item"]',
    '[class*="question-content"]',
    '[class*="exam-question"]',
    'app-question',
    'app-question-item'
  ];

  const SKIP_SELECTORS = [
    'script', 'style', 'noscript', 'svg', 'nav', 'footer',
    '[aria-hidden="true"]', '.sidebar', '[class*="sidebar"]',
    '[class*="breadcrumb"]', '[class*="chat"]'
  ].join(',');

  function cleanText(value) {
    return String(value || '')
      .replace(/<\/?[A-Za-z][^>]*>/g, '') // Bỏ thẻ HTML, không nuốt biểu thức x < 2
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function semanticElementText(element) {
    return element ? math.text(element) : '';
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function redactPersonalData(text) {
    return text
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email đã ẩn]')
      .replace(/(?:\+?84|0)(?:\d[ .-]?){8,10}\d/g, '[số điện thoại đã ẩn]');
  }

  function routeLabel() {
    const match = ROUTES.find(([pattern]) => pattern.test(location.pathname));
    return match?.[1] || 'Nội dung học tập';
  }

  function pageTitle() {
    const candidates = [
      document.querySelector('main h1'),
      document.querySelector('main h2'),
      document.querySelector('.page-scroll h1'),
      document.querySelector('.page-scroll h2'),
      document.querySelector('.page-scroll .subject-title'),
      document.querySelector('.page-scroll .question-name'),
      document.querySelector('.page-scroll .page-title'),
      document.querySelector('.page-scroll [class~="title"]'),
      document.querySelector('h1'),
      document.querySelector('h2')
    ].filter(Boolean);
    const title = candidates.map(el => cleanText(el.innerText)).find(Boolean);
    return title || routeLabel();
  }

  function extractHeadings() {
    return [...document.querySelectorAll('main h1, main h2, main h3, .page-scroll h1, .page-scroll h2, .page-scroll h3')]
      .filter(isVisible)
      .map(el => cleanText(el.innerText))
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .slice(0, 40);
  }

  // ============================================================
  // 3. TRÍCH XUẤT ĐỀ THI TOÀN DIỆN (API FIRST + DOM FALLBACK)
  // ============================================================
  function localizedQuestionData(question) {
    if (!question || typeof question !== 'object') return {};
    const language = question.currentLang || question.currentLanguage || 'vi';
    const languages = question.languagesData || question.languageData || {};
    return languages[language] || languages.vi || Object.values(languages)[0] || {};
  }

  function normalizeImageSource(value) {
    const source = String(value || '').trim();
    if (!source) return null;
    if (/^data:image\//i.test(source) || /^blob:/i.test(source)) return source;
    try {
      const absolute = new URL(source, location.href);
      return /^https?:$/i.test(absolute.protocol) ? absolute.href : null;
    } catch (_error) {
      return null;
    }
  }

  function imagesFromHtml(...htmlValues) {
    const images = [];
    for (const html of htmlValues.flat(Infinity)) {
      if (!html || typeof html !== 'string' || !/<img\b/i.test(html)) continue;
      const template = document.createElement('template');
      template.innerHTML = html;
      for (const image of template.content.querySelectorAll('img')) {
        const src = normalizeImageSource(image.getAttribute('src') || image.getAttribute('data-src') || image.getAttribute('data-original'));
        if (src) images.push({ src, alt: cleanText(image.getAttribute('alt')) });
      }
    }
    return images;
  }

  function imagesFromRoot(root) {
    return [...root.querySelectorAll('.question-name img, .question-text img, .question-option img, .select-item img')]
      .map(image => ({
        src: normalizeImageSource(image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-original')),
        alt: cleanText(image.alt)
      }))
      .filter(image => image.src);
  }

  function uniqueImages(images) {
    const seen = new Set();
    return (images || []).filter(image => {
      if (!image?.src || seen.has(image.src)) return false;
      seen.add(image.src);
      return true;
    });
  }

  function choiceImages(root) {
    return uniqueImages([...root.querySelectorAll('img')].map(image => ({
      src: normalizeImageSource(image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src') || image.getAttribute('data-original')),
      alt: cleanText(image.alt)
    })));
  }

  function imageMimeFromSource(source) {
    return String(source || '').match(/^data:(image\/[\w.+-]+)[;,]/i)?.[1]?.toLowerCase() || null;
  }

  function imageExtension(image) {
    const base64 = String(image?.src || '').match(/^data:image\/[\w.+-]+;base64,([^\s]+)/i)?.[1] || '';
    if (/^iVBOR/i.test(base64)) return 'png';
    if (/^\/9j\//i.test(base64)) return 'jpg';
    if (/^R0lGOD/i.test(base64)) return 'gif';
    if (/^UklGR/i.test(base64)) return 'webp';
    const mime = imageMimeFromSource(image?.src);
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/svg+xml') return 'svg';
    try {
      const extension = new URL(image?.src).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(extension)) return extension === 'jpeg' ? 'jpg' : extension;
    } catch (_error) {}
    return 'png';
  }

  function promptImageFiles(questions) {
    const files = [];
    for (const question of questions) {
      uniqueImages(question.images).forEach((image, index) => {
        files.push({
          question: question.number,
          index: index + 1,
          filename: `Onluyen-Prompt/cau-${String(question.number).padStart(2, '0')}-anh-${String(index + 1).padStart(2, '0')}.${imageExtension(image)}`,
          src: image.src,
          alt: image.alt || '',
          choiceLabels: (question.choices || []).filter(choice => (choice.images || []).some(item => item.src === image.src)).map(choice => choice.label)
        });
      });
    }
    return files;
  }

  function normalizeApiQuestion(question, fallbackNumber, materialPrompt = '', materialImages = []) {
    if (!question || typeof question !== 'object') return null;
    const localized = localizedQuestionData(question);
    const prompt = math.text(
      localized.content
      || localized.question
      || question.content
      || question.question
      || question.contentHtml
    );
    const optionSource = Array.isArray(localized.options) && localized.options.length
      ? localized.options
      : Array.isArray(question.options) ? question.options : [];
    const isTrueFalse = Number(question.typeAnswer) === 1;
    const isShortAnswer = Number(question.typeAnswer) === 2;
    const choices = optionSource.map((option, optionIndex) => {
      option = option || {};
      const localizedOption = localizedQuestionData({ ...option, currentLang: question.currentLang || question.currentLanguage || 'vi' });
      const source = typeof option === 'string' ? (/^(?:[a-f0-9]{24}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(option) ? '' : option)
        : localizedOption.content || localizedOption.text || option.content || option.contentHtml || option.text || option.value || '';
      return {
      label: String.fromCharCode((isTrueFalse ? 97 : 65) + optionIndex),
      idOption: option.idOption,
      text: math.text(source),
      math_content: math.metadata(source),
      images: uniqueImages(imagesFromHtml(source))
    }; }).filter(option => option.text || option.images.length);
    const fullPrompt = materialPrompt
      ? cleanText(`[Đoạn tư liệu: ${math.text(materialPrompt)}]\n${prompt}`)
      : prompt;
    const number = Number(question.stepIndex) >= 0
      ? Number(question.stepIndex) + 1
      : fallbackNumber;
    const images = uniqueImages([
      ...materialImages,
      ...choices.flatMap(choice => choice.images),
      ...imagesFromHtml(
        localized.content,
        localized.question,
        question.content,
        question.question,
        question.contentHtml,
        optionSource.map(option => option.content || option.text || option.value)
      )
    ]);
    return {
      number,
      stepId: question.stepId,
      sourceId: question.numberQuestion ? String(question.numberQuestion) : null,
      typeAnswer: question.typeAnswer ?? 0,
      answerType: isTrueFalse ? 'TF' : isShortAnswer ? 'SHORT' : 'MCQ',
      prompt: fullPrompt,
      math_content: { version: 1, question: materialPrompt
        ? math.combine('[Đoạn tư liệu:', materialPrompt, ']', localized.content || localized.question || question.content || question.question || question.contentHtml || '')
        : math.metadata(localized.content || localized.question || question.content || question.question || question.contentHtml || '') },
      choices,
      expectedChoiceCount: optionSource.length,
      images,
      raw: question
    };
  }

  function parseQuestionsFromRawAPI() {
    const raw = window.__ONLUYEN_RAW_DATA__;
    if (!raw || !Array.isArray(raw.questions) || raw.questions.length === 0) return null;

    const list = [];
    let qIndex = 1;

    for (const item of raw.questions) {
      const materialQuestions = item.dataMaterial?.datas || item.dataMaterial?.data;
      if (item.dataMaterial && Array.isArray(materialQuestions) && materialQuestions.length > 0) {
        const materialHtml = item.dataMaterial.contentHtml || item.dataMaterial.content || '';
        const materialPrompt = materialHtml;
        const materialImages = imagesFromHtml(materialHtml);
        for (const sub of materialQuestions) {
          const normalized = normalizeApiQuestion(sub, qIndex, materialPrompt, materialImages);
          if (normalized) list.push(normalized);
          qIndex++;
        }
      } else if (item.dataStandard) {
        const normalized = normalizeApiQuestion(item.dataStandard, qIndex);
        if (normalized) list.push(normalized);
        qIndex++;
      }
    }
    return list.length > 0 && list.some(question => question.prompt || question.choices.length)
      ? list.sort((a, b) => a.number - b.number)
      : null;
  }

  function extractStructuredTestQuestions() {
    const roots = [...document.querySelectorAll([
      '#test-step-question .question-container',
      'app-practice-step-question-option',
      'app-practice-step-question-true-false',
      'app-practice-step-data-question-nonresult',
      'app-practice-step-question-judge'
    ].join(','))];
    return roots
      .filter(isVisible)
      .map((root, index) => {
        const numberText = cleanText(root.querySelector('.question-info .num, .question-header .num')?.innerText);
        const questionPrompt = semanticElementText(root.querySelector('.question-name'));
        const materialPrompt = semanticElementText(root.querySelector('.question-text'));
        const prompt = materialPrompt && !questionPrompt.includes(materialPrompt)
          ? cleanText(`[Đoạn tư liệu: ${materialPrompt}]\n${questionPrompt}`)
          : questionPrompt || materialPrompt;
        const regularChoices = [...root.querySelectorAll('.question-option, .select-item')].map((choice, choiceIndex) => ({
          label: cleanText(choice.querySelector('.question-option-label, .number-item')?.innerText) || String.fromCharCode(65 + choiceIndex),
          text: semanticElementText(choice.querySelector('.question-option-content') || choice.querySelector('label')),
          math_content: math.metadata(choice.querySelector('.question-option-content') || choice.querySelector('label')),
          idOption: choice.dataset.idOption,
          images: choiceImages(choice)
        })).filter(choice => choice.text || choice.images.length);
        const trueFalseChoices = [...root.querySelectorAll('.child-content')]
          .filter(row => row.querySelector('.true-false input[type="radio"]'))
          .map((row, rowIndex) => {
            const rawLabel = cleanText(row.querySelector('.option-char')?.innerText);
            const label = rawLabel.match(/([a-z])\s*[).:\]]?/i)?.[1]?.toLowerCase()
              || String.fromCharCode(97 + rowIndex);
            const optionText = row.querySelector('.option-text');
            const text = semanticElementText(optionText?.querySelector('.fadein') || optionText);
            return { label, text, math_content: math.metadata(optionText?.querySelector('.fadein') || optionText) };
          })
          .filter(choice => choice.text);
        const shortInput = root.querySelector('.answer-input input[type="text"], input.can-resize-second, input[config-typeaction]');
        const answerType = trueFalseChoices.length ? 'TF' : shortInput ? 'SHORT' : 'MCQ';
        const choices = trueFalseChoices.length ? trueFalseChoices : regularChoices;
        const number = Number(numberText.match(/Câu\s*:?\s*(\d+)/i)?.[1] || numberText.match(/\d+/)?.[0]) || index + 1;
        const questionIdText = cleanText(root.querySelector('.question-id')?.innerText);
        const sourceId = numberText.match(/#(\d+)/)?.[1] || questionIdText.match(/#?(\d+)/)?.[1] || null;
        const text = cleanText([
          prompt,
          ...choices.map(choice => `${choice.label}${answerType === 'TF' ? ')' : '.'} ${choice.text}`)
        ].join('\n'));
        const images = uniqueImages(imagesFromRoot(root));
        return { number, sourceId, answerType, prompt, choices, images, text,
          math_content: { version: 1, question: materialPrompt
            ? math.combine('[Đoạn tư liệu:', root.querySelector('.question-text'), ']', root.querySelector('.question-name'))
            : math.metadata(root.querySelector('.question-name') || root.querySelector('.question-text')) } };
      })
      .filter(question => question.prompt || question.choices.length);
  }

  function getFullExamQuestions() {
    if (examSnapshot) return examSnapshot;
    // 1. Thử lấy từ API data trước (chuẩn 100% cả đề)
    const fromApi = parseQuestionsFromRawAPI();
    if (fromApi) return fromApi;

    // 2. Fallback lấy từ DOM hiện tại
    const domQuestions = extractStructuredTestQuestions();
    if (domQuestions.length > 0) {
      return domQuestions.map(q => ({
        number: q.number,
        stepId: null,
        sourceId: q.sourceId,
        typeAnswer: q.answerType,
        answerType: q.answerType,
        prompt: q.prompt,
        math_content: q.math_content,
        choices: q.choices,
        images: q.images || [],
        raw: null
      }));
    }
    return [];
  }

  function hasCompleteChoices(question) {
    return question.answerType === 'SHORT' || (question.choices.length >= Math.max(2, question.expectedChoiceCount || 0)
      && question.choices.every(choice => choice.text || choice.images?.length));
  }

  function sidebarQuestionNumbers() {
    return [...new Set([...document.querySelectorAll('.answer-sheet .option, app-sidebar-school-test .option, [class*="sidebar"] span, [class*="sidebar"] button')]
      .filter(isVisible).map(el => cleanText(el.innerText)).filter(t => /^\d+$/.test(t)).map(Number))].sort((a, b) => a - b);
  }

  function expectedExamTotal(questions) {
    return Math.max(sidebarQuestionNumbers().length, window.__ONLUYEN_RAW_DATA__?.questions?.length || 0, questions.length);
  }

  function examSourceContext() {
    const questions = parseQuestionsFromRawAPI() || [];
    return JSON.stringify({ revision: examRevision, key: examStorageKey(),
      sidebar: sidebarQuestionNumbers(), total: window.__ONLUYEN_RAW_DATA__?.questions?.length || 0,
      api: questions.map(q => ({ number: q.number, id: q.sourceId, type: q.answerType,
        prompt: q.math_content?.question || q.prompt, expectedChoiceCount: q.expectedChoiceCount,
        images: (q.images || []).map(i => i.src),
        choices: q.choices.map(c => ({ label: c.label, id: c.idOption,
          content: c.math_content || c.text, images: (c.images || []).map(i => i.src) })) })) });
  }

  function sameRenderedQuestion(expected, current) {
    if (!expected || !current || !hasCompleteChoices(current)) return false;
    const enriched = { ...current, choices: current.choices.map(c => ({ ...c,
      idOption: c.idOption ?? expected.choices.find(e => e.label === c.label)?.idOption })) };
    return math.signature([expected]) === math.signature([enriched]);
  }

  function invalidateExamSnapshot() {
    examSnapshot = null;
    examSnapshotContext = null;
    databaseValidation = null;
  }

  function refreshExamSnapshot(checkRendered = true) {
    if (!examSnapshot) return;
    const current = checkRendered ? extractStructuredTestQuestions() : [];
    if (examSnapshotContext !== examSourceContext() || current.some(q =>
      !sameRenderedQuestion(examSnapshot.find(e => e.number === q.number), q))) invalidateExamSnapshot();
  }

  async function getCompleteExamQuestions() {
    if (examCollection) return examCollection;
    examCollection = (async () => {
      refreshExamSnapshot();
      const sourceContext = examSourceContext();
      const questions = getFullExamQuestions();
      if (!window.__ONLUYEN_RAW_DATA__?.questions?.length && !sidebarQuestionNumbers().length
          && (/^\/practices(?:\/|$)/.test(location.pathname) || document.querySelector('app-practice-step-question-option, app-practice-step-question-true-false'))) {
        throw new Error('Không thể đọc trước toàn bộ đề luyện tập: không có API đầy đủ hoặc thanh điều hướng.');
      }
      const expected = expectedExamTotal(questions);
      if (questions.length === expected && questions.length && questions.every(hasCompleteChoices)) {
        examSnapshot = questions;
        examSnapshotContext = sourceContext;
        return questions;
      }
      if (window.__BOT_RUNNING__) throw new Error('Hãy dừng bot trước khi đọc lại các phương án từ giao diện.');
      collectionCancelled = false;
      const revision = examRevision;
      const key = activeExamKey;
      const originalNumber = currentQuestionNumber();
      const sidebarNumbers = sidebarQuestionNumbers();
      if (expected > questions.length && !sidebarNumbers.length) throw new Error('Không thể đọc trước toàn bộ đề: API thiếu câu và trang không có thanh điều hướng.');
      const targets = sidebarNumbers.length ? sidebarNumbers : questions.map(question => question.number);
      const collected = [];
      const completeDomQuestion = question => {
        if (!question) return false;
        const api = question.sourceId ? questions.find(item => item.sourceId === question.sourceId) : null;
        return hasCompleteChoices({ ...question, expectedChoiceCount: api?.expectedChoiceCount });
      };
      const checkContext = () => {
        if (collectionCancelled) throw new Error('Đã dừng đọc đề.');
        if (revision !== examRevision || key !== examStorageKey()) throw new Error('Đã chuyển bài trong khi đọc đề. Hãy tạo lại prompt của bài hiện tại.');
      };
      const waitRead = async (predicate, timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (revision !== examRevision || key !== examStorageKey()) return false;
          if (predicate()) return true;
          await sleep(80);
        }
        return false;
      };
      try {
        for (const number of targets) {
          checkContext();
          if (currentQuestionNumber() !== number) {
            const button = findSidebarButtonForQuestion(number);
            if (!button) throw new Error(`Câu ${number}: API thiếu phương án và không tìm thấy nút mở câu trên giao diện.`);
            button.click();
          }
          chrome.runtime.sendMessage({ action: 'BOT_PROGRESS', text: `Đang đọc đề và A/B/C/D từ giao diện: câu ${number}/${targets.length}...` }).catch(() => {});
          const ready = await waitRead(() => {
            if (collectionCancelled || revision !== examRevision || key !== examStorageKey()) return true;
            const current = extractStructuredTestQuestions().find(question => question.number === number);
            return completeDomQuestion(current);
          }, 5000);
          checkContext();
          if (ready) await sleep(200);
          checkContext();
          const current = extractStructuredTestQuestions().find(question => question.number === number);
          if (!ready || !completeDomQuestion(current)) {
            collected.push({ number, sourceId: current?.sourceId || null, answerType: current?.answerType || 'MCQ', prompt: current?.prompt || '', choices: [], readError: `Câu ${number}: chưa đọc đủ phương án.` });
            continue;
          }
          collected.push(current);
        }
        checkContext();
        if (collected.length < expected) throw new Error('Chưa đọc đủ số câu của đề. Hãy chờ phiếu trả lời tải xong rồi thử lại.');
        if (sourceContext !== examSourceContext()) throw new Error('Nguồn đề đã thay đổi trong khi đọc. Hãy kiểm tra lại.');
        examSnapshot = collected;
        examSnapshotContext = sourceContext;
        return collected;
      } finally {
        if (revision === examRevision && key === examStorageKey() && originalNumber && currentQuestionNumber() !== originalNumber) {
          findSidebarButtonForQuestion(originalNumber)?.click();
          await waitRead(() => currentQuestionNumber() === originalNumber, 3000);
        }
      }
    })();
    try { return await examCollection; } finally { examCollection = null; }
  }

  function extractQuestions() {
    const structured = extractStructuredTestQuestions();
    if (structured.length) return structured;

    for (const selector of QUESTION_SELECTORS) {
      const found = new Set();
      const blocks = [];
      for (const element of document.querySelectorAll(selector)) {
        if (!isVisible(element) || element.closest(SKIP_SELECTORS)) continue;
        const text = cleanText(element.innerText);
        if (text.length < 12 || text.length > 6000 || found.has(text)) continue;
        found.add(text);
        blocks.push(text);
      }
      if (blocks.length) {
        return blocks.slice(0, 100).map((text, index) => ({
          number: index + 1,
          sourceId: null,
          prompt: text,
          choices: [],
          text
        }));
      }
    }

    const root = document.querySelector('main, .page-scroll, [role="main"]') || document.body;
    const text = cleanText(root?.innerText);
    if (!text) return [];
    const matches = text.split(/(?=^\s*Câu\s+(?:hỏi\s+)?\d+[\s.:])/gim)
      .map(cleanText)
      .filter(part => /^Câu\s+(?:hỏi\s+)?\d+/i.test(part));
    return matches.slice(0, 100).map((questionText, index) => ({
      number: Number(questionText.match(/^Câu\s+(?:hỏi\s+)?(\d+)/i)?.[1]) || index + 1,
      sourceId: questionText.match(/#(\d+)/)?.[1] || null,
      prompt: questionText,
      choices: [],
      text: questionText
    }));
  }

  function extractPageText() {
    const root = document.querySelector('main, .page-scroll, [role="main"]') || document.body;
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll(SKIP_SELECTORS).forEach(el => el.remove());
    clone.querySelectorAll('input, textarea, select, button').forEach(el => {
      const label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || '';
      if (label) el.replaceWith(document.createTextNode(` ${label} `));
      else el.remove();
    });
    return redactPersonalData(cleanText(clone.innerText)).slice(0, 50000);
  }

  function collectPage() {
    const questions = extractQuestions();
    const text = extractPageText();
    return {
      schemaVersion: 1,
      source: 'Onluyen Study Helper',
      capturedAt: new Date().toISOString(),
      url: location.href,
      route: routeLabel(),
      title: pageTitle(),
      headings: extractHeadings(),
      questions: questions.map(question => ({
        ...question,
        prompt: redactPersonalData(question.prompt),
        text: redactPersonalData(question.text),
        choices: question.choices.map(choice => ({
          label: choice.label,
          text: redactPersonalData(choice.text)
        }))
      })),
      text,
      stats: {
        questionCount: questions.length,
        characterCount: text.length
      }
    };
  }

  function createTutorPrompt(page) {
    const material = page.questions.length
      ? page.questions.map(item => `Câu ${item.number}:\n${item.text}`).join('\n\n')
      : page.text;
    return [
      'Bạn là gia sư Socratic. Hãy giúp tôi tự giải nội dung Onluyen bên dưới.',
      'Quy tắc:',
      '- Không đưa đáp án cuối ngay từ đầu.',
      '- Hỏi tôi đã thử gì, sau đó đưa một gợi ý ngắn ở mỗi lượt.',
      '- Giải thích khái niệm và chỉ ra lỗi sai trong cách làm của tôi.',
      '- Chỉ xác nhận đáp án sau khi tôi đã đưa ra một phương án.',
      '',
      `Tiêu đề: ${page.title}`,
      `Trang: ${page.url}`,
      '',
      material
    ].join('\n').slice(0, 60000);
  }

  // ============================================================
  // 4. TẠO PROMPT AI CHUẨN ĐỊNH DẠNG JSON (MODE 1)
  // ============================================================
  function buildAIPrompt(questions) {
    for (const question of questions) {
      if (!hasCompleteChoices(question)) throw new Error(question.readError || `Câu ${question.number}: thiếu phương án, không thể tạo prompt chính xác.`);
      for (const source of [question.math_content?.question || question.prompt, ...question.choices.map(c => c.math_content || c.text)]) {
        const result = math.canonicalize(source);
        if (result.status !== 'ok') throw new Error(`Câu ${question.number}: ${result.reason}. Không thể tạo prompt từ công thức chưa đọc được.`);
      }
    }
    promptSnapshot = { id: Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''), signature: math.signature(questions), revision: examRevision, key: activeExamKey };
    const lines = [
      'Bạn là chuyên gia giải đề thi trắc nghiệm. Hãy giải chính xác 100% các câu hỏi dưới đây.',
      '',
      'QUY TẮC ĐỊNH DẠNG ĐÁP ÁN (BẮT BUỘC TUÂN THỦ):',
      '1. Trả về DUY NHẤT một mảng JSON nằm trong khối mã ```json ... ```.',
      '2. Không ghi bất kỳ lời giải thích, nhận xét hay văn bản nào bên ngoài khối JSON.',
      `snapshot_id: ${promptSnapshot.id}. Chép trường "snapshot_id" này vào mỗi đáp án. Bắt buộc nếu chỉ trả chữ cái, khóa a/b/c/d hoặc câu không có ID.`,
      '3. Cấu trúc từng câu trong mảng JSON:',
      '   - Đối với Trắc nghiệm chọn 1 đáp án (MCQ):',
      '     {"cau": 1, "id": "123456", "loai": "MCQ", "dap_an": "A", "noi_dung_dap_an": "Nội dung phương án A"}',
      '     ("id" là ID câu được ghi dưới đây; "noi_dung_dap_an" phải chép đúng nội dung phương án đã chọn)',
      '     Với phương án là hình: trả thêm "id_dap_an" nếu có ID lựa chọn; hoặc "anh_dap_an": ["URL hoặc data:image base64 đã ghi ở phương án"]. Chép nguyên nguồn ảnh, không mô tả hình thay cho nội dung đáp án. Nếu phương án không có chữ, bỏ noi_dung_dap_an.',
      '     Ảnh base64 được gửi/đính kèm dưới dạng ảnh, không cần chép chuỗi base64 dài. Trả id_dap_an; nếu không có ID, chỉ trả dap_an theo chữ cái của snapshot đề này và bỏ noi_dung_dap_an. Tiện ích sẽ lưu nguồn ảnh từ lựa chọn đó.',
      '   - Đối với Trắc nghiệm Đúng/Sai (TF):',
      '     {"cau": 20, "loai": "TF", "dap_an": {"a": "Đúng", "b": "Sai", "c": "Đúng", "d": "Sai"}}',
      '   - Đối với câu Trả lời ngắn (SHORT):',
      '     {"cau": 13, "loai": "SHORT", "dap_an": "2"}   (giữ nguyên dấu phẩy, dấu trừ hoặc ký hiệu cần nhập)',
      '',
      'DANH SÁCH CÂU HỎI:',
      ''
    ];

    for (const q of questions) {
      lines.push(`=== CÂU ${q.number} ===`);
      if (q.sourceId) lines.push(`ID câu: ${q.sourceId}`);
      lines.push(`Đề bài: ${q.prompt}`);
      if (q.answerType === 'TF' || q.typeAnswer === 'TF') {
        lines.push('Loại câu hỏi: Đúng/Sai cho từng ý.');
      } else if (q.answerType === 'SHORT' || q.typeAnswer === 'SHORT') {
        lines.push('Loại câu hỏi: Trả lời ngắn. Trả về chính xác nội dung cần nhập vào ô đáp án.');
      }
      if (q.choices && q.choices.length > 0) {
        lines.push('Các phương án:');
        for (const ch of q.choices) {
          lines.push(`${ch.label}${q.answerType === 'TF' || q.typeAnswer === 'TF' ? ')' : '.'} ${ch.text}`);
          if (ch.idOption != null) lines.push(`  id_dap_an: ${JSON.stringify(ch.idOption)}`);
          if (ch.images?.length) {
            if (ch.images.every(image => /^https?:\/\//i.test(image.src))) lines.push(`  anh_dap_an: ${JSON.stringify(ch.images.map(image => image.src))}`);
            else lines.push('  Ảnh base64/blob được đính kèm trong file ảnh của phương án này; trả ID hoặc chữ cái theo snapshot, không mô tả bằng lời.');
          }
        }
      }
      const questionImages = promptImageFiles([q]);
      if (questionImages.length) {
        lines.push('Hình ảnh của câu này được đính kèm hoặc lưu thành:');
        for (const image of questionImages) {
          lines.push(`- ${image.filename}${image.choiceLabels.length ? ` — phương án ${image.choiceLabels.join(', ')}` : ' — đề bài'}${image.alt ? ` (${image.alt})` : ''}`);
        }
        lines.push('Phải quan sát hình ảnh này trước khi chọn đáp án.');
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ============================================================
  // 5. GỌI GEMINI API TRỰC TIẾP (MODE 2 — KEY POOL & PRO CHO PAID)
  // ============================================================
  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function detectedImageMime(base64, declaredMime = '') {
    if (/^iVBOR/i.test(base64)) return 'image/png';
    if (/^\/9j\//i.test(base64)) return 'image/jpeg';
    if (/^R0lGOD/i.test(base64)) return 'image/gif';
    if (/^UklGR/i.test(base64)) return 'image/webp';
    return /^image\//i.test(declaredMime) ? declaredMime.toLowerCase() : 'image/png';
  }

  async function imageFileToInlineData(file) {
    const dataMatch = String(file.src || '').match(/^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/i);
    if (dataMatch) {
      const data = dataMatch[2]
        ? dataMatch[3].replace(/\s+/g, '')
        : bytesToBase64(new TextEncoder().encode(decodeURIComponent(dataMatch[3])));
      return { mimeType: detectedImageMime(data, dataMatch[1]), data };
    }

    try {
      const response = await fetch(file.src, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const data = bytesToBase64(bytes);
      return { mimeType: detectedImageMime(data, response.headers.get('content-type') || ''), data };
    } catch (pageError) {
      const response = await chrome.runtime.sendMessage({ action: 'OL_FETCH_IMAGE', url: file.src });
      if (!response?.ok || !response.data) throw new Error(response?.error || pageError.message);
      return {
        mimeType: detectedImageMime(response.data, response.mimeType || ''),
        data: response.data
      };
    }
  }

  async function prepareGeminiImageParts(questions) {
    const files = promptImageFiles(questions).slice(0, 30);
    const parts = [];
    const failures = [];
    let totalBytes = 0;

    for (const file of files) {
      try {
        const inlineData = await imageFileToInlineData(file);
        const estimatedBytes = Math.floor(inlineData.data.length * 0.75);
        if (estimatedBytes > 7 * 1024 * 1024) throw new Error('ảnh lớn hơn 7 MB');
        if (totalBytes + estimatedBytes > 18 * 1024 * 1024) throw new Error('tổng ảnh vượt 18 MB');
        totalBytes += estimatedBytes;
        parts.push({ text: `Ảnh ${file.filename} của CÂU ${file.question}${file.choiceLabels.length ? `, phương án ${file.choiceLabels.join(', ')}` : ', đề bài'}:` });
        parts.push({ inlineData });
      } catch (error) {
        failures.push(`${file.filename}: ${error.message}`);
      }
    }

    return { files, parts, failures };
  }

  async function callGeminiApiRaw(apiKey, model, promptText, imageParts = []) {
    const url = `${CS_GEMINI_BASE}/${model}:generateContent`;
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }, ...imageParts]
        }
      ],
      generation_config: {
        temperature: 0.1,
        max_output_tokens: 8192
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(`HTTP ${response.status}: ${errText}`);
      err.status = response.status;
      err.isQuota = response.status === 429;
      err.isOverloaded = response.status === 503;
      err.isModelNotFound = response.status === 404;
      throw err;
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini API không trả về nội dung text.');
    return text;
  }

  async function solveWithGeminiPool(promptText, imageParts = []) {
    const storage = await new Promise(res => chrome.storage.local.get([STORE_PAID, STORE_FREE, STORE_STATES], res));
    const paidKeys = storage[STORE_PAID] || [];
    const freeKeys = storage[STORE_FREE] || [];
    const keyStates = storage[STORE_STATES] || {};
    const now = Date.now();

    if (!paidKeys.length && !freeKeys.length) {
      throw new Error('Chưa cài đặt Gemini API Key. Hãy nhập Key trong tab Cài đặt API Key.');
    }

    // 1. Thử Paid Keys trước: ƯU TIÊN PRO MODEL, sau đó Flash fallback
    for (const key of paidKeys) {
      const preview = key.substring(0, 8) + '···' + key.slice(-4);
      const state = keyStates[preview] || { exhaustedAt: null, tier: 0 };
      if (state.exhaustedAt && now - state.exhaustedAt < 3600000) continue; // bỏ qua nếu bị exhausted trong 1h

      const PAID_MODELS = [CS_MODEL_PRO, CS_MODEL_FLASH, CS_MODEL_FALLBACK, CS_MODEL_PREVIEW];
      for (let tier = 0; tier < PAID_MODELS.length; tier++) {
        const model = PAID_MODELS[tier];
        try {
          console.log(`[OnluyenBot] Gọi Paid Key (${preview}) với model: ${model}`);
          const rawText = await callGeminiApiRaw(key, model, promptText, imageParts);
          return { text: rawText, model, keyPreview: preview, isPaid: true };
        } catch (e) {
          console.warn(`[OnluyenBot] Paid Key ${preview} model ${model} lỗi:`, e.message);
          if (e.isOverloaded || e.isModelNotFound) continue; // thử model khác
          if (e.isQuota) {
            state.exhaustedAt = now;
            keyStates[preview] = state;
            await new Promise(r => chrome.storage.local.set({ [STORE_STATES]: keyStates }, r));
            break; // nhảy sang key tiếp theo
          }
          throw e;
        }
      }
    }

    // 2. Thử Free Keys: CHỈ DÙNG FLASH VÀ FALLBACK, TUYỆT ĐỐI KHÔNG DÙNG PRO
    for (const key of freeKeys) {
      const preview = key.substring(0, 8) + '···' + key.slice(-4);
      const state = keyStates[preview] || { exhaustedAt: null };
      if (state.exhaustedAt && now - state.exhaustedAt < 3600000) continue;

      const FREE_MODELS = [CS_MODEL_FLASH, CS_MODEL_FALLBACK, CS_MODEL_PREVIEW];
      for (const model of FREE_MODELS) {
        try {
          console.log(`[OnluyenBot] Gọi Free Key (${preview}) với model: ${model}`);
          const rawText = await callGeminiApiRaw(key, model, promptText, imageParts);
          return { text: rawText, model, keyPreview: preview, isPaid: false };
        } catch (e) {
          console.warn(`[OnluyenBot] Free Key ${preview} model ${model} lỗi:`, e.message);
          if (e.isOverloaded || e.isModelNotFound) continue;
          if (e.isQuota) {
            state.exhaustedAt = now;
            keyStates[preview] = state;
            await new Promise(r => chrome.storage.local.set({ [STORE_STATES]: keyStates }, r));
            break;
          }
          throw e;
        }
      }
    }

    throw new Error('Tất cả API Key trong Pool đều đã hết Quota hoặc gặp lỗi. Vui lòng thêm Key mới hoặc thử lại sau.');
  }

  // ============================================================
  // 6. LẤY ĐÁP ÁN ĐÚNG ĐÃ HIỂN THỊ TRÊN TRANG KẾT QUẢ
  // ============================================================
  function historyQuestionNumber(root) {
    const header = cleanText(root.querySelector('.question-header')?.innerText || root.innerText);
    return Number(header.match(/Câu\s*:?[ \t]*(\d+)/i)?.[1]) || null;
  }

  function questionSourceId(root) {
    const identityText = cleanText([
      root.querySelector('.question-header')?.innerText,
      root.querySelector('.question-info .num')?.innerText,
      root.querySelector('.question-id')?.innerText
    ].join(' '));
    return identityText.match(/#\s*([\w-]+)/)?.[1] || null;
  }

  function optionAnswerText(option) {
    return semanticElementText(
      option?.querySelector('.question-option-content')
      || option?.querySelector('label')
      || option
    );
  }

  function mcqOptionElements(root) {
    return [...root.querySelectorAll('.question-option, .select-item')].filter(isVisible);
  }

  function mcqOptionLabel(option, fallbackIndex = 0) {
    const explicit = cleanText(
      option?.querySelector('.question-option-label')?.innerText
      || option?.querySelector('.number-item')?.innerText
    ).match(/[A-D]/i)?.[0];
    if (explicit) return explicit.toUpperCase();
    const numericValue = Number(option?.querySelector('input[type="radio"]')?.value);
    if (numericValue >= 1 && numericValue <= 4) return String.fromCharCode(64 + numericValue);
    return String.fromCharCode(65 + fallbackIndex);
  }

  function isMcqOptionSelected(option) {
    return option?.classList.contains('selected')
      || option?.classList.contains('highlighed')
      || !!option?.querySelector('.text-answered, input:checked');
  }

  function recordedMcqAnswerMatches(root, answerEntry) {
    const choices = currentMcqChoices(root);
    const result = math.resolveChoice(choices, answerEntry.answerContent || answerEntry.originalAnswerText || answerEntry.answerText, answerEntry.answerOptionId, answerEntry.answerImages);
    return result.status === 'equal' && isMcqOptionSelected(result.choice.element);
  }

  function currentMcqChoices(root) {
    return mcqOptionElements(root).map((element, i) => ({
      label: mcqOptionLabel(element, i), text: optionAnswerText(element), element,
      idOption: element.dataset.idOption,
      images: choiceImages(element),
      math_content: math.metadata(element.querySelector('.question-option-content') || element.querySelector('label') || element)
    }));
  }

  function shortAnswerInput(root) {
    return [...root.querySelectorAll('.answer-input input[type="text"], input.can-resize-second, input[config-typeaction]')]
      .find(isVisible) || null;
  }

  function normalizeShortAnswer(value) {
    return cleanText(value).normalize('NFKC').replace(/\s+/g, '');
  }

  function shortAnswerMatches(root, answerEntry) {
    const input = shortAnswerInput(root);
    return !!input && normalizeShortAnswer(input.value) === normalizeShortAnswer(answerEntry.answer);
  }

  async function fillShortAnswer(root, answer) {
    const input = shortAnswerInput(root);
    if (!input) return false;
    const value = String(answer ?? '').trim();
    if (!value) return false;
    if (normalizeShortAnswer(input.value) === normalizeShortAnswer(value)) return true;

    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: value.slice(-1) || '0' }));
    input.blur();
    return waitForCondition(() => shortAnswerMatches(root, { answer: value }) && !!findAnswerButton(), 2500, 50);
  }

  async function activateMcqOption(option) {
    if (!option) return false;
    const answerButtonBefore = findAnswerButton();
    const registered = () => isMcqOptionSelected(option)
      || (!answerButtonBefore && !!findAnswerButton());
    if (isMcqOptionSelected(option)) return true;

    option.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const targets = option.matches('.select-item')
      ? [option.querySelector('label'), option.querySelector('input[type="radio"]'), option]
      : [option, option.querySelector('.question-option-content'), option.querySelector('.question-option-label'), option.querySelector('input')];

    for (const target of [...new Set(targets.filter(Boolean))]) {
      assertValidatedQuestion(currentQuestionNumber());
      target.click();
      if (await waitForCondition(registered, 900, 50)) return true;
    }

    // Một số mẫu MathPlay chỉ lắng nghe sự kiện input/change trên radio.
    const radio = option.querySelector('input[type="radio"]');
    if (radio) {
      assertValidatedQuestion(currentQuestionNumber());
      radio.checked = true;
      radio.dispatchEvent(new Event('input', { bubbles: true }));
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      if (await waitForCondition(registered, 1200, 50)) return true;
    }

    return registered();
  }

  function selectionDebugSummary(root, answerEntry) {
    const shortInput = shortAnswerInput(root);
    if (shortInput) {
      return `mẫu=SHORT; cần=${cleanText(answerEntry.answer)}; giá trị=${cleanText(shortInput.value)}; nút=${[...root.querySelectorAll('button')].filter(isVisible).map(button => cleanText(button.innerText)).filter(Boolean).join(' | ') || 'không có'}`;
    }
    const options = mcqOptionElements(root);
    const selected = options
      .map((option, index) => isMcqOptionSelected(option) ? mcqOptionLabel(option, index) : null)
      .filter(Boolean)
      .join(',') || 'không có';
    const template = root.querySelector('app-test-school-question-mathplay, .select-item') ? 'MathPlay' : 'regular';
    const buttons = [...root.querySelectorAll('button')]
      .filter(isVisible)
      .map(button => cleanText(button.innerText))
      .filter(Boolean)
      .join(' | ') || 'không có';
    const renderedOptions = options
      .map((option, index) => `${mcqOptionLabel(option, index)}:${optionAnswerText(option)}`)
      .join(' | ')
      .slice(0, 500);
    const originalText = cleanText(answerEntry.originalAnswerText);
    const mappedText = cleanText(answerEntry.answerText);
    const expected = originalText && originalText !== mappedText
      ? `${mappedText}; gốc=${originalText}`
      : mappedText;
    return `mẫu=${template}; lựa chọn=${options.length}; cần=${cleanText(answerEntry.answer)} (${expected}); hiển thị=${renderedOptions}; đang chọn=${selected}; nút=${buttons}`;
  }

  function normalizeComparableText(value) {
    const result = math.canonicalize(value);
    return result.status === 'ok' ? result.key : null;
  }

  function answerFromExplanation(root, rowIndex) {
    const explicit = Array.from(root.querySelectorAll('.hint-content strong, .hint-content b'))
      .map(el => cleanText(el.innerText))
      .filter(text => /^(Đúng|Sai)$/i.test(text));
    if (explicit[rowIndex]) return /^đúng$/i.test(explicit[rowIndex]) ? 'Đúng' : 'Sai';

    const lines = cleanText(root.querySelector('.hint-content')?.innerText)
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const values = lines
      .map(line => line.match(/(?:^|[.:]\s*)(Đúng|Sai)(?:\s*[,.:]|$)/i)?.[1])
      .filter(Boolean);
    return values[rowIndex] ? (/^đúng$/i.test(values[rowIndex]) ? 'Đúng' : 'Sai') : null;
  }

  function historyShortAnswerValue(root) {
    const input = root.querySelector([
      '.answer-input input:not([type="radio"]):not([type="checkbox"])',
      'input.can-resize-second',
      'input[config-typeaction]',
      'input[type="text"]',
      'input[type="number"]'
    ].join(','));
    const inputValue = String(input?.value || input?.getAttribute('value') || '').trim();
    if (inputValue) return inputValue.replace(/[−–—﹣－]/g, '-');

    const text = semanticElementText(root);
    const match = text.match(/(?:Đáp án|Câu trả lời)\s*:\s*([+\-−–—﹣－]?\d+(?:[,.]\d+)?(?:[eE][+\-]?\d+)?)/i);
    return match?.[1]?.replace(/[−–—﹣－]/g, '-') || null;
  }

  function extractHistoryQuestionAnswer(root) {
    const qNumber = historyQuestionNumber(root);
    if (!qNumber) return { error: 'không xác định được số câu' };
    const questionText = semanticElementText(
      root.querySelector('.question-name')
      || root.querySelector('.question-text')
      || root.querySelector('[class*="question-name"]')
    );
    const questionContent = math.metadata(root.querySelector('.question-name') || root.querySelector('.question-text') || root.querySelector('[class*="question-name"]'));

    const tfRows = Array.from(root.querySelectorAll('.question-child .child-content'))
      .filter(row => row.querySelector('input[type="radio"][value="true"], input[type="radio"][value="false"]'));
    if (tfRows.length) {
      const answer = {};
      const choiceTexts = {};
      const statementContents = {};
      for (let index = 0; index < tfRows.length; index++) {
        const row = tfRows[index];
        const keyText = cleanText(row.querySelector('.option-char')?.innerText);
        const key = keyText.match(/([a-z])/i)?.[1]?.toLowerCase() || String.fromCharCode(97 + index);
        const source = row.querySelector('.option-text .fadein') || row.querySelector('.option-text');
        const choiceText = semanticElementText(source).replace(/^[a-z]\s*[).:]\s*/i, '');
        statementContents[key] = math.metadata(source);
        const readable = math.canonicalize(statementContents[key]);
        if (readable.status !== 'ok') return { error: `ý ${key}: ${readable.reason}` };
        if (choiceText) choiceTexts[key] = choiceText;
        const selected = Array.from(row.querySelectorAll('input[type="radio"]')).find(input => input.checked)?.value;
        const check = row.querySelector('.check');
        let value = null;

        if (selected === 'true' || selected === 'false') {
          const selectedIsTrue = selected === 'true';
          const studentWasCorrect = check?.classList.contains('correct');
          const studentWasWrong = check?.classList.contains('wrong') || check?.classList.contains('incorrect');
          if (studentWasCorrect) value = selectedIsTrue ? 'Đúng' : 'Sai';
          if (studentWasWrong) value = selectedIsTrue ? 'Sai' : 'Đúng';
        }
        if (!value) value = answerFromExplanation(root, index);
        if (!value) return { error: `không đọc được đáp án ý ${key}` };
        answer[key] = value;
      }
      return {
        answer: {
          cau: qNumber,
          id: questionSourceId(root),
          loai: 'TF',
          dap_an: answer,
          math_content: { version: 1, question: questionContent, statements: statementContents },
          ...(questionText ? { noi_dung_cau_hoi: questionText } : {}),
          ...(Object.keys(choiceTexts).length ? { noi_dung_cac_y: choiceTexts } : {})
        }
      };
    }

    const shortAnswer = historyShortAnswerValue(root);
    if (!root.querySelector('.question-option, .select-item') && shortAnswer) {
      return {
        answer: {
          cau: qNumber,
          id: questionSourceId(root),
          loai: 'SHORT',
          dap_an: shortAnswer,
          ...(questionText ? { noi_dung_cau_hoi: questionText } : {})
        }
      };
    }

    const correctOption = root.querySelector('.question-option.bg-correct') ||
      Array.from(root.querySelectorAll('.question-option')).find(option =>
        Array.from(option.querySelectorAll('.text-answered')).some(label =>
          isVisible(label) && /^(Đáp án đúng|Đáp án học sinh chọn đúng)$/i.test(cleanText(label.innerText))
        )
      );
    const label = cleanText(correctOption?.querySelector('.question-option-label')?.innerText).toUpperCase();
    if (!/^[A-D]$/.test(label)) return { error: 'không tìm thấy phương án đúng' };
    const answerText = optionAnswerText(correctOption);
    const answerImages = choiceImages(correctOption).map(image => image.src);
    if (!answerText && !answerImages.length) return { error: 'không đọc được nội dung phương án đúng' };
    const answerContent = math.metadata(correctOption.querySelector('.question-option-content') || correctOption);
    const readable = math.canonicalize(answerContent);
    if (readable.status !== 'ok') return { error: readable.reason };
    return {
      answer: {
        cau: qNumber,
        id: questionSourceId(root),
        loai: 'MCQ',
        dap_an: label,
        noi_dung_dap_an: answerText,
        ...(answerImages.length ? { anh_dap_an: answerImages } : {}),
        ...(correctOption.dataset.idOption != null ? { id_dap_an: correctOption.dataset.idOption } : {}),
        math_content: { version: 1, question: questionContent, answer: answerContent },
        ...(questionText ? { noi_dung_cau_hoi: questionText } : {})
      }
    };
  }

  async function waitForHistoryQuestion(root, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const formulasReady = [...root.querySelectorAll('.question-option-content, .option-text .fadein')]
        .every(element => math.canonicalize(math.metadata(element)).status !== 'incomplete');
      if (!/Đang tải/i.test(cleanText(root.innerText)) &&
          formulasReady && root.querySelector('.question-option.bg-correct, .question-child .child-content, .hint-content, .answer-input input, input.can-resize-second, input[config-typeaction]')) return true;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  async function extractHistoryAnswers() {
    const roots = Array.from(document.querySelectorAll('[id^="ans-student-"]'));
    if (!roots.length) {
      throw new Error('Hãy mở trang Kết quả/History của bài đã chấm rồi thử lại.');
    }

    const originalX = window.scrollX;
    const originalY = window.scrollY;
    const answers = [];
    const failures = [];

    try {
      for (const root of roots) {
        if (/Đang tải/i.test(cleanText(root.innerText))) {
          root.scrollIntoView({ block: 'center' });
          await waitForHistoryQuestion(root);
        }
        const result = extractHistoryQuestionAnswer(root);
        if (result.answer) answers.push(result.answer);
        else failures.push(`Câu ${historyQuestionNumber(root) || '?'}: ${result.error}`);
      }
    } finally {
      window.scrollTo(originalX, originalY);
    }

    answers.sort((a, b) => a.cau - b.cau);
    if (failures.length) {
      throw new Error(`Chưa lấy đủ đáp án (${answers.length}/${roots.length}). ${failures.slice(0, 3).join('; ')}`);
    }
    return answers;
  }

  // ============================================================
  // 7. XỬ LÝ VÀ NẠP DATABASE ĐÁP ÁN
  // ============================================================
  function entrySourceId(entry) {
    return String(entry?.id ?? entry?.question_id ?? entry?.sourceId ?? '')
      .replace(/^#/, '')
      .trim() || null;
  }

  function entryQuestionText(entry) {
    return entry?.noi_dung_cau_hoi ?? entry?.question_text ?? entry?.questionText ?? entry?.prompt ?? null;
  }

  function entryAnswerText(entry) {
    return entry?.noi_dung_dap_an_goc
      ?? entry?.original_answer_text
      ?? entry?.originalAnswerText
      ?? entry?.noi_dung_dap_an
      ?? entry?.answer_text
      ?? entry?.answerText
      ?? null;
  }

  function normalizedAnswerType(value, fallback = 'MCQ') {
    const type = String(value || fallback).trim().toUpperCase();
    if (['TF', 'TRUE_FALSE', 'TRUEFALSE'].includes(type)) return 'TF';
    if (['SHORT', 'SHORT_ANSWER', 'SHORTANSWER'].includes(type)) return 'SHORT';
    return 'MCQ';
  }

  function databaseQuestionIndex(questions) {
    const byId = new Map();
    const byNumber = new Map();
    const byPrompt = new Map();
    for (const question of questions) {
      if (question.sourceId) byId.set(String(question.sourceId), question);
      byNumber.set(Number(question.number), question);
      const promptKey = normalizeComparableText(question.math_content?.question || question.prompt);
      if (!promptKey) continue;
      if (!byPrompt.has(promptKey)) byPrompt.set(promptKey, []);
      byPrompt.get(promptKey).push(question);
    }
    return { byId, byNumber, byPrompt };
  }

  function questionForDatabaseEntry(entry, index) {
    const sourceId = entrySourceId(entry);
    if (sourceId && index.byId.has(sourceId)) return index.byId.get(sourceId);

    const promptKey = normalizeComparableText(entry.math_content?.question || entryQuestionText(entry));
    const promptMatches = promptKey ? index.byPrompt.get(promptKey) : null;
    if (promptMatches?.length === 1) return promptMatches[0];

    // Khi entry đã có định danh ổn định nhưng câu đó chưa render trong DOM,
    // không được gán nhầm theo số thứ tự của lần làm khác.
    if (sourceId || promptKey) return null;

    return null;
  }

  function contentMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).map(([key, text]) => [
      normalizeSubQuestionKey(key, 0),
      cleanText(text)
    ]));
  }

  function enrichDatabaseEntry(entry, question, snapshot = false) {
    const incomingNumber = Number(entry?.cau ?? entry?.q ?? entry?.number ?? entry?.questionNumber);
    const qNum = Number(question?.number) || incomingNumber;
    if (!qNum) return null;

    const sourceId = String(question?.sourceId || entrySourceId(entry) || '').trim() || null;
    const prompt = cleanText(question?.prompt || entryQuestionText(entry));
    const type = normalizedAnswerType(entry?.loai ?? entry?.type, question?.answerType);
    const rawAnswer = entry?.dap_an ?? entry?.a ?? entry?.answer ?? entry?.correctAnswer;
    const baseExport = { cau: qNum };
    if (sourceId) baseExport.id = sourceId;
    baseExport.loai = type;
    if (prompt) baseExport.noi_dung_cau_hoi = prompt;
    baseExport.math_content = {
      version: 1,
      question: question?.math_content?.question || entry.math_content?.question || math.metadata(prompt)
    };

    if (type === 'SHORT') {
      const value = String(rawAnswer ?? '').trim();
      if (!value) return null;
      const exported = { ...baseExport, dap_an: value };
      return { q: qNum, type, answer: value, sourceId, answerText: null, questionText: prompt, exported };
    }

    if (type === 'TF' && rawAnswer && typeof rawAnswer === 'object') {
      const choices = question?.choices || [];
      const savedContents = contentMap(
        entry?.noi_dung_cac_y ?? entry?.statement_texts ?? entry?.choiceTexts ?? entry?.noi_dung_dap_an
      );
      const remapped = {};
      const currentContents = {};
      const currentIds = {};

      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index];
        const currentKey = normalizeSubQuestionKey(choice.label, index);
        const currentText = cleanText(choice.text);
        const readable = math.canonicalize(choice.math_content || currentText);
        if (readable.status !== 'ok') throw new Error(`Câu ${qNum}, ý ${currentKey}: ${readable.reason}`);
        currentContents[currentKey] = currentText;
        if (choice.idOption !== undefined && choice.idOption !== null) currentIds[currentKey] = choice.idOption;

        const savedKeys = [...new Set([...Object.keys(savedContents), ...Object.keys(entry.math_content?.statements || {})])];
        const matches = savedKeys.filter(key =>
          math.compare(entry.math_content?.statements?.[key] || savedContents[key], choice.math_content || currentText).status === 'equal'
        );
        let savedKey = matches.length === 1 ? matches[0] : null;
        if (snapshot && !Object.keys(savedContents).length && !Object.keys(entry.math_content?.statements || {}).length
            && Object.prototype.hasOwnProperty.call(rawAnswer, currentKey)) savedKey = currentKey;
        if (!savedKey) throw new Error(`Câu ${qNum}, ý ${currentKey}: không khớp duy nhất nội dung Đúng/Sai.`);
        const value = rawAnswer[savedKey];
        if (truthValue(value) !== null) remapped[currentKey] = truthValue(value) ? 'Đúng' : 'Sai';
      }
      if (choices.length && Object.keys(remapped).length !== choices.length) throw new Error(`Câu ${qNum}: thiếu đáp án Đúng/Sai hợp lệ.`);

      if (!choices.length) {
        for (const [key, value] of Object.entries(rawAnswer)) {
          if (truthValue(value) !== null) remapped[normalizeSubQuestionKey(key, 0)] = truthValue(value) ? 'Đúng' : 'Sai';
        }
      }
      if (!Object.keys(remapped).length) return null;

      const exported = { ...baseExport, dap_an: remapped };
      exported.math_content.statements = choices.length
        ? Object.fromEntries(choices.map((c, i) => [normalizeSubQuestionKey(c.label, i), c.math_content || math.metadata(c.text)]))
        : entry.math_content?.statements || Object.fromEntries(Object.entries(savedContents).map(([k, v]) => [k, math.metadata(v)]));
      if (Object.keys(currentContents).length) exported.noi_dung_cac_y = currentContents;
      if (Object.keys(currentIds).length) exported.id_cac_y = currentIds;
      return {
        q: qNum,
        type,
        answer: remapped,
        sourceId,
        answerText: null,
        questionText: prompt,
        choiceTexts: choices.length ? currentContents : savedContents,
        statementContents: exported.math_content.statements,
        exported
      };
    }

    const choices = question?.choices || [];
    const savedAnswerText = cleanText(entryAnswerText(entry));
    const savedOptionId = entry?.id_dap_an ?? entry?.answer_id ?? entry?.answerId;
    const savedImages = entry.anh_dap_an ?? entry.answer_images;
    const savedContent = entry.math_content?.answer || savedAnswerText || null;
    const resolution = math.resolveChoice(choices, savedContent, savedOptionId, savedImages);
    let choice = resolution.choice;
    if (choices.length && (savedContent || savedImages || savedOptionId != null) && !choice) throw new Error(`Câu ${qNum}: ${resolution.reason}. Nguồn: ${savedAnswerText}`);
    const incomingLetter = String(rawAnswer || '').trim().toUpperCase();
    if (!choice && !savedContent && savedImages == null && savedOptionId == null && question && snapshot && /^[A-Z]$/.test(incomingLetter)) {
      choice = choices.find(item => String(item.label).trim().toUpperCase() === incomingLetter) || null;
    }
    if (choice) {
      const readable = math.canonicalize(choice.math_content || choice.text);
      if (readable.status !== 'ok') throw new Error(`Câu ${qNum}: ${readable.reason}`);
    }
    const currentLetter = String(choice?.label || incomingLetter).trim().toUpperCase();
    if (!/^[A-Z]$/.test(currentLetter)) return null;
    const answerText = cleanText(choice?.text || savedAnswerText) || null;
    const exported = { ...baseExport, dap_an: currentLetter };
    const answerImages = choice?.images?.length ? choice.images.map(image => image.src) : savedImages;
    if (answerImages != null) exported.anh_dap_an = answerImages;
    exported.math_content.answer = choice?.math_content || entry.math_content?.answer || math.metadata(answerText || '', 'inferred');
    if (answerText) exported.noi_dung_dap_an = answerText;
    if (savedAnswerText && currentLetter !== incomingLetter) {
      exported.noi_dung_dap_an_goc = savedAnswerText;
    }
    if (choice?.idOption !== undefined && choice.idOption !== null) exported.id_dap_an = choice.idOption;
    return {
      q: qNum,
      type: 'MCQ',
      answer: currentLetter,
      sourceId,
      answerText,
      originalAnswerText: savedAnswerText || answerText,
      answerContent: exported.math_content.answer,
      answerOptionId: savedOptionId ?? choice?.idOption,
      answerImages,
      snapshotBound: snapshot && !!question && !savedContent,
      questionText: prompt,
      exported
    };
  }

  function databaseExportJson() {
    return JSON.stringify(window.__ONLUYEN_DATABASE_EXPORT__ || [], null, 2);
  }

  function databaseItems(inputJson) {
    let items = [];
    if (typeof inputJson === 'string') {
      let cleaned = inputJson.trim();
      const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match) cleaned = match[1].trim();
      const arrayMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (arrayMatch) cleaned = arrayMatch[0];
      items = JSON.parse(cleaned);
    } else if (Array.isArray(inputJson)) {
      items = inputJson;
    }

    if (!Array.isArray(items)) {
      throw new Error('Định dạng JSON không hợp lệ. Cần mảng các object đáp án.');
    }
    return items;
  }

  function parseAndLoadDatabase(inputJson, snapshot = false, validatedQuestions = null) {
    const items = databaseItems(inputJson);

    const questions = items.length ? validatedQuestions || getFullExamQuestions() : [];
    const questionIndex = databaseQuestionIndex(questions);
    const prepared = items.map(entry => enrichDatabaseEntry(entry, questionForDatabaseEntry(entry, questionIndex), snapshot)).filter(Boolean);
    const seenIds = new Set();
    for (const entry of prepared) {
      if (entry.sourceId && seenIds.has(entry.sourceId)) throw new Error(`Database có nhiều đáp án cho ID câu ${entry.sourceId}.`);
      if (entry.sourceId) seenIds.add(entry.sourceId);
    }

    window.__ONLUYEN_DATABASE__.clear();
    window.__ONLUYEN_DATABASE_BY_ID__.clear();
    window.__ONLUYEN_DATABASE_BY_PROMPT__.clear();
    window.__ONLUYEN_DATABASE_EXPORT__ = [];
    if (!items.length) return 0;

    for (const normalizedEntry of prepared) {

      window.__ONLUYEN_DATABASE__.set(normalizedEntry.q, normalizedEntry);
      if (normalizedEntry.sourceId) window.__ONLUYEN_DATABASE_BY_ID__.set(normalizedEntry.sourceId, normalizedEntry);
      const promptKey = normalizeComparableText(normalizedEntry.exported.math_content?.question || normalizedEntry.questionText);
      if (promptKey) window.__ONLUYEN_DATABASE_BY_PROMPT__.set(promptKey,
        window.__ONLUYEN_DATABASE_BY_PROMPT__.has(promptKey) ? null : normalizedEntry);
      window.__ONLUYEN_DATABASE_EXPORT__.push(normalizedEntry.exported);
    }

    window.__ONLUYEN_DATABASE_EXPORT__.sort((a, b) => a.cau - b.cau);
    console.log(`💾 [OnluyenBot] Đã nạp ${window.__ONLUYEN_DATABASE_EXPORT__.length} đáp án chống xáo trộn vào Database.`);
    return window.__ONLUYEN_DATABASE_EXPORT__.length;
  }

  function matchFailure(report) {
    const message = report.issues.map(issue => {
      const source = issue.source?.length ? ` Nguồn: ${math.text({ version: 1, segments: issue.source }).slice(0, 240)}.` : '';
      const diff = issue.diagnostic ? ` Khác với lựa chọn ${issue.diagnostic.choiceLabel || issue.label || '?'}: “${issue.diagnostic.leftText}” / “${issue.diagnostic.rightText}”.` : '';
      return `${issue.number ? `Câu ${issue.number}${issue.label ? `, ý ${issue.label}` : ''}` : 'Đề'}${issue.id ? ` #${issue.id}` : ''}: ${issue.reason}${source}${diff}`;
    }).join('\n');
    return Object.assign(new Error(message || 'Kiểm tra đề thất bại.'), { report });
  }

  function assertValidatedQuestion(number) {
    const expected = databaseValidation?.questions.find(q => q.number === number);
    const current = extractStructuredTestQuestions().find(q => q.number === number);
    if (!databaseValidation || databaseValidation.revision !== examRevision || databaseValidation.key !== activeExamKey
        || databaseValidation.sourceContext !== examSnapshotContext
        || databaseValidation.questions.length !== expectedExamTotal(databaseValidation.questions)
        || !sameRenderedQuestion(expected, current)) {
      invalidateExamSnapshot();
      const issue = { number, id: current?.sourceId || null, status: 'different', code: 'PAGE_CHANGED', reason: 'Nội dung/ID/lựa chọn đã thay đổi sau kiểm tra. Hãy kiểm tra lại toàn bộ đề.', source: [] };
      lastMatchReport = math.matchReport({ ok: false, count: 0, issues: [issue] });
      throw matchFailure(lastMatchReport);
    }
  }

  async function validateDatabase(inputJson, commit = false, forceRefresh = false) {
    if (preflightRunning || window.__BOT_RUNNING__) throw new Error('Đang đọc đề hoặc chạy bot; hãy dừng trước khi kiểm tra lại.');
    const items = databaseItems(inputJson);
    if (!items.length && commit) {
      parseAndLoadDatabase([]);
      stagedDatabaseInput = null; databaseValidation = null; lastMatchReport = null;
      persistExamDatabase();
      return { ok: true, count: 0, answers: [], json: '[]' };
    }
    preflightRunning = true;
    validationCancelled = false;
    const revision = examRevision, key = activeExamKey;
    try {
      if (forceRefresh) invalidateExamSnapshot();
      else refreshExamSnapshot();
      const inputKey = JSON.stringify(items);
      if (commit && databaseValidation && databaseValidation.revision === revision && databaseValidation.key === key
          && databaseValidation.sourceContext === examSourceContext()
          && [databaseValidation.inputKey, databaseValidation.exportKey].includes(inputKey)) {
        lastMatchReport = databaseValidation.report;
        return { ok: true, count: window.__ONLUYEN_DATABASE_EXPORT__.length, report: lastMatchReport,
          answers: window.__ONLUYEN_DATABASE_EXPORT__, json: databaseExportJson(), reused: true };
      }
      const questions = await getCompleteExamQuestions();
      const sourceContext = examSnapshotContext;
      if (validationCancelled || revision !== examRevision || key !== examStorageKey()) throw new Error('Đã hủy kiểm tra hoặc chuyển bài; database trước đó được giữ nguyên.');
      const activeSnapshot = promptSnapshot && promptSnapshot.revision === revision && promptSnapshot.key === key ? promptSnapshot : null;
      const validation = math.validateExam(questions, items, { expectedTotal: expectedExamTotal(questions), snapshotId: activeSnapshot?.id, snapshotSignature: activeSnapshot?.signature });
      lastMatchReport = math.matchReport(validation, { extensionVersion: chrome.runtime.getManifest?.().version || 'development' });
      if (!validation.ok) throw matchFailure(lastMatchReport);
      if (commit) {
        const verified = validation.mappings.map(({ question, entry, choice, answer }) => {
          entry = { ...entry, cau: question.number, ...(question.sourceId ? { id: question.sourceId } : {}),
            noi_dung_cau_hoi: question.prompt, math_content: { ...entry.math_content, version: 1, question: question.math_content?.question || math.metadata(question.prompt) } };
          if (question.answerType === 'TF') return { ...entry, dap_an: answer,
            noi_dung_cac_y: Object.fromEntries(question.choices.map(c => [c.label, c.text])),
            math_content: { ...entry.math_content, version: 1, statements: Object.fromEntries(question.choices.map(c => [c.label, c.math_content || math.metadata(c.text)])) } };
          if (choice) return { ...entry, dap_an: choice.label, noi_dung_dap_an: choice.text,
            ...(choice.idOption != null ? { id_dap_an: choice.idOption } : {}),
            ...(choice.images?.length ? { anh_dap_an: choice.images.map(i => i.src) } : {}),
            math_content: { ...entry.math_content, version: 1, answer: choice.math_content || math.metadata(choice.text) } };
          return entry;
        });
        if (validationCancelled || revision !== examRevision || key !== examStorageKey()) throw new Error('Đã hủy kiểm tra hoặc chuyển bài.');
        const previous = { data: new Map(window.__ONLUYEN_DATABASE__), ids: new Map(window.__ONLUYEN_DATABASE_BY_ID__), prompts: new Map(window.__ONLUYEN_DATABASE_BY_PROMPT__), exported: window.__ONLUYEN_DATABASE_EXPORT__, staged: stagedDatabaseInput, validation: databaseValidation, json: stagedDatabaseInput || databaseExportJson() };
        parseAndLoadDatabase(verified, false, questions);
        try {
          await persistExamDatabase(key);
          if (validationCancelled || revision !== examRevision || key !== examStorageKey()) throw new Error('Đã hủy kiểm tra hoặc chuyển bài trong khi lưu.');
          if (sourceContext !== examSourceContext()) throw Object.assign(new Error('Nguồn đề đã thay đổi trong khi lưu. Hãy kiểm tra lại.'), { code: 'PAGE_CHANGED' });
          stagedDatabaseInput = null;
          databaseValidation = { revision, key, signature: math.signature(questions), questions,
            sourceContext, inputKey,
            exportKey: JSON.stringify(databaseItems(databaseExportJson())), report: lastMatchReport };
        } catch (error) {
          if (revision === examRevision && key === activeExamKey) {
            window.__ONLUYEN_DATABASE__ = previous.data;
            window.__ONLUYEN_DATABASE_BY_ID__ = previous.ids;
            window.__ONLUYEN_DATABASE_BY_PROMPT__ = previous.prompts;
            window.__ONLUYEN_DATABASE_EXPORT__ = previous.exported;
            stagedDatabaseInput = previous.staged; databaseValidation = previous.validation;
          }
          try { await persistExamDatabase(key, previous.json); } catch (_storageError) { /* Keep the previous in-memory state even if storage is unavailable. */ }
          throw Object.assign(error, { code: validationCancelled ? 'CANCELLED' : error.code || 'STORAGE_ERROR' });
        }
      }
      return { ok: true, count: validation.count, report: lastMatchReport, answers: window.__ONLUYEN_DATABASE_EXPORT__, json: databaseExportJson() };
    } catch (error) {
      if (!error.report && revision === examRevision && key === examStorageKey()) {
        lastMatchReport = math.matchReport({ ok: false, count: 0, issues: [{ number: null, id: null, status: 'incomplete', code: error.code || (validationCancelled ? 'CANCELLED' : 'INCOMPLETE_EXAM'), reason: error.message, source: [] }] });
        error.report = lastMatchReport;
      }
      throw error;
    } finally { preflightRunning = false; }
  }

  // ============================================================
  // 8. AUTO-SELECTOR ENGINE (BOT TỰ ĐỘNG CHỌN ĐÁP ÁN)
  // ============================================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function findSidebarButtonForQuestion(qNumber) {
    // Tìm trong thanh số câu bên trái của Onluyen
    const candidates = Array.from(document.querySelectorAll(
      '.answer-sheet .option, app-sidebar-school-test .option, .sidebar span, .sidebar button, .sidebar div, [class*="sidebar"] span, app-school-test-full-layout span'
    ));
    for (const el of candidates) {
      const text = el.innerText.trim();
      if (text === String(qNumber) && el.offsetWidth > 0 && el.offsetHeight > 0) {
        return el;
      }
    }
    // Tìm theo class số câu thông dụng trên phiếu trả lời
    const allSpans = Array.from(document.querySelectorAll('span, button, a'));
    for (const el of allSpans) {
      if (el.innerText.trim() === String(qNumber) && el.closest('.sidebar, [class*="nav"], [class*="list"], [class*="stepper"]')) {
        return el;
      }
    }
    return null;
  }

  function currentQuestionNumber() {
    const root = getCurrentQuestionRoot();
    const numberText = cleanText(root.querySelector('.question-info .num, .question-header .num')?.innerText);
    return Number(numberText.match(/Câu\s*:?\s*(\d+)/i)?.[1] || numberText.match(/\d+/)?.[0]) || null;
  }

  function currentQuestionIdentity() {
    const root = getCurrentQuestionRoot();
    return cleanText([
      root.querySelector('.question-info .num, .question-header .num')?.innerText,
      root.querySelector('.question-id')?.innerText,
      root.querySelector('.question-name')?.innerText
    ].join('|'));
  }

  function currentQuestionSourceId() {
    return questionSourceId(getCurrentQuestionRoot());
  }

  function currentQuestionMatches(expectedNumber) {
    const currentNumber = currentQuestionNumber();
    if (currentNumber !== null) return currentNumber === expectedNumber;
    const currentId = currentQuestionSourceId();
    return !!currentId && !!window.__ONLUYEN_DATABASE_BY_ID__?.get(currentId);
  }

  function answerEntryForCurrentQuestion(qNumber) {
    const sourceId = currentQuestionSourceId();
    const visibleQuestion = extractStructuredTestQuestions().find(question =>
      (sourceId && question.sourceId === sourceId) || question.number === qNumber
    );
    const promptKey = normalizeComparableText(
      visibleQuestion?.math_content?.question || visibleQuestion?.prompt
      || getCurrentQuestionRoot().querySelector('.question-name, .question-text')?.innerText
    );
    const identityMatch = (sourceId && window.__ONLUYEN_DATABASE_BY_ID__.get(sourceId))
      || (promptKey && window.__ONLUYEN_DATABASE_BY_PROMPT__.get(promptKey));
    if (identityMatch) return identityMatch;

    // Số câu chỉ là vị trí trong lần làm hiện tại. Entry có ID/nội dung
    // phải khớp định danh, kể cả khi entry đó trùng số câu đang mở.
    const numberedEntry = window.__ONLUYEN_DATABASE__.get(qNumber);
    if (numberedEntry?.sourceId || numberedEntry?.questionText) return null;
    return numberedEntry || null;
  }

  async function waitForCondition(predicate, timeoutMs = 12000, intervalMs = 100) {
    const deadline = Date.now() + timeoutMs;
    const revision = examRevision;
    while (Date.now() < deadline) {
      if (!window.__BOT_RUNNING__ || revision !== examRevision) return false;
      if (predicate()) return true;
      await sleep(intervalMs);
    }
    return false;
  }

  async function waitForQuestionNumber(expectedNumber, timeoutMs = 12000) {
    return waitForCondition(() => currentQuestionMatches(expectedNumber), timeoutMs);
  }

  async function waitForQuestionReady(expectedNumber, timeoutMs = 5000) {
    return waitForCondition(() => {
      if (!currentQuestionMatches(expectedNumber)) return false;
      const root = getCurrentQuestionRoot();
      const formulaElements = [...root.querySelectorAll('.question-option-content, .select-item label, .option-text .fadein')];
      if (formulaElements.some(element => math.canonicalize(math.metadata(element)).status === 'incomplete')) return false;
      return [...root.querySelectorAll('.question-option, .select-item, .true-false, .answer-input input[type="text"], input.can-resize-second, input[config-typeaction]')].some(isVisible);
    }, timeoutMs, 80);
  }

  function findAnswerButton() {
    const root = getCurrentQuestionRoot();
    return [...root.querySelectorAll('.submit-bar button, button')]
      .filter(isVisible)
      .find(button => /^trả lời$/i.test(cleanText(button.innerText)) && !button.disabled) || null;
  }

  function findNextQuestionButton() {
    const root = getCurrentQuestionRoot();
    return [...root.querySelectorAll('.submit-bar button, button')]
      .filter(isVisible)
      .find(button => /^(câu hỏi tiếp theo|câu tiếp theo|tiếp tục|next)$/i.test(cleanText(button.innerText)) && !button.disabled) || null;
  }

  function isFinalAnswerRecorded() {
    const root = getCurrentQuestionRoot();
    return [...root.querySelectorAll('.submit-bar button, button')]
      .filter(isVisible)
      .some(button => /^(kết thúc|hoàn thành|finish)$/i.test(cleanText(button.innerText)));
  }

  function getCurrentQuestionRoot() {
    const visibleContainer = [...document.querySelectorAll([
      '#test-step-question .question-container',
      'app-practice-step-question-option',
      'app-practice-step-question-true-false',
      'app-practice-step-data-question-nonresult',
      'app-practice-step-question-judge'
    ].join(','))].find(isVisible);
    return visibleContainer
      || document.querySelector('#test-step-question')
      || document.querySelector('.question-container')
      || document;
  }

  function normalizeSubQuestionKey(value, fallbackIndex) {
    const match = cleanText(value).match(/([a-z])\s*[).:\]]?/i);
    return match?.[1]?.toLowerCase() || String.fromCharCode(97 + fallbackIndex);
  }

  function truthValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
    const normalized = cleanText(value).toLowerCase();
    if (/^(đúng|dung|true|1)$/.test(normalized)) return true;
    if (/^(sai|false|0)$/.test(normalized)) return false;
    return null;
  }

  function getTrueFalseRows(root) {
    const hasTrueFalseRadio = row => row.querySelector(
      '.true-false input[type="radio"], input[type="radio"][value="true"], input[type="radio"][value="false"]'
    );
    const childRows = [...root.querySelectorAll('.child-content')].filter(hasTrueFalseRadio);
    if (childRows.length) return childRows;
    const tableRows = [...root.querySelectorAll('tr')].filter(hasTrueFalseRadio);
    if (tableRows.length) return tableRows;
    return [...root.querySelectorAll('.true-false')].filter(hasTrueFalseRadio);
  }

  async function clickOptionForCurrentQuestion(qNum, answerEntry) {
    const ans = answerEntry.answer;
    if (!ans) return false;
    const currentRoot = getCurrentQuestionRoot();

    // 0. Câu trả lời ngắn (input MathPlay)
    if (String(answerEntry.type || '').toUpperCase() === 'SHORT' || shortAnswerInput(currentRoot)) {
      return fillShortAnswer(currentRoot, ans);
    }

    // 1. Nếu là Trắc nghiệm đơn MCQ (A, B, C, D)
    if (typeof ans === 'string' && /^[A-D]$/i.test(ans.trim())) {
      const targetLetter = ans.trim().toUpperCase();
      const targetIndex = targetLetter.charCodeAt(0) - 65; // A->0, B->1, C->2, D->3

      const optionElements = mcqOptionElements(currentRoot);
      if (optionElements.length > 0) {
        const saved = answerEntry.answerContent || answerEntry.originalAnswerText || answerEntry.answerText;
        if (saved || answerEntry.answerImages || answerEntry.answerOptionId != null) {
          const result = math.resolveChoice(currentMcqChoices(currentRoot), saved, answerEntry.answerOptionId, answerEntry.answerImages);
          if (result.status !== 'equal') throw new Error(`Câu ${qNum}: ${result.reason}. Nguồn: ${answerEntry.originalAnswerText || answerEntry.answerText}`);
          return activateMcqOption(result.choice.element);
        }
        if (!answerEntry.snapshotBound) throw new Error(`Câu ${qNum}: cache chỉ có chữ cái, chưa xác minh được; hãy lấy lại đáp án từ đề/History.`);

        // Ưu tiên khớp theo label chữ cái
        let matched = optionElements.find((option, index) => mcqOptionLabel(option, index) === targetLetter);
        // Fallback theo index
        if (!matched && optionElements[targetIndex]) {
          matched = optionElements[targetIndex];
        }

        if (matched) {
          return activateMcqOption(matched);
        }
      }
    }

    // 2. Nếu là Đúng/Sai (TF)
    if (typeof ans === 'object' && ans !== null) {
      // Ví dụ { a: "Đúng", b: "Sai", c: "Đúng", d: "Sai" }
      const rows = getTrueFalseRows(currentRoot);
      const rowsByKey = new Map(rows.map((row, index) => [
        normalizeSubQuestionKey(row.querySelector('.option-char')?.innerText, index),
        row
      ]));
      const entries = Object.entries(ans);
      if (entries.length !== rows.length) throw new Error(`Câu ${qNum}: thiếu nội dung các ý Đúng/Sai.`);
      const planned = [];
      const used = new Set();
      for (let index = 0; index < entries.length; index++) {
        const [key, value] = entries[index];
        const saved = answerEntry.statementContents?.[key] || answerEntry.choiceTexts?.[key];
        const candidates = saved ? rows.filter(row => math.compare(saved, math.metadata(row.querySelector('.option-text .fadein') || row.querySelector('.option-text'))).status === 'equal') : [rowsByKey.get(normalizeSubQuestionKey(key, index))];
        if (candidates.length !== 1 || !candidates[0] || used.has(candidates[0])) throw new Error(`Câu ${qNum}, ý ${key}: không khớp duy nhất công thức Đúng/Sai.`);
        const expected = truthValue(value);
        const radio = [...candidates[0].querySelectorAll('input[type="radio"]')].find(input => truthValue(input.value) === expected);
        if (expected === null || !radio) throw new Error(`Câu ${qNum}, ý ${key}: thiếu lựa chọn Đúng/Sai.`);
        used.add(candidates[0]); planned.push(radio);
      }
      for (const radio of planned) if (!radio.checked) { assertValidatedQuestion(qNum); radio.click(); }
      return planned.length === rows.length;

    }

    return false;
  }

  async function runAutoBot() {
    const botRevision = examRevision;
    if (window.__ONLUYEN_DATABASE__.size === 0 && !stagedDatabaseInput) {
      throw new Error('Database đáp án đang trống. Vui lòng dùng "AI Tự Giải" hoặc nạp JSON đáp án trước.');
    }

    if (botRevision !== examRevision) return;
    window.__BOT_RUNNING__ = true;
    const questions = getFullExamQuestions();
    const total = Math.max(questions.length, window.__ONLUYEN_DATABASE_EXPORT__.length);
    const isPracticePage = /^\/practices(?:\/|$)/.test(location.pathname)
      || !!document.querySelector('app-practice-step-question-option, app-practice-step-question-true-false');

    console.log(`🚀 [OnluyenBot] Bắt đầu tự động chọn cho ${total} câu hỏi...`);

    let completed = 0;
    let stopped = false;
    try {
      for (let i = 1; i <= total; i++) {
        if (!window.__BOT_RUNNING__) {
          stopped = true;
          console.log('⏹️ [OnluyenBot] Đã dừng lại theo yêu cầu của người dùng.');
          break;
        }

        chrome.runtime.sendMessage({
          action: 'BOT_PROGRESS',
          current: i,
          total,
          text: `Đang điền câu ${i}/${total}...`
        }).catch(() => {});

        if (!currentQuestionMatches(i)) {
          const navBtn = findSidebarButtonForQuestion(i);
          if (!navBtn) throw new Error(`Không tìm thấy nút chuyển đến câu ${i}.`);
          const identityBeforeNavigation = currentQuestionIdentity();
          navBtn.click();
          const opened = await waitForCondition(() => {
            const currentIdentity = currentQuestionIdentity();
            return !!currentIdentity && currentIdentity !== identityBeforeNavigation && currentQuestionMatches(i);
          });
          if (!opened) {
            if (!window.__BOT_RUNNING__) {
              stopped = true;
              break;
            }
            throw new Error(`Đã bấm câu ${i} nhưng giao diện không chuyển đến câu này.`);
          }
        }

        const questionReady = await waitForQuestionReady(i);
        if (!questionReady) {
          if (!window.__BOT_RUNNING__) {
            stopped = true;
            break;
          }
          const pending = [...getCurrentQuestionRoot().querySelectorAll('.question-option-content, .option-text .fadein')]
            .map(element => math.canonicalize(math.metadata(element))).find(result => result.status === 'incomplete');
          throw new Error(`Câu ${i} đã mở nhưng các lựa chọn chưa render xong.${pending ? ` ${pending.reason}.` : ''}`);
        }

        // Angular có thể render lựa chọn trước rồi mới gắn trạng thái đáp án đã lưu.
        await sleep(350);
        if (botRevision !== examRevision) return;

        const answerEntry = answerEntryForCurrentQuestion(i);
        if (!answerEntry) {
          throw new Error(`Thiếu đáp án khớp câu ${i} (ID ${currentQuestionSourceId() || 'không xác định'}) trong Database. Database có thể thuộc bài khác; hãy nạp đáp án đúng bài hoặc tạo lại bằng "Sao chép Prompt AI" / "AI Tự Giải".`);
        }

        const currentRoot = getCurrentQuestionRoot();
        assertValidatedQuestion(i);
        const isShort = String(answerEntry.type || '').toUpperCase() === 'SHORT' || !!shortAnswerInput(currentRoot);
        const alreadyRecorded = typeof answerEntry.answer === 'string'
          && (isShort
            ? shortAnswerMatches(currentRoot, answerEntry)
            : recordedMcqAnswerMatches(currentRoot, answerEntry))
          && !findAnswerButton();
        if (alreadyRecorded) {
          if (i < total) {
            const nextButton = findSidebarButtonForQuestion(i + 1);
            if (!nextButton) throw new Error(`Câu ${i} đã được lưu nhưng không tìm thấy nút chuyển đến câu ${i + 1}.`);
            const identityBeforeNavigation = currentQuestionIdentity();
            nextButton.click();
            const advanced = await waitForCondition(() => {
              const currentIdentity = currentQuestionIdentity();
              return !!currentIdentity && currentIdentity !== identityBeforeNavigation && currentQuestionMatches(i + 1);
            });
            if (!advanced) throw new Error(`Câu ${i} đã được lưu nhưng giao diện chưa chuyển sang câu ${i + 1}.`);
          }
          completed++;
          console.log(`✅ [OnluyenBot] Câu ${i}/${total} đã có đáp án đúng được lưu; chuyển tiếp.`);
          continue;
        }

        const selected = await clickOptionForCurrentQuestion(i, answerEntry);
        if (!selected) {
          throw new Error(`Không chọn được đáp án cho câu ${i} (${selectionDebugSummary(getCurrentQuestionRoot(), answerEntry)}).`);
        }

        const answerButtonReady = await waitForCondition(() => !!findAnswerButton(), 4000, 80);
        if (!answerButtonReady) {
          if (!window.__BOT_RUNNING__) {
            stopped = true;
            break;
          }
          throw new Error(`Đã chọn đáp án câu ${i} nhưng nút "Trả lời" chưa sẵn sàng.`);
        }

        const answerButton = findAnswerButton();
        if (!answerButton) throw new Error(`Không còn tìm thấy nút "Trả lời" của câu ${i}.`);
        const identityBeforeSubmit = currentQuestionIdentity();
        assertValidatedQuestion(i);
        answerButton.click();
        console.log(`✅ [OnluyenBot] Đã bấm Trả lời câu ${i}; đang chờ trang xác nhận...`);

        let confirmed = false;
        if (isPracticePage) {
          const identityChanged = () => {
            const currentIdentity = currentQuestionIdentity();
            return !!currentIdentity && currentIdentity !== identityBeforeSubmit;
          };
          const practiceResponseReady = await waitForCondition(
            () => identityChanged() || !!findNextQuestionButton() || isFinalAnswerRecorded()
          );
          const nextQuestionButton = practiceResponseReady ? findNextQuestionButton() : null;
          if (nextQuestionButton) {
            nextQuestionButton.click();
            confirmed = await waitForCondition(identityChanged);
          } else {
            confirmed = practiceResponseReady && (identityChanged() || isFinalAnswerRecorded());
          }
        } else {
          confirmed = i < total
            ? await waitForCondition(() => {
                const currentIdentity = currentQuestionIdentity();
                return !!currentIdentity && currentIdentity !== identityBeforeSubmit && currentQuestionMatches(i + 1);
              })
            : await waitForCondition(isFinalAnswerRecorded);
        }
        if (!confirmed) {
          if (!window.__BOT_RUNNING__) {
            stopped = true;
            break;
          }
          const actual = currentQuestionNumber();
          throw new Error(isPracticePage
            ? `Đã bấm Trả lời câu luyện tập nhưng trang chưa tải câu tiếp theo.`
            : i < total
            ? `Đã bấm Trả lời câu ${i} nhưng trang vẫn ở câu ${actual || 'không xác định'}, chưa sang câu ${i + 1}.`
            : `Đã bấm Trả lời câu cuối nhưng trang chưa xác nhận lưu đáp án.`);
        }

        completed++;
        console.log(`✅ [OnluyenBot] Đã xác nhận hoàn thành câu ${i}/${total}.`);
        await sleep(150);
      }
    } finally {
      if (botRevision === examRevision) window.__BOT_RUNNING__ = false;
    }

    if (stopped || botRevision !== examRevision) return;
    chrome.runtime.sendMessage({
      action: 'BOT_DONE',
      completed,
      total,
      text: `Hoàn tất! Đã điền thành công ${completed}/${total} câu.`
    }).catch(() => {});
  }

  function stopAutoBot() {
    window.__BOT_RUNNING__ = false;
    collectionCancelled = true;
    validationCancelled = true;
  }

  // ============================================================
  // 9. CHROME RUNTIME MESSAGE LISTENER
  // ============================================================
  function handleMessage(message, _sender, sendResponse) {
    if (message?.action !== 'OL_PING' && message?.examKey !== undefined
        && message.examKey !== activeExamKey) {
      sendResponse({ ok: false, error: 'Đã chuyển sang bài khác. Hãy dùng database của đề hiện tại.' });
      return false;
    }
    // 1. PING & KIỂM TRA TRẠNG THÁI
    if (message?.action === 'OL_PING') {
      const hasApiData = !!(window.__ONLUYEN_RAW_DATA__ && window.__ONLUYEN_RAW_DATA__.questions?.length > 0);
      const qCount = hasApiData ? window.__ONLUYEN_RAW_DATA__.questions.length : extractQuestions().length;
      sendResponse({
        ok: true,
        url: location.href,
        route: routeLabel(),
        hasApiData,
        qCount,
        dbSize: window.__ONLUYEN_DATABASE_EXPORT__.length,
        botRunning: window.__BOT_RUNNING__ || preflightRunning,
        examKey: activeExamKey,
        databaseJson: stagedDatabaseInput || databaseExportJson()
      });
      return false;
    }

    // 2. LẤY TOÀN BỘ ĐỀ THI
    if (message?.action === 'OL_GET_EXAM') {
      const questions = getFullExamQuestions();
      sendResponse({
        ok: true,
        count: questions.length,
        hasApi: !!window.__ONLUYEN_RAW_DATA__,
        questions
      });
      return false;
    }

    // LẤY ĐÁP ÁN ĐÚNG TỪ TRANG KẾT QUẢ ĐÃ CHẤM
    if (message?.action === 'OL_GET_HISTORY_ANSWERS') {
      (async () => {
        try {
          const answers = await extractHistoryAnswers();
          sendResponse({
            ok: true,
            count: answers.length,
            answers,
            json: JSON.stringify(answers, null, 2)
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    // 3. TẠO PROMPT AI (CHẾ ĐỘ 1)
    if (message?.action === 'OL_GET_AI_PROMPT') {
      (async () => {
        try {
          const questions = await getCompleteExamQuestions();
          if (!questions.length) throw new Error('Không tìm thấy câu hỏi nào trên trang. Hãy tải lại trang F5.');
          const prompt = buildAIPrompt(questions);
          const images = promptImageFiles(questions);
          sendResponse({ ok: true, prompt, count: questions.length, imageCount: images.length, images });
        } catch (error) { sendResponse({ ok: false, error: error.message }); }
      })();
      return true;
    }

    // 4. GỌI GEMINI API TRỰC TIẾP (CHẾ ĐỘ 2)
    if (message?.action === 'OL_CALL_AI_SOLVE') {
      const solveRevision = examRevision;
      const solveKey = activeExamKey;
      (async () => {
        try {
          const questions = await getCompleteExamQuestions();
          if (!questions.length) throw new Error('Không tìm thấy câu hỏi nào trên trang. Hãy F5 tải lại.');
          const prompt = buildAIPrompt(questions);
          const imagePayload = await prepareGeminiImageParts(questions);
          if (imagePayload.failures.length) {
            throw new Error(`Không đọc được ${imagePayload.failures.length}/${imagePayload.files.length} ảnh: ${imagePayload.failures.slice(0, 2).join('; ')}`);
          }
          const aiResult = await solveWithGeminiPool(prompt, imagePayload.parts);
          if (solveRevision !== examRevision || solveKey !== examStorageKey()) {
            throw new Error('Đã chuyển sang bài khác. Hãy giải lại đề hiện tại.');
          }
          const validated = await validateDatabase(aiResult.text, true);
          const count = validated.count;
          const normalizedJson = databaseExportJson();
          sendResponse({
            ok: true,
            model: aiResult.model,
            isPaid: aiResult.isPaid,
            keyPreview: aiResult.keyPreview,
            imageCount: imagePayload.files.length,
            dbCount: count,
            rawText: normalizedJson,
            json: normalizedJson,
            answers: window.__ONLUYEN_DATABASE_EXPORT__
          });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true; // async
    }

    // 5. NẠP DATABASE THỦ CÔNG TỪ TEXTAREA
    if (message?.action === 'OL_LOAD_DATABASE') {
      validateDatabase(message.json, true).then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message, report: err.report }));
      return true;
    }
    if (message?.action === 'OL_VALIDATE_DATABASE') {
      validateDatabase(message.json || stagedDatabaseInput || databaseExportJson(), false, true).then(sendResponse).catch(err => sendResponse({ ok: false, error: err.message, report: err.report }));
      return true;
    }
    if (message?.action === 'OL_GET_MATCH_REPORT') {
      sendResponse({ ok: !!lastMatchReport, report: lastMatchReport, error: lastMatchReport ? null : 'Chưa có báo cáo kiểm tra.' });
      return false;
    }

    // 6. CHẠY BOT TỰ ĐIỀN
    if (message?.action === 'OL_START_BOT') {
      if (examCollection) {
        sendResponse({ ok: false, error: 'Đang đọc đề từ giao diện. Hãy chờ tạo prompt xong rồi chạy bot.' });
        return false;
      }
      const botRevision = examRevision;
      const failed = err => {
        if (botRevision === examRevision) chrome.runtime.sendMessage({ action: 'BOT_ERROR', error: err.message, report: err.report }).catch(() => {});
      };
      validateDatabase(message.json || stagedDatabaseInput || databaseExportJson(), true).then(result => {
        if (!result.count) throw new Error('Database đáp án đang trống.');
        if (botRevision !== examRevision) throw new Error('Đã chuyển bài trong khi kiểm tra.');
        runAutoBot().catch(failed);
        sendResponse({ ok: true, report: result.report, json: result.json, reused: !!result.reused });
      }).catch(err => { failed(err); sendResponse({ ok: false, error: err.message, report: err.report }); });
      return true;
    }

    // 7. DỪNG BOT
    if (message?.action === 'OL_STOP_BOT') {
      stopAutoBot();
      sendResponse({ ok: true });
      return false;
    }

    // CÁC TÍNH NĂNG GỐC VẪN BẢO TOÀN
    if (message?.action === 'OL_COLLECT') {
      sendResponse({ ok: true, page: collectPage() });
      return false;
    }
    if (message?.action === 'OL_TUTOR_PROMPT') {
      const page = collectPage();
      sendResponse({ ok: true, page, prompt: createTutorPrompt(page) });
      return false;
    }

    return false;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    syncExamContext().then(() => handleMessage(message, sender, sendResponse))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  examRestore = restoreExamDatabase(activeExamKey, examRevision);
  setInterval(syncExamContext, 500);

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    syncExamContext();
    chrome.runtime.sendMessage({ action: 'OL_BADGE', text: 'ON', type: 'ready', clearAfter: 2500 }).catch(() => {});
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
