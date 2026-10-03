const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { prepareExam, enterTest, testIdFromUrl, historyUrlForTest, parseApiQuestions } = require('../cli/bulk-runner');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/docx-sections-16.html'), 'utf8');
const url = 'https://app.onluyen.vn/school/test/docx/docx-fixture';
const send = (page, message) => page.evaluate(payload => new Promise(resolve => {
  window.__CLI_CONTENT_LISTENER__(payload, {}, resolve);
}), message);

async function mount(browser, mode = {}) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => r.respond({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.goto(url);
  await page.setContent(`<button id="submit">Nộp Bài</button><div class="answer-sheet">${Array.from({ length: 16 }, (_, i) => `<div class="option">${i + 1}</div>`).join('')}</div>${fixture}`);
  await page.evaluate(mode => {
    window.__answerClicks = 0; window.__submitClicks = 0; window.__navClicks = 0;
    document.querySelector('#submit').onclick = () => __submitClicks++;
    document.querySelectorAll('.answer-sheet .option').forEach(el => el.onclick = () => __navClicks++);
    window.__ONLUYEN_CACHED_QUESTIONS__ = [...document.querySelectorAll('.sections > .question[id]')].map((root, i) => ({
      dataStandard: { stepId: root.id, stepIndex: i, options: Array(4).fill('6ac000000000000000000000') }
    }));
    // Model the live log: 18 API entries but only 16 question records.
    // Original API JSON was not supplied; heading content comes from the DOM fixture.
    const headings = [...document.querySelectorAll('.section-content')].map(el => ({ dataMaterial: { contentHtml: el.innerHTML } }));
    __ONLUYEN_CACHED_QUESTIONS__.splice(12, 0, headings[1]);
    __ONLUYEN_CACHED_QUESTIONS__.unshift(headings[0]);
    if (mode.packMaterial) __ONLUYEN_CACHED_QUESTIONS__ = [headings[0],
      { dataMaterial: { datas: __ONLUYEN_CACHED_QUESTIONS__.filter(item => item.dataStandard).map(item => item.dataStandard) } }, headings[1]];
    document.querySelectorAll('.sections > .question[id]').forEach((root, i) => {
      const tf = !!root.querySelector('app-docx-question-true-false-test');
      root.querySelectorAll('.item-answer').forEach(target => target.onclick = () => {
        __answerClicks++;
        if (mode.noRegistration) return;
        const peers = tf ? target.parentElement.querySelectorAll('.item-answer') : root.querySelectorAll('.item-answer');
        peers.forEach(el => el.classList.remove('active'));
        target.classList.add('active');
        const answered = !tf || [...root.querySelectorAll('.answer')].every(row => row.querySelector('.item-answer.active'));
        if (answered && !mode.noSave) document.querySelectorAll('.answer-sheet .option')[i].classList.add('done');
      });
    });
  }, mode);
  await enterTest(page);
  const prepared = await prepareExam(page);
  return { page, prepared };
}

function answersFor(prepared) {
  return prepared.questions.map(q => q.answerType === 'TF' ? {
    cau: q.number, id: q.sourceId, loai: 'TF', snapshot_id: prepared.snapshot.id,
    dap_an: { a: 'Đúng', b: 'Sai', c: 'Đúng', d: 'Sai' },
    noi_dung_cac_y: Object.fromEntries(q.choices.map(c => [c.label, c.text]))
  } : { cau: q.number, id: q.sourceId, loai: 'MCQ', snapshot_id: prepared.snapshot.id,
    dap_an: 'A', noi_dung_dap_an: q.choices[0].text });
}

async function mountPopup(browser, contentPage) {
  const popup = await browser.newPage();
  await popup.setContent(fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  await popup.exposeFunction('__pageRequest', payload => send(contentPage, payload));
  await popup.evaluate(url => {
    window.__activeTab = { id: 1, url };
    window.__popupStore = {}; window.__clipboard = ''; window.__requests = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.__clipboard = text; }
    } });
    window.chrome = {
      tabs: {
        query: async () => [window.__activeTab],
        sendMessage: async (_id, message) => { __requests.push(message); return __pageRequest(message); }
      },
      runtime: { getManifest: () => ({ version: 'test' }), onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true }) },
      storage: { local: {
        get: async () => __popupStore,
        set: async values => Object.assign(__popupStore, values),
        remove: async keys => keys.forEach(key => delete __popupStore[key])
      } }
    };
    // Polling is tested through explicit refreshes to make route changes deterministic.
    window.setInterval = () => 0;
  }, contentPage.url());
  await popup.addScriptTag({ path: path.join(__dirname, '../popup.js') });
  await popup.waitForFunction(() => document.querySelector('#statusText').textContent.includes('Đã kết nối'));
  return popup;
}

