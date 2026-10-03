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
const brokenReport = math.validateExam(broken, [entry]);
assert.equal(brokenReport.ok, false);
assert.equal(brokenReport.warnings.length, 2);
assert.ok(brokenReport.issues.length > 0);
const sensitive = { ...entry, apiKey: 'SECRET_KEY', password: 'SECRET_PASSWORD', sessionCookie: 'SECRET_COOKIE' };
const exported = JSON.stringify(math.matchReport(math.validateExam([question], [{ ...sensitive, noi_dung_dap_an: 'Nội dung sai.' }])));
assert.ok(!/SECRET_/.test(exported));
assert.ok(JSON.parse(exported).issues[0].diagnostic);

async function mount(browser, mode = {}) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => r.respond({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.goto('https://app.onluyen.vn/school/test/step/preflight-fixture');
  await page.setContent('<div class="answer-sheet"><button class="option">1</button><button class="option">2</button></div><div id="test-step-question"><div class="question-container"></div></div>');
  await page.evaluate(({ first, mode }) => {
    window.__clicks = 0; window.__submits = 0; window.__navigation = 0; window.__skips = 0; window.__fills = 0; window.__messages = []; window.__store = {}; window.__mutate = false;
    window.__texts = [[first, 'Lựa chọn khác.'], ['Đáp án cuối.', 'Sai khác.']];
    window.__render = n => {
      const root = document.querySelector('.question-container');
      root.innerHTML = `<div class="question-info"><div class="num">Câu: ${n} <span>#${n === 1 ? '12905165' : '9999'}</span></div></div><div class="question-name">Đề câu ${n}.</div>${__texts[n - 1].map((t, i) => `<div class="question-option"><span class="question-option-label">${i ? 'B' : 'A'}</span><div class="question-option-content">${t}</div><input type="checkbox"></div>`).join('')}<div class="submit-bar"><button>BỎ QUA</button></div>`;
      const updateButton = () => { if (n !== 1 || !mode.keepSkip) root.querySelector('button').innerText = 'TRẢ LỜI'; };
      if (n === 1 && mode.type === 'SHORT') {
        root.querySelectorAll('.question-option').forEach(el => el.remove());
        const answerArea = `<div class="answer-input"><div class="line">Đáp án: <span class="ans-span-second"></span><input class="can-resize-second" type="text" value="${mode.preset === 'correct' ? '-2,5' : mode.preset === 'wrong' ? '99' : ''}"><span class="answer-unit"><math><mi>m</mi></math></span></div></div>`;
        root.querySelector('.question-name').insertAdjacentHTML(mode.inlineShort ? 'beforeend' : 'afterend', answerArea);
        if (mode.inlineShort) root.querySelector('.question-name').append(root.querySelector('.submit-bar'));
        const mirror = value => { root.querySelector('.ans-span-second').innerHTML = mode.mathMirror
          ? `<mjx-container><mjx-assistive-mml><math><mn>${value}</mn></math></mjx-assistive-mml></mjx-container>` : value; };
        if (mode.inlineShort && mode.preset) mirror(root.querySelector('.answer-input input').value);
        root.querySelector('.answer-input input').addEventListener('input', e => {
          __fills++; if (mode.refuseChange) e.target.value = '99'; else updateButton();
          if (mode.inlineShort) mirror(e.target.value);
          if (mode.changeAfterFill === 'prompt') root.querySelector('.question-name').firstChild.textContent = 'Đề đã đổi.';
          if (mode.changeAfterFill === 'id') root.querySelector('.question-info .num span').textContent = '#11111';
          if (mode.changeAfterFill === 'unit') root.querySelector('.answer-unit mi').textContent = 'cm';
        });
      } else if (n === 1 && mode.type === 'TF') {
        root.querySelectorAll('.question-option').forEach((el, i) => {
          el.outerHTML = `<div class="child-content"><span class="option-text"><span class="option-char">${i ? 'b' : 'a'})</span><span class="fadein">${__texts[0][i]}</span></span><div class="true-false"><input type="radio" name="tf-${i}" value="true" ${!i && mode.preset ? 'checked' : ''}><input type="radio" name="tf-${i}" value="false" ${i && mode.preset === 'correct' ? 'checked' : ''}></div></div>`;
        });
        root.querySelectorAll('.true-false input').forEach(input => input.addEventListener('click', () => { __clicks++; updateButton(); }));
      } else if (n === 1 && mode.preset) {
        root.querySelectorAll('.question-option input').forEach((input, i) => { input.checked = mode.preset === 'multiple' || (mode.preset === 'correct' ? !i : !!i); });
      }
      if (n === 2 && mode.lastSavedSkip) root.querySelector('.question-option input').checked = true;
      if (n === 1 && mode.disabledSkip) {
        const button = root.querySelector('button'); button.disabled = true;
        setTimeout(() => { button.disabled = false; }, 800);
      }
      root.querySelectorAll('.question-option').forEach(el => el.addEventListener('click', e => {
        __clicks++;
        if (n === 1 && mode.refuseChange) { e.preventDefault(); return; }
        root.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
        el.querySelector('input').checked = true; updateButton();
      }));
      root.querySelector('button').addEventListener('click', () => {
        if (root.querySelector('button').innerText === 'BỎ QUA') __skips++;
        __submits++; if (n === 1) __render(2); else if (!mode.lastSavedSkip) root.querySelector('button').innerText = 'KẾT THÚC';
        if (n === 2 && mode.lastSavePending) {
          const button = root.querySelector('button'); button.innerText = 'TRẢ LỜI'; button.disabled = true;
          setTimeout(() => { button.innerText = 'KẾT THÚC'; button.disabled = false; }, 500);
        }
      });
    };
    document.querySelectorAll('.answer-sheet button').forEach(b => b.addEventListener('click', () => { __navigation++; setTimeout(() => __render(Number(b.innerText)), 50); }));
    __render(1);
    Element.prototype.scrollIntoView = () => {};
    window.chrome = {
      runtime: { getURL: () => 'data:text/javascript,', getManifest: () => ({ version: 'test' }), onMessage: { addListener: f => { window.__listener = f; } },
        sendMessage: async m => { __messages.push(m); if (__mutate && m.action === 'BOT_PROGRESS' && m.text.startsWith('Đang điền')) { __texts[0][0] = 'Nội dung đã thay đổi.'; document.querySelector('.question-option-content').innerHTML = __texts[0][0]; } } },
      storage: { local: { get: (k, cb) => cb(__store), set: v => Object.assign(__store, v) } }
    };
  }, { first: variants[2], mode });
  for (const file of ['math-content.js', 'content.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', file), 'utf8') });
  return page;
}
const send = (page, payload) => page.evaluate(p => new Promise(resolve => __listener(p, {}, resolve)), payload);
async function installApiDelivery(page) {
  await page.evaluate(first => {
    window.__apiSequence = 0;
    window.__makeApi = (options = {}) => ({ questions: [1, 2].slice(0, options.partial ? 1 : 2).map(n => ({dataStandard:{
      numberQuestion:n===1?12905165:9999,stepIndex:n-1,typeAnswer:0,
      // Delivery metadata grows to pass the existing raw-payload completeness
      // heuristic. It has no bearing on the semantic source context.
      delivery:'x'.repeat(++__apiSequence*1000),
      languagesData:{vi:{content:options.renderer?`<p><span>Đề&nbsp;câu ${n}.</span></p>`:`Đề câu ${n}.`,
        options:__texts[n-1].map((text,i)=>({
          ...(options.ids?{idOption:`${n}-${i}`} : {}),
          content:options.conflict&&n===1&&!i?'Nội dung API đã đổi.':options.renderer&&n===1&&!i?first:text
        }))}}
    }})) });
    window.__deliverApi = options => window.postMessage({type:'ONLUYEN_RAW_TEST_DATA',payload:__makeApi(options)},'*');
  }, answerText);
}
(async () => {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(f => fs.existsSync(f));
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await mount(browser);
    const answers = [entry, { cau: 2, id: '9999', loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: 'Đáp án cuối.' }];
    const sidebarPage = await mount(browser);
    await sidebarPage.setContent(fs.readFileSync(path.join(__dirname, 'fixtures/sidebar-fixed-navigation.html'), 'utf8'));
    await sidebarPage.evaluate(() => {
      const root = document.querySelector('.question-container');
      const questionSource = root.querySelector('.question-name').outerHTML;
      window.__nonNavigationClicks = 0;
      window.__render = n => {
        root.innerHTML = `<div class="question-info"><div class="num">Câu: ${n} #${n === 10 ? '13535732' : n === 11 ? '13535721' : 8000 + n}</div></div>${questionSource}<div class="submit-bar"><button>BỎ QUA</button></div>`;
        root.querySelectorAll('.question-name span').forEach(el => el.onclick = () => __nonNavigationClicks++);
        root.querySelector('input').oninput = e => {
          __fills++; root.querySelector('.ans-span-second').textContent = e.target.value;
          root.querySelector('.submit-bar button').textContent = 'TRẢ LỜI';
        };
        root.querySelector('.submit-bar button').onclick = () => {
          __submits++; if (n < 11) __render(n + 1); else root.querySelector('.submit-bar button').textContent = 'KẾT THÚC';
        };
      };
      document.querySelectorAll('.answer-sheet .option').forEach(el => el.onclick = () => { __navigation++; __render(Number(el.textContent)); });
      document.querySelector('.sidebar-nav button').onclick = () => __nonNavigationClicks++;
      __render(10);
    });
    const sidebarPrompt = await send(sidebarPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(sidebarPrompt.ok, true, sidebarPrompt.error);
    assert.equal(sidebarPrompt.count, 11, 'Only the eleven answer-sheet options are question numbers');
    assert.equal(await sidebarPage.$eval('.question-info .num', el => el.textContent), 'Câu: 10 #13535732', 'Collection returns to the originally open question');
    assert.deepEqual(await sidebarPage.evaluate(() => [__navigation, __nonNavigationClicks, __fills, __submits]), [12, 0, 0, 0]);
    const sidebarAnswers = Array.from({ length: 11 }, (_, i) => ({ cau: i + 1,
      id: String(i === 9 ? 13535732 : i === 10 ? 13535721 : 8001 + i), loai: 'SHORT', dap_an: '2027' }));
    const sidebarLoaded = await send(sidebarPage, { action: 'OL_LOAD_DATABASE', json: sidebarAnswers });
    assert.equal(sidebarLoaded.ok, true, sidebarLoaded.error);
    assert.equal((await send(sidebarPage, { action: 'OL_START_BOT' })).ok, true);
    await sidebarPage.waitForFunction(() => !window.__BOT_RUNNING__);
    assert.deepEqual(await sidebarPage.evaluate(() => [__navigation, __nonNavigationClicks, __fills, __submits]), [13, 0, 11, 11],
      'Prompt/import/start reuse one scan and never click numbers in the question, report or unrelated navigation');
    assert.deepEqual(await sidebarPage.evaluate(() => __messages.filter(m => m.action === 'BOT_ERROR')), []);
    await sidebarPage.close();
    const genericSidebar = await mount(browser);
    await genericSidebar.setContent('<div class="question">Nội dung câu hỏi ngoài phiếu trả lời.</div><app-sidebar-school-test><div class="question">Nội dung thanh điều hướng không phải đề.</div></app-sidebar-school-test>');
    await genericSidebar.evaluate(() => { document.body.className = 'app sidebar-fixed'; });
    assert.equal((await send(genericSidebar, { action: 'OL_PING' })).qCount, 1,
      'The generic scraper excludes the actual sidebar, not the entire page with body.sidebar-fixed');
    await genericSidebar.close();
    for (const timing of ['reading', 'restoring']) {
      const delivery = await mount(browser);
      await installApiDelivery(delivery);
      await delivery.evaluate(timing => {
        __deliverApi({partial:true});
        document.querySelectorAll('.answer-sheet button')[timing==='reading'?1:0].addEventListener('click',()=>{
          setTimeout(()=>__deliverApi({renderer:true}),70);
        });
      }, timing);
      await delivery.waitForFunction(()=>__ONLUYEN_RAW_DATA__?.questions.length===1);
      const result = await send(delivery,{action:'OL_LOAD_DATABASE',json:answers});
      assert.equal(result.ok,true,`${timing}: ${result.error}`);
      assert.deepEqual(await delivery.evaluate(()=>[__navigation,__clicks,__submits]),[2,0,0], 'Compatible late API sources require no second scan or answer clicks');
      const promptBefore = await send(delivery,{action:'OL_GET_AI_PROMPT'});
      const token = promptBefore.prompt.match(/snapshot_id: ([a-f0-9]+)/)[1];
      await delivery.evaluate(()=>__deliverApi({renderer:true,ids:true}));
      await delivery.waitForFunction(()=>__ONLUYEN_RAW_DATA__?.questions[0].dataStandard.languagesData.vi.options[0].idOption==='1-0');
      const promptAfter = await send(delivery,{action:'OL_GET_AI_PROMPT'});
      assert.ok(promptAfter.prompt.includes(token),'Verified metadata enrichment retains the existing prompt snapshot');
      const cosmeticReuse = await send(delivery,{action:'OL_LOAD_DATABASE',json:result.json});
      assert.equal(cosmeticReuse.reused,true,'Renderer/ID enrichment retains the verified database');
      const positional = await send(delivery,{action:'OL_LOAD_DATABASE',json:answers.map(a=>({cau:a.cau,id:a.id,loai:'MCQ',dap_an:'A',snapshot_id:token}))});
      assert.equal(positional.ok,true,positional.error);
      assert.deepEqual(await delivery.evaluate(()=>[__navigation,__clicks,__submits]),[2,0,0]);
      await delivery.close();
    }
    const changedDuringRead = await mount(browser);
    await installApiDelivery(changedDuringRead);
    const priorDelivery = await send(changedDuringRead,{action:'OL_LOAD_DATABASE',json:answers});
    assert.equal(priorDelivery.ok,true,priorDelivery.error);
    await changedDuringRead.evaluate(()=>{
      __deliverApi({partial:true});
      document.querySelectorAll('.answer-sheet button')[1].addEventListener('click',()=>setTimeout(()=>__deliverApi({conflict:true}),70));
    });
    await changedDuringRead.waitForFunction(()=>__ONLUYEN_RAW_DATA__?.questions.length===1);
    const actualReadConflict = await send(changedDuringRead,{action:'OL_VALIDATE_DATABASE',json:answers});
    assert.equal(actualReadConflict.ok,false);
    assert.match(actualReadConflict.error,/Câu 1 #12905165: API đã đổi lựa chọn A/);
    assert.equal(actualReadConflict.report.issues[0].code,'PAGE_CHANGED');
    assert.equal(actualReadConflict.report.issues[0].number,1);
    assert.equal(actualReadConflict.report.issues[0].id,'12905165');
    assert.deepEqual(await changedDuringRead.evaluate(()=>[__clicks,__submits]),[0,0]);
    assert.equal((await send(changedDuringRead,{action:'OL_PING'})).databaseJson,priorDelivery.json);
    assert.equal(await changedDuringRead.evaluate(()=>__store['onluyen_saved_db:preflight-fixture']),priorDelivery.json);
    await changedDuringRead.close();
    for (const conflict of [false,true]) {
      const storing = await mount(browser);
      await installApiDelivery(storing);
      const before = await send(storing,{action:'OL_LOAD_DATABASE',json:answers});
      assert.equal(before.ok,true,before.error);
      await storing.evaluate(conflict=>{
        const original=chrome.storage.local.set;
        let once=true;
        chrome.storage.local.set=async value=>{
          original(value);
          if(once){once=false;__deliverApi({renderer:true,conflict});await new Promise(resolve=>setTimeout(resolve,100));}
        };
      },conflict);
      const duringWrite = await send(storing,{action:'OL_LOAD_DATABASE',json:answers.map(a=>({...a,note:'Force new validation'}))});
      assert.equal(duringWrite.ok,!conflict,duringWrite.error);
      if(conflict){
        assert.equal(duringWrite.report.issues[0].code,'PAGE_CHANGED');
        assert.equal((await send(storing,{action:'OL_PING'})).databaseJson,before.json);
        assert.equal(await storing.evaluate(()=>__store['onluyen_saved_db:preflight-fixture']),before.json);
      } else assert.equal((await send(storing,{action:'OL_LOAD_DATABASE',json:duringWrite.json})).reused,true);
      assert.deepEqual(await storing.evaluate(()=>[__navigation,__clicks,__submits]),[2,0,0]);
      await storing.close();
    }
    const loaded = await send(page, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(loaded.ok, true, loaded.error);
    const firstScanNavigation = await page.evaluate(() => __navigation);
    assert.equal(firstScanNavigation, 2, 'One scan visits question 2 and restores question 1');
    const duplicate = await send(page, { action: 'OL_LOAD_DATABASE', json: loaded.json });
    assert.equal(duplicate.reused, true, 'Normalized JSON reuses its successful validation');
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
    assert.equal(started.reused, true);
    assert.equal(await page.evaluate(() => __navigation), firstScanNavigation, 'Load, failed import and Start do not repeat the full scan');
    await page.waitForFunction(() => !window.__BOT_RUNNING__);
    assert.deepEqual(await page.evaluate(() => [__clicks, __submits]), [0, 0], 'Change after preflight invalidates before any answer click');
    assert.match(await page.evaluate(() => __messages.find(m => m.action === 'BOT_ERROR').error), /thay đổi sau kiểm tra/);
    await page.close();

    const directStart = await mount(browser);
    const direct = await send(directStart, { action: 'OL_START_BOT', json: answers });
    assert.equal(direct.ok, true, direct.error);
    await directStart.waitForFunction(() => !window.__BOT_RUNNING__);
    assert.deepEqual(await directStart.evaluate(() => [__navigation, __clicks, __submits]), [2, 2, 2], 'Starting with new JSON scans once, then fills each answer');
    await directStart.close();

    for (const [type, preset, firstClicks, fills] of [
      ['MCQ', 'correct', 0, 0], ['MCQ', null, 1, 0],
      ['SHORT', 'correct', 0, 0], ['SHORT', null, 0, 1],
      ['TF', 'correct', 0, 0], ['TF', 'partial', 1, 0]
    ]) {
      const skipPage = await mount(browser, { type, preset, keepSkip: true });
      const firstEntry = type === 'MCQ' ? entry : type === 'SHORT'
        ? { cau: 1, id: '12905165', loai: 'SHORT', dap_an: '-2,5' }
        : { cau: 1, id: '12905165', loai: 'TF', dap_an: { a: 'Đúng', b: 'Sai' }, noi_dung_cac_y: { a: answerText, b: 'Lựa chọn khác.' } };
      const result = await send(skipPage, { action: 'OL_START_BOT', json: [firstEntry, answers[1]] });
      assert.equal(result.ok, true, result.error);
      await skipPage.waitForFunction(() => !window.__BOT_RUNNING__);
      assert.deepEqual(await skipPage.evaluate(() => [__skips, __clicks, __fills, __submits]), [1, firstClicks + 1, fills, 2], `${type} ${preset || 'fresh'}: matching answer advances with Skip, then fills the next question`);
      assert.deepEqual(await skipPage.evaluate(() => __messages.filter(m => m.action === 'BOT_ERROR')), []);
      await skipPage.close();
    }
    // MathPlay nests both the mirrored response and the changing completion
    // button inside question-name, unlike the older short-answer fixture.
    for (const mode of [
      { keepSkip: false }, { keepSkip: true }, { keepSkip: false, mathMirror: true },
      { keepSkip: true, preset: 'correct' }
    ]) {
      const inline = await mount(browser, { type: 'SHORT', inlineShort: true, ...mode });
      const first = { cau: 1, id: '12905165', loai: 'SHORT', dap_an: mode.preset ? '-2,5' : '2027' };
      const before = await send(inline, { action: 'OL_GET_AI_PROMPT' });
      assert.equal(before.ok, true, before.error);
      const token = before.prompt.match(/snapshot_id: ([a-f0-9]+)/)[1];
      assert.doesNotMatch(before.prompt, /2027|-2,5|BỎ QUA|TRẢ LỜI/);
      assert.equal((await send(inline, { action: 'OL_START_BOT', json: [first, answers[1]] })).ok, true);
      await inline.waitForFunction(() => !window.__BOT_RUNNING__);
      assert.deepEqual(await inline.evaluate(() => [__fills, __clicks, __submits, __skips]),
        [mode.preset ? 0 : 1, 1, 2, mode.keepSkip ? 1 : 0], 'Mirrored answer and button label changes must not invalidate the checked source');
      assert.deepEqual(await inline.evaluate(() => __messages.filter(m => m.action === 'BOT_ERROR')), []);
      const after = await send(inline, { action: 'OL_GET_AI_PROMPT' });
      assert.ok(after.prompt.includes(token), 'Filling the answer retains the prompt snapshot');
      assert.equal(await inline.evaluate(() => __navigation), 2, 'Filling and reusing the prompt do not rescan the exam');
      await inline.close();
    }
    for (const changeAfterFill of ['prompt', 'id', 'unit']) {
      const changedShort = await mount(browser, { type: 'SHORT', inlineShort: true, changeAfterFill });
      const first = { cau: 1, id: '12905165', loai: 'SHORT', dap_an: '2027' };
      assert.equal((await send(changedShort, { action: 'OL_START_BOT', json: [first, answers[1]] })).ok, true);
      await changedShort.waitForFunction(() => !window.__BOT_RUNNING__);
      assert.deepEqual(await changedShort.evaluate(() => [__fills, __clicks, __submits]), [1, 0, 0], 'Real source changes after filling still prevent submission');
      assert.ok(await changedShort.evaluate(() => __messages.some(m => m.action === 'BOT_ERROR')));
      await changedShort.close();
    }
    for (const mode of [{ type: 'MCQ', preset: 'multiple' }, { type: 'SHORT', preset: 'wrong', refuseChange: true }]) {
      const blockedSkip = await mount(browser, { ...mode, keepSkip: true });
      const firstEntry = mode.type === 'MCQ' ? entry : { cau: 1, id: '12905165', loai: 'SHORT', dap_an: '-2,5' };
      assert.equal((await send(blockedSkip, { action: 'OL_START_BOT', json: [firstEntry, answers[1]] })).ok, true);
      await blockedSkip.waitForFunction(() => !window.__BOT_RUNNING__);
      assert.deepEqual(await blockedSkip.evaluate(() => [__skips, __submits]), [0, 0], 'An ambiguous selection or incorrect short answer must not advance through Skip');
      assert.ok(await blockedSkip.evaluate(() => __messages.some(m => m.action === 'BOT_ERROR')));
      await blockedSkip.close();
    }
    for (const mode of [{ lastSavedSkip: true }, { disabledSkip: true }, { lastSavedSkip: true, lastSavePending: true }]) {
      const savedSkip = await mount(browser, { type: 'MCQ', preset: 'correct', keepSkip: true, ...mode });
      assert.equal((await send(savedSkip, { action: 'OL_START_BOT', json: answers })).ok, true);
      await savedSkip.waitForFunction(() => !window.__BOT_RUNNING__);
      assert.deepEqual(await savedSkip.evaluate(() => [__skips, __submits]), [mode.lastSavedSkip ? 2 : 1, 2], 'Click the saved final Skip once, and wait for disabled Skip buttons to become enabled');
      assert.ok(await savedSkip.evaluate(() => __messages.some(m => m.action === 'BOT_DONE' && m.completed === 2)));
      assert.deepEqual(await savedSkip.evaluate(() => __messages.filter(m => m.action === 'BOT_ERROR')), []);
      if (mode.lastSavePending) assert.equal(await savedSkip.$eval('.submit-bar button', button => button.innerText), 'KẾT THÚC', 'A disabled Answer button indicates pending work; wait for the final confirmation');
      await savedSkip.close();
    }

    const promptReuse = await mount(browser);
    assert.equal((await send(promptReuse, { action: 'OL_GET_AI_PROMPT' })).ok, true);
    const fromPrompt = await send(promptReuse, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(fromPrompt.ok, true, fromPrompt.error);
    assert.equal(await promptReuse.evaluate(() => __navigation), 2, 'Import reuses the complete exam collected for the prompt');
    const freshCheck = await send(promptReuse, { action: 'OL_VALIDATE_DATABASE', json: answers });
    assert.equal(freshCheck.ok, true, freshCheck.error);
    assert.equal(await promptReuse.evaluate(() => __navigation), 4, 'Explicit whole-exam check always refreshes every question');
    await promptReuse.close();

    const changed = await mount(browser);
    const beforeChange = await send(changed, { action: 'OL_LOAD_DATABASE', json: answers });
    assert.equal(beforeChange.ok, true, beforeChange.error);
    await changed.evaluate(() => {
      __texts[1][0] = 'Đáp án cuối đã đổi.';
      window.postMessage({ type: 'ONLUYEN_RAW_TEST_DATA', payload: { questions: [{}] } }, '*');
    });
    await changed.waitForFunction(() => __messages.some(m => m.action === 'OL_BADGE'));
    const changedStart = await send(changed, { action: 'OL_START_BOT', json: beforeChange.json });
    assert.equal(changedStart.ok, false, changedStart.error);
    assert.ok(changedStart.report.issues.some(i => i.number === 2));
    assert.deepEqual(await changed.evaluate(() => [__navigation, __clicks, __submits]), [4, 0, 0], 'API update invalidates the snapshot; an error on the last question blocks all answers');
    assert.equal(await changed.evaluate(() => __store['onluyen_saved_db:preflight-fixture']), beforeChange.json);
    await changed.close();

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
    const failedWrite = await send(storageFailure, { action: 'OL_LOAD_DATABASE', json: answers.map(e => ({ ...e, note: 'New import' })) });
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
        // A changed visible choice makes the previous snapshot unusable.
        __texts[0][1] = 'Lựa chọn vừa thay đổi.';
        __render(1);
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
