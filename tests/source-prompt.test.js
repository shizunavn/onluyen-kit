const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const math = require('../math-content');
const cli = require('../cli/bulk-runner');

// Real pasted question #13050131. Only the PNG payload is shortened in the
// fixture; expand it here so the regression exceeds the old 256 KiB HTML cap.
const antennaHtml = fs.readFileSync(path.join(__dirname, 'fixtures/antenna-base64-question.html'), 'utf8');
const antennaLarge = antennaHtml.replace('iVBORw0KGgo=', 'A'.repeat(265700));
const antennaPrompt = math.toPromptContent(antennaHtml);
// The response mirror is nested in the real question HTML. Filling it must
// change neither prompt content nor source identity; the static unit remains.
const filledAntenna = antennaHtml.replace('class="ans-span-second"></span>',
  'class="ans-span-second"><mjx-container data-latex="2027"></mjx-container></span>')
  .replace('autocomplete="off"', 'autocomplete="off" value="2027"') + '<button>TRẢ LỜI</button><textarea>2027</textarea>';
assert.deepEqual(math.toPromptContent(filledAntenna), antennaPrompt);
assert.equal(math.sourceFingerprint(filledAntenna), math.sourceFingerprint(antennaHtml));
assert.ok(antennaPrompt.segments.some(s => s.format === 'mathml' && s.raw.includes('<mi>m</mi>')), 'The response unit is question source');
assert.notEqual(math.sourceFingerprint(filledAntenna.replace('<mi>m</mi>', '<mi>c</mi><mi>m</mi>')), math.sourceFingerprint(antennaHtml));
assert.notEqual(math.sourceFingerprint(filledAntenna.replace('Chiều cao', 'Chiều rộng')), math.sourceFingerprint(antennaHtml));
const unknownMirror = antennaHtml.replace('class="ans-span-second"></span>', 'class="ans-span-second"><mjx-container><svg></svg></mjx-container></span>');
assert.deepEqual(math.toPromptContent(unknownMirror), antennaPrompt, 'An unrendered response mirror is not an unrendered question');
assert.ok(antennaLarge.length > 262144);
assert.equal(antennaPrompt.ok, true);
assert.deepEqual(math.toPromptContent(antennaLarge), antennaPrompt, 'Media bytes never consume the text/math budget');
assert.equal(math.sourceFingerprint(antennaLarge), math.sourceFingerprint(antennaHtml));
assert.match(antennaPrompt.text, /Trên nóc một tòa nhà/);
assert.match(antennaPrompt.text, /Chiều cao của tòa nhà/);
for (const number of ['5', '7', '50', '40']) assert.ok(antennaPrompt.text.includes(number));
assert.doesNotMatch(antennaPrompt.text, /data:image|<svg|<path/);
assert.ok(antennaPrompt.segments.some(s => s.format === 'mathml' && s.raw.includes('<mn>50</mn>')));
assert.deepEqual(math.toPromptContent(JSON.parse(JSON.stringify(math.metadata(antennaLarge)))), antennaPrompt);
const multipleMedia = `<div>${antennaLarge}<img src="data:image/png;base64,${'B'.repeat(600000)}"><svg><svg><path d="${'M1 2 '.repeat(60000)}"/></svg></svg></div>`;
assert.deepEqual(math.toPromptContent(multipleMedia), antennaPrompt, 'Multiple large images and nested SVGs do not erase any source');
assert.equal(math.toPromptContent(`<div>${'word '.repeat(60000)}</div>`).ok, false, 'Real oversized prose remains bounded');
assert.equal(math.toPromptContent(`<math><mtext>${'x'.repeat(270000)}</mtext></math>`).ok, false, 'Real oversized MathML remains bounded');
assert.equal(math.toPromptContent(`<mjx-container><svg><text>${'x'.repeat(300000)}</text></svg></mjx-container>`).ok, false, 'Large SVG without accessible source is still incomplete');
const sourceWithMedia = `<div title="a > b"><style>${'a{}'.repeat(100000)}</style><script>${'var x=1;'.repeat(40000)}</script><mjx-container data-latex="x^2"></mjx-container><script type="math/tex">y^2</script></div>`;
assert.ok(math.toPromptContent(sourceWithMedia).text.includes('x^2'));
assert.ok(math.toPromptContent(sourceWithMedia).text.includes('y^2'));
const antennaQuestions = cli.parseApiQuestions([{ dataStandard: { numberQuestion:13050131, stepIndex:5, typeAnswer:2,
  languagesData:{vi:{content:antennaLarge}} } }]);