(async () => {
  assert.equal(testIdFromUrl(url), 'docx-fixture');
  assert.equal(historyUrlForTest(url), 'https://app.onluyen.vn/school/test/history/docx-fixture');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const { page, prepared } = await mount(browser);
    assert.equal(prepared.count, 16);
    const raw = await page.evaluate(() => __ONLUYEN_CACHED_QUESTIONS__);
    assert.equal(raw.length, 18);
    assert.equal(parseApiQuestions(raw).length, 16);
    assert.equal((await send(page, { action: 'OL_PING' })).qCount, 16);
    assert.equal(await page.evaluate(() => __CLI_RUNTIME_MESSAGES__.find(m => m.action === 'OL_BADGE').text), '16');
    assert.equal(prepared.questions.filter(q => q.answerType === 'MCQ').length, 12);
    assert.equal(prepared.questions.filter(q => q.answerType === 'TF').length, 4);
    assert.equal(prepared.questions[0].sourceId, '6ac07dceb168a3fd526790a2');
    assert.ok(prepared.questions.every(q => q.choices.length === 4 && q.choices.every(c => c.text)));
    assert.ok(prepared.prompt.includes('Ứng xử số và bản quyền'));
    assert.ok(prepared.prompt.includes('Dữ liệu cần được xử lí'));
    assert.ok(prepared.questions[0].prompt.includes('TRẮC NGHIỆM NHIỀU LỰA CHỌN'));
    assert.ok(prepared.questions[12].prompt.includes('TRẮC NGHIỆM ĐÚNG/SAI'));
    assert.ok(!prepared.questions[12].prompt.includes('TRẮC NGHIỆM NHIỀU LỰA CHỌN'));
    assert.deepEqual(await page.evaluate(() => [__answerClicks, __submitClicks, __navClicks]), [0, 0, 0]);
    const answers = answersFor(prepared);
    const popup = await mountPopup(browser, page);
    assert.equal(await popup.$eval('#qCountPill', el => el.textContent), '16 câu');
    for (const route of ['', 'step/', 'docx/', 'history/', 'result/']) {
      const routeUrl = `https://app.onluyen.vn/school/test/${route}docx-fixture`;
      await page.evaluate(routeUrl => history.replaceState(null, '', routeUrl), routeUrl);
      const ping = await send(page, { action: 'OL_PING' });
      assert.equal(ping.examKey, 'onluyen_saved_db:docx-fixture');
      assert.equal(await popup.evaluate(routeUrl => savedDbStorageKey(routeUrl), routeUrl), ping.examKey);
      assert.equal(testIdFromUrl(routeUrl), 'docx-fixture');
    }
    await page.evaluate(url => history.replaceState(null, '', url), url);
    await popup.click('#btnCopyPrompt');
    await popup.waitForFunction(() => !document.querySelector('#btnCopyPrompt').disabled);
    assert.match(await popup.$eval('#progressBox', el => el.textContent), /Đã tạo prompt cho 16 câu/);
    assert.ok(await popup.evaluate(() => __clipboard.includes('Ứng xử số và bản quyền')));
    await popup.$eval('#txtDatabase', (el, answers) => { el.value = JSON.stringify(answers); }, answers);
    await popup.click('#btnSaveDb');
    await popup.waitForFunction(() => /Đã nạp|❌/.test(document.querySelector('#progressBox').textContent));
    await popup.waitForFunction(() => !document.querySelector('#btnSaveDb').disabled);
    assert.match(await popup.$eval('#progressBox', el => el.textContent), /Đã nạp 16 câu/);
    assert.ok(await popup.evaluate(() => __popupStore['onluyen_saved_db:docx-fixture']));
    assert.equal(await popup.evaluate(() => __popupStore['onluyen_saved_db:docx']), undefined);
    assert.equal(await page.evaluate(() => window.__CLI_RUNTIME_MESSAGES__.filter(m => m.action === 'BOT_PROGRESS').length), 0);
    await popup.click('#btnStartBot');
    await popup.waitForFunction(() => !document.querySelector('#btnStartBot').disabled);
    assert.ok(!await popup.$eval('#progressBox', el => el.textContent.includes('❌')));
    await page.waitForFunction(() => __CLI_RUNTIME_MESSAGES__.some(m => m.action === 'BOT_DONE' || m.action === 'BOT_ERROR'));
    const state = await page.evaluate(() => ({ clicks: __answerClicks, submits: __submitClicks, nav: __navClicks,
      done: document.querySelectorAll('.answer-sheet .option.done').length, messages: __CLI_RUNTIME_MESSAGES__ }));
    assert.ok(!state.messages.some(m => m.action === 'BOT_ERROR'), JSON.stringify(state.messages));
    assert.equal(state.messages.find(m => m.action === 'BOT_DONE').completed, 16);
    assert.equal(state.clicks, 28); // 12 MCQ and all 16 TF statements.
    assert.equal(state.done, 16);
    assert.equal(state.submits, 0);
    assert.equal(state.nav, 0);
    assert.equal((await send(page, { action: 'OL_PING' })).examKey, 'onluyen_saved_db:docx-fixture');
    // A real assignment change still rejects an in-flight old response.
    await popup.evaluate(() => {
      const send = chrome.tabs.sendMessage;
      chrome.tabs.sendMessage = async (id, message) => {
        const response = await send(id, message);
        if (message.action === 'OL_GET_AI_PROMPT') __activeTab.url = 'https://app.onluyen.vn/school/test/docx/another-assignment';
        return response;
      };
    });
    await popup.click('#btnCopyPrompt');
    await popup.waitForFunction(() => !document.querySelector('#btnCopyPrompt').disabled);
    assert.match(await popup.$eval('#progressBox', el => el.textContent), /Đã chuyển sang bài khác/);
    await popup.close();
    await send(page, { action: 'OL_START_BOT', json: answers });
    await page.waitForFunction(() => !window.__BOT_RUNNING__);
    assert.equal(await page.evaluate(() => __answerClicks), 28, 'Saved DOCX selections are not toggled again');
    await page.close();

    const grouped = await mount(browser, { packMaterial: true });
    assert.equal(await grouped.page.evaluate(() => __ONLUYEN_RAW_DATA__.questions.length), 3);
    assert.equal(grouped.prepared.count, 16);
    assert.equal((await send(grouped.page, { action: 'OL_PING' })).qCount, 16);
    assert.equal(await grouped.page.evaluate(() => __CLI_RUNTIME_MESSAGES__.find(m => m.action === 'OL_BADGE').text), '16');
    await grouped.page.close();

    const shuffled = await mount(browser);
    const original = answersFor(shuffled.prepared);
    await shuffled.page.evaluate(() => {
      const root = document.querySelector('.sections > .question[id]');
      const labels = [...root.querySelectorAll('.item-answer')];
      const contents = [...root.querySelectorAll('.option-content')];
      [contents[0].innerHTML, contents[1].innerHTML] = [contents[1].innerHTML, contents[0].innerHTML];
      const tf = document.querySelector('app-docx-question-true-false-test');
      const statements = [...tf.querySelectorAll('.option-content')];
      [statements[0].innerHTML, statements[1].innerHTML] = [statements[1].innerHTML, statements[0].innerHTML];
    });
    const reordered = await send(shuffled.page, { action: 'OL_START_BOT', json: original });
    assert.equal(reordered.ok, true, reordered.error);
    await shuffled.page.waitForFunction(() => __CLI_RUNTIME_MESSAGES__.some(m => m.action === 'BOT_DONE' || m.action === 'BOT_ERROR'));
    assert.equal(await shuffled.page.$eval('.sections > .question[id] .item-answer.active', el => el.textContent.trim()), 'B');
    assert.equal(await shuffled.page.$eval('app-docx-question-true-false-test .answer .active', el => el.textContent), 'Sai');
    assert.ok(!await shuffled.page.evaluate(() => __CLI_RUNTIME_MESSAGES__.some(m => m.action === 'BOT_ERROR')));
    await shuffled.page.close();

    for (const mode of [{ noRegistration: true }, { noSave: true }]) {
      const failed = await mount(browser, mode);
      await send(failed.page, { action: 'OL_START_BOT', json: answersFor(failed.prepared) });
      await failed.page.waitForFunction(() => __CLI_RUNTIME_MESSAGES__.some(m => m.action === 'BOT_ERROR'), { timeout: 10000 });
      assert.equal(await failed.page.evaluate(() => __answerClicks), 1);
      assert.equal(await failed.page.evaluate(() => __submitClicks), 0);
      assert.ok(!await failed.page.evaluate(() => __CLI_RUNTIME_MESSAGES__.some(m => m.action === 'BOT_DONE')));
      await failed.page.close();
    }

    const invalid = await mount(browser);
    const badAnswers = answersFor(invalid.prepared);
    badAnswers[15].noi_dung_cac_y.d = 'Nội dung hoàn toàn khác.';
    const bad = await send(invalid.page, { action: 'OL_START_BOT', json: badAnswers });
    assert.equal(bad.ok, false);
    assert.equal(await invalid.page.evaluate(() => __answerClicks), 0);
    assert.equal(await invalid.page.evaluate(() => __submitClicks), 0);
    assert.equal((await send(invalid.page, { action: 'OL_PING' })).dbSize, 0);
    await invalid.page.close();

    const controls = await mount(browser);
    await controls.page.evaluate(() => document.querySelector('.sections > .question:last-of-type .answer').replaceChildren());
    const blocked = await send(controls.page, { action: 'OL_START_BOT', json: answersFor(controls.prepared) });
    // Source text is intact, but execution must resolve every control before clicking.
    assert.equal(blocked.ok, true, blocked.error);
    await controls.page.waitForFunction(() => __CLI_RUNTIME_MESSAGES__.some(m => m.action === 'BOT_ERROR'));
    assert.equal(await controls.page.evaluate(() => __answerClicks), 0);
    assert.equal(await controls.page.evaluate(() => __submitClicks), 0);
    await controls.page.close();

    const incomplete = await mount(browser);
    await incomplete.page.evaluate(() => document.querySelector('.sections > .question:last-of-type').remove());
    const missing = await send(incomplete.page, { action: 'OL_PREPARE_EXAM' });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /15\/16 câu DOCX/);
    assert.match(missing.error, /Câu 16/);
    assert.ok(missing.report.issues.some(issue => issue.number === 16 && issue.code === 'NOT_RENDERED'));
    assert.equal(await incomplete.page.evaluate(() => __answerClicks), 0);
    await incomplete.page.close();

    const emptyChoice = await mount(browser);
    await emptyChoice.page.evaluate(() => document.querySelector('.sections > .question:last-of-type .option-content').replaceChildren());
    const empty = await send(emptyChoice.page, { action: 'OL_PREPARE_EXAM' });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /Câu 16, ý a/);
    assert.ok(empty.report.issues.some(issue => issue.number === 16 && issue.label === 'a' && issue.code === 'NOT_RENDERED'));
    assert.equal(await emptyChoice.page.evaluate(() => __answerClicks), 0);
    await emptyChoice.page.close();

    const absentApiQuestion = await mount(browser);
    await absentApiQuestion.page.evaluate(() => {
      __ONLUYEN_CACHED_QUESTIONS__.push({ dataStandard: { stepId: 'unrendered-17', stepIndex: 16 } });
      window.postMessage({ type: 'ONLUYEN_RAW_TEST_DATA', payload: { questions: __ONLUYEN_CACHED_QUESTIONS__ } }, '*');
    });
    await absentApiQuestion.page.waitForFunction(() => __ONLUYEN_RAW_DATA__.questions.length === 19);
    const absent = await send(absentApiQuestion.page, { action: 'OL_PREPARE_EXAM' });
    assert.equal(absent.ok, false);
    assert.match(absent.error, /16\/17 câu DOCX; API: 17 câu trong 19 mục/);
    assert.equal(await absentApiQuestion.page.evaluate(() => __answerClicks), 0);
    await absentApiQuestion.page.close();
    console.log('OK: actual 16-question DOCX fixture, shared CLI/extension driver, MCQ/TF autosave, reorder, incomplete sources and zero-click failures');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
