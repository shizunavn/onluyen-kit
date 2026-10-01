const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const math = require('../math-content');
const puppeteer = require('puppeteer');

const answerText = 'Nếu một số nguyên chia hết cho 6 thì nó chia hết cho 2 và 3.';
const mathml = n => `<math><mrow><mn>${n}</mn></mrow></math>`;
const variants = [answerText, 'Nếu một số nguyên chia hết cho $6$ thì nó chia hết cho \\(2\\) và $3$.',
  `<p>Nếu một số nguyên chia hết cho ${mathml(6)} thì nó chia hết cho ${mathml(2)} và ${mathml(3)}.</p>`];
for (const a of variants) for (const b of variants) {
  assert.equal(math.compare(a, b).status, 'equal');
  assert.equal(math.compare(math.metadata(a), JSON.parse(JSON.stringify(math.metadata(b)))).status, 'equal');
}
const question = { number: 1, sourceId: '12905165', answerType: 'MCQ', prompt: 'Mệnh đề nào có mệnh đề đảo đúng?', choices: [{ label: 'A', text: variants[2] }, { label: 'B', text: 'Một mệnh đề khác.' }] };
const entry = { cau: 9, id: '12905165', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: answerText };
assert.equal(math.validateExam([question], [entry]).mappings[0].answer, 'A');
assert.equal(math.validateExam([question], [{ ...entry, noi_dung_dap_an: undefined }]).issues[0].code, 'SNAPSHOT_EXPIRED');
const opts = { snapshotId: 'fixture-token', snapshotSignature: math.signature([question]) };
assert.equal(math.validateExam([question], [{ ...entry, noi_dung_dap_an: undefined, snapshot_id: opts.snapshotId }], opts).ok, true);
assert.equal(math.validateExam([{ ...question, choices: question.choices.slice().reverse() }], [{ ...entry, noi_dung_dap_an: undefined, snapshot_id: opts.snapshotId }], opts).ok, false);
assert.equal(math.validateExam([question], [entry], { expectedTotal: 2 }).ok, false);
assert.equal(math.validateExam([question], [{ ...entry, loai: 'SHORT' }]).issues[0].code, 'ANSWER_TYPE_CONFLICT');
assert.ok(math.validateExam([question], [null, entry]).issues.some(i => i.code === 'INVALID_DATABASE_ENTRY'));
const broken = [{ ...question, choices: [{ label: 'A', text: '$\\unknown{x}$' }, { label: 'B', text: '$x+1)$' }] }];
assert.ok(math.validateExam(broken, [entry]).issues.length >= 3);
const sensitive = { ...entry, apiKey: 'SECRET_KEY', password: 'SECRET_PASSWORD', sessionCookie: 'SECRET_COOKIE' };
const exported = JSON.stringify(math.matchReport(math.validateExam([question], [{ ...sensitive, noi_dung_dap_an: 'Nội dung sai.' }])));
assert.ok(!/SECRET_/.test(exported));
assert.ok(JSON.parse(exported).issues[0].diagnostic);

