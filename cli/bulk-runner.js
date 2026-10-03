#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer');
const math = require('../math-content');
const promptSnapshots = new WeakMap();

const ROOT = path.resolve(__dirname, '..');
const CONTENT_SOURCE = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const MATH_SOURCE = fs.readFileSync(path.join(ROOT, 'math-content.js'), 'utf8');
const INJECT_SOURCE = fs.readFileSync(path.join(ROOT, 'inject.js'), 'utf8');
const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

function exportMatchReport(report) {
  const reportFile = path.join(ROOT, 'cache', 'onluyen-match-report.json');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.error(`Báo cáo kiểm tra: ${reportFile}`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function comparable(value) {
  const result = math.canonicalize(value);
  return result.status === 'ok' ? result.key : null;
}

function parseArgs(argv) {
  const args = { links: 'bulk-tests.txt', answers: [], geminiConfigs: [], submit: false, headless: false };
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--links') args.links = argv[++index];
    else if (value === '--answers') args.answers.push(...String(argv[++index] || '').split(',').filter(Boolean));
    else if (value === '--gemini-config') args.geminiConfigs.push(argv[++index]);
    else if (value === '--submit') args.submit = true;
    else if (value === '--dry-run') args.submit = false;
    else if (value === '--headless') args.headless = true;
    else if (value === '--headed') args.headless = false;
  }
  return args;
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function keysAndModelsFromGeminiConfig(config) {
  if (!config || typeof config !== 'object') return { keys: [], models: [] };
  const keys = uniqueStrings([
    ...(Array.isArray(config.geminiApiKeys) ? config.geminiApiKeys : []),
    ...(Array.isArray(config.paidApiKeys) ? config.paidApiKeys : []),
    config.geminiApiKey,
    config.paidApiKey
  ]);
  const modelConfig = config.models && typeof config.models === 'object' ? config.models : {};
  const models = uniqueStrings([
    modelConfig.primary,
    modelConfig.fallback1,
    modelConfig.fallback2,
    modelConfig.smart,
    modelConfig.pro
  ]).filter(model => /^gemini-/i.test(model));
  return { keys, models };
}

function loadGeminiPool(args = {}) {
  const envKeys = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
    .split(/[;,\r\n]+/).map(key => key.trim()).filter(Boolean);
  const configPaths = [...(args.geminiConfigs || [])];
  if (process.env.GEMINI_CONFIG) configPaths.push(process.env.GEMINI_CONFIG);

  const pointerFile = path.join(ROOT, 'gemini-config.path');
  if (fs.existsSync(pointerFile)) {
    configPaths.push(...fs.readFileSync(pointerFile, 'utf8')
      .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')));
  }
  const localConfig = path.join(ROOT, 'config.json');
  if (fs.existsSync(localConfig)) configPaths.push(localConfig);

  const keys = [...envKeys];
  const models = [];
  let loadedConfigs = 0;
  for (const candidate of uniqueStrings(configPaths)) {
    const file = path.isAbsolute(candidate) ? candidate : path.resolve(ROOT, candidate);
    if (!fs.existsSync(file)) continue;
    try {
      const extracted = keysAndModelsFromGeminiConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
      keys.push(...extracted.keys);
      models.push(...extracted.models);
      loadedConfigs++;
    } catch (error) {
      throw new Error(`Không đọc được Gemini config ${path.basename(file)}: ${error.message}`);
    }
  }
  return { keys: uniqueStrings(keys), models: uniqueStrings(models), loadedConfigs };
}

function readLinks(filePath) {
  const absolute = path.resolve(ROOT, filePath);
  if (!fs.existsSync(absolute)) throw new Error(`Không tìm thấy file link: ${absolute}`);
  const links = fs.readFileSync(absolute, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  for (const link of links) {
    const parsed = new URL(link);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'app.onluyen.vn') {
      throw new Error(`Link không hợp lệ hoặc không thuộc app.onluyen.vn: ${link}`);
    }
  }
  if (!links.length) throw new Error(`File ${absolute} chưa có link bài test.`);
  return links;
}

function testIdFromUrl(url) {
  return new URL(url).pathname.match(/\/school\/test\/(?:history\/)?([^/?#]+)/i)?.[1] || null;
}

function historyUrlForTest(url) {
  const parsed = new URL(url);
  const testId = testIdFromUrl(url);
  return testId ? `${parsed.origin}/school/test/history/${testId}` : null;
}

function cachePath(...parts) {
  return path.join(ROOT, 'cache', ...parts);
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadTestCache(testId) {
  if (!testId) return { answers: [], questions: [] };
  return readJsonFile(cachePath('tests', `${testId}.json`), { answers: [], questions: [] });
}

function saveTestCache(testId, questions, answers) {
  if (!testId) return;
  writeJsonFile(cachePath('tests', `${testId}.json`), {
    schemaVersion: 3,
    testId,
    updatedAt: new Date().toISOString(),
    questions,
    answers
  });
}

function accountCacheKey(username) {
  return crypto.createHash('sha256').update(String(username || '').trim().toLocaleLowerCase('vi')).digest('hex');
}

function loadAccountCache(username) {
  const key = accountCacheKey(username);
  return {
    key,
    file: cachePath('accounts', `${key}.json`),
    data: readJsonFile(cachePath('accounts', `${key}.json`), { schemaVersion: 1, accountKey: key, tests: {} })
  };
}

function markAccountCompleted(accountCache, testId, details) {
  if (!testId) return;
  accountCache.data.tests ||= {};
  accountCache.data.tests[testId] = {
    completed: true,
    score: details.score ?? null,
    url: details.url,
    completedAt: new Date().toISOString()
  };
  writeJsonFile(accountCache.file, accountCache.data);
}

function answerFilesFromArgs(args) {
  const files = args.answers.map(file => path.resolve(ROOT, file));
  const answerDir = path.join(ROOT, 'answers');
  if (fs.existsSync(answerDir)) {
    for (const name of fs.readdirSync(answerDir)) {
      if (name.toLowerCase().endsWith('.json')) files.push(path.join(answerDir, name));
    }
  }
  return [...new Set(files)];
}

function parseJsonArray(input) {
  let text = String(input || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) text = fenced[1];
  const array = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (array) text = array[0];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Dữ liệu đáp án phải là một mảng JSON.');
  return parsed;
}

function loadAnswerBank(files) {
  const entries = [];
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`Không tìm thấy answer bank: ${file}`);
    entries.push(...parseJsonArray(fs.readFileSync(file, 'utf8')));
  }
  return entries;
}

function localizedQuestionData(question) {
  const language = question?.currentLang || question?.currentLanguage || 'vi';
  const languages = question?.languagesData || question?.languageData || {};
  return languages[language] || languages.vi || Object.values(languages)[0] || {};
}

function imageSourcesFromHtml(...htmlValues) {
  const images = [];
  for (const html of htmlValues.flat(Infinity)) {
    if (!html || typeof html !== 'string') continue;
    const regex = /<img\b[^>]*?\b(?:src|data-src|data-original)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    for (const match of html.matchAll(regex)) {
      const raw = match[1].replace(/&amp;/gi, '&');
      try {
        const src = /^data:image\//i.test(raw) ? raw : new URL(raw, 'https://app.onluyen.vn/').href;
        images.push({ src, alt: '' });
      } catch (_error) {}
    }
  }
  const seen = new Set();
  return images.filter(image => image.src && !seen.has(image.src) && seen.add(image.src));
}

function normalizeApiQuestion(question, fallbackNumber, materialPrompt = '', materialImages = []) {
  if (!question || typeof question !== 'object') return null;
  const localized = localizedQuestionData(question);
  const promptSource = localized.content || localized.question || question.content || question.question || question.contentHtml || '';
  const prompt = math.text(promptSource);
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
    text: math.text(source),
    idOption: option.idOption,
    math_content: math.metadata(source),
    images: imageSourcesFromHtml(source)
  }; });
  const number = Number(question.stepIndex) >= 0 ? Number(question.stepIndex) + 1 : fallbackNumber;
  const images = imageSourcesFromHtml(
    materialImages.map(image => `<img src="${image.src}">`),
    choices.flatMap(choice => choice.images).map(image => `<img src="${image.src}">`),
    localized.content,
    localized.question,
    question.content,
    question.question,
    question.contentHtml,
    optionSource.map(option => option.content || option.text || option.value)
  );
  return {
    number,
    origin: 'api',
    sourceId: question.numberQuestion ? String(question.numberQuestion) : null,
    answerType: isTrueFalse ? 'TF' : isShortAnswer ? 'SHORT' : 'MCQ',
    prompt: materialPrompt ? `[Đoạn tư liệu: ${math.text(materialPrompt)}]\n${prompt}` : prompt,
    math_content: { version: 1, question: materialPrompt ? math.combine('[Đoạn tư liệu:', materialPrompt, ']', promptSource) : math.metadata(promptSource) },
    choices,
    expectedChoiceCount: optionSource.length,
    images
  };
}

function parseApiQuestions(rawItems) {
  const list = [];
  let fallbackNumber = 1;
  for (const item of rawItems || []) {
    const materialQuestions = item?.dataMaterial?.datas || item?.dataMaterial?.data;
    if (item?.dataMaterial && Array.isArray(materialQuestions)) {
      const materialHtml = item.dataMaterial.contentHtml || item.dataMaterial.content || '';
      const materialPrompt = materialHtml;
      const materialImages = imageSourcesFromHtml(materialHtml);
      for (const question of materialQuestions) {
        const normalized = normalizeApiQuestion(question, fallbackNumber++, materialPrompt, materialImages);
        if (normalized) list.push(normalized);
      }
    } else if (item?.dataStandard) {
      const normalized = normalizeApiQuestion(item.dataStandard, fallbackNumber++);
      if (normalized) list.push(normalized);
    }
  }
  return list.sort((a, b) => a.number - b.number);
}

function buildPrompt(questions, preparedSnapshot = null) {
  const inspection = math.inspectPromptSources(questions);
  if (!inspection.ok) throw Object.assign(new Error(inspection.issues.map(i => `Câu ${i.number}: ${i.reason}`).join('\n')),
    { report: math.matchReport(inspection, { cliVersion: require('../package.json').version }) });
  const snapshot = preparedSnapshot || { id: crypto.randomUUID(), signature: math.signature(questions), questions };
  promptSnapshots.set(questions, snapshot);
  const lines = [
    'Giải chính xác các câu trắc nghiệm sau.',
    'Chỉ trả về một mảng JSON, không giải thích.',
    `snapshot_id: ${snapshot.id}. Chép trường "snapshot_id" này vào từng đáp án; bắt buộc khi thiếu ID câu hoặc chỉ trả đáp án theo vị trí.`,
    'MCQ: {"cau":1,"id":"123456","loai":"MCQ","dap_an":"A","noi_dung_dap_an":"Nội dung phương án A"}',
    'Với đáp án là hình, chép id_dap_an nếu có hoặc anh_dap_an: ["URL/data:image base64 của phương án"]. Không mô tả hình thay cho nội dung đáp án. Nếu phương án không có chữ, bỏ noi_dung_dap_an.',
    'Ảnh base64 được gửi dưới dạng ảnh. Không chép chuỗi base64 dài: dùng id_dap_an; nếu không có ID, chỉ trả chữ cái của snapshot đề này và bỏ noi_dung_dap_an. Runner sẽ lưu nguồn ảnh từ lựa chọn đó.',
    'Đúng/Sai: {"cau":20,"loai":"TF","dap_an":{"a":"Đúng","b":"Sai","c":"Đúng","d":"Sai"}}',
    'Trả lời ngắn: {"cau":13,"loai":"SHORT","dap_an":"2"} (giữ nguyên dấu phẩy, dấu trừ hoặc ký hiệu cần nhập)',
    ''
  ];
  for (const question of questions) {
    lines.push(`=== CÂU ${question.number} ===`);
    if (question.sourceId) lines.push(`ID câu: ${question.sourceId}`);
    lines.push(math.toPromptContent(question.math_content?.question || question.prompt).text);
    if (question.answerType === 'TF') lines.push('Loại: Đúng/Sai cho từng ý.');
    if (question.answerType === 'SHORT') lines.push('Loại: Trả lời ngắn. Ghi chính xác nội dung cần nhập vào ô đáp án.');
    for (const choice of question.choices) {
      const content = math.toPromptContent(choice.math_content || choice.text);
      lines.push(`${choice.label}${question.answerType === 'TF' ? ')' : '.'} ${content.ok ? content.text : '[Lựa chọn bằng hình ảnh]'}`);
      if (choice.idOption != null) lines.push(`  id_dap_an: ${JSON.stringify(choice.idOption)}`);
      if (choice.images?.length) {
        if (choice.images.every(image => /^https?:\/\//i.test(image.src))) lines.push(`  anh_dap_an: ${JSON.stringify(choice.images.map(image => image.src))}`);
        else lines.push('  Ảnh base64/blob được đính kèm cho phương án này; trả ID hoặc chữ cái của snapshot, không mô tả bằng lời.');
      }
    }
    (question.images || []).forEach((image, index) => {
      const labels = question.choices.filter(choice => (choice.images || []).some(item => item.src === image.src)).map(choice => choice.label);
      lines.push(`Ảnh ${index + 1} của câu này${labels.length ? `, phương án ${labels.join(', ')}` : ', đề bài'} được đính kèm trong yêu cầu; phải quan sát ảnh trước khi trả lời.`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

function validateAndEnrichAnswers(rawAnswers, questions) {
  const snapshot = promptSnapshots.get(questions);
  const validation = math.validateExam(questions, rawAnswers, { snapshotId: snapshot?.id, snapshotSignature: snapshot?.signature, snapshotQuestions: snapshot?.questions });
  if (!validation.ok) throw Object.assign(new Error(validation.issues.map(i => `Câu ${i.number ?? '?'}: ${i.reason}`).join('\n')), { report: math.matchReport(validation, { cliVersion: require('../package.json').version }) });
  return validation.mappings.map(({ question, entry, choice: verifiedChoice, answer, verification }) => {
    const proof = { verification, ...(entry.snapshot_id ? { snapshot_id: entry.snapshot_id } : {}),
      ...(entry.noi_dung_cau_hoi && entry.noi_dung_cau_hoi !== question.prompt ? { noi_dung_cau_hoi_goc: entry.noi_dung_cau_hoi } : {}) };
    if (question.answerType === 'SHORT') {
      const value = String(answer ?? '').trim();
      if (!value) throw new Error(`Đáp án trả lời ngắn câu ${question.number} không hợp lệ.`);
      return {
        ...proof,
        cau: question.number,
        id: question.sourceId,
        loai: 'SHORT',
        dap_an: value,
        math_content: { version: 1, question: question.math_content?.question || math.metadata(question.prompt) },
        noi_dung_cau_hoi: question.prompt
      };
    }
    if (question.answerType === 'MCQ') {
      const letter = String(answer || '').trim().toUpperCase();
      if (!/^[A-D]$/.test(letter)) throw new Error(`Đáp án MCQ câu ${question.number} không hợp lệ.`);
      const choice = verifiedChoice;
      if (!choice) throw new Error(`Không tìm thấy nội dung đáp án ${letter} của câu ${question.number}.`);
      return {
        ...proof,
        cau: question.number,
        id: question.sourceId,
        loai: 'MCQ',
        dap_an: choice.label.toUpperCase(),
        ...(entry.noi_dung_dap_an ? { noi_dung_dap_an: entry.noi_dung_dap_an }
          : verification.basis === 'structured' ? { noi_dung_dap_an: choice.text } : {}),
        ...(choice.images?.length ? { anh_dap_an: choice.images.map(image => image.src) } : {}),
        math_content: { version: 1, question: question.math_content?.question || math.metadata(question.prompt), answer: choice.math_content || math.metadata(choice.text),
          ...(entry.math_content?.answer ? { supplied_answer: entry.math_content.supplied_answer || entry.math_content.answer } : {}) },
        noi_dung_cau_hoi: question.prompt,
        ...(choice.idOption !== undefined && choice.idOption !== null ? { id_dap_an: choice.idOption } : {})
      };
    }
    if (!answer || typeof answer !== 'object') throw new Error(`Đáp án Đúng/Sai câu ${question.number} không hợp lệ.`);
    const normalized = {};
    for (const choice of question.choices) {
      const value = answer[choice.label];
      const text = String(value ?? '').trim().toLocaleLowerCase('vi');
      if (!['đúng', 'dung', 'true', 'sai', 'false'].includes(text)) {
        throw new Error(`Thiếu đáp án ý ${choice.label} của câu ${question.number}.`);
      }
      normalized[choice.label] = ['đúng', 'dung', 'true'].includes(text) ? 'Đúng' : 'Sai';
    }
    const choiceTexts = Object.fromEntries(question.choices.filter(c => math.canonicalize(c.math_content || c.text).status === 'ok').map(choice => [choice.label, choice.text]));
    const choiceIds = Object.fromEntries(question.choices
      .filter(choice => choice.idOption !== undefined && choice.idOption !== null)
      .map(choice => [choice.label, choice.idOption]));
    return {
      ...proof,
      cau: question.number,
      id: question.sourceId,
      loai: 'TF',
      dap_an: normalized,
      noi_dung_cau_hoi: question.prompt,
      noi_dung_cac_y: choiceTexts,
      ...(entry.noi_dung_cac_y ? { noi_dung_cac_y_goc: entry.noi_dung_cac_y } : {}),
      math_content: { version: 1, question: question.math_content?.question || math.metadata(question.prompt), statements: Object.fromEntries(question.choices.map(c => [c.label, c.math_content || math.metadata(c.text)])) },
      ...(Object.keys(choiceIds).length ? { id_cac_y: choiceIds } : {})
    };
  });
}

function answerText(entry) {
  return entry?.math_content?.answer ?? entry?.noi_dung_dap_an_goc ?? entry?.noi_dung_dap_an ?? entry?.answer_text ?? entry?.answerText ?? null;
}

function questionText(entry) {
  return entry?.noi_dung_cau_hoi ?? entry?.question_text ?? entry?.questionText ?? entry?.prompt ?? null;
}

function matchBankAnswers(questions, bankEntries) {
  const byId = new Map();
  for (const entry of bankEntries) {
    const id = entry.id ?? entry.question_id ?? entry.sourceId;
    if (id == null) continue;
    const key = String(id).replace(/^#/, '');
    const entries = byId.get(key) || [];
    const fingerprint = e => JSON.stringify([math.sourceFingerprint(e.math_content?.question || questionText(e)), math.sourceFingerprint(answerText(e)),
      e.id_dap_an ?? null, e.anh_dap_an ?? null,
      answerText(e) ? null : e.dap_an ?? e.answer, e.math_content?.statements ?? e.noi_dung_cac_y ?? null]);
    if (!entries.some(e => fingerprint(e) === fingerprint(entry))) entries.push(entry);
    byId.set(key, entries);
  }
  const byPrompt = new Map();
  for (const entry of bankEntries) {
    const key = math.sourceFingerprint(entry.math_content?.question || questionText(entry));
    if (!key) continue;
    if (!byPrompt.has(key)) byPrompt.set(key, []);
    byPrompt.get(key).push(entry);
  }
  const matched = [];
  const missing = [];

  for (const question of questions) {
    const promptMatches = byPrompt.get(math.sourceFingerprint(question.math_content?.question || question.prompt)) || [];
    const idMatches = question.sourceId ? byId.get(question.sourceId) || [] : [];
    if (idMatches.length > 1) {
      const validation = math.validateExam([question], idMatches);
      throw Object.assign(new Error(`Câu ${question.number}: nhiều đáp án cache cho cùng ID.`), { report: math.matchReport(validation) });
    }
    const entry = idMatches[0] || (promptMatches.length === 1 ? promptMatches[0] : null);
    if (!entry) {
      missing.push(question);
      continue;
    }
    matched.push(...validateAndEnrichAnswers([entry], [question]));
  }
  return { matched, missing };
}

let geminiKeyCursor = 0;
const geminiKeyCooldowns = new Map();
const geminiModelCooldowns = new Map();

function retryDelayMs(response, fallbackMs = 60000) {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 5 * 60 * 1000)
    : fallbackMs;
}

function detectedImageMime(base64, declaredMime = '') {
  if (/^iVBOR/i.test(base64)) return 'image/png';
  if (/^\/9j\//i.test(base64)) return 'image/jpeg';
  if (/^R0lGOD/i.test(base64)) return 'image/gif';
  if (/^UklGR/i.test(base64)) return 'image/webp';
  return /^image\//i.test(declaredMime) ? declaredMime.toLowerCase() : 'image/png';
}

async function imageToInlineData(image) {
  const match = String(image?.src || '').match(/^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/i);
  if (match) {
    const data = match[2]
      ? match[3].replace(/\s+/g, '')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8').toString('base64');
    return { mimeType: detectedImageMime(data, match[1]), data };
  }
  const response = await fetch(image.src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    mimeType: detectedImageMime(buffer.toString('base64'), response.headers.get('content-type') || ''),
    data: buffer.toString('base64')
  };
}

async function geminiImageParts(questions) {
  const parts = [];
  const failures = [];
  let totalBytes = 0;
  for (const question of questions) {
    for (let index = 0; index < (question.images || []).length; index++) {
      try {
        const inlineData = await imageToInlineData(question.images[index]);
        const estimatedBytes = Math.floor(inlineData.data.length * 0.75);
        if (estimatedBytes > 7 * 1024 * 1024) throw new Error('ảnh lớn hơn 7 MB');
        if (totalBytes + estimatedBytes > 18 * 1024 * 1024) throw new Error('tổng ảnh vượt 18 MB');
        totalBytes += estimatedBytes;
        const labels = (question.choices || []).filter(choice => (choice.images || []).some(image => image.src === question.images[index].src)).map(choice => choice.label);
        parts.push({ text: `Ảnh ${index + 1} của CÂU ${question.number}${labels.length ? `, phương án ${labels.join(', ')}` : ', đề bài'}:` });
        parts.push({ inlineData });
      } catch (error) {
        failures.push(`câu ${question.number}, ảnh ${index + 1}: ${error.message}`);
      }
    }
  }
  return { parts, failures, imageCount: parts.filter(part => part.inlineData).length };
}

async function callGemini(keys, models, prompt, questions = []) {
  const imagePayload = await geminiImageParts(questions);
  if (imagePayload.failures.length) {
    throw new Error(`Không đọc được ${imagePayload.failures.length} ảnh (${imagePayload.failures.slice(0, 2).join('; ')}).`);
  }
  const failures = [];
  const orderedKeys = keys.map((_key, index) => keys[(geminiKeyCursor + index) % keys.length]);
  for (let keyIndex = 0; keyIndex < orderedKeys.length; keyIndex++) {
    const key = orderedKeys[keyIndex];
    if ((geminiKeyCooldowns.get(key) || 0) > Date.now()) continue;
    for (const model of models) {
      if ((geminiModelCooldowns.get(model) || 0) > Date.now()) continue;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }, ...imagePayload.parts] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192, responseMimeType: 'application/json' }
          })
        });
        if (!response.ok) {
          failures.push(`${model}: HTTP ${response.status}`);
          if ([401, 403].includes(response.status)) {
            geminiKeyCooldowns.set(key, Number.POSITIVE_INFINITY);
            break;
          }
          if (response.status === 404) {
            geminiModelCooldowns.set(model, Number.POSITIVE_INFINITY);
            continue;
          }
          if (response.status === 429) {
            geminiKeyCooldowns.set(key, Date.now() + retryDelayMs(response));
            break;
          }
          if (response.status === 503) {
            geminiModelCooldowns.set(model, Date.now() + retryDelayMs(response));
          }
          continue;
        }
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
        geminiKeyCursor = (geminiKeyCursor + keyIndex + 1) % keys.length;
        return { answers: parseJsonArray(text), model, imageCount: imagePayload.imageCount };
      } catch (error) {
        failures.push(`${model}: ${error.message}`);
      }
    }
  }
  throw new Error(`Gemini không trả được đáp án (${failures.slice(0, 5).join('; ')}).`);
}

function askLine(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(label, value => {
    rl.close();
    resolve(value.trim());
  }));
}

async function askCredentials(useEnvironment = true) {
  const envUsername = useEnvironment ? process.env.ONLUYEN_USERNAME : '';
  const envPassword = useEnvironment ? process.env.ONLUYEN_PASSWORD : '';
  if (envUsername && envPassword) return { username: envUsername, password: envPassword };

  const combined = await askHidden('Dán "tài_khoản mật_khẩu" (được che khi nhập): ');
  const separator = combined.includes('|') ? /\s*\|\s*/ : /\s+/;
  const parts = combined.split(separator).filter(Boolean);
  const username = envUsername || parts.shift() || '';
  const password = envPassword || parts.join(' ') || await askHidden('Mật khẩu Onluyen: ');
  if (!username || !password) throw new Error('Thiếu tên đăng nhập hoặc mật khẩu.');
  return { username, password };
}

function askAnswerJsonOrSkip(testId, missingCount) {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  console.log(`\nCache bài ${testId || 'không rõ ID'} còn thiếu ${missingCount} câu.`);
  console.log('Dán mảng JSON đáp án ngay tại đây; nhấn Enter trên dòng trống để dùng Gemini.');
  console.log('Nếu CMD chưa tự nhận hết JSON, gõ END ở một dòng riêng.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  return new Promise((resolve, reject) => {
    const finish = () => {
      rl.close();
      if (!lines.length) return resolve(null);
      try {
        resolve(parseJsonArray(lines.join('\n')));
      } catch (error) {
        reject(new Error(`JSON đáp án không hợp lệ: ${error.message}`));
      }
    };
    rl.on('line', line => {
      if (!lines.length && !line.trim()) return finish();
      if (/^END$/i.test(line.trim())) return finish();
      lines.push(line);
      try {
        const parsed = parseJsonArray(lines.join('\n'));
        rl.close();
        resolve(parsed);
      } catch (_incompleteJson) {}
    });
  });
}

