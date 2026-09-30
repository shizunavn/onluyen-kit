const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const puppeteer = require('puppeteer');
const {
  comparable,
  keysAndModelsFromGeminiConfig,
  parseJsonArray,
  parseApiQuestions,
  buildPrompt,
  getQuestions,
  geminiImageParts,
  validateAndEnrichAnswers,
  matchBankAnswers,
  enterTest,
  login,
  testIdFromUrl,
  historyUrlForTest,
  inspectTestStatus,
  extractHistoryAnswersFromPage
} = require('../cli/bulk-runner');

assert.equal(comparable(' Trao đổi. '), comparable('trao   đổi'));
assert.equal(comparable('10-2 pm.'), comparable('10−2 pm.'));
assert.notEqual(comparable('10-2 pm.'), comparable('10² pm.'));
assert.equal(
  comparable('$ A\\cup B=\\left\\{ 2;4;7;8;9;12 \\right\\} $'),
  comparable('A ∪ B = {2;4;7;8;9;12}')
);
assert.equal(comparable('\\left( 2;11 \\right)'), comparable('(2;11)'));
assert.equal(
  comparable('(1) \\(A=\\left\\lbrace x\\in\\mathbb{N}|x\\space chia\\space hết\\space cho\\space3\\space và\\space3\\le x\\le12\\right\\rbrace\\).'),
  comparable('(1) A={x∈ℕ|x chia hết cho 3 và 3≤x≤12}')
);
assert.notEqual(comparable('(2;11)'), comparable('[2;11)'));
assert.notEqual(comparable('x < 2'), comparable('x > 2'));
assert.deepEqual(parseJsonArray('```json\n[{"cau":1,"dap_an":"A"}]\n```'), [{ cau: 1, dap_an: 'A' }]);
assert.equal(testIdFromUrl('https://app.onluyen.vn/school/test/6aa4b2bb490a3ba3d2477f7e'), '6aa4b2bb490a3ba3d2477f7e');
assert.equal(
  historyUrlForTest('https://app.onluyen.vn/school/test/6aa4b2bb490a3ba3d2477f7e'),
  'https://app.onluyen.vn/school/test/history/6aa4b2bb490a3ba3d2477f7e'
);
assert.deepEqual(keysAndModelsFromGeminiConfig({
  geminiApiKeys: [' key-a ', 'AQ.auth-key', 'key-a'],
  geminiApiKey: 'key-c',
  models: { primary: 'gemini-primary', fallback1: 'not-gemini', fallback2: 'gemini-fallback' }
}), {
  keys: ['key-a', 'AQ.auth-key', 'key-c'],
  models: ['gemini-primary', 'gemini-fallback']
});

const questions = parseApiQuestions([
  {
    dataStandard: {
      stepIndex: 0,
      numberQuestion: 12475737,
      typeAnswer: 0,
      currentLang: 'vi',
      languagesData: {
        vi: {
          content: '<p>Hoạt động đưa sản phẩm đến tay người tiêu dùng được gọi là</p>',
          options: [
            { content: '<p>trao đổi.</p>' },
            { content: '<p>phân phối.</p>' },
            { content: '<p>điều tiết.</p>' },
            { content: '<p>tiêu thụ.</p>' }
          ]
        }
      }
    }
  }
]);

