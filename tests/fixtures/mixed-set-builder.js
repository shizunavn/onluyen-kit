// Reconstructed from the user's screenshot, not captured HTML from Onluyen.
// The answer entry is the exact JSON supplied by the user for question 19.
const answer = {
  cau: 19, id: '12759000', snapshot_id: 'b200ef084a7ccdfa6a049765863bfc85',
  loai: 'MCQ', dap_an: 'A', noi_dung_dap_an: String.raw`A={x∈\mathbb{R}|3≤x<7}.`
};
const options = [['≤', '<'], ['≤', '≤'], ['<', '≤'], ['<', '<']].map(([lower, upper]) =>
  `<math><mrow><mi>A</mi><mo>=</mo><mo>{</mo><mi>x</mi><mo>∈</mo><mi mathvariant="double-struck">R</mi><mo>|</mo><mn>3</mn><mo>${lower === '<' ? '&lt;' : lower}</mo><mi>x</mi><mo>${upper === '<' ? '&lt;' : upper}</mo><mn>7</mn><mo>}</mo><mo>.</mo></mrow></math>`
);
const question = 'Cho tập <math><mi>A</mi><mo>=</mo><mo>[</mo><mn>3</mn><mo>;</mo><mn>7</mn><mo>)</mo></math>. Các biểu diễn khác của tập <math><mi>A</mi></math> là';
module.exports = { answer, options, question };
