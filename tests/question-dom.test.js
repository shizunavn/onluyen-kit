const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '..');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function mount(browser, body, url) {
  const page = await browser.newPage();
  if (url) {
    await page.setRequestInterception(true);
    page.on('request', request => request.respond({ status: 200, contentType: 'text/html', body: '<html></html>' }));
    await page.goto(url);
  }
  await page.setContent(`<!doctype html><html><head></head><body>${body}</body></html>`);
  await page.evaluate(() => {
    Element.prototype.getBoundingClientRect = () => ({
      width: 100,
      height: 20,
      top: 0,
      right: 100,
      bottom: 20,
      left: 0,
      x: 0,
      y: 0
    });
    Element.prototype.scrollIntoView = () => {};
    window.chrome = {
      runtime: {
        getURL: () => 'data:text/javascript,',
        sendMessage: message => {
          window.__runtimeMessages = window.__runtimeMessages || [];
          window.__runtimeMessages.push(message);
          return Promise.resolve({ ok: true });
        },
        onMessage: {
          addListener(listener) {
            window.__onluyenListener = listener;
          }
        }
      },
      storage: {
        local: {
          get(_keys, callback) { callback(window.__storageFixture || {}); },
          set(value, callback) {
            window.__storageFixture = { ...(window.__storageFixture || {}), ...value };
            if (callback) callback();
          }
        }
      }
    };
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'math-content.js'), 'utf8') });
  await page.addScriptTag({ content: contentSource });
  return page;
}

async function send(page, message) {
  return page.evaluate(payload => new Promise(resolve => {
    window.__onluyenListener(payload, {}, resolve);
  }), message);
}

function trueFalseRow(key, text, token) {
  return `
    <div class="child-content ng-star-inserted">
      <span class="option-text">
        <span class="option-char">${key}) </span>
        <span class="fadein" style="position: relative;">${text}</span>
      </span>
      <div class="true-false">
        <div><input type="radio" name="${key}" value="true" id="true${token}"><label for="true${token}">Đúng</label></div>
        <div><input type="radio" name="${key}" value="false" id="false${token}"><label for="false${token}">Sai</label></div>
      </div>
    </div>`;
}