assert.equal(questions.length, 1);
assert.equal(questions[0].sourceId, '12475737');
assert.equal(questions[0].choices[0].text, 'trao đổi.');
const romanQuestions = parseApiQuestions([{ dataStandard: {
  stepIndex: 2, numberQuestion: 13537524, typeAnswer: 0,
  languagesData: { vi: {
    content: 'Một gói lưu trữ có dung lượng không vượt quá $50{\\rm GB}$.',
    options: ['$x+y<0$', '$x-y\\le50$', '$x+y\\ge50$', '$x+y\\le50$'].map((content, index) => ({ idOption: index, content }))
  } }
} }]);
assert.match(buildPrompt(romanQuestions), /50GB/);
const localizedEnglishQuestions = parseApiQuestions([{ dataStandard: {
  numberQuestion: 13257730, stepIndex: 0, typeAnswer: 0, currentLang: 'en',
  languagesData: { en: { content: 'Choose the best arrangement.' } },
  options: ['d-b-c-a-e', 'c-a-d-b-e', 'b-c-d-a-e', 'a-d-b-c-e'].map((content, idOption) => ({ idOption, languagesData: { en: { content } } }))
} }]);
assert.equal(localizedEnglishQuestions[0].choices.length, 4);
assert.match(buildPrompt(localizedEnglishQuestions), /B\. c-a-d-b-e/);
assert.equal(matchBankAnswers(localizedEnglishQuestions, [{ cau: 7, id: '13257730', dap_an: 'D', noi_dung_dap_an: 'c - a - d - b - e' }]).matched[0].dap_an, 'B');
assert.throws(() => buildPrompt([{ number: 1, answerType: 'MCQ', choices: [], prompt: 'Text without choices.' }]), /thiếu phương án/);
const numberedQuestion = require('./math-cases').numberedQuestion;
const numberedShortQuestion = parseApiQuestions([{ dataStandard: {
  stepIndex: 22, numberQuestion: 9023, typeAnswer: 2,
  languagesData: { vi: { content: numberedQuestion.html } }
} }]);
assert.equal(numberedShortQuestion[0].answerType, 'SHORT');
const numberedShortPrompt = buildPrompt(numberedShortQuestion);
assert.match(numberedShortPrompt, /mệnh đề chứa biến/);
assert.match(numberedShortPrompt, /1\) 2x\+1/);
assert.match(numberedShortPrompt, /6\) 2x-1≤7/);
const imageQuestions = parseApiQuestions([{ dataStandard: {
  stepIndex: 0, numberQuestion: 12905197, typeAnswer: 0,
  languagesData: { vi: { content: '<p>Chọn hình miền nghiệm.</p>', options: [
    { idOption: 'image-a', content: '<img src="https://example.test/a.png">' },
    { idOption: 'image-b', content: '<img src="data:image/png;base64,iVBORw0KGgo=">' }
  ] } }
} }]);
assert.equal(imageQuestions[0].choices.length, 2);
assert.match(buildPrompt(imageQuestions), /phương án B/);
assert.match(buildPrompt(imageQuestions), /anh_dap_an/);
const imageAnswer = validateAndEnrichAnswers([{ cau: 1, loai: 'MCQ', dap_an: 'A', anh_dap_an: ['data:image/png;base64,iVBORw0KGgo='] }], imageQuestions)[0];
assert.equal(imageAnswer.dap_an, 'B');
assert.equal(imageAnswer.id_dap_an, 'image-b');
assert.deepEqual(imageAnswer.anh_dap_an, ['data:image/png;base64,iVBORw0KGgo=']);
const reorderedImages = [{ ...imageQuestions[0], choices: imageQuestions[0].choices.slice().reverse().map((choice, index) => ({ ...choice, label: String.fromCharCode(65 + index) })) }];
const matchedImageAnswer = matchBankAnswers(reorderedImages, [imageAnswer]);
assert.equal(matchedImageAnswer.missing.length, 0);
assert.equal(matchedImageAnswer.matched[0].dap_an, 'A');
assert.throws(() => validateAndEnrichAnswers([{ cau: 1, dap_an: 'B', id_dap_an: 'image-a', anh_dap_an: imageAnswer.anh_dap_an }], imageQuestions), /mâu thuẫn/);

const oldHistory = [{
  cau: 1,
  id: '12475737',
  loai: 'MCQ',
  dap_an: 'D',
  noi_dung_dap_an: 'trao đổi.'
}];
const bankMatch = matchBankAnswers(questions, oldHistory);
assert.equal(bankMatch.missing.length, 0);
assert.equal(bankMatch.matched[0].dap_an, 'A');
assert.equal(bankMatch.matched[0].noi_dung_dap_an, 'trao đổi.');