assert.equal(antennaQuestions[0].images.length, 1);
assert.ok(antennaQuestions[0].images[0].src.length > 265700, 'Image API retains the full original image source');
const antennaCliPrompt = cli.buildPrompt(antennaQuestions);
assert.match(antennaCliPrompt, /13050131/);
assert.match(antennaCliPrompt, /Trên nóc một tòa nhà/);
assert.ok(antennaCliPrompt.includes('50°'));
assert.doesNotMatch(antennaCliPrompt, /A{1000}|<svg|<path/);

const degreeHtml = fs.readFileSync(path.join(__dirname, 'fixtures/triangle-degrees-question.html'), 'utf8');
const degreeSources = [...degreeHtml.matchAll(/<math\b[\s\S]*?<\/math>/g)].slice(-4).map(m => m[0]);
const degreeQuestions = cli.parseApiQuestions([{dataStandard:{numberQuestion:12905060,stepIndex:20,typeAnswer:0,
  languagesData:{vi:{content:'Cho tam giác ABC có góc B tù; tính góc A.',
    options:degreeSources.map((content,i)=>({idOption:String(i),content}))}}}}]);
const degreeSnapshot = {id:'degree-snapshot',signature:math.signature(degreeQuestions),questions:degreeQuestions};
const degreeCliPrompt = cli.buildPrompt(degreeQuestions,degreeSnapshot);
assert.ok(degreeCliPrompt.includes('60°'));
const degreeEntry = {cau:21,id:'12905060',snapshot_id:degreeSnapshot.id,loai:'MCQ',dap_an:'C',noi_dung_dap_an:'60°.'};
const degreeSaved = cli.validateAndEnrichAnswers([degreeEntry],degreeQuestions);
assert.equal(degreeSaved[0].dap_an,'C');
assert.equal(degreeSaved[0].noi_dung_dap_an,'60°.');
assert.ok(degreeSaved[0].math_content.answer.segments[0].raw.includes('<msup>'));
assert.equal(cli.validateAndEnrichAnswers(JSON.parse(JSON.stringify(degreeSaved)),degreeQuestions)[0].dap_an,'C');
assert.throws(()=>cli.validateAndEnrichAnswers([{...degreeEntry,noi_dung_dap_an:'80°.'}],degreeQuestions),error=>
  error.report.issues.some(issue=>issue.code==='ID_CONFLICT'&&issue.diagnostic.choiceLabel==='C'&&issue.diagnostic.rightText==='60'));

// Deliberately outside the parser's grammar. These are sources, not flattened text.
const unknown = '<math><menclose notation="circle"><mi>x</mi></menclose></math>';
const other = '<math><menclose notation="circle"><mi>y</mi></menclose></math>';
const latex = String.raw`\overbrace{x+y}`;
const content = `<div>Tư liệu &amp; ghi chú<br>1) ${unknown}<br>2) $${latex}$<br>Phần kết.</div>`;
const question = { number: 1, sourceId: 'source-1', answerType: 'MCQ', origin: 'dom',
  prompt: content, choices: [{ label: 'A', idOption: 'a', text: unknown }, { label: 'B', idOption: 'b', text: 'x+1' }] };
const snapshot = { id: 'source-token', signature: math.signature([question]), questions: [question] };
const options = { snapshotId: snapshot.id, snapshotSignature: snapshot.signature };
const entry = { cau: 1, id: 'source-1', loai: 'MCQ', dap_an: 'A', snapshot_id: snapshot.id };
const corpus = [content, unknown, other, `$${latex}$`,
  '<math><mfrac><mn>1</mn><mfrac><mi>x</mi><mi>y</mi></mfrac></mfrac></math>',
  '<math><mrow><mn>1</mn><mn>2</mn></mrow></math>',
  '<mjx-container><svg><text>x</text></svg></mjx-container>', antennaLarge, multipleMedia, sourceWithMedia];