async function mount(browser) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => r.respond({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.goto('https://app.onluyen.vn/school/test/step/preflight-fixture');
  await page.setContent('<div class="answer-sheet"><button class="option">1</button><button class="option">2</button></div><div id="test-step-question"><div class="question-container"></div></div>');
  await page.evaluate(first => {
    window.__clicks = 0; window.__submits = 0; window.__messages = []; window.__store = {}; window.__mutate = false;
    window.__texts = [[first, 'Lựa chọn khác.'], ['Đáp án cuối.', 'Sai khác.']];
    window.__render = n => {
      const root = document.querySelector('.question-container');
      root.innerHTML = `<div class="question-info"><div class="num">Câu: ${n} <span>#${n === 1 ? '12905165' : '9999'}</span></div></div><div class="question-name">Đề câu ${n}.</div>${__texts[n - 1].map((t, i) => `<div class="question-option"><span class="question-option-label">${i ? 'B' : 'A'}</span><div class="question-option-content">${t}</div><input type="checkbox"></div>`).join('')}<div class="submit-bar"><button>BỎ QUA</button></div>`;
      root.querySelectorAll('.question-option').forEach(el => el.addEventListener('click', () => {
        __clicks++; el.querySelector('input').checked = true; root.querySelector('button').innerText = 'TRẢ LỜI';
      }));
      root.querySelector('button').addEventListener('click', () => {
        __submits++; if (n === 1) __render(2); else root.querySelector('button').innerText = 'KẾT THÚC';
      });
    };
    document.querySelectorAll('.answer-sheet button').forEach(b => b.addEventListener('click', () => setTimeout(() => __render(Number(b.innerText)), 50)));
    __render(1);
    Element.prototype.scrollIntoView = () => {};
    window.chrome = {
      runtime: { getURL: () => 'data:text/javascript,', getManifest: () => ({ version: 'test' }), onMessage: { addListener: f => { window.__listener = f; } },
        sendMessage: async m => { __messages.push(m); if (__mutate && m.action === 'BOT_PROGRESS' && m.text.startsWith('Đang điền')) { __texts[0][0] = 'Nội dung đã thay đổi.'; document.querySelector('.question-option-content').innerHTML = __texts[0][0]; } } },
      storage: { local: { get: (k, cb) => cb(__store), set: v => Object.assign(__store, v) } }
    };
  }, variants[2]);
  for (const file of ['math-content.js', 'content.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', file), 'utf8') });
  return page;
}
const send = (page, payload) => page.evaluate(p => new Promise(resolve => __listener(p, {}, resolve)), payload);
(async () => {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await mount(browser);
    const answers = [entry, { cau: 2, id: '9999', loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: 'Đáp án cuối.' }];
    const loaded = await send(page, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(loaded.ok, true, loaded.error);
    assert.deepEqual(await page.evaluate(() => [__clicks, __submits]), [0, 0], 'Full collection may navigate, but cannot answer');
    assert.equal(await page.$eval('.question-info .num', el => el.textContent.split('#')[0].trim()), 'Câu: 1');
    const invalid = answers.map((e, i) => i ? { ...e, noi_dung_dap_an: 'Sai đáp án cuối.' } : e);
    const rejected = await send(page, { action: 'OL_LOAD_DATABASE', json: invalid });
    assert.equal(rejected.ok, false);
    assert.ok(rejected.report.issues.some(i => i.number === 2));
    assert.deepEqual(await page.evaluate(() => [__clicks, __submits]), [0, 0]);
    assert.equal((await send(page, { action: 'OL_PING' })).databaseJson, loaded.json);
    assert.equal(await page.evaluate(() => __store['onluyen_saved_db:preflight-fixture']), loaded.json);
    const report = await send(page, { action: 'OL_GET_MATCH_REPORT' });
    assert.equal(report.report.ok, false);
    await page.evaluate(() => { window.__mutate = true; });
    const started = await send(page, { action: 'OL_START_BOT' });
    assert.equal(started.ok, true, started.error);
    await page.waitForFunction(() => !window.__BOT_RUNNING__);
    assert.deepEqual(await page.evaluate(() => [__clicks, __submits]), [0, 0], 'Change after preflight invalidates before any answer click');
    assert.match(await page.evaluate(() => __messages.find(m => m.action === 'BOT_ERROR').error), /thay đổi sau kiểm tra/);
    await page.close();

    const partial = await mount(browser);
    await partial.evaluate(() => {
      document.querySelector('.answer-sheet').remove();
      window.__ONLUYEN_RAW_DATA__ = { questions: [{ dataStandard: { stepIndex: 0, numberQuestion: 12905165, typeAnswer: 0, languagesData: { vi: { content: 'Đề câu 1.', options: [{ content: 'A' }, { content: 'B' }] } } } }, {}] };
    });
    const blocked = await send(partial, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Không thể đọc trước toàn bộ đề/);
    assert.deepEqual(await partial.evaluate(() => [__clicks, __submits]), [0, 0]);
    await partial.close();
    const storageFailure = await mount(browser);
    const original = await send(storageFailure, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(original.ok, true, original.error);
    await storageFailure.evaluate(() => { chrome.storage.local.set = () => { throw new Error('Storage write failed'); }; });
    const failedWrite = await send(storageFailure, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(failedWrite.ok, false);
    assert.equal(failedWrite.report.issues[0].code, 'STORAGE_ERROR');
    assert.equal((await send(storageFailure, { action: 'OL_PING' })).databaseJson, original.json);
    assert.equal(await storageFailure.evaluate(() => __store['onluyen_saved_db:preflight-fixture']), original.json);
    await storageFailure.close();
    for (const action of ['cancel', 'switch']) {
      const pending = await mount(browser);
      const initial = await send(pending, { action: 'OL_LOAD_DATABASE', json: answers });
      assert.equal(initial.ok, true, initial.error);
      await pending.evaluate(() => {
        __messages = [];
        const button = document.querySelectorAll('.answer-sheet button')[1];
        const clone = button.cloneNode(true); button.replaceWith(clone);
        clone.addEventListener('click', () => setTimeout(() => __render(2), 600));
      });
      const loading = send(pending, { action: 'OL_LOAD_DATABASE', json: answers });
      await pending.waitForFunction(() => __messages.some(m => m.action === 'BOT_PROGRESS' && m.text.includes('câu 2/2')));
      if (action === 'cancel') await send(pending, { action: 'OL_STOP_BOT' });
      else {
        await pending.evaluate(() => history.pushState({}, '', '/school/test/step/other-exam'));
        await send(pending, { action: 'OL_PING' });
      }
      const outcome = await loading;
      assert.equal(outcome.ok, false, action);
      assert.equal(await pending.evaluate(() => __store['onluyen_saved_db:preflight-fixture']), initial.json);
      assert.deepEqual(await pending.evaluate(() => [__clicks, __submits]), [0, 0]);
      if (action === 'cancel') assert.equal((await send(pending, { action: 'OL_PING' })).databaseJson, initial.json);
      await pending.close();
    }
    console.log('OK: whole-exam preflight, atomic import, snapshot expiry, diagnostics, mutation checks, unavailable navigation');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