const enriched = validateAndEnrichAnswers([{ cau: 1, loai: 'MCQ', dap_an: 'B' }], questions);
assert.deepEqual(enriched[0], {
  cau: 1,
  id: '12475737',
  loai: 'MCQ',
  dap_an: 'B',
  noi_dung_dap_an: 'phân phối.',
  math_content: { version: 1, question: questions[0].math_content.question, answer: questions[0].choices[1].math_content },
  noi_dung_cau_hoi: 'Hoạt động đưa sản phẩm đến tay người tiêu dùng được gọi là'
});

const shortQuestions = parseApiQuestions([{
  dataStandard: {
    stepIndex: 0,
    numberQuestion: 13123314,
    typeAnswer: 2,
    languagesData: { vi: { content: '<p>Có bao nhiêu mệnh đề sai?</p>', options: [] } }
  }
}]);
assert.equal(shortQuestions[0].answerType, 'SHORT');
assert.deepEqual(validateAndEnrichAnswers(
  [{ cau: 1, loai: 'SHORT', dap_an: '-2,5' }],
  shortQuestions
), [{
  cau: 1,
  id: '13123314',
  loai: 'SHORT',
  dap_an: '-2,5',
  noi_dung_cau_hoi: 'Có bao nhiêu mệnh đề sai?'
}]);

const shuffledByPrompt = matchBankAnswers([{ ...questions[0], number: 7, sourceId: null }], [{
  cau: 1,
  loai: 'MCQ',
  dap_an: 'D',
  noi_dung_cau_hoi: questions[0].prompt,
  noi_dung_dap_an: 'trao đổi.'
}]);
assert.equal(shuffledByPrompt.missing.length, 0);
assert.equal(shuffledByPrompt.matched[0].cau, 7);
assert.equal(shuffledByPrompt.matched[0].dap_an, 'A');

const shuffledTf = matchBankAnswers([{
  number: 3,
  sourceId: 'tf-1',
  answerType: 'TF',
  prompt: 'Hai nhận định',
  choices: [
    { label: 'a', text: 'Nhận định thứ hai', idOption: 22 },
    { label: 'b', text: 'Nhận định thứ nhất', idOption: 11 }
  ]
}], [{
  cau: 1,
  id: 'tf-1',
  loai: 'TF',
  dap_an: { a: 'Đúng', b: 'Sai' },
  noi_dung_cac_y: { a: 'Nhận định thứ nhất', b: 'Nhận định thứ hai' }
}]);
assert.deepEqual(shuffledTf.matched[0].dap_an, { a: 'Sai', b: 'Đúng' });
assert.deepEqual(shuffledTf.matched[0].noi_dung_cac_y, {
  a: 'Nhận định thứ hai',
  b: 'Nhận định thứ nhất'
});