function askHidden(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return askLine(label);
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = chunk => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          reject(new Error('Đã hủy.'));
          return;
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        value += char;
        process.stdout.write('*');
      }
    };
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on('data', onData);
  });
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function firstElement(page, selectors) {
  for (const selector of selectors) {
    const element = await page.$(selector);
    if (element) return element;
  }
  return null;
}

async function isLoginPage(page) {
  return /\/login(?:[/?#]|$)/i.test(page.url()) || !!(await page.$('input[type="password"]'));
}

async function waitForRouteToSettle(page) {
  try {
    await page.waitForFunction(() => /\/login(?:[/?#]|$)/i.test(location.pathname)
      || !!document.querySelector('input[type="password"], #test-step-question, .btn-test, [id^="ans-student-"]'),
    { timeout: 8000 });
  } catch (_error) {}
  await sleep(500);
}

async function login(page, credentialState) {
  if (!await isLoginPage(page)) return;
  await page.waitForSelector('input[type="password"]', { timeout: 20000 });
  credentialState.username ||= process.env.ONLUYEN_USERNAME || await askLine('Tên đăng nhập Onluyen: ');
  credentialState.password ||= process.env.ONLUYEN_PASSWORD || await askHidden('Mật khẩu Onluyen: ');
  if (!credentialState.username || !credentialState.password) throw new Error('Thiếu tên đăng nhập hoặc mật khẩu.');

  const filled = await page.evaluate(({ username, password }) => {
    const usernameInput = document.querySelector('input[placeholder*="Tên đăng nhập"], input[name="username"], input[autocomplete="username"], input[type="email"]')
      || Array.from(document.querySelectorAll('input[type="text"]')).find(input => {
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const passwordInput = document.querySelector('input[type="password"]');
    if (!usernameInput || !passwordInput) return false;
    const setValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    setValue(usernameInput, username);
    setValue(passwordInput, password);
    return true;
  }, { username: credentialState.username, password: credentialState.password });
  if (!filled) throw new Error('Không nhận diện được form đăng nhập Onluyen.');
  await sleep(250);
  const submitted = await page.evaluate(() => {
    const button = document.querySelector('button[type="submit"], input[type="submit"]')
      || Array.from(document.querySelectorAll('button, [role="button"]')).find(element => /^Đăng\s*nhập$/i.test((element.innerText || '').replace(/\s+/g, ' ').trim()));
    if (!button) return false;
    button.click();
    return true;
  });
  if (!submitted) throw new Error('Không tìm thấy nút Đăng nhập.');

  const deadline = Date.now() + 25000;
  let loggedIn = false;
  while (Date.now() < deadline) {
    await sleep(300);
    if (!/\/login(?:[/?#]|$)/i.test(page.url())) {
      loggedIn = true;
      break;
    }
    try {
      if (!await page.$('input[type="password"]')) {
        loggedIn = true;
        break;
      }
    } catch (_navigationInProgress) {
      // Angular có thể hủy execution context trong lúc chuyển trang; thử lại ở vòng kế tiếp.
    }
  }
  if (!loggedIn) {
    let message = '';
    try {
      message = await page.evaluate(() => document.querySelector('.alert, .invalid-feedback, [class*="error"]')?.innerText || '');
    } catch (_error) {}
    throw new Error(`Đăng nhập không thành công${message ? `: ${message.trim()}` : '.'}`);
  }
}

async function enterTest(page) {
  try {
    await page.waitForFunction(() => {
      if (document.querySelector('#test-step-question, app-practice-step-question-option, app-practice-step-question-true-false')) return true;
      return Array.from(document.querySelectorAll('button, a, [role="button"], .btn-test')).some(element =>
        /^(làm bài|bắt đầu|bắt đầu làm bài|tiếp tục|tiếp tục làm bài|vào làm|làm lại)$/i.test((element.innerText || '').replace(/\s+/g, ' ').trim())
      );
    }, { timeout: 30000 });
  } catch (_error) {}

  for (let attempt = 0; attempt < 4; attempt++) {
    if (await page.$('#test-step-question, app-practice-step-question-option, app-practice-step-question-true-false')) return;
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .btn-test'));
      const target = candidates.find(element => {
        const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && /^(làm bài|bắt đầu|bắt đầu làm bài|tiếp tục|tiếp tục làm bài|vào làm|làm lại)$/i.test(text);
      });
      if (!target) return false;
      target.click();
      return true;
    });
    if (!clicked) break;
    await sleep(600);
    await page.evaluate(() => {
      const modal = document.querySelector('.modal.show, [role="dialog"], .swal2-container');
      if (!modal) return;
      const visible = element => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const confirm = Array.from(modal.querySelectorAll('button, a, [role="button"], .btn-test'))
        .filter(visible)
        .find(element => /^(đồng\s*ý|xác\s*nhận|có|làm lại|bắt đầu)$/i.test((element.innerText || '').replace(/\s+/g, ' ').trim()));
      confirm?.click();
    });
    try {
      await page.waitForSelector('#test-step-question, app-practice-step-question-option, app-practice-step-question-true-false', { timeout: 12000 });
    } catch (_error) {}
  }
  if (!await page.$('#test-step-question, app-practice-step-question-option, app-practice-step-question-true-false')) {
    throw new Error('Link chưa mở được giao diện làm bài. Hãy dùng link bài test hoặc link /school/test/step/.');
  }
}

async function collectDomQuestion(page) {
  await page.addScriptTag({ content: MATH_SOURCE });
  return page.evaluate(() => {
    const math = window.OnluyenMath;
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const root = document.querySelector('#test-step-question .question-container, app-practice-step-question-option, app-practice-step-question-true-false');
    if (!root) return null;
    const numberText = clean(root.querySelector('.question-info .num, .question-header .num')?.innerText);
    const questionId = clean(root.querySelector('.question-id')?.innerText);
    const promptElement = root.querySelector('.question-name') || root.querySelector('.question-text');
    const prompt = math.text(promptElement);
    const tfRows = Array.from(root.querySelectorAll('.child-content')).filter(row => row.querySelector('input[value="true"], input[value="false"]'));
    const shortInput = root.querySelector('.answer-input input[type="text"], input.can-resize-second, input[config-typeaction]');
    const answerType = tfRows.length ? 'TF' : shortInput ? 'SHORT' : 'MCQ';
    const choices = answerType === 'TF'
      ? tfRows.map((row, index) => ({
          label: clean(row.querySelector('.option-char')?.innerText).match(/[a-z]/i)?.[0]?.toLowerCase() || String.fromCharCode(97 + index),
          text: math.text(row.querySelector('.option-text .fadein') || row.querySelector('.option-text')),
          math_content: math.metadata(row.querySelector('.option-text .fadein') || row.querySelector('.option-text'))
        }))
      : Array.from(root.querySelectorAll('.question-option, .select-item')).map((option, index) => ({
          label: (clean(option.querySelector('.question-option-label, .number-item')?.innerText) || String.fromCharCode(65 + index)).toUpperCase(),
          text: math.text(option.querySelector('.question-option-content') || option.querySelector('label')),
          math_content: math.metadata(option.querySelector('.question-option-content') || option.querySelector('label')),
          idOption: option.dataset.idOption,
          images: [...option.querySelectorAll('img')].map(image => ({ src: image.currentSrc || image.src || image.getAttribute('data-src') || '', alt: clean(image.alt) })).filter(image => image.src)
        }));
    const seenImages = new Set();
    const images = Array.from(root.querySelectorAll('.question-name img, .question-text img, .question-option img, .select-item img'))
      .map(image => ({ src: image.currentSrc || image.src || image.getAttribute('data-src') || '', alt: clean(image.alt) }))
      .filter(image => image.src && !seenImages.has(image.src) && seenImages.add(image.src));
    return {
      number: Number(numberText.match(/Câu\s*:?\s*(\d+)/i)?.[1] || numberText.match(/\d+/)?.[0]),
      sourceId: numberText.match(/#\s*([\w-]+)/)?.[1] || questionId.match(/#?\s*([\w-]+)/)?.[1] || null,
      answerType,
      prompt,
      math_content: { version: 1, question: math.metadata(promptElement) },
      choices,
      images
    };
  });
}

async function collectQuestionsFromDom(page) {
  const numbers = await page.evaluate(() => {
    const selectors = '.answer-sheet .option, app-sidebar-school-test .option';
    return [...new Set(Array.from(document.querySelectorAll(selectors))
      .filter(element => /^\d+$/.test((element.innerText || '').trim()))
      .map(element => Number(element.innerText.trim())))]
      .filter(Boolean)
      .sort((a, b) => a - b);
  });
  const targets = numbers.length ? numbers : [1];
  const questions = [];
  for (const number of targets) {
    await page.evaluate(targetNumber => {
      const candidates = Array.from(document.querySelectorAll('.answer-sheet .option, app-sidebar-school-test .option'));
      candidates.find(element => (element.innerText || '').trim() === String(targetNumber))?.click();
    }, number);
    await page.waitForFunction(expected => {
      const text = document.querySelector('.question-info .num, .question-header .num')?.innerText || '';
      return Number(text.match(/Câu\s*:?\s*(\d+)/i)?.[1] || text.match(/\d+/)?.[0]) === expected;
    }, { timeout: 12000 }, number);
    const question = await collectDomQuestion(page);
    if (question?.number) questions.push(question);
  }
  return questions.sort((a, b) => a.number - b.number);
}

async function domQuestionCount(page) {
  return page.evaluate(() => {
    const selectors = '.answer-sheet .option, app-sidebar-school-test .option';
    const numbers = [...new Set(Array.from(document.querySelectorAll(selectors))
      .filter(element => /^\d+$/.test((element.innerText || '').trim()))
      .map(element => Number(element.innerText.trim())))]
      .filter(Boolean);
    return numbers.length ? Math.max(...numbers) : 0;
  });
}

async function getQuestions(page) {
  // Trên trang school/test, API câu hiện tại thường đến trước phiếu trả lời.
  // Chờ phiếu render để không nhầm payload 1 câu tạm thời là toàn bộ đề.
  if (/\/school\/test\/step\//.test(new URL(page.url()).pathname)) {
    try {
      await page.waitForFunction(() => {
        const selectors = '.answer-sheet .option, app-sidebar-school-test .option';
        return Array.from(document.querySelectorAll(selectors))
          .filter(element => /^\d+$/.test((element.innerText || '').trim())).length > 1;
      }, { timeout: 6000 });
    } catch (_error) {}
  }
  try {
    await page.waitForFunction(() => Array.isArray(window.__ONLUYEN_CACHED_QUESTIONS__) && window.__ONLUYEN_CACHED_QUESTIONS__.length, { timeout: 12000 });
    const raw = await page.evaluate(() => window.__ONLUYEN_CACHED_QUESTIONS__);
    const parsed = parseApiQuestions(raw);
    const expectedCount = await domQuestionCount(page);
    if (parsed.length && (!expectedCount || parsed.length >= expectedCount)) return parsed;
    if (parsed.length && expectedCount > parsed.length) {
      console.log(`  API mới tải ${parsed.length}/${expectedCount} câu; chuyển sang đọc lần lượt từ giao diện.`);
    }
  } catch (_error) {}
  return collectQuestionsFromDom(page);
}

async function installContentDriver(page, rawQuestions) {
  await page.evaluate(() => {
    window.__CLI_RUNTIME_MESSAGES__ = [];
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      getURL: () => 'data:text/javascript,void 0',
      sendMessage: message => {
        window.__CLI_RUNTIME_MESSAGES__.push(message);
        return Promise.resolve({ ok: true });
      },
      onMessage: {
        addListener(listener) { window.__CLI_CONTENT_LISTENER__ = listener; }
      }
    };
    window.chrome.storage = {
      local: {
        get(_keys, callback) { callback({}); },
        set(_value, callback) { if (callback) callback(); }
      }
    };
  });
  await page.addScriptTag({ content: MATH_SOURCE });
  await page.addScriptTag({ content: CONTENT_SOURCE });
  if (rawQuestions?.length) {
    await page.evaluate(questions => {
      window.postMessage({ type: 'ONLUYEN_RAW_TEST_DATA', payload: { questions } }, '*');
    }, rawQuestions);
    await page.waitForFunction(() => window.__ONLUYEN_RAW_DATA__?.questions?.length, { timeout: 5000 });
  }
}

async function sendToContent(page, message) {
  return page.evaluate(payload => new Promise(resolve => {
    window.__CLI_CONTENT_LISTENER__(payload, {}, resolve);
  }), message);
}

async function prepareExam(page) {
  const raw = await page.evaluate(() => window.__ONLUYEN_CACHED_QUESTIONS__ || []);
  await installContentDriver(page, raw);
  const prepared = await sendToContent(page, { action: 'OL_PREPARE_EXAM' });
  if (!prepared?.ok) throw Object.assign(new Error(prepared?.error || 'Không đọc đủ toàn bộ đề.'), { report: prepared?.report });
  return prepared;
}

async function runAnswers(page, answers, totalQuestions) {
  const loaded = await sendToContent(page, { action: 'OL_LOAD_DATABASE', json: answers });
  if (!loaded?.ok || loaded.count !== totalQuestions) throw Object.assign(new Error(loaded?.error || `Chỉ nạp được ${loaded?.count || 0}/${totalQuestions} đáp án.`), { report: loaded?.report });
  await sendToContent(page, { action: 'OL_START_BOT' });
  await page.waitForFunction(() => {
    if (window.__BOT_RUNNING__) return false;
    return window.__CLI_RUNTIME_MESSAGES__.some(message => message.action === 'BOT_DONE' || message.action === 'BOT_ERROR');
  }, { timeout: Math.max(90000, totalQuestions * 18000) });
  const state = await page.evaluate(() => ({
    done: window.__CLI_RUNTIME_MESSAGES__.find(message => message.action === 'BOT_DONE') || null,
    error: window.__CLI_RUNTIME_MESSAGES__.find(message => message.action === 'BOT_ERROR') || null
  }));
  if (state.error) throw Object.assign(new Error(state.error.error || 'Bot điền đáp án gặp lỗi.'), { report: state.error.report });
  if (!state.done || state.done.completed !== totalQuestions) throw new Error(`Bot chỉ hoàn thành ${state.done?.completed || 0}/${totalQuestions} câu.`);
}

async function submitTest(page) {
  let dialogAccepted = false;
  const dialogHandler = async dialog => {
    dialogAccepted = true;
    await dialog.accept();
  };
  page.on('dialog', dialogHandler);
  try {
    const clicked = await page.evaluate(() => {
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const buttons = Array.from(document.querySelectorAll('button, a')).filter(visible);
      const target = buttons.find(button => /^nộp\s*bài$/i.test((button.innerText || '').replace(/\s+/g, ' ').trim()));
      if (!target) return false;
      target.click();
      return true;
    });
    if (!clicked) throw new Error('Đã điền xong nhưng không tìm thấy nút Nộp bài.');
    await sleep(800);

    if (!dialogAccepted) {
      await page.evaluate(() => {
        const visible = element => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const modal = document.querySelector('.modal.show, [role="dialog"], .swal2-container');
        const scope = modal || document;
        const buttons = Array.from(scope.querySelectorAll('button')).filter(visible);
        const confirm = buttons.find(button => /^(nộp\s*bài|đồng\s*ý|xác\s*nhận|có)$/i.test((button.innerText || '').replace(/\s+/g, ' ').trim()));
        confirm?.click();
      });
    }

    try {
      await page.waitForFunction(() => /\/history(?:\/|$)/i.test(location.pathname)
        || !!document.querySelector('[id^="ans-student-"]')
        || /kết quả|điểm số/i.test(document.body.innerText), { timeout: 30000 });
    } catch (_error) {
      throw new Error('Đã bấm Nộp bài nhưng chưa thấy trang Kết quả xác nhận.');
    }
  } finally {
    page.off('dialog', dialogHandler);
  }
}

async function inspectTestStatus(page) {
  try {
    await page.waitForFunction(() => {
      const text = document.body?.innerText || '';
      return /Bài tập đã được hoàn thành|Điểm số/i.test(text)
        || !!document.querySelector('#test-step-question, app-practice-step-question-option, app-practice-step-question-true-false, .btn-test');
    }, { timeout: 15000 });
  } catch (_error) {}
  return page.evaluate(() => {
    const text = (document.querySelector('.page-scroll')?.innerText || document.body?.innerText || '').replace(/\u00a0/g, ' ');
    const completed = /Bài tập đã được hoàn thành/i.test(text);
    const scoreText = text.match(/Điểm số\s*([\d]+(?:[.,][\d]+)?)/i)?.[1] || null;
    return {
      completed,
      score: scoreText === null ? null : Number(scoreText.replace(',', '.'))
    };
  });
}

async function readResultScore(page) {
  const status = await inspectTestStatus(page);
  return status.score;
}

async function extractHistoryAnswersFromPage(page, historyUrl) {
  await page.goto(historyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[id^="ans-student-"]', { timeout: 30000 });
  await installContentDriver(page);
  const result = await sendToContent(page, { action: 'OL_GET_HISTORY_ANSWERS' });
  if (!result?.ok) throw new Error(result?.error || 'Không đọc được History.');
  return result.answers;
}

async function processTest(page, url, context) {
  const testId = testIdFromUrl(url);
  console.log(`\n[${context.index}/${context.total}] Mở ${url}`);

  const cachedCompletion = testId && context.accountCache.data.tests?.[testId];
  if (cachedCompletion?.completed) {
    console.log(`  SKIP: tài khoản này đã làm bài ${testId} theo cache${cachedCompletion.score !== null ? ` (${cachedCompletion.score} điểm)` : ''}.`);
    return { url, ok: true, skipped: true, reason: 'account-cache', score: cachedCompletion.score ?? null };
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForRouteToSettle(page);
  await login(page, context.credentials);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForRouteToSettle(page);
  if (await isLoginPage(page)) {
    await login(page, context.credentials);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForRouteToSettle(page);
  }
  if (await isLoginPage(page)) {
    const loginMessage = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('.alert, .invalid-feedback, .text-danger, .toast, .message'));
      return candidates.map(element => (element.innerText || '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    }).catch(() => '');
    throw new Error(`Đăng nhập Onluyen chưa thành công${loginMessage ? `: ${loginMessage}` : '. Hãy kiểm tra lại tài khoản/mật khẩu.'}`);
  }

  const existingStatus = await inspectTestStatus(page);
  if (existingStatus.completed && existingStatus.score !== null && existingStatus.score >= 9.999) {
    markAccountCompleted(context.accountCache, testId, { score: existingStatus.score, url });
    console.log(`  SKIP: tài khoản đã đạt ${existingStatus.score} điểm, không làm lại.`);
    return { url, ok: true, skipped: true, reason: 'perfect-score', score: existingStatus.score, finalUrl: page.url() };
  }

  let historyAnswers = [];
  const existingTestCache = loadTestCache(testId);
  if (existingStatus.completed && !(existingTestCache.answers || []).length) {
    const historyUrl = historyUrlForTest(url);
    try {
      historyAnswers = await extractHistoryAnswersFromPage(page, historyUrl);
      saveTestCache(testId, [], historyAnswers);
      console.log(`  Đã tự lấy và cache ${historyAnswers.length} đáp án từ ${historyUrl}`);
    } catch (error) {
      console.warn(`  Không lấy được đáp án History: ${error.message}`);
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  await enterTest(page);

  // The browser driver owns the complete source snapshot. Prompt generation,
  // JSON import and execution all reuse it, including DOM-only questions.
  const prepared = await prepareExam(page);
  const questions = prepared.questions;
  const snapshot = { ...prepared.snapshot, questions };
  promptSnapshots.set(questions, snapshot);
  if (!questions.length) throw new Error('Không trích xuất được câu hỏi nào.');
  console.log(`  Đã đọc ${questions.length} câu.`);

  const testCache = loadTestCache(testId);
  let availableAnswers = context.answerBank.concat(testCache.answers || [], historyAnswers);
  let bank = matchBankAnswers(questions, availableAnswers);
  if (bank.missing.length && !context.pasteAsked.has(testId || url)) {
    context.pasteAsked.add(testId || url);
    const pasted = await askAnswerJsonOrSkip(testId, bank.missing.length);
    if (pasted?.length) {
      promptSnapshots.set(bank.missing, snapshot);
      const enrichedPasted = validateAndEnrichAnswers(pasted, bank.missing);
      availableAnswers = availableAnswers.concat(enrichedPasted);
      bank = matchBankAnswers(questions, availableAnswers);
      console.log(`  JSON vừa dán khớp ${questions.length - bank.missing.length}/${questions.length} câu.`);
    }
  }

  let answers = bank.matched;
  let model = null;
  if (bank.missing.length) {
    if (!context.apiKeys.length) {
      const key = process.env.GEMINI_API_KEY || await askHidden('Gemini API key (không lưu): ');
      if (key) context.apiKeys.push(key);
    }
    if (!context.apiKeys.length) throw new Error(`Thiếu đáp án cho ${bank.missing.length} câu và chưa có Gemini API key.`);
    console.log(`  Answer bank khớp ${bank.matched.length}/${questions.length}; gửi ${bank.missing.length} câu còn lại cho Gemini...`);
    const prompt = buildPrompt(bank.missing, snapshot);
    const solvedAnswers = [];
    for (const part of math.splitPrompt(prompt)) {
      const numbers = [...part.matchAll(/^=== CÂU (\d+) ===/gm)].map(match => Number(match[1]));
      const batch = bank.missing.filter(q => numbers.includes(q.number));
      const solved = await callGemini(context.apiKeys, context.models, part, batch);
      model = solved.model;
      if (solved.imageCount) console.log(`  Đã gửi kèm ${solved.imageCount} ảnh cho Gemini.`);
      solvedAnswers.push(...solved.answers);
    }
    answers = answers.concat(validateAndEnrichAnswers(solvedAnswers, bank.missing));
  } else {
    console.log('  Answer bank đã khớp toàn bộ câu theo ID/nội dung.');
  }
  answers.sort((a, b) => a.cau - b.cau);
  const verified = math.validateExam(questions, answers, { snapshotId: snapshot.id, snapshotSignature: snapshot.signature });
  if (!verified.ok) throw Object.assign(new Error('Không xác minh được toàn bộ đáp án.'), { report: math.matchReport(verified) });
  saveTestCache(testId, questions, answers);
  console.log(`  Đã cache ${answers.length} đáp án cho bài ${testId || url}.`);

  await runAnswers(page, answers, questions.length);
  console.log(`  Đã điền và xác nhận ${questions.length}/${questions.length} câu.`);

  if (context.submit) {
    await submitTest(page);
    const score = await readResultScore(page);
    markAccountCompleted(context.accountCache, testId, { score, url });
    console.log(`  Đã nộp bài và thấy trang Kết quả${score !== null ? `: ${score} điểm` : ''}.`);
    return { url, ok: true, questions: questions.length, submitted: true, score, model, finalUrl: page.url() };
  } else {
    console.log('  Dry-run: đã điền xong, chưa nộp bài.');
  }
  return { url, ok: true, questions: questions.length, submitted: context.submit, model, finalUrl: page.url() };
}

function writeLog(results) {
  const logDir = path.join(ROOT, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(logDir, `bulk-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
  return file;
}

async function runAccountSession(options) {
  const accountCache = loadAccountCache(options.credentials.username);
  const allCached = options.links.every(url => {
    const testId = testIdFromUrl(url);
    return !!testId && !!accountCache.data.tests?.[testId]?.completed;
  });
  if (allCached) {
    return options.links.map((url, index) => {
      const testId = testIdFromUrl(url);
      const cached = accountCache.data.tests[testId];
      console.log(`\n[${index + 1}/${options.links.length}] Mở ${url}`);
      console.log(`  SKIP: tài khoản này đã làm bài ${testId} theo cache${cached.score !== null ? ` (${cached.score} điểm)` : ''}.`);
      return {
        accountKey: accountCache.key.slice(0, 12),
        url,
        ok: true,
        skipped: true,
        reason: 'account-cache',
        score: cached.score ?? null
      };
    });
  }
  const browser = await puppeteer.launch({
    executablePath: options.executablePath,
    headless: options.headless,
    defaultViewport: null,
    args: ['--start-maximized']
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(INJECT_SOURCE);
  const results = [];
  const context = {
    answerBank: options.answerBank,
    apiKeys: options.apiKeys,
    models: options.models,
    credentials: options.credentials,
    accountCache,
    pasteAsked: new Set(),
    submit: options.submit,
    index: 0,
    total: options.links.length
  };

  try {
    for (let index = 0; index < options.links.length; index++) {
      context.index = index + 1;
      try {
        results.push(await processTest(page, options.links[index], context));
      } catch (error) {
        console.error(`  LỖI: ${error.message}`);
        if (error.report) exportMatchReport(error.report);
        results.push({ url: options.links[index], ok: false, error: error.message, finalUrl: page.url() });
      }
    }
  } finally {
    await browser.close();
  }

  return results.map(result => ({ accountKey: accountCache.key.slice(0, 12), ...result }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const links = readLinks(args.links);
  const answerBank = loadAnswerBank(answerFilesFromArgs(args));
  const geminiPool = loadGeminiPool(args);
  const apiKeys = geminiPool.keys;
  const models = process.env.GEMINI_MODELS
    ? uniqueStrings(String(process.env.GEMINI_MODELS).split(','))
    : uniqueStrings(geminiPool.models.concat(DEFAULT_MODELS));
  const executablePath = chromeExecutable();
  if (!executablePath) throw new Error('Không tìm thấy Chrome hoặc Edge. Có thể đặt biến CHROME_PATH.');

  console.log(`Onluyen Bulk Runner · ${links.length} bài · ${args.submit ? 'TỰ NỘP BÀI' : 'DRY-RUN'}`);
  console.log(`Answer bank: ${answerBank.length} đáp án. Mật khẩu và API key không được ghi vào log.`);
  console.log(`Gemini key pool: ${apiKeys.length} key · ${models.length} model${geminiPool.loadedConfigs ? ` · ${geminiPool.loadedConfigs} config ngoài` : ''}.`);
  const allResults = [];
  let useEnvironmentCredentials = true;

  while (true) {
    const credentials = await askCredentials(useEnvironmentCredentials);
    useEnvironmentCredentials = false;
    const sessionResults = await runAccountSession({
      links,
      answerBank,
      apiKeys,
      models,
      credentials,
      executablePath,
      headless: args.headless,
      submit: args.submit
    });
    allResults.push(...sessionResults);
    const passed = sessionResults.filter(result => result.ok).length;
    console.log(`\nTài khoản hiện tại hoàn tất ${passed}/${sessionResults.length} bài.`);

    if (!process.stdin.isTTY) break;
    const next = await askLine('\n[1] Làm tiếp với tài khoản khác\n[2] Thoát\nChọn: ');
    if (next.trim() !== '1') break;
  }

  const logFile = writeLog(allResults);
  const passed = allResults.filter(result => result.ok).length;
  console.log(`\nTổng cộng ${passed}/${allResults.length} lượt bài thành công. Log: ${logFile}`);
  if (passed !== allResults.length) process.exitCode = 1;
}

module.exports = {
  cleanText,
  comparable,
  keysAndModelsFromGeminiConfig,
  loadGeminiPool,
  parseJsonArray,
  parseApiQuestions,
  getQuestions,
  prepareExam,
  buildPrompt,
  geminiImageParts,
  validateAndEnrichAnswers,
  matchBankAnswers,
  enterTest,
  login,
  testIdFromUrl,
  historyUrlForTest,
  inspectTestStatus,
  extractHistoryAnswersFromPage,
  loadTestCache,
  saveTestCache,
  loadAccountCache,
  markAccountCompleted
};

if (require.main === module) {
  main().catch(error => {
    if (error.report) {
      exportMatchReport(error.report);
    }
    console.error(`LỖI: ${error.message}`);
    process.exitCode = 1;
  });
}
