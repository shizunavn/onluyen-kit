const m = body => `<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`;
module.exports = {
  equal: [
    ['\\(x+y\\le 50\\)', 'x+y⩽50.'],
    ['$x+y\\geqslant50$', m('<mrow><mi>x</mi><mo>+</mo><mi>y</mi><mo>≥</mo><mn>50</mn></mrow>')],
    ['$\\frac{1}{\\frac{x}{y}}$', m('<mfrac><mn>1</mn><mfrac><mi>x</mi><mi>y</mi></mfrac></mfrac>')],
    ['$10^{-2}$', m('<msup><mn>10</mn><mrow><mo>−</mo><mn>2</mn></mrow></msup>')],
    ['$x_2^3$', m('<msubsup><mi>x</mi><mn>2</mn><mn>3</mn></msubsup>')],
    ['$x^2$', 'x²'], ['$x_2$', 'x₂'],
    ['$\\frac{1}{2}$', '½'], ['$\\sqrt{x}$', '√x'], ['$\\sqrt{x+1}$', '√(x+1)'],
    ['$\\sqrt[3]{x+1}$', m('<mroot><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><mn>3</mn></mroot>')],
    ['$\\sqrt{x}$', m('<msqrt><mi>x</mi></msqrt>')],
    ['$\\left(2;11\\right]$', '(2;11]'],
    ['$A\\cup B=\\{2;4\\}$', m('<mi>A</mi><mo>∪</mo><mi>B</mi><mo>=</mo><mo>{</mo><mn>2</mn><mo>;</mo><mn>4</mn><mo>}</mo>')],
    ['$\\vec{AB}$', m('<mover accent="true"><mrow><mi>A</mi><mi>B</mi></mrow><mo>→</mo></mover>')],
    ['$\\bar{x}$', m('<mover><mi>x</mi><mo>¯</mo></mover>')],
    ['$\\sin x+\\log_2 x$', m('<mi>sin</mi><mi>x</mi><mo>+</mo><msub><mi>log</mi><mn>2</mn></msub><mi>x</mi>')],
    ['$\\sin x$', m('<mi>sin</mi><mo>&#x2061;</mo><mi>x</mi>')],
    ['$\\sum_{i=1}^{n}i$', m('<munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi>')],
    ['$\\int_0^1 x$', m('<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>x</mi>')],
    ['$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$', m('<mo>(</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable><mo>)</mo>')],
    ['$\\begin{cases}x=1\\\\y=2\\end{cases}$', m('<mo>{</mo><mtable><mtr><mtd><mi>x</mi><mo>=</mo><mn>1</mn></mtd></mtr><mtr><mtd><mi>y</mi><mo>=</mo><mn>2</mn></mtd></mtr></mtable>')],
    ['Điều kiện $x \\le 2$.', `<p>Điều kiện ${m('<mi>x</mi><mo>≤</mo><mn>2</mn>')}.</p>`],
    ['x&lt;2', '$x<2$'], ['<p>x < 2</p>', '$x<2$'], ['$x\\quad+\\,y$', 'x+y'],
    ['$0,5$', m('<mn>0,5</mn>')],
    ['$\\text{chia hết}$', m('<mtext>chia hết</mtext>')],
    ['$\\mathbb{N}$', 'ℕ'],
    ['$\\mathbf{AB}$', m('<mstyle mathvariant="bold"><mi>A</mi><mi>B</mi></mstyle>')],
    ['$\\vec{x}$', 'x⃗'], ['$\\bar{x}$', 'x̄'],
    ['$x^{12}$', '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:msup><m:mi>x</m:mi><m:mn>12</m:mn></m:msup></m:math>']
  ],
  different: [
    ['x+y', 'x−y'], ['x<2', 'x≤2'], ['x≤2', 'x≥2'], ['A', 'a'],
    ['x²', 'x₂'], ['$\\frac{x}{y}$', '$\\frac{y}{x}$'], ['(2;11)', '[2;11]'],
    ['$\\sqrt[3]{x}$', '$\\sqrt{x}$'], ['x+y', 'y+x'], ['1/2', '0,5'],
    ['$x^{12}$', '$x_1^2$'], ['10²', '102'], ['10^{-2}', '10-2'],
    ['$\\vec{x}$', 'x'], ['$\\begin{matrix}1&2\\end{matrix}$', '$\\begin{matrix}2&1\\end{matrix}$'],
    ['$\\mathbb{R}$', 'R'], ['$x\\in A$', '$x\\notin A$'], ['$\\text{a b}$', '$\\text{ab}$'], ['$x^23$', '$x^{23}$'],
    [m('<mi>x</mi><mo>&#x2064;</mo><mi>y</mi>'), '$xy$']
  ],
  unsupported: ['$\\unknown{x}$', m('<menclose notation="circle"><mi>x</mi></menclose>'), '$\\begin{unknown}x\\end{unknown}$', m('<mfrac linethickness="0"><mn>1</mn><mn>2</mn></mfrac>')],
  incomplete: ['$x+2', '\\(x+2', '$\\frac{1}$', '<math><mi>x</mi>', '<mjx-container><svg></svg></mjx-container>']
};
