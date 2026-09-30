/* Shared, source-preserving math reader. No evaluation or algebraic rewriting. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OnluyenMath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  class ReadError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const fail = message => { throw new ReadError('unsupported', message); };
  const incomplete = message => { throw new ReadError('incomplete', message); };
  const aliases = {
    le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥',
    ne: '≠', neq: '≠', lt: '<', gt: '>', pm: '±', mp: '∓', times: '×', cdot: '·',
    div: '÷', cup: '∪', cap: '∩', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆',
    supset: '⊃', supseteq: '⊇', setminus: '∖', backslash: '∖', emptyset: '∅', varnothing: '∅',
    infty: '∞', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
    to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', pi: 'π', lambda: 'λ',
    mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', tau: 'τ', phi: 'ϕ', varphi: 'φ', psi: 'ψ', eta: 'η', zeta: 'ζ',
    epsilon: 'ϵ', varepsilon: 'ε', sigma: 'σ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
    sum: '∑', prod: '∏', int: '∫', oint: '∮', partial: '∂', nabla: '∇',
    lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', lvert: '|', rvert: '|', vert: '|',
    langle: '⟨', rangle: '⟩', ell: 'ℓ', dots: '…', ldots: '…', cdots: '⋯'
  };
  const functions = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'exp', 'lim', 'max', 'min']);
  const vulgar = { '½': ['1', '2'], '⅓': ['1', '3'], '⅔': ['2', '3'], '¼': ['1', '4'], '¾': ['3', '4'], '⅕': ['1', '5'], '⅖': ['2', '5'], '⅗': ['3', '5'], '⅘': ['4', '5'], '⅙': ['1', '6'], '⅚': ['5', '6'], '⅛': ['1', '8'], '⅜': ['3', '8'], '⅝': ['5', '8'], '⅞': ['7', '8'] };
  const supers = Object.fromEntries(Array.from('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿ').map((c, i) => [c, Array.from('0123456789+-()n')[i]]));
  const subs = Object.fromEntries(Array.from('₀₁₂₃₄₅₆₇₈₉₊₋₍₎').map((c, i) => [c, Array.from('0123456789+-()')[i]]));
  const symbol = value => {
    if (!value) return { t: 'row', items: [] };
    const set = { 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℝ': 'R', 'ℂ': 'C' }[value];
    if (set) return { t: 'style', style: 'mathbb', body: { t: 'symbol', v: set } };
    return { t: 'symbol', v: value.replace(/[−–﹣－]/g, '-').replace(/⩽/g, '≤').replace(/⩾/g, '≥').replace(/⧵/g, '∖') };
  };
  function row(items) {
    const flat = items.flatMap(item => item?.t === 'row' ? item.items : item ? [item] : []);
    return flat.length === 1 ? flat[0] : { t: 'row', items: flat };
  }
  const children = node => node.t === 'row' ? node.items : [node];
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', emsp: ' ', ensp: ' ', thinsp: ' ', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', minus: '−', plusmn: '±', times: '×', divide: '÷', cup: '∪', cap: '∩', infin: '∞', isin: '∈', notin: '∉', radic: '√' };
  const decode = s => String(s).replace(/&(#x[\da-f]+|#\d+|[A-Za-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return entities[code.toLowerCase()] || all;
  });

  function tokenize(raw) {
    const tokens = [];
    const source = decode(raw);
    if (source.length > 65536) fail('Công thức quá dài');
    for (let i = 0; i < source.length;) {
      const c = source[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '\\') {
        // JSON is decoded by the caller. Only duplicated command escapes are tolerated.
        if (source[i + 1] === '\\') { tokens.push({ k: 'break', v: '\\\\' }); i += 2; continue; }
        const m = source.slice(i + 1).match(/^[A-Za-z]+|^./u);
        if (!m) incomplete('Lệnh LaTeX bị cắt');
        if (['text', 'operatorname'].includes(m[0])) {
          const literal = source.slice(i + 1 + m[0].length).match(/^\s*\{([^{}]*)\}/);
          if (!literal) incomplete(`Thiếu nhóm văn bản của \\${m[0]}`);
          if (/\\/.test(literal[1])) fail('Lệnh bên trong văn bản toán chưa hỗ trợ');
          tokens.push({ k: m[0] === 'text' ? 'literaltext' : 'literalfunc', v: literal[1].replace(/\s+/g, ' ').trim() });
          i += 1 + m[0].length + literal[0].length; continue;
        }
        tokens.push({ k: 'cmd', v: m[0] }); i += m[0].length + 1; continue;
      }
      if (supers[c] || subs[c]) {
        const map = supers[c] ? supers : subs;
        let value = '';
        while (map[source[i]]) value += map[source[i++]];
        tokens.push({ k: map === supers ? 'sup' : 'sub', v: value }); continue;
      }
      if (vulgar[c]) { tokens.push({ k: 'vulgar', v: c }); i++; continue; }
      if (c === '√') { tokens.push({ k: 'cmd', v: 'sqrt' }); i++; continue; }
      const accent = { '\u20d7': 'vec', '\u0304': 'bar', '\u0302': 'hat', '\u0307': 'dot', '\u0308': 'ddot', '\u0332': 'underline' }[c];
      if (accent) { tokens.push({ k: 'accent', v: accent }); i++; continue; }
      const num = source.slice(i).match(/^\d+(?:\.\d+)?/);
      if (num) { tokens.push({ k: 'number', v: num[0] }); i += num[0].length; continue; }
      const fn = source.slice(i).match(/^(arcsin|arccos|arctan|sin|cos|tan|cot|sec|csc|log|ln|exp|lim|max|min)(?![A-Za-z])/);
      if (fn) { tokens.push({ k: 'fn', v: fn[0] }); i += fn[0].length; continue; }
      if (source.slice(i, i + 2) === '<=' || source.slice(i, i + 2) === '>=') {
        tokens.push({ k: 'char', v: source[i] === '<' ? '≤' : '≥' }); i += 2; continue;
      }
      if ('{}^_&'.includes(c)) tokens.push({ k: c, v: c });
      else if (/\p{L}/u.test(c)) tokens.push({ k: 'char', v: c });
      else if ('+-−–﹣－=<>≤≥⩽⩾≠±∓×·÷/(),;:[]|∪∩∈∉⊂⊆⊃⊇∖⧵∅∞∀∃¬∧∨→←⇒⇔∑∏∫∮∂∇⟨⟩…⋯.!'.includes(c)) tokens.push({ k: 'char', v: c });
      else fail(`Ký hiệu chưa hỗ trợ: ${c}`);
      i++;
    }
    return tokens;
  }

  function parseLatex(raw, plain = false) {
    const tokens = tokenize(raw);
    let pos = 0, depth = 0;
    const peek = () => tokens[pos];
    function argument() {
      if (!peek()) incomplete('Thiếu đối số công thức');
      if (peek().k === '{') {
        pos++; const value = sequence(() => peek()?.k === '}');
        if (peek()?.k !== '}') incomplete('Thiếu dấu }');
        if (value.t === 'row' && !value.items.length) incomplete('Đối số công thức trống');
        pos++; return value;
      }
      if (plain && peek().v === '(') {
        pos++; const value = sequence(() => peek()?.v === ')');
        if (peek()?.v !== ')') incomplete('Đối số chưa đóng ngoặc');
        pos++; return value;
      }
      if (peek().k === 'number' && peek().v.length > 1) {
        if (plain) fail('Đối số nhiều chữ số cần ngoặc {...}');
        const value = peek().v;
        tokens.splice(pos, 1, { k: 'number', v: value[0] }, { k: 'number', v: value.slice(1) });
      }
      return atom(plain);
    }
    function rawGroup() {
      if (peek()?.k !== '{') incomplete('Thiếu nhóm {...}');
      pos++; let result = '', nesting = 1;
      while (peek()) {
        const token = tokens[pos++];
        if (token.k === '{') nesting++;
        if (token.k === '}' && --nesting === 0) return result;
        result += token.k === 'cmd' ? '\\' + token.v : token.v;
      }
      incomplete('Nhóm LaTeX bị cắt');
    }
    function atom(allowFence = true) {
      if (++depth > 128) fail('Công thức lồng quá sâu');
      try {
        const token = tokens[pos++];
        if (!token) incomplete('Thiếu thành phần công thức');
        if (token.k === 'number') {
          // A numeric slash fraction is a literal coefficient, e.g. 1/2x.
          // General a/bc and chained divisions are not assigned a guessed grouping.
          if (peek()?.v === '/' && tokens[pos + 1]?.k === 'number') {
            pos++;
            const denominator = tokens[pos++];
            if (peek()?.v === '/' || ['^', '_', 'sup', 'sub'].includes(peek()?.k)) fail('Phân số dùng / mơ hồ; hãy dùng LaTeX với tử/mẫu rõ ràng');
            return { t: 'fraction', numerator: { t: 'number', v: token.v }, denominator: { t: 'number', v: denominator.v } };
          }
          return { t: 'number', v: token.v };
        }
        if (token.k === 'literalfunc') return { t: 'function', v: token.v };
        if (token.k === 'literaltext') return { t: 'textmath', style: 'text', body: { t: 'literal', v: token.v } };
        if (token.k === 'vulgar') return { t: 'fraction', numerator: { t: 'number', v: vulgar[token.v][0] }, denominator: { t: 'number', v: vulgar[token.v][1] } };
        if (token.k === 'fn') return { t: 'function', v: token.v };
        if (plain && (token.k === '{' || token.k === '}')) return symbol(token.v);
        if (token.k === '{') { pos--; return argument(); }
        if (token.k === 'char') {
          if (allowFence && ['(', '['].includes(token.v)) {
            // Keep a fenced expression together so a following ^/_ applies
            // to the whole base rather than just its closing delimiter.
            const body = sequence(() => peek()?.k === 'char' && [')', ']'].includes(peek().v));
            if (!peek()) incomplete('Ngoặc công thức chưa đóng');
            return row([symbol(token.v), body, symbol(tokens[pos++].v)]);
          }
          return symbol(token.v);
        }
        if (token.k !== 'cmd') fail(`Thành phần sai vị trí: ${token.v}`);
        const name = token.v;
        if (aliases[name]) return symbol(aliases[name]);
        if (functions.has(name)) return { t: 'function', v: name };
        if (['left', 'right', 'middle', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr', 'limits', 'nolimits'].includes(name)) {
          if (['left', 'right'].includes(name) && peek()?.v === '.') { pos++; return null; }
          return null;
        }
        if (['quad', 'qquad', 'space', ',', ';', '!', ':', ' '].includes(name)) return null;
        // Legacy roman/italic declarations affect glyph layout, like the
        // already supported \mathrm and MathML normal/italic variants.
        // Keep every following symbol and the surrounding group intact.
        if (['rm', 'rmfamily', 'it', 'itshape'].includes(name)) return null;
        if ('{}[]|'.includes(name)) return symbol(name);
        if (['frac', 'dfrac', 'tfrac'].includes(name)) return { t: 'fraction', numerator: argument(), denominator: argument() };
        if (name === 'sqrt') {
          let degree = { t: 'number', v: '2' };
          if (peek()?.v === '[') {
            pos++; degree = sequence(() => peek()?.v === ']');
            if (peek()?.v !== ']') incomplete('Thiếu ] ở bậc căn');
            pos++;
          }
          return { t: 'root', degree, body: argument() };
        }
        if (['text', 'operatorname', 'mathrm', 'mathbb', 'mathbf', 'mathcal', 'mathsf'].includes(name)) {
          const value = argument();
          if (name === 'mathrm') return value;
          if (name === 'operatorname') return { t: 'function', v: render(value) };
          return { t: name === 'text' ? 'textmath' : 'style', style: name, body: value };
        }
        if (['vec', 'overrightarrow', 'hat', 'widehat', 'bar', 'overline', 'dot', 'ddot', 'underline'].includes(name)) {
          return { t: 'accent', kind: ({ overrightarrow: 'vec', widehat: 'hat', overline: 'bar' })[name] || name, body: argument() };
        }
        if (name === 'begin') {
          const env = rawGroup();
          if (!['matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'aligned', 'array'].includes(env)) fail(`Môi trường chưa hỗ trợ: ${env}`);
          if (env === 'array') rawGroup(); // column alignment is layout only
          const rows = [], cells = [];
          const flush = () => { rows.push(cells.splice(0)); };
          while (peek() && !(peek().k === 'cmd' && peek().v === 'end')) {
            cells.push(sequence(() => peek()?.k === '&' || peek()?.k === 'break' || (peek()?.k === 'cmd' && peek()?.v === 'end')));
            if (peek()?.k === '&') { pos++; continue; }
            if (peek()?.k === 'break') { pos++; flush(); continue; }
          }
          if (!peek()) incomplete(`Thiếu end của ${env}`);
          pos++;
          if (rawGroup() !== env) fail('Môi trường đóng không khớp');
          if (cells.length) flush();
          const table = { t: 'table', rows };
          const brackets = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', null] }[env];
          return brackets ? row([symbol(brackets[0]), table, brackets[1] && symbol(brackets[1])]) : table;
        }
        fail(`Lệnh LaTeX chưa hỗ trợ: \\${name}`);
      } finally { depth--; }
    }
    function sequence(stop = () => false) {
      const items = [];
      while (peek() && !stop()) {
        if (peek().k === 'accent') {
          const token = tokens[pos++], body = items.pop();
          if (!body) fail('Dấu trên biến không có cơ số');
          items.push({ t: 'accent', kind: token.v, body }); continue;
        }
        if (['^', '_', 'sup', 'sub'].includes(peek().k)) {
          const token = tokens[pos++];
          const base = items.pop();
          if (!base) fail('Chỉ số không có cơ số');
          const value = ['sup', 'sub'].includes(token.k) ? parseLatex(token.v) : argument();
          const key = ['^', 'sup'].includes(token.k) ? 'sup' : 'sub';
          const script = base.t === 'script' ? { ...base } : { t: 'script', base, sub: null, sup: null };
          if (script[key]) fail('Chỉ số bị lặp');
          script[key] = value; items.push(script); continue;
        }
        const value = atom();
        if (value) items.push(value);
      }
      return row(items);
    }
    return sequence();
  }

  // Small non-executing XML/HTML reader, identical in Node and the browser.
  function markup(source) {
    if (source.length > 262144) fail('Nội dung quá dài');
    const root = { name: '#root', attrs: {}, nodes: [] }, stack = [root];
    source = source.replace(/<(?!\/?[A-Za-z][\w:-]*(?:\s|\/?>)|!--)/g, '&lt;');
    const parts = source.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) || [];
    for (const part of parts) {
      if (part.startsWith('<!--')) continue;
      if (part.startsWith('<!') || part.startsWith('<?')) fail('Khai báo XML chưa hỗ trợ');
      if (!part.startsWith('<')) { stack.at(-1).nodes.push(decode(part)); continue; }
      const closing = part.match(/^<\/([\w:-]+)\s*>$/);
      if (closing) {
        if (stack.length === 1 || stack.at(-1).name !== closing[1].toLowerCase().split(':').at(-1)) incomplete('Thẻ đóng không khớp');
        stack.pop(); continue;
      }
      const open = part.match(/^<([\w:-]+)([\s\S]*?)\/?\s*>$/);
      if (!open) incomplete('Thẻ bị cắt');
      const attrs = {};
      for (const match of open[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
      const node = { name: open[1].toLowerCase().split(':').at(-1), attrs, nodes: [], source: part };
      stack.at(-1).nodes.push(node);
      if (!/\/\s*>$/.test(part) && !['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr'].includes(node.name)) stack.push(node);
      if (stack.length > 128) fail('Nội dung lồng quá sâu');
    }
    if (stack.length !== 1) incomplete('Thẻ chưa đóng');
    return root;
  }
  const xmlText = node => typeof node === 'string' ? node : node.nodes.map(xmlText).join('');
  const elements = node => node.nodes.filter(n => typeof n !== 'string');
  const xmlSource = node => typeof node === 'string' ? node.replace(/&/g, '&amp;').replace(/</g, '&lt;') : `<${node.name}${Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')}>${node.nodes.map(xmlSource).join('')}</${node.name}>`;
  function parseMathML(node) {
    const kids = elements(node);
    const args = n => { if (kids.length !== n) incomplete(`${node.name}: thiếu hoặc thừa đối số`); return kids.map(parseMathML); };
    switch (node.name.replace(/^.*:/, '')) {
      case 'math': case 'mrow': case 'mstyle': case 'mpadded': {
        const visibleKids = kids.filter((kid, i) => !(kid.name === 'mo' && xmlText(kid).trim() === '\u2061'
          && i > 0 && kids[i - 1].name === 'mi' && functions.has(xmlText(kids[i - 1]).trim())));
        const body = row(visibleKids.map(parseMathML));
        const variant = node.attrs.mathvariant;
        if (!variant || ['normal', 'italic'].includes(variant)) return body;
        const style = { 'double-struck': 'mathbb', bold: 'mathbf', script: 'mathcal', 'sans-serif': 'mathsf' }[variant];
        if (!style) fail(`mathvariant chưa hỗ trợ: ${variant}`);
        return { t: 'style', style, body };
      }
      case 'semantics': if (!kids.length) incomplete('MathML trống'); return parseMathML(kids[0]);
      case 'mi': {
        const text = xmlText(node).trim();
        const body = functions.has(text) ? { t: 'function', v: text } : row(Array.from(text).map(symbol));
        const style = node.attrs.mathvariant;
        if (style && !['normal', 'italic'].includes(style)) {
          const mapped = { 'double-struck': 'mathbb', bold: 'mathbf', script: 'mathcal', 'sans-serif': 'mathsf' }[style];
          if (!mapped) fail(`mathvariant chưa hỗ trợ: ${style}`);
          return { t: 'style', style: mapped, body };
        }
        return body;
      }
      case 'mn': {
        const value = xmlText(node).trim().replace(/^(\d+),(\d+)$/, '$1.$2');
        if (!/^\d+(?:\.\d+)?$/.test(value)) fail(`Số MathML chưa hỗ trợ: ${value}`);
        return { t: 'number', v: value };
      }
      case 'mo': {
        const value = xmlText(node).trim();
        if (value === '\u2061') fail('Hàm tùy biến với ApplyFunction chưa hỗ trợ');
        if (value === '\u2062') return row([]);
        if (value === '\u2063') return symbol(',');
        if (value === '\u2064') return symbol('+');
        return symbol(value);
      }
      case 'mtext': return { t: 'textmath', style: 'text', body: { t: 'literal', v: xmlText(node).replace(/\s+/g, ' ').trim() } };
      case 'mspace': return row([]);
      case 'mfrac': {
        if (/^0(?:\.0+)?(?:px|em|pt)?$/.test(node.attrs.linethickness || '')) fail('Phân số không có gạch/binomial chưa hỗ trợ');
        const [numerator, denominator] = args(2); return { t: 'fraction', numerator, denominator };
      }
      case 'msqrt': return { t: 'root', degree: { t: 'number', v: '2' }, body: row(kids.map(parseMathML)) };
      case 'mroot': { const [body, degree] = args(2); return { t: 'root', degree, body }; }
      case 'msup': case 'msub': { const [base, value] = args(2); return { t: 'script', base, sub: node.name === 'msub' ? value : null, sup: node.name === 'msup' ? value : null }; }
      case 'msubsup': { const [base, sub, sup] = args(3); return { t: 'script', base, sub, sup }; }
      case 'mover': case 'munder': {
        const [body, mark] = args(2);
        const kind = { '→': 'vec', '¯': 'bar', '‾': 'bar', '^': 'hat', 'ˆ': 'hat', '˙': 'dot', '¨': 'ddot', '_': 'underline' }[render(mark)];
        if (kind) return { t: 'accent', kind, body };
        return { t: 'script', base: body, sub: node.name === 'munder' ? mark : null, sup: node.name === 'mover' ? mark : null };
      }
      case 'munderover': { const [base, sub, sup] = args(3); return { t: 'script', base, sub, sup }; }
      case 'mfenced': {
        const separators = node.attrs.separators ?? ',';
        const body = kids.flatMap((kid, i) => i && separators ? [symbol(separators[Math.min(i - 1, separators.length - 1)]), parseMathML(kid)] : [parseMathML(kid)]);
        return row([symbol(node.attrs.open ?? '('), ...body, symbol(node.attrs.close ?? ')')]);
      }
      case 'mtable': return { t: 'table', rows: kids.map(tr => {
        if (tr.name !== 'mtr') fail(`Hàng MathML chưa hỗ trợ: ${tr.name}`);
        return elements(tr).map(td => { if (td.name !== 'mtd') fail(`Ô MathML chưa hỗ trợ: ${td.name}`); return row(elements(td).map(parseMathML)); });
      }) };
      default: fail(`Phần tử MathML chưa hỗ trợ: ${node.name}`);
    }
  }
  function render(node) {
    if (!node) return '';
    if (node.t === 'symbol' || node.t === 'number' || node.t === 'function' || node.t === 'literal') return node.v;
    if (node.t === 'row') return node.items.map(render).join('');
    if (node.t === 'fraction') return `\\frac{${render(node.numerator)}}{${render(node.denominator)}}`;
    if (node.t === 'script') return `${node.base.t === 'row' ? `{${render(node.base)}}` : render(node.base)}${node.sub ? `_{${render(node.sub)}}` : ''}${node.sup ? `^{${render(node.sup)}}` : ''}`;
    if (node.t === 'root') return `\\sqrt${render(node.degree) === '2' ? '' : `[${render(node.degree)}]`}{${render(node.body)}}`;
    if (node.t === 'accent') return `\\${node.kind}{${render(node.body)}}`;
    if (node.t === 'style') return `\\${node.style}{${render(node.body)}}`;
    if (node.t === 'textmath') return `\\text{${render(node.body)}}`;
    if (node.t === 'table') return `\\begin{matrix}${node.rows.map(r => r.map(render).join('&')).join('\\\\')}\\end{matrix}`;
    fail(`Cấu trúc chưa hỗ trợ: ${node.t}`);
  }
  function looksMath(s) {
    // A set-builder expression has explicit outer structure even when its
    // predicate includes prose (e.g. x chia hết cho 3).
    if (/^(?:\(\d+\)\s*)?[A-Za-z]\s*=\s*\{[\s\S]*\}$/.test(s)) return true;
    if (/[\p{L}]/u.test(s.replace(/[A-Za-zα-ωΑ-Ωℕℤℚℝℂⁿ]/gu, ''))) return false;
    if (/\\[A-Za-z]+|[≤≥⩽⩾∪∩∈∉⊂⊆⊃⊇∞ℕℤℚℝℂ√½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉\u20d7\u0304\u0302\u0307\u0308\u0332]/u.test(s)) return true;
    if (!/[\p{L}\p{N}]/u.test(s)) return false;
    return /^[\dA-Za-zα-ωΑ-Ω\s+\-−–=<>^_()[\]{},;.:|/×·]+$/u.test(s) && !/[A-Za-z]{4,}/.test(s);
  }
  function splitPlain(value, segments) {
    let s = decode(value).trim();
    if (!s) return;
    const pattern = /\$\$([\s\S]*?)\$\$|\$([^$]*?)\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
    let end = 0, found = false;
    for (const m of s.matchAll(pattern)) {
      found = true;
      splitPlain(s.slice(end, m.index), segments);
      segments.push({ format: 'latex', raw: m[1] ?? m[2] ?? m[3] ?? m[4] });
      end = m.index + m[0].length;
    }
    if (found) { splitPlain(s.slice(end), segments); return; }
    if (/\$|\\[()[\]]/.test(s)) incomplete('Delimiter công thức chưa đóng');
    const lines = s.split(/\r?\n/);
    if (lines.length > 1 && lines.slice(1).some(line => /^\s*(\d+|[A-Za-z])\s*\)(?=\s|$)/.test(line))) {
      lines.forEach(line => splitPlain(line, segments));
      return;
    }
    // Number/letter list markers belong to surrounding prose. A fragment like
    // "1)" is often flushed immediately before a MathJax container; treating
    // it as math would introduce an unmatched closing fence into that formula.
    // Only infer markers in un-delimited text, with a whitespace/end boundary.
    const marker = s.match(/^(\d+|[A-Za-z])\s*\)(?=\s|$)/);
    if (marker) {
      segments.push({ format: 'text', raw: `${marker[1]})` });
      splitPlain(s.slice(marker[0].length), segments);
      return;
    }
    const bare = s.replace(/[.]$/, '');
    if (bare && looksMath(bare)) {
      segments.push({ format: 'plain', raw: bare });
      if (s.endsWith('.')) segments.push({ format: 'text', raw: '.' });
    } else {
      // Read compact formulas in prose separately from Vietnamese text. Never
      // turn a sentence containing a relation symbol into one large formula.
      const chunk = '[A-Za-zα-ωΑ-Ω\\dℕℤℚℝℂⁿ⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉+\\-−=<>≤≥⩽⩾^_()[\\]{},;:|/×·√½⅓⅔¼¾.]+';
      const inline = new RegExp(`${chunk}(?:\\s*[+\\-−=<>≤≥⩽⩾/×·]\\s*${chunk})*`, 'gu');
      let offset = 0;
      for (const match of s.matchAll(inline)) {
        if (/\p{L}/u.test(s[match.index - 1] || '') || /\p{L}/u.test(s[match.index + match[0].length] || '')) continue;
        const formula = match[0].replace(/[.,]$/, '');
        if (!looksMath(formula) || !/[=<>≤≥⩽⩾+\-−/^_√²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉;]|^\([\d,]+\)$/u.test(formula)) continue;
        if (match.index > offset) segments.push({ format: 'text', raw: s.slice(offset, match.index) });
        segments.push({ format: 'plain', raw: formula });
        offset = match.index + formula.length;
      }
      if (offset < s.length) segments.push({ format: 'text', raw: s.slice(offset) });
    }
  }
  function readContent(input) {
    try {
      if (input?.kind === 'canonical-math-content') return readContent(input.content);
      if (input && typeof input === 'object' && Array.isArray(input.segments)) {
        if (input.version !== 1) fail('Phiên bản math_content chưa hỗ trợ');
        const error = input.error || (input.status && input.status !== 'ok' ? { status: input.status, reason: input.reason } : null);
        if (error && !['unsupported', 'incomplete'].includes(error.status)) fail('Trạng thái math_content không hợp lệ');
        return { ...input, ...(error ? { error } : {}), status: 'ok', version: 1, segments: input.segments.map(s => ({ ...s })) };
      }
      if (input && typeof input === 'object' && typeof input.outerHTML !== 'string') fail('Đối tượng nội dung công thức không hợp lệ');
      const source = input?.outerHTML ?? String(input ?? '');
      const segments = [];
      if (/<(?:math\b|mjx-|[A-Za-z][\w:-]*(?:\s|>))/i.test(source)) {
        const tree = markup(source);
        let pending = '';
        const flush = () => { splitPlain(pending, segments); pending = ''; };
        const walk = node => {
          if (typeof node === 'string') { pending += node; return; }
          if (node.name === 'script' && /^math\/tex/.test(node.attrs.type || '')) {
            flush(); segments.push({ format: 'latex', raw: xmlText(node) }); return;
          }
          if (['svg', 'script', 'style', 'annotation', 'annotation-xml'].includes(node.name)) return;
          if (node.name === 'math') { flush(); segments.push({ format: 'mathml', raw: xmlSource(node) }); return; }
          if (node.name === 'mjx-container') {
            flush();
            const findMath = n => typeof n === 'string' ? null : n.name === 'math' ? n : n.nodes.map(findMath).find(Boolean);
            const math = findMath(node);
            if (math) segments.push({ format: 'mathml', raw: xmlSource(math) });
            else if (node.attrs['data-latex']) segments.push({ format: 'latex', raw: node.attrs['data-latex'] });
            else incomplete('MathJax chưa có MathML/LaTeX gốc');
            return;
          }
          if (['p', 'div', 'br', 'li'].includes(node.name)) pending += '\n';
          node.nodes.forEach(walk);
          if (['p', 'div', 'li'].includes(node.name)) pending += '\n';
        };
        walk(tree); flush();
      } else splitPlain(source, segments);
      return { status: 'ok', version: 1, segments };
    } catch (e) { return { status: e.status || 'unsupported', reason: e.message, version: 1, segments: [], source: input?.outerHTML ?? String(input ?? '') }; }
  }
  function canonicalize(input) {
    const content = readContent(input);
    if (content.status !== 'ok') return content;
    if (content.error) return { ...content.error, content };
    try {
      const mapped = content.segments.map(segment => {
        if (segment.format === 'text') return { t: 'text', v: decode(segment.raw).normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\p{L}+/gu, word => {
          if (/^[A-Z]{1,3}$/.test(word)) return word;
          const lower = word.toLocaleLowerCase('vi');
          return lower === 'toạ' ? 'tọa' : lower;
        }).replace(/\s+/g, ' ').trim().replace(/\.$/, '') };
        if (segment.format === 'latex' || segment.format === 'plain') {
          const raw = segment.raw.trim().replace(/^(\d+),(\d+)$/, '$1.$2');
          return { t: 'math', body: parseLatex(raw, segment.format === 'plain' && !/\\[A-Za-z]/.test(raw)) };
        }
        if (segment.format === 'mathml') {
          const tree = markup(segment.raw);
          if (elements(tree).length !== 1) incomplete('Nguồn MathML không đầy đủ');
          return { t: 'math', body: parseMathML(elements(tree)[0]) };
        }
        fail(`Định dạng chưa hỗ trợ: ${segment.format}`);
      }).filter(p => p.t !== 'text' || p.v);
      const parts = [];
      for (const part of mapped) {
        const previous = parts.at(-1);
        if (previous?.t === 'math' && part.t === 'math') previous.body = row([previous.body, part.body]);
        else parts.push(part);
      }
      for (const part of parts) if (part.t === 'math') validateFences(part.body);
      return { kind: 'canonical-math-content', status: 'ok', key: parts.length ? JSON.stringify(parts) : '', parts, content };
    } catch (e) { return { status: e.status || 'unsupported', reason: e.message, content }; }
  }
  function validateFences(node) {
    if (!node) return;
    if (node.t === 'row') {
      const stack = [];
      for (const item of node.items) {
        if (item.t === 'symbol' && ['(', '[', '{'].includes(item.v)) stack.push({ open: item.v, separator: false });
        else if (item.t === 'symbol' && [')', ']', '}'].includes(item.v)) {
          const opening = stack.pop();
          if (!opening) incomplete('Ngoặc đóng không có ngoặc mở');
          const expected = { '(': ')', '[': ']', '{': '}' }[opening.open];
          if (expected !== item.v && !(opening.separator && ['(', '['].includes(opening.open) && [')', ']'].includes(item.v))) fail('Ngoặc không khớp');
        } else if (item.t === 'symbol' && [',', ';'].includes(item.v)) {
          if (stack.length) stack.at(-1).separator = true;
        } else validateFences(item);
      }
      // A cases/system brace intentionally has no closing fence.
      if (stack.length && !(stack.length === 1 && stack[0].open === '{' && node.items.at(-1)?.t === 'table')) incomplete('Ngoặc công thức chưa đóng');
    } else {
      for (const key of ['base', 'sub', 'sup', 'numerator', 'denominator', 'body', 'degree']) if (node[key]) validateFences(node[key]);
      if (node.rows) node.rows.flat().forEach(validateFences);
    }
  }
  function compare(left, right) {
    const a = canonicalize(left), b = canonicalize(right);
    if (a.status !== 'ok' || b.status !== 'ok') {
      const bad = a.status !== 'ok' ? a : b;
      return { status: bad.status, reason: bad.reason };
    }
    return { status: a.key === b.key ? 'equal' : 'different', reason: a.key === b.key ? '' : 'Nội dung/cấu trúc công thức khác nhau' };
  }
  function text(input) {
    const c = canonicalize(input);
    if (c.status !== 'ok') return c.content?.source || c.source || (typeof input === 'string' ? input : input?.textContent || '');
    return c.content.segments.map(segment => ['text', 'plain'].includes(segment.format) ? segment.raw : render(canonicalize({ version: 1, segments: [segment] }).parts[0].body))
      .join(' ').replace(/\s+([.,;])/g, '$1').replace(/\s+/g, ' ').trim();
  }
  function metadata(input, origin = 'source') {
    const c = readContent(input);
    return c.status === 'ok' ? { version: 1, origin, segments: c.segments } : { version: 1, origin, segments: [{ format: 'plain', raw: c.source }], error: { status: c.status, reason: c.reason } };
  }
  function combine(...inputs) {
    const contents = inputs.map(input => typeof input === 'object' && input?.segments ? input : metadata(input));
    const error = contents.find(c => c.error)?.error;
    return { version: 1, origin: 'source', segments: contents.flatMap(c => c.segments), ...(error ? { error } : {}) };
  }
  function resolveChoice(choices, saved, optionId, imageRefs) {
    if (imageRefs !== undefined && imageRefs !== null) {
      const refs = Array.isArray(imageRefs) ? imageRefs : [imageRefs];
      const normalize = value => {
        if (typeof value !== 'string') return null;
        const source = value.trim();
        if (/^data:image\/[\w.+-]+;base64,/i.test(source)) return source.replace(/\s/g, '');
        if (/^https?:\/\//i.test(source) || /^blob:(?:https?:\/\/|null\/)/i.test(source)) {
          try { return new URL(source).href; } catch (_) { return null; }
        }
        return null;
      };
      const wanted = refs.map(normalize);
      if (!wanted.length || wanted.some(ref => !ref)) return { status: 'unsupported', reason: 'Định danh ảnh phải là URL http/https hoặc data:image/...;base64,...', choice: null };
      const matches = choices.filter(choice => {
        const sources = (choice.images || []).map(image => normalize(typeof image === 'string' ? image : image.src));
        return sources.length === wanted.length && sources.every((source, index) => source && source === wanted[index]);
      });
      if (matches.length !== 1) return { status: 'different', reason: matches.length ? 'Khớp nhiều lựa chọn có cùng ảnh' : 'Không có lựa chọn khớp nguồn ảnh', choice: null };
      const choice = matches[0];
      const ids = optionId != null ? choices.filter(c => c.idOption != null && String(c.idOption) === String(optionId)) : [];
      if (optionId != null && choices.some(c => c.idOption != null) && (ids.length !== 1 || ids[0] !== choice)) return { status: 'different', reason: 'ID đáp án và ảnh mâu thuẫn', choice: null };
      const current = canonicalize(choice.math_content || choice.text || '');
      if (current.status !== 'ok') return { ...current, choice: null };
      const content = canonicalize(saved || '');
      if (content.status !== 'ok') return { ...content, choice: null };
      if (current.key && content.key && compare(saved, choice.math_content || choice.text).status !== 'equal') {
        return { status: 'different', reason: 'Nội dung đáp án và ảnh mâu thuẫn', choice: null };
      }
      return { status: 'equal', reason: '', choice };
    }
    const hasSaved = saved !== null && saved !== undefined && saved !== '';
    if (hasSaved && (typeof saved === 'string' || saved.origin === 'inferred')) {
      const savedKey = canonicalize(saved).key;
      // A lossy projection is used only to detect ambiguity, never to match an answer.
      // Unrelated fractions or powers in other choices must not block a simple formula.
      function flattened(node, includeRootDegree) {
        if (!node) return '';
        if (node.t === 'row') return node.items.map(n => flattened(n, includeRootDegree)).join('');
        if (node.t === 'fraction') return flattened(node.numerator, includeRootDegree) + flattened(node.denominator, includeRootDegree);
        if (node.t === 'script') return flattened(node.base, includeRootDegree) + flattened(node.sub, includeRootDegree) + flattened(node.sup, includeRootDegree);
        if (node.t === 'root') return flattened(node.body, includeRootDegree) + (includeRootDegree ? flattened(node.degree, includeRootDegree) : '');
        if (node.t === 'table') return node.rows.flat().map(n => flattened(n, includeRootDegree)).join('');
        if (node.body) return flattened(node.body, includeRootDegree);
        return render(node);
      }
      const ambiguous = savedKey && choices.some(choice => {
        const candidate = canonicalize(choice.math_content || choice.text);
        if (candidate.status !== 'ok' || candidate.key === savedKey
            || !/"t":"(?:fraction|script|root|table)"/.test(candidate.key)) return false;
        return [false, true].some(includeRootDegree => canonicalize({ version: 1, segments: candidate.parts.map(part => (
          part.t === 'math'
            ? { format: 'plain', raw: flattened(part.body, includeRootDegree) }
            : { format: 'text', raw: part.v }
        )) }).key === savedKey);
      });
      if (ambiguous) {
        return { status: 'incomplete', reason: 'Database cũ có thể đã mất cấu trúc; hãy lấy lại từ đề/History', choice: null };
      }
    }
    const comparisons = hasSaved ? choices.map(choice => compare(saved, choice.math_content || choice.text)) : [];
    const matches = choices.filter((_c, i) => comparisons[i]?.status === 'equal');
    const ids = optionId !== undefined && optionId !== null ? choices.filter(c => c.idOption !== undefined && String(c.idOption) === String(optionId)) : [];
    const bad = comparisons.find(c => c.status === 'unsupported' || c.status === 'incomplete');
    if (bad) return { ...bad, choice: null };
    if (matches.length > 1 || ids.length > 1) return { status: 'different', reason: 'Khớp nhiều lựa chọn', choice: null };
    if (ids.length && hasSaved && matches[0] !== ids[0]) return { status: 'different', reason: 'ID đáp án và nội dung mâu thuẫn', choice: null };
    const choice = matches[0] || (!hasSaved && ids[0]);
    return choice ? { status: 'equal', reason: '', choice } : { status: 'different', reason: 'Không có lựa chọn khớp duy nhất', choice: null };
  }
  return { readContent, canonicalize, compare, text, metadata, combine, resolveChoice };
});
