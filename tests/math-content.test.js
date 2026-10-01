const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const math = require('../math-content');
const cases = require('./math-cases');
const prosePrefix = 'nửa mặt phẳng không chứa gốc tọa độ, bờ là đường thẳng ';
const proseSuffix = ' (không bao gồm đường thẳng).';
const fractionFormula = '<math><mi>y</mi><mo>=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>x</mi><mo>+</mo><mfrac><mn>5</mn><mn>2</mn></mfrac></math>';
cases.equal.push([
  prosePrefix.replace('tọa', 'toạ') + 'y=1/2x+5/2' + proseSuffix,
  prosePrefix + fractionFormula + proseSuffix
]);
cases.equal.push(['1/2', '$\\frac{1}{2}$']);
cases.equal.push(['c - a - d - b - e', 'c-a-d-b-e']);
cases.equal.push(['c – a – d – b – e', 'c-a-d-b-e']);
cases.equal.push(['I&rsquo;ll do that.', "I'll do that."]);
cases.equal.push(['&emsp;I&rsquo;ll do that.', 'I’ll do that.']);
cases.different.push(['c-a-d-b-e', 'c-a-b-d-e']);
cases.equal.push(['${\\rm GB}$', '$\\mathrm{GB}$']);
cases.equal.push(['$50{\\rm GB}$', '<math><mn>50</mn><mi mathvariant="normal">GB</mi></math>']);
cases.equal.push(['Một gói lưu trữ có dung lượng $50{\\rm GB}$.', 'Một gói lưu trữ có dung lượng $50\\mathrm{GB}$.']);
cases.equal.push(['${\\it x}+y$', '$x+y$']);
cases.different.push(['${\\rm A}$', '${\\rm a}$']);
cases.different.push(['${\\rm x-y}$', '${\\rm x+y}$']);
cases.equal.push([prosePrefix + 'y = 1/2x + 5/2' + proseSuffix, prosePrefix + fractionFormula + proseSuffix]);
cases.different.push(['1/2', '0,5']);
cases.equal.push(['1/2x+5/2', '$\\frac{1}{2}x+\\frac{5}{2}$']);
cases.different.push(['1/2x+5/2', '$\\frac{1}{2x}+\\frac{5}{2}$']);
cases.different.push([prosePrefix + 'y=2/1x+5/2' + proseSuffix, prosePrefix + fractionFormula + proseSuffix]);
cases.different.push([prosePrefix + 'y=1/2x+5/2 (bao gồm đường thẳng).', prosePrefix + fractionFormula + proseSuffix]);
cases.unsupported.push('1/2/3', '1/2^3');
// Renderer transformations should preserve a whole mixed sentence, not merely
// a formula tested in isolation. These cases also run unchanged in the browser.
for (let n = 1; n <= 12; n++) {
  const value = `Cho số ${n} và điểm ABC: x, y thỏa mãn x+${n}≤20.`;
  const atom = body => `<math><mstyle mathvariant="italic"><mrow>${body}</mrow></mstyle></math>`;
  const rendered = `<div><span>Cho số&nbsp;</span>${atom(`<mn>${n}</mn>`)} và điểm ${atom('<mi>A</mi>')}${atom('<mi>B</mi><mi>C</mi>')}: ${atom('<mi>x</mi>')}, ${atom('<mi>y</mi>')} thỏa mãn ${atom(`<mi>x</mi><mo>+</mo><mn>${n}</mn><mo>&le;</mo><mn>20</mn>`)}.</div>`;
  const delimited = `Cho số $${n}$ và điểm $ABC$: $x,y$ thỏa mãn $x+${n}\\le20$.`;
  for (const pair of [[value, rendered], [rendered, delimited], [value, delimited]]) cases.equal.push(pair);
  cases.different.push([value, value.replace(`x+${n}`, `x-${n}`)]);
}
for (const [a, b] of cases.equal) {
  assert.equal(math.compare(a, b).status, 'equal', `${a} must equal ${b}`);
  assert.equal(math.compare(b, a).status, 'equal');
  assert.equal(math.compare(math.metadata(a), JSON.parse(JSON.stringify(math.metadata(b)))).status, 'equal');
  assert.equal(math.compare(math.canonicalize(a), math.canonicalize(b)).status, 'equal');
  assert.equal(math.canonicalize(math.metadata(a)).key, math.canonicalize(a).key);
}
for (const [a, b] of cases.different) assert.equal(math.compare(a, b).status, 'different', `${a} must differ from ${b}`);
assert.equal(math.compare(math.canonicalize('x+y'), math.canonicalize('x-y')).status, 'different');
assert.equal(math.compare({}, {}).status, 'unsupported');
assert.equal(math.compare('x&le;2', '$x\\le 2$').status, 'equal');
for (const status of ['unsupported', 'incomplete']) {
  for (const a of cases[status]) assert.equal(math.canonicalize(a).status, status, a);
}
const choices = [{ idOption: 1, text: 'x+y≤50' }, { idOption: 2, text: 'x-y≤50' }];
assert.equal(math.resolveChoice(choices, 'x+y≤50', 2).choice, null);
const imageChoices = [
  { idOption: 'plot-a', text: '', images: [{ src: 'https://example.test/a.png' }] },
  { idOption: 'plot-b', text: '', images: [{ src: 'data:image/png;base64,iVBORw0KGgo=' }] }
];
assert.equal(math.resolveChoice(imageChoices, null, null, 'https://example.test/a.png').choice, imageChoices[0]);
assert.equal(math.resolveChoice(imageChoices, null, null, ['data:image/png;base64,iVBORw0KGgo=']).choice, imageChoices[1]);
assert.equal(math.resolveChoice(imageChoices, null, 'plot-b', ['https://example.test/a.png']).choice, null);
assert.equal(math.resolveChoice([imageChoices[0], imageChoices[0]], null, null, ['https://example.test/a.png']).choice, null);
assert.equal(math.resolveChoice(imageChoices, null, null, ['https://example.test/missing.png']).choice, null);
assert.equal(math.resolveChoice(imageChoices, null, null, ['javascript:alert(1)']).status, 'unsupported');
assert.equal(math.resolveChoice([{ text: '', images: [{ src: 'blob:https://app.onluyen.vn/graph-1' }] }], null, null, ['blob:https://app.onluyen.vn/graph-1']).status, 'equal');
assert.equal(math.resolveChoice([{ text: 'x+y', images: imageChoices[0].images }], 'x-y', null, ['https://example.test/a.png']).choice, null);
assert.equal(math.resolveChoice([choices[0], choices[0]], 'x+y≤50').choice, null);
assert.equal(math.resolveChoice([{ text: '$\\unknown{x}$' }], 'x').status, 'unsupported');
assert.equal(math.compare({ version: 1, segments: [], error: { status: 'equal' } }, 'x').status, 'unsupported');
assert.equal(math.compare(math.metadata('<mjx-container><svg></svg></mjx-container>'), 'x').status, 'incomplete');
assert.equal(math.resolveChoice([{ text: '102' }, { text: '10²' }], '102').status, 'incomplete');
const mixedChoices = [
  { text: '$xy\\ge4$' },
  { text: '$\\frac{1}{x}+y<2$' },
  { text: '$2x-3y\\le5$' },
  { text: '$x^2+y>1$' }
];
for (const saved of ['2x-3y≤5.', math.metadata('2x-3y≤5.', 'inferred')]) {
  assert.equal(math.resolveChoice(mixedChoices, saved).choice, mixedChoices[2]);
}
assert.equal(math.resolveChoice([{ text: '$12$' }, { text: '$\\frac{1}{2}$' }], '12').status, 'incomplete');
assert.equal(math.resolveChoice([{ text: 'x2+y>1' }, mixedChoices[3]], 'x2+y>1').status, 'incomplete');
for (let exponent = 1; exponent <= 20; exponent++) {
  const source = `$x^{${exponent}}$`;
  assert.equal(math.compare(source, `<math><msup><mi>x</mi><mn>${exponent}</mn></msup></math>`).status, 'equal');
  assert.equal(math.compare(source, `$x_${exponent}$`).status, 'different');
}
// The browser runs the exact same corpus, including JSON metadata round trips.
(async () => {
  const puppeteer = require('puppeteer');
  const executablePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(f => fs.existsSync(f));
  assert.ok(executablePath);
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../math-content.js'), 'utf8') });
    const actual = await page.evaluate(corpus => ({
      equal: corpus.equal.map(([a, b]) => window.OnluyenMath.compare(a, b).status),
      different: corpus.different.map(([a, b]) => window.OnluyenMath.compare(a, b).status),
      unsupported: corpus.unsupported.map(a => window.OnluyenMath.canonicalize(a).status),
      incomplete: corpus.incomplete.map(a => window.OnluyenMath.canonicalize(a).status)
    }), cases);
    for (const status of Object.keys(actual)) assert.deepEqual(actual[status], cases[status].map(() => status));
    const resolutionCases = [
      { choices: mixedChoices, saved: '2x-3y≤5.' },
      { choices: mixedChoices, saved: math.metadata('2x-3y≤5.', 'inferred') },
      { choices: [{ text: '102' }, { text: '10²' }], saved: '102' },
      { choices: [{ text: '$12$' }, { text: '$\\frac{1}{2}$' }], saved: '12' },
      { choices: [{ text: 'x2+y>1' }, mixedChoices[3]], saved: 'x2+y>1' },
      { choices: imageChoices, saved: '', imageRefs: ['https://example.test/a.png'] },
      { choices: imageChoices, saved: '', imageRefs: ['data:image/png;base64,iVBORw0KGgo='] }
    ];
    const summarize = (api, fixture) => {
      const result = api.resolveChoice(fixture.choices, fixture.saved, fixture.optionId, fixture.imageRefs);
      return { status: result.status, index: fixture.choices.indexOf(result.choice) };
    };
    const browserResolutions = await page.evaluate(fixtures => fixtures.map(fixture => {
      const result = window.OnluyenMath.resolveChoice(fixture.choices, fixture.saved, fixture.optionId, fixture.imageRefs);
      return { status: result.status, index: fixture.choices.indexOf(result.choice) };
    }), resolutionCases);
    assert.deepEqual(browserResolutions, resolutionCases.map(fixture => summarize(math, fixture)));
  } finally { await browser.close(); }
  console.log('OK: shared math corpus, rejection cases, metadata round trips, Node/browser parity');
})().catch(e => { console.error(e); process.exitCode = 1; });