corpus.push(`Texte ${unknown}`, `<div>\nTexte&nbsp;${unknown}\n</div>`);
corpus.push(antennaHtml, filledAntenna, unknownMirror);
const results = corpus.map(value => ({ prompt: math.toPromptContent(value), fingerprint: math.sourceFingerprint(value) }));
const formatted = results[0].prompt;
assert.equal(formatted.ok, true);
assert.match(formatted.text, /Tư liệu & ghi chú\n1\)/);
assert.ok(formatted.text.includes(unknown));
assert.ok(formatted.text.includes(latex));
assert.ok(formatted.text.indexOf('1)') < formatted.text.indexOf('2)'));
assert.match(formatted.text, /Phần kết/);
assert.doesNotMatch(formatted.text, /<div|<svg|chưa hỗ trợ/i);
assert.ok(formatted.diagnostics.length >= 2);
assert.equal(math.compare(unknown, unknown).status, 'unsupported');
assert.notEqual(math.sourceFingerprint(unknown), math.sourceFingerprint(other));
assert.equal(math.sourceFingerprint(`Texte ${unknown}`),math.sourceFingerprint(`<div>\nTexte&nbsp;${unknown}\n</div>`),
  'Unsupported math keeps its raw source while surrounding prose ignores renderer whitespace');
assert.notEqual(math.sourceFingerprint(`Texte ${unknown}`),math.sourceFingerprint(`Texte. ${unknown}`), 'Interior punctuation stays significant');
assert.notEqual(math.sourceFingerprint(`Texte ${unknown}`),math.sourceFingerprint(`<div>Texte ${other}</div>`));
assert.deepEqual(math.toPromptContent(JSON.parse(JSON.stringify(math.metadata(content)))), formatted);
assert.equal(results[6].prompt.ok, false, 'Unrendered SVG is not a source');
assert.ok(!results[5].prompt.text.includes('12'), 'Separate number nodes never become 12');
assert.equal(math.validateExam([question], [entry], options).mappings[0].verification.basis, 'snapshot');
assert.equal(math.validateExam([question], [{ ...entry, snapshot_id: 'expired' }], options).ok, false);
assert.equal(math.validateExam([question], [{ ...entry, noi_dung_dap_an: 'y+1' }], options).ok, false);
const raw = math.validateExam([question], [{ ...entry, snapshot_id: undefined, noi_dung_dap_an: unknown }]);
assert.equal(raw.ok, true);
assert.equal(raw.mappings[0].verification.evidence, 'exact_source');
const validId = math.validateExam([question], [{ ...entry, snapshot_id: undefined, dap_an: 'A', id_dap_an: 'b', noi_dung_dap_an: 'x+1' }]);
assert.equal(validId.ok, true, 'Unrelated unsupported choice does not block a valid ID');
assert.equal(validId.mappings[0].verification.basis, 'structured');
const validPositionWithContent = math.validateExam([question], [{ ...entry, dap_an: 'B', noi_dung_dap_an: '$x+1$' }], options);
assert.equal(validPositionWithContent.ok, true, 'Unrelated unsupported choice cannot veto current snapshot identity plus equal content');
assert.equal(validPositionWithContent.mappings[0].verification.basis, 'snapshot');
const duplicate = { ...question, choices: [question.choices[0], { ...question.choices[0], label: 'B', idOption: 'b' }] };
assert.equal(math.validateExam([duplicate], [{ ...entry, noi_dung_dap_an: unknown }]).ok, false);
assert.equal(math.validateExam([{ ...question, choices: [{ ...question.choices[0], text: other }, question.choices[1]] }], [entry], options).ok, false);
const tf = { ...question, answerType: 'TF', choices: question.choices.map((c, i) => ({ ...c, label: i ? 'b' : 'a' })) };
const tfEntry = { id: tf.sourceId, loai: 'TF', dap_an: { a: 'Đúng', b: 'Sai' }, math_content: { version: 1, statements: { a: math.metadata(unknown), b: math.metadata('x+1') } } };
assert.equal(math.validateExam([tf], [tfEntry]).mappings[0].verification.basis, 'snapshot');
const shuffledTf = { ...tf, choices: [{ ...tf.choices[1], label: 'a' }, { ...tf.choices[0], label: 'b' }] };
assert.deepEqual(math.validateExam([shuffledTf], [tfEntry]).mappings[0].answer, { a: 'Sai', b: 'Đúng' });
const prompt = cli.buildPrompt([question], snapshot);
assert.ok(prompt.includes(unknown));
const materialQuestions = cli.parseApiQuestions([{dataMaterial:{contentHtml:content,datas:[{
  stepIndex:0,numberQuestion:5002,typeAnswer:0,languagesData:{vi:{content:'Câu liên quan tư liệu',
    options:[unknown,other,'x+1','x+2'].map((text,i)=>({idOption:i,content:text}))}}
}]}}]);
assert.equal(materialQuestions[0].choices.length,4);
const materialPrompt = cli.buildPrompt(materialQuestions);
assert.ok(materialPrompt.includes(unknown) && materialPrompt.includes(other) && materialPrompt.includes('Câu liên quan tư liệu'));
const incompleteQuestions = cli.parseApiQuestions([{dataStandard:{stepIndex:0,numberQuestion:5003,typeAnswer:0,
  languagesData:{vi:{content:'Thiếu nguồn một phương án',options:[{content:'x+1'},{content:''}]}}}}]);