(async () => {
  const executablePath = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].find(file => fs.existsSync(file));
  assert.ok(executablePath, 'Không tìm thấy Chrome hoặc Edge cho CLI test');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  const cliImagePayload = await geminiImageParts([{
    number: 7,
    images: [{
      src: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlDkAAAAASUVORK5CYII='
    }]
  }]);
  assert.equal(cliImagePayload.failures.length, 0);
  assert.equal(cliImagePayload.imageCount, 1);
  assert.equal(cliImagePayload.parts.find(part => part.inlineData).inlineData.mimeType, 'image/png');
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url.startsWith('/login')) {
      response.end('<form method="post" action="/home"><input type="text"><input type="text" placeholder="Tên đăng nhập hoặc số điện thoại"><input type="password" name="password"><button>Đăng nhập</button></form>');
      return;
    }
    if (request.url.startsWith('/school/test/history/test-1')) {
      response.end([
        '<div id="ans-student-0"><div class="question-header">Câu 1 | #9001</div><div class="question-option bg-correct"><span class="question-option-label">A</span><div class="question-option-content">trao đổi.</div></div></div>',
        '<div id="ans-student-1"><div class="question-header">Câu 2 | #9002</div><div class="question-name">Điền đáp án thích hợp</div><div class="answer-input">Đáp án: <input type="text" value="0,03"></div><div class="hint-content">Giải đáp.</div></div>'
      ].join(''));
      return;
    }
    response.end('<main id="home">Đã đăng nhập</main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const page = await browser.newPage();
    const port = server.address().port;
    await page.goto(`http://127.0.0.1:${port}/login`);
    await login(page, { username: 'student', password: 'secret' });
    assert.match(page.url(), /\/home$/, 'CLI không chịu được navigation làm hủy execution context lúc đăng nhập');

    const historyAnswers = await extractHistoryAnswersFromPage(page, `http://127.0.0.1:${port}/school/test/history/test-1`);
    assert.ok(historyAnswers[0].math_content.answer.segments.length);
    assert.deepEqual(historyAnswers.map(({ math_content, ...answer }) => answer), [
      { cau: 1, id: '9001', loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: 'trao đổi.' },
      { cau: 2, id: '9002', loai: 'SHORT', dap_an: '0,03', noi_dung_cau_hoi: 'Điền đáp án thích hợp' }
    ]);

    await page.setContent('<div class="page-scroll">Bài tập đã được hoàn thành.\nĐiểm số\n10\nChi tiết</div>');
    assert.deepEqual(await inspectTestStatus(page), { completed: true, score: 10 });

    await page.setContent('<div class="btn-test info">Tiếp tục</div>');
    await page.evaluate(() => {
      document.querySelector('.btn-test').addEventListener('click', () => {
        document.body.innerHTML = '<div id="test-step-question"><div class="question-container">Ready</div></div>';
      });
    });
    await enterTest(page);
    assert.ok(await page.$('#test-step-question'), 'CLI không mở được bài từ thẻ div.btn-test');

    await page.setContent(`
      <div class="answer-sheet"><div class="option">1</div><div class="option">2</div></div>
      <div id="test-step-question"><div class="question-container">
        <div class="question-info"><div class="num">Câu: 1 <span>#101</span></div></div>
        <div class="question-name">Question 1</div>
        <div class="question-option"><span class="question-option-label">A</span><div class="question-option-content">One A</div></div>
        <div class="question-option"><span class="question-option-label">B</span><div class="question-option-content">One B</div></div>
      </div></div>`);
    await page.evaluate(() => {
      window.__ONLUYEN_CACHED_QUESTIONS__ = [{
        dataStandard: {
          stepIndex: 0,
          numberQuestion: 101,
          typeAnswer: 0,
          languagesData: { vi: { content: 'Question 1', options: [{ content: 'One A' }, { content: 'One B' }] } }
        }
      }];
      const render = number => {
        document.querySelector('.question-info .num').innerHTML = `Câu: ${number} <span>#10${number}</span>`;
        document.querySelector('.question-name').textContent = `Question ${number}`;
        document.querySelectorAll('.question-option-content')[0].textContent = number === 1 ? 'One A' : 'Two A';
        document.querySelectorAll('.question-option-content')[1].textContent = number === 1 ? 'One B' : 'Two B';
      };
      document.querySelectorAll('.answer-sheet .option').forEach((option, index) => {
        option.addEventListener('click', () => render(index + 1));
      });
    });
    const lazyQuestions = await getQuestions(page);
    assert.equal(lazyQuestions.length, 2, 'CLI phải bỏ qua API chưa đủ và đọc từng câu trong phiếu trả lời');
    assert.deepEqual(lazyQuestions.map(question => question.sourceId), ['101', '102']);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('OK: CLI login, History mapping, score checks, caching inputs, and /school/test landing entry passed!');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
