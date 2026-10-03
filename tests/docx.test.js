const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { prepareExam, enterTest, testIdFromUrl, historyUrlForTest } = require('../cli/bulk-runner');

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

(async () => {
  assert.equal(testIdFromUrl(url), 'docx-fixture');
  assert.equal(historyUrlForTest(url), 'https://app.onluyen.vn/school/test/history/docx-fixture');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const { page, prepared } = await mount(browser);
    assert.equal(prepared.count, 16);
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
    const loaded = await send(page, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(loaded.ok, true, loaded.error);
    assert.equal(await page.evaluate(() => window.__CLI_RUNTIME_MESSAGES__.filter(m => m.action === 'BOT_PROGRESS').length), 0);
    const start = await send(page, { action: 'OL_START_BOT', json: answers });
    assert.equal(start.ok, true, start.error);
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
    await send(page, { action: 'OL_START_BOT', json: answers });
    await page.waitForFunction(() => !window.__BOT_RUNNING__);
    assert.equal(await page.evaluate(() => __answerClicks), 28, 'Saved DOCX selections are not toggled again');
    await page.close();

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
    assert.match(missing.error, /DOCX.*chưa render/);
    assert.equal(await incomplete.page.evaluate(() => __answerClicks), 0);
    await incomplete.page.close();
    console.log('OK: actual 16-question DOCX fixture, shared CLI/extension driver, MCQ/TF autosave, reorder, incomplete sources and zero-click failures');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