assert.equal(incompleteQuestions[0].choices.length,2, 'Do not silently remove an empty choice');
assert.throws(()=>cli.buildPrompt(incompleteQuestions),e=>e.report?.issues.some(i=>i.code==='SCRAPE_INCOMPLETE'));
// WeakMap contexts intentionally belong to the exact collected array.
const questions = [question]; cli.buildPrompt(questions, snapshot);
const saved = cli.validateAndEnrichAnswers([{ ...entry, noi_dung_dap_an: unknown }], questions);
assert.equal(saved[0].noi_dung_dap_an, unknown);
assert.equal(saved[0].verification.basis, 'snapshot');
assert.equal(cli.matchBankAnswers(questions, JSON.parse(JSON.stringify(saved))).matched.length, 1);
const long = 'snapshot_id: shared\n' + [1, 2, 3].map(n => `=== CÂU ${n} ===\n${'x'.repeat(100)}\n`).join('');
const parts = math.splitPrompt(long, 155);
assert.equal(parts.length, 3);
assert.equal(parts.map(p => p.replace('snapshot_id: shared\n', '')).join(''), long.replace('snapshot_id: shared\n', ''));
assert.ok(parts.every(p => p.startsWith('snapshot_id: shared')));
assert.throws(() => math.splitPrompt(long, 50), /vượt giới hạn/);