(async () => {
  const executablePath = chromeExecutable();
  assert.ok(executablePath, 'Không tìm thấy Chrome hoặc Edge để chạy DOM integration test');
  const browser = await puppeteer.launch({ executablePath, headless: true });

  try {
    const numberedQuestion = require('./math-cases').numberedQuestion;
    const numberedPage = await mount(browser, `
      <div id="test-step-question"><div class="question-container">
        <div class="question-info"><div class="num">Câu: 23 <span>#9023</span></div></div>
        <div class="question-name">${numberedQuestion.html}</div>
        <div class="answer-input">Đáp án: <input type="text"></div>
        <div class="submit-bar"><button>BỎ QUA</button></div>
      </div></div>`);
    const numberedPrompt = await send(numberedPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(numberedPrompt.ok, true, numberedPrompt.error);
    assert.match(numberedPrompt.prompt, /mệnh đề chứa biến/);
    assert.match(numberedPrompt.prompt, /1\) 2x\+1/);
    assert.match(numberedPrompt.prompt, /6\) 2x-1≤7/);
    const splitNumberedQuestion = require('./math-cases').splitNumberedQuestion;
    await numberedPage.evaluate(html => {
      document.querySelector('.question-name').innerHTML = html;
    }, splitNumberedQuestion.html);
    const renderedNumberedPrompt = await send(numberedPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(renderedNumberedPrompt.ok, true, renderedNumberedPrompt.error);
    assert.match(renderedNumberedPrompt.prompt, /1\) ″2x\+1/);
    assert.match(renderedNumberedPrompt.prompt, /6\) ″2x-1≤7″/);
    await numberedPage.evaluate(content => {
      window.__ONLUYEN_RAW_DATA__ = { questions: [{ dataStandard: {
        numberQuestion: 9023, stepIndex: 22, typeAnswer: 2,
        languagesData: { vi: { content } }
      } }] };
    }, splitNumberedQuestion.latex);
    const apiNumberedPrompt = await send(numberedPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(apiNumberedPrompt.ok, true, apiNumberedPrompt.error);
    assert.match(apiNumberedPrompt.prompt, /6\) ″2x-1≤7″/);
    const logicQuestion = require('./math-cases').logicNumberedQuestion;
    await numberedPage.evaluate(html => {
      window.__ONLUYEN_RAW_DATA__ = null;
      document.querySelector('.question-name').innerHTML = html;
      document.querySelector('.question-info .num').innerHTML = 'Câu: 26 <span>#9026</span>';
    }, logicQuestion);
    const logicDomPrompt = await send(numberedPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(logicDomPrompt.ok, true, logicDomPrompt.error);
    assert.match(logicDomPrompt.prompt, /1\) P⇒Q; 2\) Q⇒P; 3\) P⇔Q;/);
    assert.match(logicDomPrompt.prompt, /4\) " P là điều kiện cần để có Q "/);
    await numberedPage.evaluate(content => {
      window.__ONLUYEN_RAW_DATA__ = { questions: [{ dataStandard: {
        numberQuestion: 9026, stepIndex: 25, typeAnswer: 2,
        languagesData: { vi: { content } }
      } }] };
    }, logicQuestion);
    const logicApiPrompt = await send(numberedPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(logicApiPrompt.ok, true, logicApiPrompt.error);
    assert.match(logicApiPrompt.prompt, /1\) P⇒Q; 2\) Q⇒P; 3\) P⇔Q;/);
    const brokenNumberedPrompt = await numberedPage.evaluate(() => {
      window.__ONLUYEN_RAW_DATA__ = null;
      document.querySelector('math').innerHTML = '<mi>x</mi><mo>)</mo>';
      return new Promise(resolve => window.__onluyenListener({ action: 'OL_GET_AI_PROMPT' }, {}, resolve));
    });
    assert.equal(brokenNumberedPrompt.ok, false);
    assert.match(brokenNumberedPrompt.error, /Ngoặc đóng/);
    assert.equal(await numberedPage.$eval('.answer-input input', element => element.value), '');
    assert.equal(await numberedPage.$eval('.submit-bar button', element => element.textContent), 'BỎ QUA');
    await numberedPage.close();

    const routePage = await mount(browser, `
      <div id="test-step-question"><div class="question-container">
        <div class="question-info"><div class="num">Câu: 1 <span>#12460413</span></div></div>
        <div class="question-name">Một vật được coi là chất điểm khi</div>
      </div></div>`, 'https://app.onluyen.vn/school/test/step/exam-a');
    const examA = [{ cau: 1, id: '12460413', loai: 'MCQ', dap_an: 'A' }];
    await send(routePage, { action: 'OL_LOAD_DATABASE', json: examA });
    await routePage.evaluate(() => {
      window.__ONLUYEN_RAW_DATA__ = { questions: [{ old: true }] };
      window.__ONLUYEN_RAW_DATA_SCORE__ = 9999;
      window.__BOT_RUNNING__ = true;
      window.__storageFixture['onluyen_saved_db:exam-b'] = JSON.stringify([
        { cau: 1, id: '12475660', loai: 'MCQ', dap_an: 'B', noi_dung_cau_hoi: 'Câu hỏi kinh tế' }
      ]);
      window.__storageFixture.onluyen_saved_db = JSON.stringify([{ cau: 1, dap_an: 'D' }]);
      history.pushState({}, '', '/school/test/step/exam-b');
      document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#12475660</span>';
      document.querySelector('.question-name').textContent = 'Câu hỏi kinh tế';
    });
    await routePage.waitForFunction(() => window.__ONLUYEN_DATABASE_BY_ID__.has('12475660'));
    const examBStatus = await send(routePage, { action: 'OL_PING' });
    assert.equal(examBStatus.examKey, 'onluyen_saved_db:exam-b');
    assert.equal(examBStatus.botRunning, false);
    assert.equal(examBStatus.hasApiData, false);
    assert.equal(JSON.parse(examBStatus.databaseJson)[0].id, '12475660');
    assert.equal(await routePage.evaluate(() => window.__ONLUYEN_RAW_DATA_SCORE__), 0);
    await routePage.evaluate(() => history.pushState({}, '', '/school/test/history/exam-b'));
    assert.equal((await send(routePage, { action: 'OL_PING' })).databaseJson, examBStatus.databaseJson);
    await routePage.evaluate(() => history.pushState({}, '', '/school/test/step/exam-c'));
    const emptyStatus = await send(routePage, { action: 'OL_PING' });
    assert.equal(emptyStatus.dbSize, 0, 'Never restore the legacy global database into a new exam');
    await routePage.evaluate(() => {
      history.pushState({}, '', '/school/test/exam-a');
      document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#12460413</span>';
      document.querySelector('.question-name').textContent = 'Một vật được coi là chất điểm khi';
    });
    const restoredStatus = await send(routePage, { action: 'OL_PING' });
    assert.equal(JSON.parse(restoredStatus.databaseJson)[0].id, '12460413');
    assert.equal(restoredStatus.dbSize, 1);
    await routePage.evaluate(() => history.pushState({}, '', '/school/test/step/exam-c'));
    const staleLoad = await send(routePage, {
      action: 'OL_LOAD_DATABASE', json: examA, examKey: 'onluyen_saved_db:exam-a'
    });
    assert.equal(staleLoad.ok, false, 'Reject a pending popup action from the previous exam');
    assert.equal((await send(routePage, { action: 'OL_PING' })).dbSize, 0);
    await routePage.close();

    const popupPage = await browser.newPage();
    await popupPage.setContent(fs.readFileSync(path.join(root, 'popup.html'), 'utf8').replace(/<script[^>]*src="popup.js"[^>]*><\/script>/, ''));
    await popupPage.evaluate(() => {
      window.__popupExam = 'exam-a';
      window.__popupActions = [];
      window.__popupSaves = [];
      window.__popupDatabases = {
        'exam-a': JSON.stringify([{ cau: 1, id: '12460413', dap_an: 'A' }]),
        'exam-b': JSON.stringify([{ cau: 1, id: '12475660', dap_an: 'B' }])
      };
      window.chrome = {
        tabs: {
          query: async () => [{ id: 1, url: `https://app.onluyen.vn/school/test/step/${window.__popupExam}` }],
          sendMessage: async (_tab, message) => {
            window.__popupActions.push(message.action);
            if (message.action === 'OL_LOAD_DATABASE') {
              if (window.__popupSilent) return new Promise(() => {});
              return { ok: false, error: 'Câu 6: Database cũ có thể đã mất cấu trúc; hãy lấy lại từ đề/History' };
            }
            if (message.action !== 'OL_PING') throw new Error('Unexpected popup message');
            const databaseJson = window.__popupDatabases[window.__popupExam] || '[]';
            return {
              ok: true, url: `https://app.onluyen.vn/school/test/step/${window.__popupExam}`,
              examKey: `onluyen_saved_db:${window.__popupExam}`,
              databaseJson, dbSize: JSON.parse(databaseJson).length, qCount: 1
            };
          }
        },
        runtime: { onMessage: { addListener() {} } },
        storage: { local: {
          get: async () => ({ onluyen_saved_db: 'WRONG LEGACY DATABASE' }),
          set: async value => { window.__popupSaves.push(value); }
        } }
      };
    });
    await popupPage.addScriptTag({ content: fs.readFileSync(path.join(root, 'popup.js'), 'utf8') });
    await popupPage.waitForFunction(() => document.getElementById('txtDatabase').value.includes('12460413'));
    await popupPage.evaluate(() => { window.__popupExam = 'exam-b'; });
    await popupPage.waitForFunction(() => document.getElementById('txtDatabase').value.includes('12475660'));
    await popupPage.evaluate(() => { document.getElementById('txtDatabase').value = 'unsaved edit'; });
    await popupPage.evaluate(() => updateBotStatus());
    assert.equal(await popupPage.$eval('#txtDatabase', el => el.value), 'unsaved edit');
    await popupPage.evaluate(() => { window.__popupExam = 'exam-c'; });
    await popupPage.waitForFunction(() => document.getElementById('txtDatabase').value === '');
    assert.equal(await popupPage.$eval('#dbStatusPill', el => el.textContent), 'DB: 0 đáp án');
    await popupPage.evaluate(() => {
      document.getElementById('txtDatabase').value = '[{"cau":3,"id":"13537524","dap_an":"D","noi_dung_dap_an":"x+y≤50."}]';
      document.getElementById('btnStartBot').click();
    });
    await popupPage.waitForFunction(() => document.getElementById('progressBox').textContent.includes('Câu 6'));
    await popupPage.waitForFunction(() => !document.getElementById('message').classList.contains('show'));
    await popupPage.evaluate(() => updateBotStatus());
    assert.match(await popupPage.$eval('#progressBox', el => el.textContent), /❌.*Câu 6/);
    assert.equal(await popupPage.$eval('#btnStartBot', el => el.disabled), false);
    assert.deepEqual(await popupPage.evaluate(() => ({ starts: __popupActions.filter(a => a === 'OL_START_BOT'), saves: __popupSaves })), { starts: [], saves: [] });
    await popupPage.evaluate(() => { document.getElementById('btnSaveDb').click(); });
    await popupPage.waitForFunction(() => !document.getElementById('btnSaveDb').disabled);
    assert.match(await popupPage.$eval('#progressBox', el => el.textContent), /❌.*Câu 6/);
    const timeoutError = await popupPage.evaluate(async () => {
      window.__popupSilent = true;
      try { await sendToPage({ action: 'OL_LOAD_DATABASE', json: '[]' }, 30); }
      catch (error) { return error.message; }
    });
    assert.match(timeoutError, /không phản hồi khi nạp JSON/);
    await popupPage.close();

    const shuffledEnglishPage = await mount(browser, '<div class="answer-sheet"><button class="option">1</button><button class="option">2</button></div><div id="test-step-question"><div class="question-container"></div></div>');
    await shuffledEnglishPage.evaluate(() => {
      window.__englishSelections = [];
      const options = {
        1: ['d - b - c - a - e', 'c - a - d - b - e', 'b - c - d - a - e', 'a - d - b - c - e'],
        2: ['a - c - b', 'c - b - a', 'b - c - a', 'c - a - b']
      };
      window.__renderEnglish = number => {
        const id = number === 1 ? '13257730' : '13257733';
        const root = document.querySelector('.question-container');
        root.innerHTML = `<div class="question-info"><div class="num">Câu: ${number} <span>#${id}</span></div></div><div class="question-name">Mark the best arrangement. a. Alex: I’ll do that. b. Mom: Great! c. Mom: Can you help?</div>${options[number].map((text, index) => `<div class="question-option"><span class="question-option-label">${String.fromCharCode(65 + index)}</span><div class="question-option-content">${text}</div><input type="checkbox"></div>`).join('')}<div class="submit-bar"><button>BỎ QUA</button></div>`;
        const button = root.querySelector('.submit-bar button');
        root.querySelectorAll('.question-option').forEach(option => option.addEventListener('click', () => {
          root.querySelectorAll('input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__englishSelections.push(`${id}:${option.querySelector('.question-option-content').innerText}`);
          button.innerText = 'TRẢ LỜI';
        }));
        button.addEventListener('click', () => {
          if (number === 1) window.__renderEnglish(2);
          else button.innerText = 'KẾT THÚC';
        });
      };
      document.querySelectorAll('.answer-sheet button').forEach(button => button.addEventListener('click', () => window.__renderEnglish(Number(button.innerText))));
      window.__renderEnglish(2);
      window.__ONLUYEN_RAW_DATA__ = { questions: ['13257733', '13257730'].map((id, index) => ({ dataStandard: {
        numberQuestion: id, stepIndex: index, typeAnswer: 0,
        languagesData: { vi: { content: 'Mark the best arrangement. c - a - b a - c - b b - c - a c - b - a', options: [{ idOption: 1 }, { idOption: 2 }, { idOption: 3 }, { idOption: 4 }] } }
      } })) };
    });
    const shuffledPrompt = await send(shuffledEnglishPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(shuffledPrompt.ok, true, shuffledPrompt.error);
    assert.equal(shuffledPrompt.count, 2);
    assert.match(shuffledPrompt.prompt, /Các phương án:\nA\. d - b - c - a - e\nB\. c - a - d - b - e/);
    assert.equal(await shuffledEnglishPage.$eval('.question-info .num', element => element.innerText.split('#')[0].trim()), 'Câu: 2');
    assert.deepEqual(await shuffledEnglishPage.evaluate(() => window.__englishSelections), []);
    const shuffledEnglishLoad = await send(shuffledEnglishPage, { action: 'OL_LOAD_DATABASE', json: [
      { cau: 1, id: '13257733', loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: 'c-a-b' },
      { cau: 2, id: '13257730', loai: 'MCQ', dap_an: 'D', noi_dung_dap_an: 'c-a-d-b-e' }
    ] });
    assert.equal(shuffledEnglishLoad.ok, true, shuffledEnglishLoad.error);
    assert.deepEqual(shuffledEnglishLoad.answers.map(answer => [answer.cau, answer.id, answer.dap_an]), [[1, '13257730', 'B'], [2, '13257733', 'D']]);
    await send(shuffledEnglishPage, { action: 'OL_START_BOT' });
    await shuffledEnglishPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.deepEqual(await shuffledEnglishPage.evaluate(() => window.__englishSelections), ['13257730:c - a - d - b - e', '13257733:c - a - b']);
    await shuffledEnglishPage.close();

    const incompleteChoicePage = await mount(browser, '<div id="test-step-question"><div class="question-container"><div class="question-info"><div class="num">Câu: 1 <span>#13257730</span></div></div><div class="question-name">Choose the best arrangement.</div><div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">a-b-c</div></div><div class="question-option"><span class="question-option-label">B</span><div class="question-option-content">c-a-b</div></div><div class="submit-bar"><button>TRẢ LỜI</button></div></div></div>');
    await incompleteChoicePage.evaluate(() => {
      window.__incompleteSubmit = 0;
      document.querySelector('.submit-bar button').addEventListener('click', () => { window.__incompleteSubmit++; });
      window.__ONLUYEN_RAW_DATA__ = { questions: [{ dataStandard: {
        numberQuestion: 13257730, stepIndex: 0, typeAnswer: 0,
        content: 'Choose the best arrangement. a-b-c c-a-b b-c-a c-b-a',
        options: [{ idOption: 1 }, { idOption: 2 }, { idOption: 3 }, { idOption: 4 }]
      } }] };
    });
    const incompletePrompt = await send(incompleteChoicePage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(incompletePrompt.ok, false);
    assert.match(incompletePrompt.error, /chưa đọc đủ phương án/);
    assert.equal(incompletePrompt.prompt, undefined);
    assert.equal(await incompleteChoicePage.evaluate(() => window.__incompleteSubmit), 0);
    await incompleteChoicePage.close();

    const romanApiPage = await mount(browser, '<main>Đang tải đề</main>');
    await romanApiPage.evaluate(() => {
      window.__ONLUYEN_RAW_DATA__ = { questions: [{ dataStandard: {
        stepIndex: 2, numberQuestion: 13537524, typeAnswer: 0,
        languagesData: { vi: {
          content: 'Một gói lưu trữ có dung lượng không vượt quá $50{\\rm GB}$.',
          options: ['$x+y<0$', '$x-y\\le50$', '$x+y\\ge50$', '$x+y\\le50$'].map((content, index) => ({ idOption: index, content }))
        } }
      } }] };
    });
    const romanPrompt = await send(romanApiPage, { action: 'OL_GET_AI_PROMPT' });
    assert.equal(romanPrompt.ok, true, romanPrompt.error);
    assert.match(romanPrompt.prompt, /50GB/);
    assert.match(romanPrompt.prompt, /ID câu: 13537524/);
    await romanApiPage.close();

    const imagePage = await mount(browser, `
      <div id="test-step-question"><div class="question-container">
      <div class="question-info"><div class="num">Câu: 1 <span>#12905197</span></div></div>
      <div class="question-name">Chọn hình biểu diễn miền nghiệm.</div>
      ${['a', 'b', 'c', 'd'].map((key, index) => `<div class="question-option" data-id-option="plot-${key}"><span class="question-option-label">${String.fromCharCode(65 + index)}</span><div class="question-option-content"><img src="https://example.test/plot-${key}.png"></div><input type="checkbox"></div>`).join('')}
      <div class="submit-bar"><button>BỎ QUA</button></div>
      </div></div>`);
    const imageExam = await send(imagePage, { action: 'OL_GET_EXAM' });
    assert.equal(imageExam.questions[0].choices.length, 4, 'Image-only choices must be retained');
    assert.equal(imageExam.questions[0].choices[1].images[0].src, 'https://example.test/plot-b.png');
    const imagePrompt = await send(imagePage, { action: 'OL_GET_AI_PROMPT' });
    assert.match(imagePrompt.prompt, /anh_dap_an/);
    assert.match(imagePrompt.prompt, /phương án B/);
    assert.match(imagePrompt.prompt, /plot-b\.png/);
    await imagePage.evaluate(() => {
      window.__imageSelected = null;
      const button = document.querySelector('.submit-bar button');
      document.querySelectorAll('.question-option').forEach(option => option.addEventListener('click', () => {
        document.querySelectorAll('input').forEach(input => { input.checked = false; });
        option.querySelector('input').checked = true;
        window.__imageSelected = option.dataset.idOption;
        button.innerText = 'TRẢ LỜI';
      }));
      button.addEventListener('click', () => { button.innerText = 'KẾT THÚC'; });
    });
    const imageLoad = await send(imagePage, { action: 'OL_LOAD_DATABASE', json: [{ cau: 1, id: '12905197', loai: 'MCQ', dap_an: 'A', anh_dap_an: ['https://example.test/plot-b.png'] }] });
    assert.equal(imageLoad.ok, true, imageLoad.error);
    assert.equal(imageLoad.answers[0].dap_an, 'B');
    assert.deepEqual(imageLoad.answers[0].anh_dap_an, ['https://example.test/plot-b.png']);
    await imagePage.evaluate(() => {
      const root = document.querySelector('.question-container');
      const option = root.querySelector('[data-id-option="plot-b"]');
      root.insertBefore(option, document.querySelector('.submit-bar'));
      root.querySelectorAll('.question-option').forEach((element, i) => { element.querySelector('.question-option-label').innerText = String.fromCharCode(65 + i); });
    });
    await send(imagePage, { action: 'OL_START_BOT' });
    await imagePage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.equal(await imagePage.evaluate(() => window.__imageSelected), 'plot-b');
    const imageErrors = await imagePage.evaluate(() => (window.__runtimeMessages || []).filter(message => message.action === 'BOT_ERROR'));
    assert.deepEqual(imageErrors, []);
    const invalidImageLoad = await send(imagePage, { action: 'OL_LOAD_DATABASE', json: [{ cau: 1, id: '12905197', loai: 'MCQ', dap_an: 'A', anh_dap_an: ['https://example.test/not-present.png'] }] });
    assert.equal(invalidImageLoad.ok, false);
    const base64Image = 'data:image/png;base64,iVBORw0KGgo=';
    await imagePage.evaluate(source => {
      document.querySelector('[data-id-option="plot-c"] img').src = source;
    }, base64Image);
    const base64Load = await send(imagePage, { action: 'OL_LOAD_DATABASE', json: [{ cau: 1, id: '12905197', loai: 'MCQ', dap_an: 'A', anh_dap_an: [base64Image] }] });
    assert.equal(base64Load.ok, true, base64Load.error);
    assert.deepEqual(base64Load.answers[0].anh_dap_an, [base64Image]);
    await imagePage.evaluate(source => {
      document.querySelector('[data-id-option="plot-a"] img').src = source;
      document.querySelectorAll('input').forEach(input => { input.checked = false; });
      document.querySelector('.submit-bar button').innerText = 'BỎ QUA';
      window.__imageSelected = null;
      window.__runtimeMessages = [];
    }, base64Image);
    await send(imagePage, { action: 'OL_START_BOT' });
    await imagePage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.equal(await imagePage.evaluate(() => window.__imageSelected), null);
    assert.match(await imagePage.evaluate(() => window.__runtimeMessages.find(message => message.action === 'BOT_ERROR')?.error), /Khớp nhiều lựa chọn/);
    await imagePage.close();

    const tfPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#12475736</span></div></div>
          <div class="question-name"><div class="fadein"><p>Đánh giá từng nhận định sau.</p></div></div>
          ${trueFalseRow('a', 'Nhận định thứ nhất.', 'a1')}
          ${trueFalseRow('b', 'Bạn K và bạn T đã sử dụng hiệu quả hình thức phân phối là quảng cáo trực tiếp tại địa điểm bán và kết nối thông qua mạng xã hội.', '6aa4df012c18f20a8af87a971')}
          ${trueFalseRow('c', 'Nhận định thứ ba.', 'c1')}
          ${trueFalseRow('d', 'Nhận định thứ tư.', 'd1')}
          <div class="submit-bar"><button type="button">TRẢ LỜI</button></div>
        </div>
      </div>`);
    await tfPage.evaluate(() => {
      window.__submitClicks = 0;
      document.querySelector('.submit-bar button').addEventListener('click', event => {
        window.__submitClicks++;
        event.currentTarget.innerText = 'KẾT THÚC';
      });
    });

    const exam = await send(tfPage, { action: 'OL_GET_EXAM' });
    assert.equal(exam.count, 1);
    assert.equal(exam.questions[0].answerType, 'TF');
    assert.deepEqual(exam.questions[0].choices.map(choice => choice.label), ['a', 'b', 'c', 'd']);
    assert.equal(exam.questions[0].choices[1].text, 'Bạn K và bạn T đã sử dụng hiệu quả hình thức phân phối là quảng cáo trực tiếp tại địa điểm bán và kết nối thông qua mạng xã hội.');
    const tfPrompt = await send(tfPage, { action: 'OL_GET_AI_PROMPT' });
    assert.match(tfPrompt.prompt, /Loại câu hỏi: Đúng\/Sai cho từng ý\./);
    assert.match(tfPrompt.prompt, /b\) Bạn K và bạn T/);

    const loadedTf = await send(tfPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{ cau: 1, loai: 'TF', dap_an: { a: 'Đúng', b: 'Sai', c: true, d: 0 } }]
    });
    assert.equal(loadedTf.count, 1);
    await send(tfPage, { action: 'OL_START_BOT' });
    await tfPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const selectedTf = await tfPage.evaluate(() => [...document.querySelectorAll('.child-content')].map(row => ({
      key: row.querySelector('.option-char').innerText.trim()[0],
      value: row.querySelector('input:checked')?.value || null
    })));
    assert.deepEqual(selectedTf, [
      { key: 'a', value: 'true' },
      { key: 'b', value: 'false' },
      { key: 'c', value: 'true' },
      { key: 'd', value: 'false' }
    ]);
    assert.equal(await tfPage.evaluate(() => window.__submitClicks), 1);
    await tfPage.close();

    const mcqPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#12475737</span></div></div>
          <div class="question-name"><div class="fadein"><p>Hoạt động đưa sản phẩm đến tay người tiêu dùng được gọi là</p></div></div>
          <div class="row text-left options">
            ${['tiêu thụ.', 'phân phối.', 'điều tiết.', 'trao đổi.'].map((text, index) => `
              <div class="question-option cursor-pointer">
                <span class="question-option-label float-left">${String.fromCharCode(65 + index)}</span>
                <div class="question-option-content fadein"><p>${text}</p></div>
                <input type="checkbox" class="d-none" id="${index}">
              </div>`).join('')}
          </div>
          <div class="submit-bar"><button type="button">TRẢ LỜI</button></div>
        </div>
      </div>`);
    await mcqPage.evaluate(() => {
      window.__optionClicks = 0;
      window.__submitClicks = 0;
      document.querySelectorAll('.question-option').forEach(option => {
        option.addEventListener('click', () => {
          window.__optionClicks++;
          const checkbox = option.querySelector('input');
          checkbox.checked = !checkbox.checked;
        });
      });
      document.querySelector('.submit-bar button').addEventListener('click', event => {
        window.__submitClicks++;
        event.currentTarget.innerText = 'KẾT THÚC';
      });
    });

    const mcqExam = await send(mcqPage, { action: 'OL_GET_EXAM' });
    assert.equal(mcqExam.questions[0].answerType, 'MCQ');
    assert.deepEqual(mcqExam.questions[0].choices.map(choice => choice.label), ['A', 'B', 'C', 'D']);
    // A database from another exam must not match merely by question number,
    // even when its answer text happens to exist among the current options.
    for (const foreignEntry of [
      {
        cau: 1, id: '12460413', loai: 'MCQ', dap_an: 'A',
        noi_dung_cau_hoi: 'Một vật được coi là chất điểm khi',
        noi_dung_dap_an: 'kích thước của vật rất nhỏ so với độ dài của đường đi.'
      },
      { cau: 1, id: '12460413', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: 'phân phối.' },
      { cau: 1, loai: 'MCQ', dap_an: 'B', noi_dung_cau_hoi: 'Câu hỏi thuộc bài khác', noi_dung_dap_an: 'phân phối.' }
    ]) {
      const loaded = await send(mcqPage, { action: 'OL_LOAD_DATABASE', json: [foreignEntry] });
      assert.equal(loaded.ok, true);
      assert.equal(loaded.count, 1, 'Keep entries for questions that may render later');
      await send(mcqPage, { action: 'OL_START_BOT' });
      await mcqPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
      const rejected = await mcqPage.evaluate(() => ({
        clicks: window.__optionClicks,
        submits: window.__submitClicks,
        error: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').at(-1)?.error
      }));
      assert.equal(rejected.clicks, 0);
      assert.equal(rejected.submits, 0);
      assert.match(rejected.error, /Thiếu đáp án khớp câu 1.*12475737.*Database có thể thuộc bài khác/);
    }
    await send(mcqPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{ cau: 1, loai: 'MCQ', dap_an: 'D', noi_dung_dap_an: 'phân phối.' }]
    });
    await send(mcqPage, { action: 'OL_START_BOT' });
    await mcqPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const mcqState = await mcqPage.evaluate(() => ({
      clicks: window.__optionClicks,
      submits: window.__submitClicks,
      selected: [...document.querySelectorAll('.question-option input')].findIndex(input => input.checked)
    }));
    assert.deepEqual(mcqState, { clicks: 1, submits: 1, selected: 1 });
    await mcqPage.close();

    const transitionPage = await mount(browser, `
      <div class="answer-sheet">
        <div class="option">1</div>
        <div class="option">2</div>
      </div>
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#2001</span></div></div>
          <div class="question-name"><p>Câu chuyển trang thứ nhất</p></div>
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">Một A</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content">Một B</div><input type="checkbox"></div>
          <div class="submit-bar"><button type="button">TRẢ LỜI</button></div>
        </div>
      </div>`);
    await transitionPage.evaluate(() => {
      window.__submittedQuestions = [];
      window.__selectedAnswers = {};

      window.__renderQuestion = number => {
        const root = document.querySelector('#test-step-question');
        root.innerHTML = `
          <div class="question-container">
            <div class="question-info"><div class="num">Câu: ${number} <span>#${2000 + number}</span></div></div>
            <div class="question-name"><p>Câu chuyển trang thứ ${number === 1 ? 'nhất' : 'hai'}</p></div>
            <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">${number} A</div><input type="checkbox"></div>
            <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content">${number} B</div><input type="checkbox"></div>
            <div class="submit-bar"><button type="button">TRẢ LỜI</button></div>
          </div>`;
        root.querySelectorAll('.question-option').forEach(option => {
          option.addEventListener('click', () => {
            root.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
            option.querySelector('input').checked = true;
            window.__selectedAnswers[number] = option.querySelector('.question-option-label').innerText;
          });
        });
        root.querySelector('.submit-bar button').addEventListener('click', event => {
          window.__submittedQuestions.push(number);
          if (number === 1) {
            // Cố ý render chậm hơn delay cũ 400 ms để chứng minh bot thật sự
            // đợi số câu đổi, thay vì chạy tiếp theo thời gian cố định.
            setTimeout(() => window.__renderQuestion(2), 650);
          } else {
            event.currentTarget.innerText = 'KẾT THÚC';
          }
        });
      };

      document.querySelectorAll('.answer-sheet .option').forEach((option, index) => {
        option.addEventListener('click', () => window.__renderQuestion(index + 1));
      });
      window.__renderQuestion(1);
    });
    await send(transitionPage, {
      action: 'OL_LOAD_DATABASE',
      json: [
        { cau: 2, id: '2001', loai: 'MCQ', dap_an: 'D', noi_dung_dap_an: '1 B' },
        { cau: 1, id: '2002', loai: 'MCQ', dap_an: 'D', noi_dung_dap_an: '2 A' }
      ]
    });
    await send(transitionPage, { action: 'OL_START_BOT' });
    await transitionPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const transitionState = await transitionPage.evaluate(() => ({
      currentNumber: Number(document.querySelector('.question-info .num').innerText.match(/\d+/)[0]),
      selectedAnswers: window.__selectedAnswers,
      submittedQuestions: window.__submittedQuestions,
      done: window.__runtimeMessages.some(message => message.action === 'BOT_DONE' && message.completed === 2),
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(transitionState, {
      currentNumber: 2,
      selectedAnswers: { 1: 'B', 2: 'A' },
      submittedQuestions: [1, 2],
      done: true,
      errors: []
    });
    await transitionPage.close();

    const resumeMathPage = await mount(browser, `
      <div class="answer-sheet">
        <div class="option">1</div>
        <div class="option">2</div>
      </div>
      <div id="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#3101</span></div></div>
          <div class="question-name">Câu đã lưu</div>
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">saved A</div></div>
          <div class="question-option selected highlighed"><div class="text-answered">Đáp án của bạn</div><span class="question-option-label">B</span><div class="question-option-content">saved B</div></div>
          <div class="submit-bar"><button>BỎ QUA</button></div>
        </div>
      </div>`);
    await resumeMathPage.evaluate(() => {
      window.__mathSelected = null;
      window.__renderMathQuestion = () => {
        document.querySelector('#test-step-question').innerHTML = `
          <div class="question-container">
            <div class="question-info"><div class="num">Câu: 2 <span>#3102</span></div></div>
            <div class="question-name">MathPlay</div>
            <div class="select-item"><input id="math-a" name="answer" type="radio" value="1"><span class="number-item">a</span><label for="math-a">author</label></div>
            <div class="select-item"><input id="math-b" name="answer" type="radio" value="2"><span class="number-item">b</span><label for="math-b">founder</label></div>
            <div class="submit-bar"><button>BỎ QUA</button></div>
          </div>`;
        const root = document.querySelector('#test-step-question');
        root.querySelectorAll('input[type="radio"]').forEach(input => input.addEventListener('change', () => {
          window.__mathSelected = input.value;
          root.querySelector('.submit-bar button').innerText = 'TRẢ LỜI';
        }));
        root.querySelector('.submit-bar button').addEventListener('click', event => {
          if (/trả lời/i.test(event.currentTarget.innerText)) event.currentTarget.innerText = 'KẾT THÚC';
        });
      };
      document.querySelectorAll('.answer-sheet .option').forEach((option, index) => {
        option.addEventListener('click', () => {
          if (index === 1) window.__renderMathQuestion();
        });
      });
    });
    await send(resumeMathPage, {
      action: 'OL_LOAD_DATABASE',
      json: [
        { cau: 1, id: '3101', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: 'saved B' },
        { cau: 2, id: '3102', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: 'founder' }
      ]
    });
    await send(resumeMathPage, { action: 'OL_START_BOT' });
    await resumeMathPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const resumeMathState = await resumeMathPage.evaluate(() => ({
      currentNumber: Number(document.querySelector('.question-info .num').innerText.match(/\d+/)[0]),
      selected: window.__mathSelected,
      button: document.querySelector('.submit-bar button').innerText.trim(),
      done: window.__runtimeMessages.some(message => message.action === 'BOT_DONE' && message.completed === 2),
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(resumeMathState, {
      currentNumber: 2,
      selected: '2',
      button: 'KẾT THÚC',
      done: true,
      errors: []
    });
    await resumeMathPage.close();

    const practicePage = await mount(browser, `
      <app-practice-step-question-option>
        <div class="step-content">
          <div id="step">
            <div class="question-header"><div class="num">1</div><div class="question-id">#13039222</div></div>
            <div class="question-name"><div class="fadein">Trong các câu sau đây, câu nào không phải là mệnh đề?</div></div>
            <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">3 là số nguyên tố lẻ nhỏ nhất.</div><input type="checkbox" class="d-none"></div>
            <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content">2 + 3 = 6.</div><input type="checkbox" class="d-none"></div>
            <div class="question-option"><span class="question-option-label">C</span><div class="question-option-content">Văn Miếu được xây dựng từ thời nhà Lý.</div><input type="checkbox" class="d-none"></div>
            <div class="question-option"><span class="question-option-label">D</span><div class="question-option-content">Đề kiểm tra hôm nay dễ quá!</div><input type="checkbox" class="d-none"></div>
            <div class="submit-bar"><button type="button">BỎ QUA</button></div>
          </div>
        </div>
      </app-practice-step-question-option>`);
    await practicePage.evaluate(() => {
      window.__practiceSelected = null;
      window.__practiceAnswerClicks = 0;
      window.__practiceNextClicks = 0;
      const host = document.querySelector('app-practice-step-question-option');
      host.querySelectorAll('.question-option').forEach(option => {
        option.addEventListener('click', () => {
          host.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__practiceSelected = option.querySelector('.question-option-label').innerText;
          host.querySelector('.submit-bar button').innerText = 'TRẢ LỜI';
        });
      });
      host.querySelector('.submit-bar button').addEventListener('click', event => {
        const action = event.currentTarget.innerText.trim();
        if (action === 'TRẢ LỜI') {
          window.__practiceAnswerClicks++;
          const button = event.currentTarget;
          setTimeout(() => { button.innerText = 'CÂU HỎI TIẾP THEO'; }, 500);
          return;
        }
        if (action === 'CÂU HỎI TIẾP THEO') {
          window.__practiceNextClicks++;
          host.innerHTML = `
            <div class="step-content"><div id="step">
              <div class="question-header"><div class="num">2</div><div class="question-id">#13039223</div></div>
              <div class="question-name">Câu luyện tập tiếp theo</div>
              <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">Mới A</div><input type="checkbox"></div>
              <div class="submit-bar"><button type="button">BỎ QUA</button></div>
            </div></div>`;
        }
      });
    });
    const practiceExam = await send(practicePage, { action: 'OL_GET_EXAM' });
    assert.equal(practiceExam.count, 1);
    assert.equal(practiceExam.questions[0].number, 1);
    assert.equal(practiceExam.questions[0].sourceId, '13039222');
    assert.equal(practiceExam.questions[0].prompt, 'Trong các câu sau đây, câu nào không phải là mệnh đề?');
    assert.deepEqual(practiceExam.questions[0].choices.map(choice => choice.label), ['A', 'B', 'C', 'D']);
    await send(practicePage, {
      action: 'OL_LOAD_DATABASE',
      json: [{ cau: 1, loai: 'MCQ', dap_an: 'B' }]
    });
    await send(practicePage, { action: 'OL_START_BOT' });
    await practicePage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const practiceState = await practicePage.evaluate(() => ({
      selected: window.__practiceSelected,
      answerClicks: window.__practiceAnswerClicks,
      nextClicks: window.__practiceNextClicks,
      currentQuestion: document.querySelector('.question-header .num').innerText,
      done: window.__runtimeMessages.some(message => message.action === 'BOT_DONE' && message.completed === 1),
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(practiceState, {
      selected: 'B',
      answerClicks: 1,
      nextClicks: 1,
      currentQuestion: '2',
      done: true,
      errors: []
    });
    await practicePage.close();

    const mathJaxPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#12893605</span></div></div>
          <div class="question-name"><p>Đường kính hạt nhân khoảng bao nhiêu?</p></div>
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content"><p><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><msup><mn>10</mn><mrow><mo>−</mo><mn>2</mn></mrow></msup></math></mjx-assistive-mml></mjx-container> pm.</p></div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content"><p><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><msup><mn>10</mn><mn>2</mn></msup></math></mjx-assistive-mml></mjx-container> pm.</p></div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">C</span><div class="question-option-content"><p><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><msup><mn>10</mn><mrow><mo>−</mo><mn>4</mn></mrow></msup></math></mjx-assistive-mml></mjx-container> pm.</p></div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">D</span><div class="question-option-content"><p><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><msup><mn>10</mn><mn>4</mn></msup></math></mjx-assistive-mml></mjx-container> pm.</p></div><input type="checkbox"></div>
          <div class="submit-bar"><button type="button">BỎ QUA</button></div>
        </div>
      </div>`);
    await mathJaxPage.evaluate(() => {
      window.__mathSelected = null;
      window.__mathSubmitClicks = 0;
      const root = document.querySelector('#test-step-question');
      const button = root.querySelector('.submit-bar button');
      root.querySelectorAll('.question-option').forEach(option => {
        option.addEventListener('click', () => {
          root.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__mathSelected = option.querySelector('.question-option-label').innerText;
          button.innerText = 'TRẢ LỜI';
        });
      });
      button.addEventListener('click', () => {
        if (button.innerText.trim() !== 'TRẢ LỜI') return;
        window.__mathSubmitClicks++;
        button.innerText = 'KẾT THÚC';
      });
    });
    const mathExam = await send(mathJaxPage, { action: 'OL_GET_EXAM' });
    assert.equal(mathExam.questions[0].choices[0].text, '10^{-2} pm.');
    const mathLoad = await send(mathJaxPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{ cau: 1, id: '12893605', loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: '$10^{-2}$ pm.' }]
    });
    assert.equal(mathLoad.answers[0].dap_an, 'A');
    assert.equal(mathLoad.answers[0].noi_dung_dap_an, '10^{-2} pm.');
    await send(mathJaxPage, { action: 'OL_START_BOT' });
    await mathJaxPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const mathState = await mathJaxPage.evaluate(() => ({
      selected: window.__mathSelected,
      submits: window.__mathSubmitClicks,
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(mathState, { selected: 'A', submits: 1, errors: [] });
    await mathJaxPage.close();

    const { triangleAnswer, triangleChoices } = require('./math-cases');
    let triangleCache;
    for (const order of [[0, 1, 2, 3], [1, 0, 2, 3]]) {
      const expected = String.fromCharCode(65 + order.indexOf(1));
      const trianglePage = await mount(browser, `
        <div id="test-step-question"><div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#13039101</span></div></div>
          <div class="question-name">Mệnh đề đảo của mệnh đề đã cho là</div>
          ${order.map((index, i) => `<div class="question-option"><span class="question-option-label">${String.fromCharCode(65 + i)}</span><div class="question-option-content">${triangleChoices[index]}</div><input type="checkbox"></div>`).join('')}
          <div class="submit-bar"><button>BỎ QUA</button></div>
        </div></div>`);
      await trianglePage.evaluate(() => {
        window.__triangleSelected = null;
        window.__triangleSubmits = 0;
        const button = document.querySelector('.submit-bar button');
        document.querySelectorAll('.question-option').forEach(option => option.addEventListener('click', () => {
          document.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__triangleSelected = option.querySelector('.question-option-label').innerText;
          button.innerText = 'TRẢ LỜI';
        }));
        button.addEventListener('click', () => {
          if (button.innerText !== 'TRẢ LỜI') return;
          window.__triangleSubmits++;
          button.innerText = 'KẾT THÚC';
        });
      });
      const loadedTriangle = await send(trianglePage, {
        action: 'OL_LOAD_DATABASE',
        json: [{ cau: 6, id: '13039101', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: triangleAnswer }]
      });
      assert.equal(loadedTriangle.ok, true, loadedTriangle.error);
      assert.equal(loadedTriangle.answers[0].dap_an, expected);
      if (triangleCache) {
        const restoredTriangle = await send(trianglePage, { action: 'OL_LOAD_DATABASE', json: triangleCache });
        assert.equal(restoredTriangle.ok, true, restoredTriangle.error);
        assert.equal(restoredTriangle.answers[0].dap_an, expected, 'Cached answer follows ABC content after options move');
      }
      triangleCache = loadedTriangle.json;
      await send(trianglePage, { action: 'OL_START_BOT' });
      await trianglePage.waitForFunction(() => window.__BOT_RUNNING__ === false);
      assert.deepEqual(await trianglePage.evaluate(() => ({
        selected: window.__triangleSelected,
        submits: window.__triangleSubmits,
        errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
      })), { selected: expected, submits: 1, errors: [] });
      await trianglePage.close();
    }

    const safetyPage = await mount(browser, `
      <div id="test-step-question"><div class="question-container">
        <div class="question-info"><div class="num">Câu: 1 <span>#7001</span></div></div>
        <div class="question-name">Chọn phân số.</div>
        ${['<mfrac><mn>1</mn><mi>x</mi></mfrac>', '<mfrac><mi>x</mi><mn>1</mn></mfrac>'].map((body, i) => `
          <div class="question-option"><span class="question-option-label">${i ? 'B' : 'A'}</span>
          <div class="question-option-content"><mjx-container><svg></svg><mjx-assistive-mml><math>${body}</math></mjx-assistive-mml></mjx-container></div><input type="checkbox"></div>`).join('')}
        <div class="submit-bar"><button>BỎ QUA</button></div>
      </div></div>`, 'https://app.onluyen.vn/school/test/step/math-safe');
    await safetyPage.evaluate(() => {
      window.__safeClicks = 0;
      document.querySelectorAll('.question-option, .submit-bar button').forEach(el => el.addEventListener('click', () => { window.__safeClicks++; }));
    });
    const safeLoaded = await send(safetyPage, {
      action: 'OL_LOAD_DATABASE', json: [{ cau: 1, id: '7001', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: '$\\frac{1}{x}$' }]
    });
    assert.equal(safeLoaded.ok, true);
    assert.equal(safeLoaded.answers[0].dap_an, 'A');
    assert.equal(safeLoaded.answers[0].math_content.answer.segments[0].format, 'mathml');
    for (const answer of ['$\\unknown{x}$', '1x']) {
      const rejected = await send(safetyPage, {
        action: 'OL_LOAD_DATABASE', json: [{ cau: 1, id: '7001', loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: answer }]
      });
      assert.equal(rejected.ok, false);
      const status = await send(safetyPage, { action: 'OL_PING' });
      assert.equal(status.databaseJson, safeLoaded.json, 'A failed import must not replace the in-memory database');
      assert.equal(await safetyPage.evaluate(() => window.__storageFixture['onluyen_saved_db:math-safe']), safeLoaded.json, 'A failed import must not overwrite saved data');
    }
    const restored = await send(safetyPage, { action: 'OL_LOAD_DATABASE', json: safeLoaded.json });
    assert.equal(restored.ok, true, 'MathML metadata survives exporting and reloading JSON');
    await safetyPage.evaluate(() => {
      const options = document.querySelectorAll('.question-option-content');
      options[1].innerHTML = options[0].innerHTML;
    });
    await send(safetyPage, { action: 'OL_START_BOT' });
    await safetyPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.equal(await safetyPage.evaluate(() => window.__safeClicks), 0, 'Ambiguous math must not click or submit');
    assert.match(await safetyPage.evaluate(() => window.__runtimeMessages.filter(m => m.action === 'BOT_ERROR').at(-1).error), /Khớp nhiều lựa chọn/);
    await safetyPage.evaluate(() => {
      document.querySelector('.question-option-content').innerHTML = '<mjx-container><svg></svg></mjx-container>';
    });
    await send(safetyPage, { action: 'OL_START_BOT' });
    await safetyPage.waitForFunction(() => window.__BOT_RUNNING__ === false, { timeout: 10000 });
    assert.equal(await safetyPage.evaluate(() => window.__safeClicks), 0, 'Missing MathJax source must not click or submit');
    assert.match(await safetyPage.evaluate(() => window.__runtimeMessages.filter(m => m.action === 'BOT_ERROR').at(-1).error), /chưa render/);
    await safetyPage.close();

    const tfSafetyPage = await mount(browser, `
      <div id="test-step-question"><div class="question-container">
        <div class="question-info"><div class="num">Câu: 1 <span>#8000</span></div></div>
        <div class="question-name">Câu khác đang mở.</div>
      </div></div>`);
    const deferredTf = await send(tfSafetyPage, {
      action: 'OL_LOAD_DATABASE', json: [{
        cau: 1, id: '8001', loai: 'TF', dap_an: { a: 'Đúng', b: 'Sai' },
        noi_dung_cac_y: { a: '$x^2$', b: '$x^4$' }
      }]
    });
    assert.equal(deferredTf.ok, true);
    await tfSafetyPage.evaluate(body => {
      document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#8001</span>';
      document.querySelector('.question-container').insertAdjacentHTML('beforeend', body);
      window.__tfSafetyClicks = 0;
      document.querySelectorAll('input, button').forEach(el => el.addEventListener('click', () => { window.__tfSafetyClicks++; }));
    }, trueFalseRow('a', '<mjx-container><mjx-assistive-mml><math><msup><mi>x</mi><mn>2</mn></msup></math></mjx-assistive-mml></mjx-container>', 'safe-a')
      + trueFalseRow('b', '<mjx-container><mjx-assistive-mml><math><msup><mi>x</mi><mn>3</mn></msup></math></mjx-assistive-mml></mjx-container>', 'safe-b')
      + '<div class="submit-bar"><button>BỎ QUA</button></div>');
    await send(tfSafetyPage, { action: 'OL_START_BOT' });
    await tfSafetyPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.equal(await tfSafetyPage.evaluate(() => window.__tfSafetyClicks), 0, 'Validate every statement before clicking any TF radio');
    assert.match(await tfSafetyPage.evaluate(() => window.__runtimeMessages.filter(m => m.action === 'BOT_ERROR').at(-1).error), /ý b/);
    await tfSafetyPage.close();

    const inequalityPage = await mount(browser, `
      <div id="test-step-question"><div class="question-container">
        <div class="question-info"><div class="num">Câu: 1 <span>#13537524</span></div></div>
        <div class="question-name">Tổng dung lượng video x và ảnh y không vượt quá 50 GB.</div>
        ${[
          '<mi>x</mi><mo>+</mo><mi>y</mi><mo>&lt;</mo><mn>0</mn>',
          '<mi>x</mi><mo>−</mo><mi>y</mi><mo>⩽</mo><mn>50</mn>',
          '<mi>x</mi><mo>+</mo><mi>y</mi><mo>⩾</mo><mn>50</mn>',
          '<mi>x</mi><mo>+</mo><mi>y</mi><mo>⩽</mo><mn>50</mn>'
        ].map((math, index) => `
          <div class="question-option"><span class="question-option-label">${String.fromCharCode(65 + index)}</span>
            <div class="question-option-content"><mjx-container><svg aria-hidden="true"></svg>
              <mjx-assistive-mml><math>${math}</math></mjx-assistive-mml></mjx-container>.</div>
            <input type="checkbox"></div>`).join('')}
        <div class="submit-bar"><button>BỎ QUA</button></div>
      </div></div>`);
    await inequalityPage.evaluate(() => {
      window.__inequalitySelected = null;
      const button = document.querySelector('.submit-bar button');
      document.querySelectorAll('.question-option').forEach(option => option.addEventListener('click', () => {
        document.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
        option.querySelector('input').checked = true;
        window.__inequalitySelected = option.querySelector('.question-option-label').innerText;
        button.innerText = 'TRẢ LỜI';
      }));
      button.addEventListener('click', () => { button.innerText = 'KẾT THÚC'; });
    });
    for (const [index, answerText] of ['\\(x + y \\le 50\\)', '$x+y\\leq50$', '$x+y\\leqslant50$', 'x+y≤50.'].entries()) {
      await inequalityPage.evaluate(() => {
        window.__inequalitySelected = null;
        document.querySelectorAll('input').forEach(input => { input.checked = false; });
        document.querySelector('.submit-bar button').innerText = 'BỎ QUA';
        window.__runtimeMessages = [];
      });
      const deferred = index % 2 === 1;
      if (deferred) {
        await inequalityPage.evaluate(() => {
          document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#99999</span>';
        });
      }
      const loaded = await send(inequalityPage, {
        action: 'OL_LOAD_DATABASE',
        json: [{ cau: 1, id: '13537524', loai: 'MCQ', dap_an: 'B', noi_dung_dap_an: answerText }]
      });
      assert.equal(loaded.answers[0].dap_an, deferred ? 'B' : 'D', 'Remap only when the matching question is rendered');
      await inequalityPage.evaluate(() => {
        document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#13537524</span>';
      });
      await send(inequalityPage, { action: 'OL_START_BOT' });
      await inequalityPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
      const result = await inequalityPage.evaluate(() => ({
        selected: window.__inequalitySelected,
        errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
      }));
      assert.deepEqual(result, { selected: 'D', errors: [] });
    }
    await inequalityPage.evaluate(() => {
      document.querySelector('.question-info .num').innerHTML = 'Câu: 3 <span>#13537524</span>';
      window.__inequalitySelected = null;
      document.querySelectorAll('input').forEach(input => { input.checked = false; });
      document.querySelector('.submit-bar button').innerText = 'BỎ QUA';
      window.__runtimeMessages = [];
    });
    const suppliedDatabase = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/inequality-database.json'), 'utf8'));
    const suppliedLoad = await send(inequalityPage, { action: 'OL_LOAD_DATABASE', json: suppliedDatabase });
    assert.equal(suppliedLoad.ok, true, suppliedLoad.error);
    assert.equal(suppliedLoad.count, 19);
    assert.equal(suppliedLoad.answers.find(answer => answer.id === '13537524').dap_an, 'D');
    assert.ok(suppliedLoad.answers.find(answer => answer.id === '13537524').math_content.answer);
    await inequalityPage.evaluate(() => {
      document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#13537528</span>';
      const formulas = [
        '<mi>x</mi><mi>y</mi><mo>⩾</mo><mn>4</mn>',
        '<mfrac><mn>1</mn><mi>x</mi></mfrac><mo>+</mo><mi>y</mi><mo>&lt;</mo><mn>2</mn>',
        '<mn>2</mn><mi>x</mi><mo>−</mo><mn>3</mn><mi>y</mi><mo>⩽</mo><mn>5</mn>',
        '<msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mi>y</mi><mo>&gt;</mo><mn>1</mn>'
      ];
      document.querySelectorAll('.question-option-content').forEach((element, index) => {
        element.innerHTML = `<mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math>${formulas[index]}</math></mjx-assistive-mml></mjx-container>.`;
      });
    });
    const mixedLoad = await send(inequalityPage, { action: 'OL_LOAD_DATABASE', json: suppliedDatabase });
    assert.equal(mixedLoad.ok, true, mixedLoad.error);
    assert.equal(mixedLoad.count, 19);
    assert.equal(mixedLoad.answers.find(answer => answer.id === '13537528').dap_an, 'C');
    const singleMixedLoad = await send(inequalityPage, { action: 'OL_LOAD_DATABASE', json: [suppliedDatabase[0]] });
    assert.equal(singleMixedLoad.ok, true, singleMixedLoad.error);
    await send(inequalityPage, { action: 'OL_START_BOT' });
    await inequalityPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.deepEqual(await inequalityPage.evaluate(() => ({
      selected: window.__inequalitySelected,
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    })), { selected: 'C', errors: [] });
    await inequalityPage.evaluate(() => {
      document.querySelector('.question-info .num').innerHTML = 'Câu: 6 <span>#12495418</span>';
      const formula = '<math><mi>y</mi><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>x</mi><mo>+</mo><mfrac><mn>5</mn><mn>2</mn></mfrac></math>';
      document.querySelectorAll('.question-option-content').forEach((element, index) => {
        const origin = index % 2 ? 'chứa' : 'không chứa';
        const boundary = index < 2 ? 'bao gồm' : 'không bao gồm';
        element.innerHTML = `nửa mặt phẳng ${origin} gốc tọa độ, bờ là đường thẳng <mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml>${formula}</mjx-assistive-mml></mjx-container> (${boundary} đường thẳng).`;
      });
      window.__inequalitySelected = null;
      document.querySelectorAll('input').forEach(input => { input.checked = false; });
      document.querySelector('.submit-bar button').innerText = 'BỎ QUA';
      window.__runtimeMessages = [];
    });
    const proseLoad = await send(inequalityPage, { action: 'OL_LOAD_DATABASE', json: suppliedDatabase });
    assert.equal(proseLoad.ok, true, proseLoad.error);
    assert.equal(proseLoad.count, 19);
    assert.equal(proseLoad.answers.find(answer => answer.id === '12495418').dap_an, 'C');
    await inequalityPage.evaluate(() => {
      document.querySelector('.question-info .num').innerHTML = 'Câu: 1 <span>#12495418</span>';
    });
    const singleProseLoad = await send(inequalityPage, { action: 'OL_LOAD_DATABASE', json: [suppliedDatabase[5]] });
    assert.equal(singleProseLoad.ok, true, singleProseLoad.error);
    await send(inequalityPage, { action: 'OL_START_BOT' });
    await inequalityPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    assert.deepEqual(await inequalityPage.evaluate(() => ({
      selected: window.__inequalitySelected,
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    })), { selected: 'C', errors: [] });
    await inequalityPage.close();

    const latexPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#12758586</span></div></div>
          <div class="question-name"><p>Cho hai tập hợp A và B. Khẳng định nào đúng?</p></div>
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content"><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><mi>A</mi><mo>∪</mo><mi>B</mi><mo>=</mo><mo>{</mo><mn>2</mn><mo>;</mo><mn>4</mn><mo>;</mo><mn>7</mn><mo>;</mo><mn>8</mn><mo>;</mo><mn>9</mn><mo>;</mo><mn>12</mn><mo>}</mo></math></mjx-assistive-mml></mjx-container></div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content"><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><mi>A</mi><mo>∪</mo><mi>B</mi><mo>=</mo><mo>{</mo><mn>2</mn><mo>;</mo><mn>8</mn><mo>;</mo><mn>9</mn><mo>;</mo><mn>12</mn><mo>}</mo></math></mjx-assistive-mml></mjx-container></div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">C</span><div class="question-option-content"><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><mi>A</mi><mo>∪</mo><mi>B</mi><mo>=</mo><mo>∅</mo></math></mjx-assistive-mml></mjx-container></div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">D</span><div class="question-option-content"><mjx-container><svg aria-hidden="true"></svg><mjx-assistive-mml><math><mi>A</mi><mo>∪</mo><mi>B</mi><mo>=</mo><mo>{</mo><mn>2</mn><mo>;</mo><mn>8</mn><mo>;</mo><mn>9</mn><mo>}</mo></math></mjx-assistive-mml></mjx-container></div><input type="checkbox"></div>
          <div class="submit-bar"><button type="button">BỎ QUA</button></div>
        </div>
      </div>`);
    await latexPage.evaluate(() => {
      window.__latexSelected = null;
      const root = document.querySelector('#test-step-question');
      const button = root.querySelector('.submit-bar button');
      root.querySelectorAll('.question-option').forEach(option => {
        option.addEventListener('click', () => {
          root.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__latexSelected = option.querySelector('.question-option-label').innerText;
          button.innerText = 'TRẢ LỜI';
        });
      });
      button.addEventListener('click', () => {
        if (button.innerText.trim() === 'TRẢ LỜI') button.innerText = 'KẾT THÚC';
      });
    });
    const latexLoad = await send(latexPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{
        cau: 1,
        id: '12758586',
        loai: 'MCQ',
        dap_an: 'A',
        noi_dung_dap_an: '$ A\\cup B=\\left\\{ 2;4;7;8;9;12 \\right\\} $'
      }]
    });
    assert.equal(latexLoad.answers[0].dap_an, 'A');
    assert.equal(latexLoad.answers[0].noi_dung_dap_an, 'A∪B={2;4;7;8;9;12}');
    await send(latexPage, { action: 'OL_START_BOT' });
    await latexPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const latexState = await latexPage.evaluate(() => ({
      selected: window.__latexSelected,
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(latexState, { selected: 'A', errors: [] });
    await latexPage.close();

    const intervalPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#12759003</span></div></div>
          <div class="question-name"><p>Cho M=[2;11) và N=(2;15). Tìm giao hai tập hợp.</p></div>
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content"><mjx-container><mjx-assistive-mml><math><mo>(</mo><mn>2</mn><mo>;</mo><mn>11</mn><mo>]</mo></math></mjx-assistive-mml></mjx-container>.</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content"><mjx-container><mjx-assistive-mml><math><mo>[</mo><mn>2</mn><mo>;</mo><mn>11</mn><mo>]</mo></math></mjx-assistive-mml></mjx-container>.</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">C</span><div class="question-option-content"><mjx-container><mjx-assistive-mml><math><mo>[</mo><mn>2</mn><mo>;</mo><mn>11</mn><mo>)</mo></math></mjx-assistive-mml></mjx-container>.</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">D</span><div class="question-option-content"><mjx-container><mjx-assistive-mml><math><mo>(</mo><mn>2</mn><mo>;</mo><mn>11</mn><mo>)</mo></math></mjx-assistive-mml></mjx-container>.</div><input type="checkbox"></div>
          <div class="submit-bar"><button type="button">BỎ QUA</button></div>
        </div>
      </div>`);
    await intervalPage.evaluate(() => {
      window.__intervalSelected = null;
      const root = document.querySelector('#test-step-question');
      const button = root.querySelector('.submit-bar button');
      root.querySelectorAll('.question-option').forEach(option => {
        option.addEventListener('click', () => {
          root.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__intervalSelected = option.querySelector('.question-option-label').innerText;
          button.innerText = 'TRẢ LỜI';
        });
      });
      button.addEventListener('click', () => {
        if (button.innerText.trim() === 'TRẢ LỜI') button.innerText = 'KẾT THÚC';
      });
    });
    await send(intervalPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{ cau: 1, id: '12759003', loai: 'MCQ', dap_an: 'D', noi_dung_dap_an: '\\(\\left( 2;11 \\right)\\)' }]
    });
    await intervalPage.evaluate(() => {
      const entry = window.__ONLUYEN_DATABASE__.get(1);
      entry.answer = 'A';
      entry.answerText = '\\left( 2;11 \\right]';
    });
    await send(intervalPage, { action: 'OL_START_BOT' });
    await intervalPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const intervalState = await intervalPage.evaluate(() => ({
      selected: window.__intervalSelected,
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(intervalState, { selected: 'D', errors: [] });
    await intervalPage.close();

    const setBuilderPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#13508738</span></div></div>
          <div class="question-name"><p>Tập hợp A={3;6;9;12} được viết cách khác là</p></div>
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">(1) A={x∈ℕ|x chia hết cho 3 và 3≤x≤12}</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content">(2) A={x∈ℕ|x chia hết cho 3 và 3&lt;x&lt;6}</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">C</span><div class="question-option-content">(3) A={x∈ℕ|x chia hết cho 3 và 3≤x&lt;12}</div><input type="checkbox"></div>
          <div class="question-option"><span class="question-option-label">D</span><div class="question-option-content">(4) A={x∈ℕ|x chia hết cho 3,x≤12}</div><input type="checkbox"></div>
          <div class="submit-bar"><button type="button">BỎ QUA</button></div>
        </div>
      </div>`);
    await setBuilderPage.evaluate(() => {
      window.__setBuilderSelected = null;
      const root = document.querySelector('#test-step-question');
      const button = root.querySelector('.submit-bar button');
      root.querySelectorAll('.question-option').forEach(option => {
        option.addEventListener('click', () => {
          root.querySelectorAll('.question-option input').forEach(input => { input.checked = false; });
          option.querySelector('input').checked = true;
          window.__setBuilderSelected = option.querySelector('.question-option-label').innerText;
          button.innerText = 'TRẢ LỜI';
        });
      });
      button.addEventListener('click', () => {
        if (button.innerText.trim() === 'TRẢ LỜI') button.innerText = 'KẾT THÚC';
      });
    });
    await send(setBuilderPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{
        cau: 1,
        id: '13508738',
        loai: 'MCQ',
        dap_an: 'A',
        noi_dung_dap_an: '(1) \\(A=\\left\\lbrace x\\in\\mathbb{N}|x\\space chia\\space hết\\space cho\\space3\\space và\\space3\\le x\\le12\\right\\rbrace\\).'
      }]
    });
    await send(setBuilderPage, { action: 'OL_START_BOT' });
    await setBuilderPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const setBuilderState = await setBuilderPage.evaluate(() => ({
      selected: window.__setBuilderSelected,
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(setBuilderState, { selected: 'A', errors: [] });
    await setBuilderPage.close();

    const shortPage = await mount(browser, `
      <div id="test-step-question" class="test-step-question">
        <div class="question-container">
          <div class="question-info"><div class="num">Câu: 1 <span>#13123314</span></div></div>
          <div class="question-name">
            <div class="title">Điền đáp án thích hợp vào ô trống</div>
            <div class="content">Có bao nhiêu mệnh đề sai trong các mệnh đề trên?</div>
            <div class="answer-input"><input class="can-resize-second" id="mathplay-answer-1" type="text" config-typeaction="number"></div>
          </div>
          <div class="submit-bar"><button type="button">BỎ QUA</button></div>
        </div>
      </div>`);
    await shortPage.evaluate(() => {
      window.__shortSubmitClicks = 0;
      const input = document.querySelector('.answer-input input');
      const button = document.querySelector('.submit-bar button');
      input.addEventListener('input', () => { button.innerText = input.value ? 'TRẢ LỜI' : 'BỎ QUA'; });
      button.addEventListener('click', () => {
        window.__shortSubmitClicks++;
        button.innerText = 'KẾT THÚC';
      });
    });
    const shortExam = await send(shortPage, { action: 'OL_GET_EXAM' });
    assert.equal(shortExam.questions[0].answerType, 'SHORT');
    const shortPrompt = await send(shortPage, { action: 'OL_GET_AI_PROMPT' });
    assert.match(shortPrompt.prompt, /Trả lời ngắn/);
    await send(shortPage, {
      action: 'OL_LOAD_DATABASE',
      json: [{ cau: 1, loai: 'SHORT', dap_an: '-2,5' }]
    });
    await send(shortPage, { action: 'OL_START_BOT' });
    await shortPage.waitForFunction(() => window.__BOT_RUNNING__ === false);
    const shortState = await shortPage.evaluate(() => ({
      value: document.querySelector('.answer-input input').value,
      submits: window.__shortSubmitClicks,
      done: window.__runtimeMessages.some(message => message.action === 'BOT_DONE' && message.completed === 1),
      errors: window.__runtimeMessages.filter(message => message.action === 'BOT_ERROR').map(message => message.error)
    }));
    assert.deepEqual(shortState, { value: '-2,5', submits: 1, done: true, errors: [] });
    await shortPage.close();

    const historyPage = await mount(browser, `
      <div id="ans-student-0" class="question-content correct-wrong">
        <div class="question-header">C\u00e2u 1 | #9001</div>
        <div class="question-options-list">
          <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">Option A</div></div>
          <div class="question-option bg-wrong"><span class="question-option-label">B</span><div class="question-option-content">Option B</div></div>
          <div class="question-option"><span class="question-option-label">C</span><div class="question-option-content">Option C</div></div>
          <div class="question-option bg-correct"><span class="question-option-label">D</span><div class="question-option-content">Semantic answer</div><div class="text-answered text-green d-block">Correct</div></div>
        </div>
      </div>
      <div id="ans-student-1" class="question-content correct-wrong">
        <div class="question-header">C\u00e2u 2 | #9002</div>
        <div class="question-child">
          <div class="child-content"><span class="option-char">a) </span><input type="radio" value="true" checked><input type="radio" value="false"><div class="check correct"></div></div>
          <div class="child-content"><span class="option-char">b) </span><input type="radio" value="true" checked><input type="radio" value="false"><div class="check wrong"></div></div>
          <div class="child-content"><span class="option-char">c) </span><input type="radio" value="true"><input type="radio" value="false" checked><div class="check correct"></div></div>
          <div class="child-content"><span class="option-char">d) </span><input type="radio" value="true"><input type="radio" value="false"><div class="check"></div></div>
        </div>
        <div class="hint-content"><strong>\u0110\u00fang</strong><strong>Sai</strong><strong>Sai</strong><strong>\u0110\u00fang</strong></div>
      </div>
      <div id="ans-student-2" class="question-content correct-wrong">
        <div class="question-header">C\u00e2u 3 | #9003</div>
        <div class="question-name">Điền đáp án thích hợp vào ô trống</div>
        <div class="answer-input">Đáp án: <input type="text" value="1,44"></div>
        <div class="hint-content">Giải đáp câu trả lời ngắn.</div>
      </div>
      <div id="ans-student-3" class="question-content correct-wrong">
        <div class="question-header">C\u00e2u 4 | #9004</div>
        <div class="student-answer">Đáp án: −2,5</div>
        <div class="hint-content">Giải đáp câu trả lời ngắn.</div>
      </div>
      <div id="ans-student-4" class="question-content correct-wrong">
        <div class="question-header">C\u00e2u 5 | #9005</div>
        <div class="student-answer">Đáp án: 0,03</div>
        <div class="hint-content">Giải đáp câu trả lời ngắn.</div>
      </div>`);
    const historyResult = await send(historyPage, { action: 'OL_GET_HISTORY_ANSWERS' });
    assert.equal(historyResult.ok, true);
    assert.equal(historyResult.count, 5);
    assert.ok(historyResult.answers[0].math_content.answer.segments.length);
    assert.deepEqual(historyResult.answers.map(({ math_content, ...answer }) => answer), [
      { cau: 1, id: '9001', loai: 'MCQ', dap_an: 'D', noi_dung_dap_an: 'Semantic answer' },
      { cau: 2, id: '9002', loai: 'TF', dap_an: { a: '\u0110\u00fang', b: 'Sai', c: 'Sai', d: '\u0110\u00fang' } },
      { cau: 3, id: '9003', loai: 'SHORT', dap_an: '1,44', noi_dung_cau_hoi: 'Điền đáp án thích hợp vào ô trống' },
      { cau: 4, id: '9004', loai: 'SHORT', dap_an: '-2,5' },
      { cau: 5, id: '9005', loai: 'SHORT', dap_an: '0,03' }
    ]);
    assert.deepEqual(JSON.parse(historyResult.json), historyResult.answers);
    await historyPage.close();

    const apiPage = await mount(browser, '<main>API fixture</main>');
    const fullPayload = {
      questions: [
        {
          typeData: 0,
          dataStandard: {
            stepIndex: 0,
            stepId: 'step-1',
            numberQuestion: 1001,
            typeAnswer: 0,
            currentLang: 'vi',
            content: '<p>Câu API trực tiếp</p>',
            languagesData: {
              vi: {
                content: '<p>Câu API trực tiếp</p><img alt="Đồ thị" src="data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlDkAAAAASUVORK5CYII=">',
                options: [
                  { idOption: 0, content: '<p>x < 2</p>' },
                  { idOption: 1, content: '<p>Đáp án B</p>' }
                ]
              }
            },
            options: []
          }
        },
        {
          typeData: 0,
          dataStandard: {
            stepIndex: 1,
            stepId: 'step-2',
            numberQuestion: 1002,
            typeAnswer: 1,
            currentLang: 'vi',
            content: '',
            languagesData: {
              vi: {
                content: '<p>Chọn đúng hoặc sai</p>',
                options: [
                  { idOption: 0, content: '<p>Nhận định a</p>' },
                  { idOption: 1, content: '<p>Nhận định b</p>' }
                ]
              }
            },
            options: []
          }
        },
        {
          typeData: 1,
          dataMaterial: {
            contentHtml: '<p>Đoạn tư liệu chung</p>',
            datas: [{
              stepIndex: 2,
              stepId: 'step-3',
              numberQuestion: 1003,
              typeAnswer: 0,
              content: '<p>Câu hỏi học liệu</p>',
              options: [
                { idOption: 0, content: '<p>Lựa chọn thứ nhất</p>' },
                { idOption: 1, content: '<p>Lựa chọn thứ hai</p>' }
              ]
            }]
          }
        }
      ]
    };
    await apiPage.evaluate(payload => {
      window.postMessage({ type: 'ONLUYEN_RAW_TEST_DATA', payload }, '*');
    }, fullPayload);
    await apiPage.waitForFunction(() => window.__ONLUYEN_RAW_DATA__?.questions?.length === 3);

    await apiPage.evaluate(() => {
      window.postMessage({
        type: 'ONLUYEN_RAW_TEST_DATA',
        payload: {
          questions: [
            { typeData: 0, dataStandard: {} },
            { typeData: 0, dataStandard: {} },
            { typeData: 1, dataMaterial: {} }
          ]
        }
      }, '*');
    });
    const apiExam = await send(apiPage, { action: 'OL_GET_EXAM' });
    assert.equal(apiExam.count, 3);
    assert.equal(apiExam.questions[0].prompt, 'Câu API trực tiếp');
    assert.deepEqual(apiExam.questions[0].choices.map(choice => choice.text), ['x < 2', 'Đáp án B']);
    assert.equal(apiExam.questions[1].answerType, 'TF');
    assert.deepEqual(apiExam.questions[1].choices.map(choice => choice.label), ['a', 'b']);
    assert.match(apiExam.questions[2].prompt, /\[Đoạn tư liệu: Đoạn tư liệu chung\]\nCâu hỏi học liệu/);
    const apiPrompt = await send(apiPage, { action: 'OL_GET_AI_PROMPT' });
    assert.match(apiPrompt.prompt, /Câu API trực tiếp/);
    assert.match(apiPrompt.prompt, /Loại câu hỏi: Đúng\/Sai cho từng ý\./);
    assert.match(apiPrompt.prompt, /Câu hỏi học liệu/);
    assert.equal(apiPrompt.imageCount, 1);
    assert.equal(apiPrompt.images[0].filename, 'Onluyen-Prompt/cau-01-anh-01.png');
    assert.match(apiPrompt.prompt, /cau-01-anh-01\.png/);

    await apiPage.evaluate(() => {
      window.__storageFixture = {
        onluyen_paid_keys: ['AQ.test-auth-key'],
        onluyen_free_keys: [],
        onluyen_key_states: {}
      };
      window.fetch = async (url, options) => {
        window.__geminiRequest = { url: String(url), headers: options.headers };
        window.__geminiRequestBody = JSON.parse(options.body);
        return {
          ok: true,
          async json() {
            return {
              candidates: [{ content: { parts: [{ text: JSON.stringify([
                { cau: 1, loai: 'MCQ', dap_an: 'A' },
                { cau: 2, loai: 'TF', dap_an: { a: 'Đúng', b: 'Sai' } },
                { cau: 3, loai: 'MCQ', dap_an: 'A' }
              ]) }] } }]
            };
          }
        };
      };
    });
    const apiSolve = await send(apiPage, { action: 'OL_CALL_AI_SOLVE' });
    assert.equal(apiSolve.ok, true);
    assert.equal(apiSolve.imageCount, 1);
    const { math_content: mcqMathContent, ...mcqSolved } = apiSolve.answers[0];
    assert.ok(mcqMathContent.answer.segments.length);
    assert.deepEqual(mcqSolved, {
      cau: 1,
      id: '1001',
      loai: 'MCQ',
      noi_dung_cau_hoi: 'Câu API trực tiếp',
      dap_an: 'A',
      noi_dung_dap_an: 'x < 2',
      id_dap_an: 0
    });
    const { math_content: tfMathContent, ...tfSolved } = apiSolve.answers[1];
    assert.ok(tfMathContent.statements.a.segments.length);
    assert.deepEqual(tfSolved, {
      cau: 2,
      id: '1002',
      loai: 'TF',
      noi_dung_cau_hoi: 'Chọn đúng hoặc sai',
      dap_an: { a: 'Đúng', b: 'Sai' },
      noi_dung_cac_y: { a: 'Nhận định a', b: 'Nhận định b' },
      id_cac_y: { a: 0, b: 1 }
    });
    assert.deepEqual(JSON.parse(apiSolve.json), apiSolve.answers);
    const geminiParts = await apiPage.evaluate(() => window.__geminiRequestBody.contents[0].parts);
    assert.equal(geminiParts.filter(part => part.inlineData).length, 1);
    assert.equal(geminiParts.find(part => part.inlineData).inlineData.mimeType, 'image/png');
    const geminiRequest = await apiPage.evaluate(() => window.__geminiRequest);
    assert.equal(geminiRequest.url.includes('?key='), false);
    assert.equal(geminiRequest.headers['x-goog-api-key'], 'AQ.test-auth-key');

    const shuffledPayload = structuredClone(fullPayload);
    shuffledPayload.questions = [
      shuffledPayload.questions[1],
      shuffledPayload.questions[2],
      shuffledPayload.questions[0]
    ];
    shuffledPayload.questions[0].dataStandard.stepIndex = 0;
    shuffledPayload.questions[0].dataStandard.languagesData.vi.options.reverse();
    shuffledPayload.questions[1].dataMaterial.datas[0].stepIndex = 1;
    shuffledPayload.questions[2].dataStandard.stepIndex = 2;
    shuffledPayload.questions[2].dataStandard.languagesData.vi.options.reverse();
    await apiPage.evaluate(payload => {
      window.postMessage({ type: 'ONLUYEN_RAW_TEST_DATA', payload }, '*');
    }, shuffledPayload);
    await apiPage.waitForFunction(() => window.__ONLUYEN_RAW_DATA__?.questions?.[0]?.dataStandard?.numberQuestion === 1002);
    const shuffledLoad = await send(apiPage, { action: 'OL_LOAD_DATABASE', json: apiSolve.json });
    assert.equal(shuffledLoad.ok, true);
    const mcqAfterShuffle = shuffledLoad.answers.find(answer => answer.id === '1001');
    const tfAfterShuffle = shuffledLoad.answers.find(answer => answer.id === '1002');
    assert.equal(mcqAfterShuffle.cau, 3);
    assert.equal(mcqAfterShuffle.dap_an, 'B');
    assert.equal(mcqAfterShuffle.noi_dung_dap_an, 'x < 2');
    assert.equal(tfAfterShuffle.cau, 1);
    assert.deepEqual(tfAfterShuffle.dap_an, { a: 'Sai', b: 'Đúng' });
    await apiPage.close();

    console.log('OK: DOM, API, Practices, History answers, and verified page-transition fixtures passed!');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