async function mount(browser) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', r => r.respond({ status: 200, contentType: 'text/html', body: '<html></html>' }));
  await page.goto('https://app.onluyen.vn/school/test/step/source-fixture');
  await page.setContent('<div class="answer-sheet"><button class="option">1</button><button class="option">2</button></div><div id="test-step-question"><div class="question-container"></div></div>');
  await page.evaluate(({ unknown, other }) => {
    document.body.className = 'app header-fixed sidebar-fixed';
    document.body.insertAdjacentHTML('beforeend', '<div class="sidebar-status"><span>15</span><button>50</button></div>');
    window.__store = {}; window.__messages = []; window.__clicks = 0; window.__submits = 0; window.__reads = 0;
    window.__sources = [[unknown, 'x+1'], [other, 'x+2']];
    window.__render = n => {
      const root = document.querySelector('.question-container');
      root.innerHTML = `<div class="question-info"><div class="num">Câu: ${n} #${1000+n}</div></div><div class="question-name">Tư liệu &amp; ghi chú<br>Đề câu ${n} ${unknown}</div>${__sources[n-1].map((s,i)=>`<div class="question-option"><span class="question-option-label">${i?'B':'A'}</span><div class="question-option-content">${s}</div><input type="checkbox"></div>`).join('')}<div class="submit-bar"><button>BỎ QUA</button></div>`;
      root.querySelectorAll('.question-option').forEach(el => el.addEventListener('click', () => {
        __clicks++; root.querySelectorAll('input').forEach(input => input.checked = false); el.querySelector('input').checked = true;
      }));
      root.querySelector('button').onclick = () => { __submits++; if (n === 1) __render(2); else root.querySelector('button').textContent = 'KẾT THÚC'; };
    };
    document.querySelectorAll('.answer-sheet button').forEach(button => button.onclick = () => { __reads++; __render(Number(button.textContent)); });
    __render(1); Element.prototype.scrollIntoView = () => {};
    window.chrome = { runtime: { getURL: () => 'data:text/javascript,', getManifest: () => ({version:'test'}), onMessage: { addListener:f=>window.__listener=f }, sendMessage:async m=>__messages.push(m) }, storage:{local:{get:(_k,cb)=>cb(__store),set:v=>Object.assign(__store,v)}} };
  }, { unknown, other });
  return page;
}
const send = (page, payload) => page.evaluate(p => new Promise(resolve => __CLI_CONTENT_LISTENER__(p, {}, resolve)), payload);
(async () => {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await mount(browser);
    await page.evaluate(unknown=>{
      document.querySelectorAll('.answer-sheet button')[1].addEventListener('click',()=>setTimeout(()=>{
        window.postMessage({type:'ONLUYEN_RAW_TEST_DATA',payload:{questions:[1,2].map(n=>({dataStandard:{
          numberQuestion:1000+n,stepIndex:n-1,typeAnswer:0,languagesData:{vi:{
            content:`Tư liệu &amp; ghi chú<br>Đề câu ${n} ${unknown}`,
            options:__sources[n-1].map((content,i)=>({idOption:i?'b':'a',content}))
          }}
        }}))}},'*');
      },70));
    },unknown);
    const prepared = await cli.prepareExam(page);
    assert.deepEqual(await page.evaluate(values => values.map(value => ({prompt: OnluyenMath.toPromptContent(value),fingerprint: OnluyenMath.sourceFingerprint(value)})), corpus), results);
    assert.equal(prepared.ok, true, prepared.error);
    assert.equal(prepared.questions.length, 2);
    assert.ok(prepared.prompt.includes(unknown) && prepared.prompt.includes(other));
    assert.match(prepared.prompt, /B\. x\+2/);
    const again = await send(page, { action:'OL_GET_AI_PROMPT' });
    assert.ok(again.prompt.includes(prepared.snapshot.id), 'Repeated exports keep the same source snapshot');
    cli.buildPrompt(prepared.questions, {...prepared.snapshot, questions: prepared.questions});
    const answers = cli.validateAndEnrichAnswers(prepared.questions.map(q => ({cau:q.number,id:q.sourceId,loai:'MCQ',dap_an:'A',snapshot_id:prepared.snapshot.id})), prepared.questions);
    const loaded = await send(page, {action:'OL_LOAD_DATABASE',json:answers});
    assert.equal(loaded.ok,true,loaded.error);
    const failed = await send(page,{action:'OL_LOAD_DATABASE',json:answers.map((a,i)=>i?{...a,noi_dung_dap_an:'Wrong final answer'}:a)});
    assert.equal(failed.ok,false);
    assert.deepEqual(await page.evaluate(()=>[__reads,__clicks,__submits]),[2,0,0]);
    assert.equal((await send(page,{action:'OL_PING'})).databaseJson, loaded.json);
    const started = await send(page,{action:'OL_START_BOT'});
    assert.equal(started.ok,true,started.error);
    await page.waitForFunction(()=>!window.__BOT_RUNNING__);
    assert.deepEqual(await page.evaluate(()=>__CLI_RUNTIME_MESSAGES__.filter(m=>m.action==='BOT_ERROR')),[]);
    assert.deepEqual(await page.evaluate(()=>[__reads,__clicks,__submits]),[2,2,2], 'Export/import/start share one full scan; unsupported source can still use its snapshot');
    await page.setContent(`<div id="ans-student-1"><div class="question-header">Câu 1 #5001</div><div class="question-name">History source</div><div class="question-option bg-correct"><span class="question-option-label">A</span><div class="question-option-content">${unknown}</div></div></div>`);
    const history = await send(page, {action:'OL_GET_HISTORY_ANSWERS'});
    assert.equal(history.ok,true,history.error);
    assert.equal(history.answers[0].noi_dung_dap_an,undefined, 'Do not save a MathML display placeholder as supplied answer content');
    assert.ok(history.answers[0].math_content.answer.segments.some(s=>s.raw===unknown));
    const historyQuestion = {...question,sourceId:'5001',prompt:'History source'};
    assert.equal(math.validateExam([historyQuestion],history.answers).ok,true, 'History retains a usable unknown source');
    await page.close();
    console.log('OK: lossless prompt sources, parser diagnostics, identity proofs, raw-source cache, chunking, Node/browser parity and shared snapshot execution');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
