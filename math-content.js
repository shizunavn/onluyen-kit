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
    langle: '⟨', rangle: '⟩', ell: 'ℓ', dots: '…', ldots: '…', cdots: '⋯', prime: '′'
  };
  const functions = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'exp', 'lim', 'max', 'min']);
  const vulgar = { '½': ['1', '2'], '⅓': ['1', '3'], '⅔': ['2', '3'], '¼': ['1', '4'], '¾': ['3', '4'], '⅕': ['1', '5'], '⅖': ['2', '5'], '⅗': ['3', '5'], '⅘': ['4', '5'], '⅙': ['1', '6'], '⅚': ['5', '6'], '⅛': ['1', '8'], '⅜': ['3', '8'], '⅝': ['5', '8'], '⅞': ['7', '8'] };
  const supers = Object.fromEntries(Array.from('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿ').map((c, i) => [c, Array.from('0123456789+-()n')[i]]));
  const subs = Object.fromEntries(Array.from('₀₁₂₃₄₅₆₇₈₉₊₋₍₎').map((c, i) => [c, Array.from('0123456789+-()')[i]]));
  const symbol = value => {
    if (!value) return { t: 'row', items: [] };
    if (value === '″' || value === '‴') return row(Array.from({ length: value === '″' ? 2 : 3 }, () => ({ t: 'symbol', v: '′' })));
    const set = { 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q', 'ℝ': 'R', 'ℂ': 'C' }[value];
    if (set) return { t: 'style', style: 'mathbb', body: { t: 'symbol', v: set } };
    return { t: 'symbol', v: value.replace(/[−–﹣－]/g, '-').replace(/⩽/g, '≤').replace(/⩾/g, '≥').replace(/⧵/g, '∖') };
  };
  function row(items) {
    const flat = items.flatMap(item => item?.t === 'row' ? item.items : item ? [item] : []);
    return flat.length === 1 ? flat[0] : { t: 'row', items: flat };
  }
  function fenced(open, body, close) {
    if ([open, close].some(value => value && !['(', ')', '[', ']', '{', '}', '|', '‖', '⟨', '⟩'].includes(value))) fail('Ký hiệu ngoặc chưa hỗ trợ');
    if (open && close) return row([symbol(open), body, symbol(close)]);
    if (!open && !close) return body;
    return { t: 'fenced', open: open || null, body, close: close || null };
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
      if (c === '√') { tokens.push({ k: 'cmd', v: 'sqrt', plain: true }); i++; continue; }
      if (["'", '′', '″', '‴'].includes(c)) {
        tokens.push({ k: 'prime', v: c === '″' ? 2 : c === '‴' ? 3 : 1 }); i++; continue;
      }
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
    let pos = 0, depth = 0, plainMode = plain;
    const peek = () => tokens[pos];
    function argument(allowEmptyBase = false, texArgument = false) {
      const previousMode = plainMode;
      if (texArgument) plainMode = false;
      try {
        if (!peek()) incomplete('Thiếu đối số công thức');
        if (peek().k === '{') {
          pos++;
          // Braces consumed as an explicit command/script argument group their
          // contents. Visible set braces outside that argument stay literal.
          plainMode = false;
          const value = sequence(() => peek()?.k === '}');
          if (peek()?.k !== '}') incomplete('Thiếu dấu }');
          if (value.t === 'row' && !value.items.length && !(allowEmptyBase && ['^', '_'].includes(tokens[pos + 1]?.k))) incomplete('Đối số công thức trống');
          pos++; return value;
        }
        if (plainMode && peek().v === '(') {
          pos++; const value = sequence(() => peek()?.v === ')');
          if (peek()?.v !== ')') incomplete('Đối số chưa đóng ngoặc');
          pos++; return value;
        }
        if (peek().k === 'number' && peek().v.length > 1) {
          if (plainMode) fail('Đối số nhiều chữ số cần ngoặc {...}');
          const value = peek().v;
          tokens.splice(pos, 1, { k: 'number', v: value[0] }, { k: 'number', v: value.slice(1) });
        }
        return atom(plainMode);
      } finally { plainMode = previousMode; }
    }
    const commandArgument = () => argument(false, true);
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
        if (plainMode && (token.k === '{' || token.k === '}')) return symbol(token.v);
        if (token.k === '{') { pos--; return argument(true); }
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
        if (name === 'left') {
          const delimiter = () => {
            const token = tokens[pos++];
            if (!token) incomplete('Thiếu ký hiệu ngoặc của left/right');
            const value = token.k === 'cmd' ? aliases[token.v] || token.v : token.v;
            if (value === '.') return null;
            if (!['(', ')', '[', ']', '{', '}', '|', '‖', '⟨', '⟩'].includes(value)) fail(`Ký hiệu ngoặc chưa hỗ trợ: ${value}`);
            return value;
          };
          const open = delimiter();
          const body = sequence(() => peek()?.k === 'cmd' && peek()?.v === 'right');
          if (!peek()) incomplete('Thiếu right của ngoặc LaTeX');
          pos++;
          return fenced(open, body, delimiter());
        }
        if (name === 'right') incomplete('Ngoặc right không có left');
        if (['middle', 'big', 'Big', 'bigl', 'bigr', 'Bigl', 'Bigr', 'limits', 'nolimits'].includes(name)) {
          return null;
        }
        if (['quad', 'qquad', 'space', ',', ';', '!', ':', ' '].includes(name)) return null;
        // Legacy roman/italic declarations affect glyph layout, like the
        // already supported \mathrm and MathML normal/italic variants.
        // Keep every following symbol and the surrounding group intact.
        if (['rm', 'rmfamily', 'it', 'itshape'].includes(name)) return null;
        if ('{}[]|'.includes(name)) return symbol(name);
        if (['frac', 'dfrac', 'tfrac'].includes(name)) return { t: 'fraction', numerator: commandArgument(), denominator: commandArgument() };
        if (name === 'sqrt') {
          let degree = { t: 'number', v: '2' };
          if (peek()?.v === '[') {
            pos++; degree = sequence(() => peek()?.v === ']');
            if (peek()?.v !== ']') incomplete('Thiếu ] ở bậc căn');
            pos++;
          }
          return { t: 'root', degree, body: token.plain ? argument() : commandArgument() };
        }
        if (['text', 'operatorname', 'mathrm', 'mathbb', 'mathbf', 'mathcal', 'mathsf'].includes(name)) {
          const value = commandArgument();
          if (name === 'mathrm') return value;
          if (name === 'operatorname') return { t: 'function', v: render(value) };
          return { t: name === 'text' ? 'textmath' : 'style', style: name, body: value };
        }
        if (['vec', 'overrightarrow', 'hat', 'widehat', 'bar', 'overline', 'dot', 'ddot', 'underline'].includes(name)) {
          return { t: 'accent', kind: ({ overrightarrow: 'vec', widehat: 'hat', overline: 'bar' })[name] || name, body: commandArgument() };
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
          return brackets ? fenced(brackets[0], table, brackets[1]) : table;
        }
        fail(`Lệnh LaTeX chưa hỗ trợ: \\${name}`);
      } finally { depth--; }
    }
    function sequence(stop = () => false) {
      const items = [];
      while (peek() && !stop()) {
        if (peek().k === 'prime') {
          let count = 0;
          while (peek()?.k === 'prime') count += tokens[pos++].v;
          const base = items.pop() || row([]);
          if (base.t === 'script' && base.sup) fail('Chỉ số bị lặp');
          const script = base.t === 'script' ? { ...base } : { t: 'script', base, sub: null, sup: null };
          script.sup = row(Array.from({ length: count }, () => symbol('′')));
          items.push(script); continue;
        }
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
  function markup(source, contentOnly = false) {
    if (!contentOnly && source.length > 262144) fail('Nội dung quá dài');
    const root = { name: '#root', attrs: {}, nodes: [] }, stack = [root];
    let contentLength = 0, skipped = null, skipDepth = 0;
    const account = size => {
      contentLength += size;
      if (contentLength > 262144) fail('Nội dung văn bản/công thức quá dài');
    };
    source = source.replace(/<(?!\/?[A-Za-z][\w:-]*(?:\s|\/?>)|!--)/g, '&lt;');
    const parts = source.matchAll(/<!--[\s\S]*?-->|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g);
    for (const match of parts) {
      const part = match[0];
      if (skipped) {
        if (new RegExp(`^<\\/${skipped}\\s*>$`, 'i').test(part)) skipDepth--;
        else if (new RegExp(`^<${skipped}(?:\\s|>)`, 'i').test(part) && !/\/\s*>$/.test(part)) skipDepth++;
        if (!skipDepth) skipped = null;
        continue;
      }
      if (part.startsWith('<!--')) continue;
      if (part.startsWith('<!') || part.startsWith('<?')) fail('Khai báo XML chưa hỗ trợ');
      if (!part.startsWith('<')) { account(part.length); stack.at(-1).nodes.push(decode(part)); continue; }
      const closing = part.match(/^<\/([\w:-]+)\s*>$/);
      if (closing) {
        account(closing[1].length + 3);
        if (stack.length === 1 || stack.at(-1).name !== closing[1].toLowerCase().split(':').at(-1)) incomplete('Thẻ đóng không khớp');
        stack.pop(); continue;
      }
      const open = part.match(/^<([\w:-]+)([\s\S]*?)\/?\s*>$/);
      if (!open) incomplete('Thẻ bị cắt');
      const name = open[1].toLowerCase().split(':').at(-1);
      const inMath = !contentOnly || name === 'math' || stack.some(node => node.name === 'math');
      const attrs = {};
      // HTML media and layout attributes are not mathematical source. Image
      // collection uses the untouched HTML/DOM separately; MathML attributes
      // and original TeX remain intact, including unsupported syntax.
      if (inMath || name !== 'img') {
        for (const attr of open[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          const key = attr[1].toLowerCase();
          if (inMath || ['data-latex', 'type'].includes(key)) attrs[key] = decode(attr[2] ?? attr[3]);
        }
      }
      if (contentOnly && !inMath && (['svg', 'style'].includes(name) || name === 'script' && !/^math\/tex/.test(attrs.type || ''))) {
        if (!/\/\s*>$/.test(part)) { skipped = name; skipDepth = 1; }
        continue;
      }
      account(name.length + 2 + JSON.stringify(attrs).length);
      const node = { name, attrs, nodes: [] };
      stack.at(-1).nodes.push(node);
      if (!/\/\s*>$/.test(part) && !['br', 'img', 'hr', 'input', 'meta', 'link', 'wbr'].includes(node.name)) stack.push(node);
      if (stack.length > 128) fail('Nội dung lồng quá sâu');
    }
    if (stack.length !== 1 || skipped) incomplete('Thẻ chưa đóng');
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
        const fenceRole = (kid, role) => kid?.name === 'mo'
          && (kid.attrs['data-mjx-texclass'] === role || kid.attrs.fence === 'true');
        const first = visibleKids[0], last = visibleKids.at(-1);
        let body;
        if (visibleKids.length >= 3 && fenceRole(first, 'OPEN') && fenceRole(last, 'CLOSE')
            && (!xmlText(first).trim() || !xmlText(last).trim())) {
          // MathJax keeps an explicit empty operator for an invisible delimiter.
          // Preserve the visible side as structure, rather than ignoring it or
          // accepting arbitrary missing brackets beside a table.
          body = fenced(xmlText(first).trim(), row(visibleKids.slice(1, -1).map(parseMathML)), xmlText(last).trim());
        } else {
          body = row(visibleKids.map(parseMathML));
          // Conventional MathML cases omit the closing operator altogether.
          if (body.t === 'row' && body.items.length === 2 && body.items[0].t === 'symbol'
              && body.items[0].v === '{' && body.items[1].t === 'table') body = fenced('{', body.items[1], null);
        }
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
        const value = xmlText(node).trim();
        const number = value.match(/^(\d+(?:[.,]\d+)?)(\.)?$/);
        if (!number) fail(`Số MathML chưa hỗ trợ: ${value}`);
        const atom = { t: 'number', v: number[1].replace(',', '.') };
        // MathJax can put a sentence period inside mn (e.g. <mn>27.</mn>).
        // Retain it as punctuation: only the whole-content terminal period
        // normalizes away, never a dot inside scripts, fractions or tables.
        return number[2] ? row([atom, symbol('.')]) : atom;
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
        return fenced(node.attrs.open ?? '(', row(body), node.attrs.close ?? ')');
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
    if (node.t === 'row') return node.items.map((item, i) =>
      `${i && item.t === 'number' && node.items[i - 1].t === 'number' ? ' ' : ''}${render(item)}`).join('');
    if (node.t === 'fenced') {
      const delimiter = value => value ? /[{}]/.test(value) ? `\\${value}` : value : '.';
      return `\\left${delimiter(node.open)}${render(node.body)}\\right${delimiter(node.close)}`;
    }
    if (node.t === 'fraction') return `\\frac{${render(node.numerator)}}{${render(node.denominator)}}`;
    if (node.t === 'script') {
      const sup = render(node.sup);
      if (sup && /^′+$/.test(sup) && !node.sub) return `${render(node.base)}${sup.length === 2 ? '″' : sup.length === 3 ? '‴' : sup}`;
      return `${node.base.t === 'row' ? `{${render(node.base)}}` : render(node.base)}${node.sub ? `_{${render(node.sub)}}` : ''}${node.sup ? `^{${sup}}` : ''}`;
    }
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
    if (/\s/.test(s) && Array.from(s.matchAll(/[A-Za-z]{2,}/g)).some(m => !/^[A-Z]{1,3}$/.test(m[0]) && !functions.has(m[0]) && !s.includes(`\\${m[0]}`))) return false;
    if (/[\p{L}]/u.test(s.replace(/[A-Za-zα-ωΑ-Ωℕℤℚℝℂⁿ]/gu, ''))) return false;
    if (/\\[A-Za-z]+|[≤≥⩽⩾⇒⇔→←∪∩∈∉⊂⊆⊃⊇∞ℕℤℚℝℂ√½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉′″‴\u20d7\u0304\u0302\u0307\u0308\u0332]/u.test(s)) return true;
    if (!/[\p{L}\p{N}]/u.test(s)) return false;
    return /^[\dA-Za-zα-ωΑ-Ω\s+\-−–=<>^_()[\]{},;.:|/×·]+$/u.test(s) && !/[A-Za-z]{4,}/.test(s);
  }
  function isProseDate(value, prefix) {
    // A date introducer gives slash-separated calendar components a textual
    // meaning. Explicit math sources and bare chained divisions stay strict.
    if (!/(?:^|[^\p{L}\p{N}_])(?:ngày|date|dated|on)\s*:?\s*$/iu.test(prefix)) return false;
    const match = value.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
    if (!match) return false;
    const [day, month, year] = match.slice(1).map(Number);
    if (year < 1 || month < 1 || month > 12) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1];
  }
  function splitPlain(value, segments, prose = false) {
    const decoded = decode(value);
    let s = decoded.trim();
    if (!s) return;
    if (/^\s*\n/.test(decoded)) segments.push({ format: 'text', raw: '\n' });
    const pattern = /\$\$([\s\S]*?)\$\$|\$([^$]*?)\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g;
    let end = 0, found = false, lineHasMath = false;
    for (const m of s.matchAll(pattern)) {
      found = true;
      const prefix = s.slice(end, m.index);
      const raw = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (/\r?\n/.test(prefix)) lineHasMath = false;
      if (!lineHasMath && /(?:^|\n)\s*\d+\s*$/.test(prefix) && raw.trim() === ')') {
        splitPlain(prefix + ')', segments, prose);
      } else if (!lineHasMath && /(?:^|\n)\s*$/.test(prefix) && /^\s*\d+\s*\)\s*$/.test(raw) && s.slice(m.index + m[0].length).trim()) {
        splitPlain(prefix + raw.trim(), segments, prose);
      } else {
        splitPlain(prefix, segments, true);
        segments.push({ format: 'latex', raw });
        lineHasMath = true;
      }
      end = m.index + m[0].length;
    }
    if (found) { splitPlain(s.slice(end), segments, true); return; }
    if (/\$|\\[()[\]]/.test(s)) incomplete('Delimiter công thức chưa đóng');
    const lines = s.split(/\r?\n/);
    if (lines.length > 1 && lines.slice(1).some(line => /^\s*(\d+|[A-Za-z])\s*\)(?=\s|$)/.test(line))) {
      lines.forEach((line, index) => {
        if (index) segments.push({ format: 'text', raw: '\n' });
        splitPlain(line, segments, prose);
      });
      return;
    }
    // Number/letter list markers belong to surrounding prose. A fragment like
    // "1)" is often flushed immediately before a MathJax container; treating
    // it as math would introduce an unmatched closing fence into that formula.
    // Only infer markers in un-delimited text, with a whitespace/end boundary.
    const marker = s.match(/^(\d+|[A-Za-z])\s*\)(?=\s|$)/);
    if (marker) {
      segments.push({ format: 'text', raw: `${marker[1]})` });
      splitPlain(s.slice(marker[0].length), segments, prose);
      return;
    }
    // The dot in \right. is the invisible delimiter, not sentence punctuation.
    const bare = /\\right\s*\.$/.test(s) ? s : s.replace(/[.]$/, '');
    if (bare && looksMath(bare) && !(prose && /^[A-Za-z]{2,}$/.test(bare) && !/^[A-Z]{1,3}$/.test(bare))) {
      segments.push({ format: 'plain', raw: bare });
      if (bare !== s) segments.push({ format: 'text', raw: '.' });
    } else {
      // Read compact formulas in prose separately from Vietnamese text. Never
      // turn a sentence containing a relation symbol into one large formula.
      const chunk = '[A-Za-zα-ωΑ-Ω\\dℕℤℚℝℂⁿ⁰¹²³⁴⁵⁶⁷⁸⁹₀-₉′″‴+\\-−=<>≤≥⩽⩾⇒⇔→←^_()[\\]{},;:|/×·√½⅓⅔¼¾.]+';
      const inline = new RegExp(`${chunk}(?:\\s*[+\\-−=<>≤≥⩽⩾⇒⇔→←/×·]\\s*${chunk})*`, 'gu');
      let offset = 0;
      for (const match of s.matchAll(inline)) {
        if (/\p{L}/u.test(s[match.index - 1] || '') || /\p{L}/u.test(s[match.index + match[0].length] || '')) continue;
        const formula = match[0].replace(/[.,]$/, '');
        if (isProseDate(formula, s.slice(0, match.index))) continue;
        if (!looksMath(formula) || !/[=<>≤≥⩽⩾⇒⇔→←+\-−/^_√²³⁰¹⁴⁵⁶⁷⁸⁹₀-₉′″‴;]|^\([\d,]+\)$/u.test(formula)) continue;
        if (match.index > offset) segments.push({ format: 'text', raw: s.slice(offset, match.index) });
        segments.push({ format: 'plain', raw: formula });
        offset = match.index + formula.length;
      }
      if (offset < s.length) segments.push({ format: 'text', raw: s.slice(offset) });
    }
  }
  function readContent(input) {
    const segments = [];
    let source = '';
    try {
      if (input?.kind === 'canonical-math-content') return readContent(input.content);
      if (input && typeof input === 'object' && Array.isArray(input.segments)) {
        if (input.version !== 1) fail('Phiên bản math_content chưa hỗ trợ');
        const error = input.error || (input.status && input.status !== 'ok' ? { status: input.status, reason: input.reason } : null);
        if (error && !['unsupported', 'incomplete'].includes(error.status)) fail('Trạng thái math_content không hợp lệ');
        return { ...input, ...(error ? { error } : {}), status: 'ok', version: 1, segments: input.segments.map(s => ({ ...s })) };
      }
      if (input && typeof input === 'object' && typeof input.outerHTML !== 'string') fail('Đối tượng nội dung công thức không hợp lệ');
      source = input?.outerHTML ?? String(input ?? '');
      if (/<(?:math\b|mjx-|[A-Za-z][\w:-]*(?:\s|>))/i.test(source)) {
        const tree = markup(source, true);
        const proseDocument = /<(?:p|div|li|br)\b/i.test(source);
        let pending = '', lineHasMath = false;
        const append = value => {
          pending += value;
          if (/\r?\n/.test(value)) lineHasMath = false;
        };
        const flush = () => { splitPlain(pending, segments, proseDocument); pending = ''; };
        const emitMath = (format, raw, node) => {
          // Onluyen can render just the list delimiter as its own MathML node:
          // text "1 " + <math><mo>)</mo></math>. Recognize it only after a
          // numeric label at the beginning of a prose line, before other math.
          const marker = !lineHasMath && pending.match(/(?:^|\n)\s*\d+\s*$/);
          let closingLabel = format === 'latex' && raw.trim() === ')';
          if (marker && format === 'mathml') {
            try { const body = parseMathML(node); closingLabel = body.t === 'symbol' && body.v === ')'
              || body.t === 'row' && body.items.length === 1 && body.items[0].t === 'symbol' && body.items[0].v === ')'; }
            catch (_error) { /* Unknown markup stays in the source. */ }
          }
          if (marker && closingLabel) {
            append(')');
            return;
          }
          // A full label may also be inside the renderer: <mn>1</mn><mo>)</mo>.
          // Require a prose document, a line boundary and exactly these two
          // atoms. A closing fence inside an actual formula stays in math.
          if (proseDocument && !lineHasMath && /(?:^|\n)\s*$/.test(pending)) {
            const label = (format === 'latex' ? raw : xmlText(node)).trim().match(/^(\d+)\s*\)$/);
            if (label) {
              try {
                const body = format === 'latex' ? parseLatex(raw) : parseMathML(node);
                if (body.t === 'row' && body.items.length === 2 && body.items[0].t === 'number'
                    && body.items[0].v === label[1] && body.items[1].t === 'symbol' && body.items[1].v === ')') {
                  append(`${label[1]})`);
                  return;
                }
              } catch (_error) { /* Preserve the original formula below. */ }
            }
          }
          flush(); segments.push({ format, raw }); lineHasMath = true;
        };
        const walk = node => {
          if (typeof node === 'string') { append(node); return; }
          if (node.name === 'script' && /^math\/tex/.test(node.attrs.type || '')) {
            emitMath('latex', xmlText(node)); return;
          }
          if (['svg', 'script', 'style', 'annotation', 'annotation-xml'].includes(node.name)) return;
          if (node.name === 'math') {
            const annotation = (function find(n) {
              if (typeof n === 'string') return null;
              if (n.name === 'annotation' && /^(?:application\/(?:x-)?tex|text\/tex)$/i.test(n.attrs.encoding || '')) return n;
              return n.nodes.map(find).find(Boolean);
            })(node);
            if (annotation && xmlText(annotation).trim()) emitMath('latex', xmlText(annotation), node);
            else emitMath('mathml', xmlSource(node), node);
            return;
          }
          if (node.name === 'mjx-container') {
            const findMath = n => typeof n === 'string' ? null : n.name === 'math' ? n : n.nodes.map(findMath).find(Boolean);
            const math = findMath(node);
            if (node.attrs['data-latex']) emitMath('latex', node.attrs['data-latex']);
            else if (math) walk(math);
            else incomplete('MathJax chưa render: chưa có MathML/LaTeX gốc');
            return;
          }
          if (['p', 'div', 'br', 'li'].includes(node.name)) append('\n');
          node.nodes.forEach(walk);
          if (['p', 'div', 'li'].includes(node.name)) append('\n');
        };
        walk(tree); flush();
      } else splitPlain(source, segments);
      return { status: 'ok', version: 1, segments };
    } catch (e) { return { status: e.status || 'unsupported', reason: e.message, version: 1, segments, source }; }
  }
  function canonicalize(input) {
    const content = readContent(input);
    if (content.status !== 'ok') return content;
    if (content.error) return { ...content.error, content };
    try {
      const mapped = content.segments.flatMap(segment => {
        if (segment.format === 'text') {
          const value = decode(segment.raw).normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\p{L}+/gu, word => {
            if (/^[A-Z]{1,3}$/.test(word) || /^[α-ωΑ-Ω]$/.test(word)) return word;
            const lower = word.toLocaleLowerCase('vi');
            return lower === 'toạ' ? 'tọa' : lower;
          }).replace(/\s+/g, ' ').trim();
          // Short capital names in prose (triangle ABC, points A/B, P/Q)
          // have the same letters whether rendered as text or math. Preserve
          // case and order; never flatten scripts, accents or other math nodes.
          const parts = [];
          let offset = 0;
          for (const match of value.matchAll(/(?<![\p{L}\p{N}_])[A-Z]{1,3}(?![\p{L}\p{N}_])/gu)) {
            if (match.index > offset) parts.push({ t: 'text', v: value.slice(offset, match.index).trim() });
            parts.push({ t: 'math', body: parseLatex(match[0], true) });
            offset = match.index + match[0].length;
          }
          if (offset < value.length) parts.push({ t: 'text', v: value.slice(offset).trim() });
          return parts;
        }
        if (segment.format === 'latex' || segment.format === 'plain') {
          const raw = segment.raw.trim().replace(/^(\d+),(\d+)$/, '$1.$2');
          return { t: 'math', body: parseLatex(raw, segment.format === 'plain') };
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
      const tokens = parts.flatMap(part => part.t === 'text' ? proseTokens(part.v) : mathTokens(part.body));
      // Sentence punctuation belongs to the full content, not each renderer
      // fragment. Removing it from each text segment loses interior periods.
      if (tokens.at(-1)?.t === 'symbol' && tokens.at(-1).v === '.') tokens.pop();
      return { kind: 'canonical-math-content', canonicalVersion: 2, status: 'ok', key: tokens.length ? JSON.stringify(tokens) : '', tokens, parts, content };
    } catch (e) { return { status: e.status || 'unsupported', reason: e.message, content }; }
  }
  function proseTokens(value) {
    return Array.from(value.matchAll(/[\p{L}\p{M}]+|\d+(?:\.\d+)?|[^\s]/gu), match => {
      const atom = match[0];
      if (/^\d+(?:\.\d+)?$/.test(atom)) return [{ t: 'number', v: atom }];
      if (/^[A-Za-zα-ωΑ-Ω]$/.test(atom) || /^[A-Z]{1,3}$/.test(atom)) return Array.from(atom, c => mathTokens(symbol(c))).flat();
      if (/^[\p{L}\p{M}]+$/u.test(atom)) return [{ t: 'word', v: atom }];
      return [symbol(atom)];
    }).flat();
  }
  function mathTokens(node) {
    if (node.t === 'row') return node.items.flatMap(mathTokens);
    if (node.t === 'number' || node.t === 'symbol') return [node];
    // Fractions, scripts, roots, styles, text inside formulas and tables remain
    // opaque structural atoms. They must never match their flattened spelling.
    return [{ t: 'structure', body: node }];
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
      if (stack.length) incomplete('Ngoặc công thức chưa đóng');
    } else {
      for (const key of ['base', 'sub', 'sup', 'numerator', 'denominator', 'body', 'degree']) if (node[key]) validateFences(node[key]);
      if (node.rows) node.rows.flat().forEach(validateFences);
    }
  }
  function compare(left, right) {
    const a = canonicalize(left), b = canonicalize(right);
    if (a.status !== 'ok' || b.status !== 'ok') {
      const bad = a.status !== 'ok' ? a : b;
      return { status: bad.status, code: bad.status === 'incomplete' ? 'INCOMPLETE_SOURCE' : 'UNSUPPORTED_SYNTAX', reason: bad.reason };
    }
    if (a.key === b.key) return { status: 'equal', code: 'MATCH', reason: '' };
    let differenceIndex = 0;
    while (JSON.stringify(a.tokens[differenceIndex]) === JSON.stringify(b.tokens[differenceIndex])) differenceIndex++;
    const describe = token => token ? token.v ?? render(token.body) : '(hết nội dung)';
    return { status: 'different', code: 'CONTENT_DIFFERENT', reason: 'Nội dung/cấu trúc công thức khác nhau', diagnostic: { index: differenceIndex, left: a.tokens[differenceIndex] ?? null, right: b.tokens[differenceIndex] ?? null, leftText: describe(a.tokens[differenceIndex]), rightText: describe(b.tokens[differenceIndex]) } };
  }
  // Formatting a prompt must not depend on parsing every possible formula.
  // In particular, an unknown MathML element is exported as MathML, never as
  // its flattened textContent or the surrounding page HTML.
  function toPromptContent(input, options = {}) {
    const content = readContent(input);
    const diagnostics = [];
    if (content.status !== 'ok' || content.error) {
      const problem = content.error || content;
      return { ok: false, status: problem.status, text: '', segments: content.segments || [],
        diagnostics: [{ phase: 'scrape', status: problem.status, reason: problem.reason }] };
    }
    if (!content.segments.some(segment => String(segment.raw || '').trim())) {
      return { ok: false, status: 'incomplete', text: '', segments: content.segments,
        diagnostics: [{ phase: 'scrape', status: 'incomplete', reason: 'Nguồn câu hỏi hoặc lựa chọn trống' }] };
    }
    const pieces = content.segments.map((segment, index) => {
      const raw = String(segment.raw ?? '');
      if (segment.format === 'text' || segment.format === 'plain') {
        if (segment.format === 'plain') {
          const parsed = canonicalize({ version: 1, segments: [segment] });
          if (parsed.status !== 'ok') diagnostics.push({ phase: 'parse', index, format: 'plain', status: parsed.status, reason: parsed.reason });
        }
        return decode(raw);
      }
      if (segment.format === 'latex') {
        try { const body = parseLatex(raw); validateFences(body); if (options.display) return render(body); }
        catch (e) { diagnostics.push({ phase: 'parse', index, format: 'latex', status: e.status || 'unsupported', reason: e.message }); }
        return options.display ? raw : `\\(${raw}\\)`;
      }
      if (segment.format === 'mathml') {
        try {
          const tree = markup(raw), nodes = elements(tree);
          if (nodes.length !== 1) incomplete('Nguồn MathML không đầy đủ');
          const body = parseMathML(nodes[0]);
          validateFences(body);
          if (options.display) return render(body);
          const latexTree = value => {
            if (Array.isArray(value)) return value.map(latexTree);
            if (!value || typeof value !== 'object') return value;
            const copied = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, latexTree(child)]));
            if (copied.t === 'symbol' && /^[{}%#&$_]$/.test(copied.v)) copied.v = `\\${copied.v}`;
            if (copied.t === 'function' && /^[a-z]+$/.test(copied.v)) copied.v = `\\${copied.v} `;
            return copied;
          };
          const latex = render(latexTree(body));
          const converted = { version: 1, segments: [{ format: 'latex', raw: latex }] };
          if (compare({ version: 1, segments: [segment] }, converted).status !== 'equal') {
            fail('Chuyển MathML sang LaTeX chưa bảo toàn cấu trúc; giữ nguồn MathML');
          }
          return `\\(${latex}\\)`;
        } catch (e) {
          diagnostics.push({ phase: 'parse', index, format: 'mathml', status: e.status || 'unsupported', reason: e.message });
          return options.display ? `[MathML] ${raw} [/MathML]` : `\n[MathML]\n${raw}\n[/MathML]\n`;
        }
      }
      diagnostics.push({ phase: 'parse', index, format: segment.format, status: 'unsupported', reason: 'Định dạng nguồn chưa hỗ trợ' });
      return '';
    });
    if (diagnostics.some(issue => issue.format && !['text', 'plain', 'latex', 'mathml'].includes(issue.format))) {
      return { ok: false, status: 'unsupported', text: '', segments: content.segments, diagnostics };
    }
    const text = pieces.join(' ').replace(/ +([.,;:])/g, '$1').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { ok: !!text, status: text ? 'ok' : 'incomplete', text, segments: content.segments, diagnostics };
  }
  function text(input) {
    return toPromptContent(input, { display: true }).text.replace(/ +([.,;])/g, '$1').replace(/[ \t]+/g, ' ').trim();
  }
  function metadata(input, origin = 'source') {
    const c = readContent(input);
    return c.status === 'ok' ? { version: 1, origin, segments: c.segments, ...(c.error ? { error: c.error } : {}) }
      : { version: 1, origin, segments: c.segments || [], source: c.source,
        error: { status: c.status, reason: c.reason } };
  }
  function combine(...inputs) {
    const contents = inputs.map(input => typeof input === 'object' && input?.segments ? input : metadata(input));
    const error = contents.find(c => c.error)?.error;
    return { version: 1, origin: 'source', segments: contents.flatMap(c => c.segments), ...(error ? { error } : {}) };
  }
  function sourceFingerprint(input) {
    const canonical = canonicalize(input);
    if (canonical.status === 'ok') return JSON.stringify(['canonical', canonical.key]);
    const content = readContent(input);
    return JSON.stringify(['source', content.status, content.error?.status || '',
      (content.segments || []).map(segment => [segment.format, String(segment.raw).replace(/\r\n?/g, '\n')]),
      content.status !== 'ok' || content.error ? content.source || '' : '']);
  }
  function exactSourceMatch(left, right) {
    const a = readContent(left), b = readContent(right);
    if (a.status !== 'ok' || b.status !== 'ok' || a.error || b.error || !a.segments.length || !b.segments.length) return false;
    return JSON.stringify(a.segments.map(s => [s.format, String(s.raw).replace(/\r\n?/g, '\n')]))
      === JSON.stringify(b.segments.map(s => [s.format, String(s.raw).replace(/\r\n?/g, '\n')]));
  }
  function sourceDifference(left, right) {
    const a = readContent(left).segments || [], b = readContent(right).segments || [];
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if (a[index]?.format === b[index]?.format && a[index]?.raw === b[index]?.raw) continue;
      const x = String(a[index]?.raw || ''), y = String(b[index]?.raw || '');
      let offset = 0; while (offset < Math.min(x.length, y.length) && x[offset] === y[offset]) offset++;
      return { index, sourceOffset: offset, format: a[index]?.format || b[index]?.format || null,
        leftText: x.slice(offset, offset + 100) || '(hết nguồn)', rightText: y.slice(offset, offset + 100) || '(hết nguồn)' };
    }
    return null;
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
    if (bad && !(ids.length === 1 && matches.length === 1 && matches[0] === ids[0])) return { ...bad, choice: null };
    if (matches.length > 1 || ids.length > 1) return { status: 'different', reason: 'Khớp nhiều lựa chọn', choice: null };
    if (optionId != null && choices.some(c => c.idOption != null) && ids.length !== 1) return { status: 'different', code: 'ID_CONFLICT', reason: 'ID đáp án không tồn tại trong các lựa chọn hiện tại', choice: null };
    if (ids.length && hasSaved && matches[0] !== ids[0]) return { status: 'different', reason: 'ID đáp án và nội dung mâu thuẫn', choice: null };
    const choice = matches[0] || (!hasSaved && ids[0]);
    return choice ? { status: 'equal', reason: '', choice } : { status: 'different', reason: 'Không có lựa chọn khớp duy nhất', choice: null };
  }
  function verifyChoice(choices, saved, optionId, imageRefs, context = {}) {
    const failVerification = (code, reason, status = 'different') => ({ status, code, reason, choice: null,
      verification: { version: 1, basis: 'blocked', reason } });
    const ids = optionId == null ? [] : choices.filter(choice => choice.idOption != null && String(choice.idOption) === String(optionId));
    if (optionId != null && ids.length !== 1) return failVerification('ID_CONFLICT', 'ID lựa chọn không khớp duy nhất.');
    const labels = context.snapshotValid && context.label != null
      ? choices.filter(choice => String(choice.label).toUpperCase() === String(context.label).toUpperCase()) : [];
    if (labels.length > 1) return failVerification('MULTIPLE_MATCHES', 'Nhãn lựa chọn bị trùng.');
    if (ids.length && labels.length && ids[0] !== labels[0]) return failVerification('ID_CONFLICT', 'ID lựa chọn và chữ cái mâu thuẫn.');
    const byIdentity = ids[0] || labels[0] || null;
    const hasSource = saved !== null && saved !== undefined && saved !== '';
    if (hasSource || imageRefs != null) {
      const resolved = resolveChoice(choices, saved, optionId, imageRefs);
      if (resolved.status === 'equal') {
        if (labels.length && labels[0] !== resolved.choice) return failVerification('ID_CONFLICT', 'Nội dung và chữ cái của snapshot mâu thuẫn.');
        return { ...resolved, verification: { version: 1, basis: 'structured', reason: imageRefs != null ? 'Nguồn ảnh khớp duy nhất' : 'Nội dung có cấu trúc khớp duy nhất' } };
      }
      if (imageRefs != null) return resolved;
      if (/mất cấu trúc/.test(resolved.reason || '')) return resolved;
      const target = byIdentity || null;
      const compared = target ? compare(saved, target.math_content || target.text) : null;
      if (compared?.status === 'different') return failVerification('ID_CONFLICT', 'ID/chữ cái và nội dung đáp án mâu thuẫn.');
      if (target && compared?.status === 'equal') return { status: 'equal', code: 'IDENTITY_MATCH', reason: '', choice: target,
        verification: { version: 1, basis: ids.length ? 'structured' : 'snapshot',
          evidence: ids.length ? 'option_id' : 'snapshot_label', reason: 'Định danh lựa chọn và nội dung có cấu trúc khớp' } };
      // Raw source can prove identity when a parser does not know this syntax.
      // It is never converted into a mathematical `equal` comparison.
      const rawMatches = choices.filter(choice => exactSourceMatch(saved, choice.math_content || choice.text));
      if ((target && rawMatches.includes(target)) || (rawMatches.length === 1 && !target)) {
        return { status: 'equal', code: 'SOURCE_MATCH', reason: '', choice: target || rawMatches[0],
          verification: { version: 1, basis: 'snapshot', evidence: 'exact_source',
            reason: target ? 'Định danh lựa chọn và nguồn nguyên dạng khớp' : 'Nguồn công thức nguyên dạng khớp duy nhất' } };
      }
      if (rawMatches.length > 1) return failVerification('MULTIPLE_MATCHES', 'Nguồn nguyên dạng khớp nhiều lựa chọn.');
      return { ...resolved, code: resolved.code || (target ? 'ID_CONFLICT' : errorCode(resolved.reason, resolved.status)),
        ...(target ? { diagnostic: { ...sourceDifference(saved, target.math_content || target.text), choiceLabel: target.label } } : {}), choice: null };
    }
    if (!byIdentity) return failVerification('SNAPSHOT_EXPIRED', 'Thiếu nội dung/ID và snapshot hợp lệ.');
    const targetSource = byIdentity.math_content || byIdentity.text;
    if (!toPromptContent(targetSource).ok && !(byIdentity.images || []).length) {
      return failVerification('SCRAPE_INCOMPLETE', 'Lựa chọn được chỉ định chưa có nguồn.', 'incomplete');
    }
    if (!context.snapshotValid && canonicalize(targetSource).status !== 'ok') {
      return failVerification('SNAPSHOT_EXPIRED', 'Công thức chưa hỗ trợ cần snapshot hiện tại để dùng ID.');
    }
    return { status: 'equal', code: 'IDENTITY_MATCH', reason: '', choice: byIdentity,
      verification: { version: 1, basis: context.snapshotValid ? 'snapshot' : 'structured',
        evidence: ids.length ? 'option_id' : 'snapshot_label', reason: ids.length ? 'ID lựa chọn hợp lệ' : 'Chữ cái của snapshot hiện tại' } };
  }
  function signature(questions) {
    return JSON.stringify(questions.map(q => ({
      number: q.number, id: q.sourceId || null, type: q.answerType,
      prompt: sourceFingerprint(q.math_content?.question || q.prompt),
      choices: (q.choices || []).map(c => ({ label: c.label, id: c.idOption ?? null,
        key: sourceFingerprint(c.math_content || c.text),
        images: (c.images || []).map(i => typeof i === 'string' ? i : i.src) }))
    })));
  }
  function errorCode(reason, status = 'different') {
    if (/MathJax|render/.test(reason || '')) return 'NOT_RENDERED';
    if (/mất cấu trúc/.test(reason || '')) return 'LOSSY_DATABASE';
    if (/nhiều|trùng/.test(reason || '')) return 'MULTIPLE_MATCHES';
    if (/mâu thuẫn/.test(reason || '')) return 'ID_CONFLICT';
    return status === 'unsupported' ? 'UNSUPPORTED_SYNTAX' : status === 'incomplete' ? 'INCOMPLETE_SOURCE' : 'CONTENT_DIFFERENT';
  }
  function validateExam(questions, entries, options = {}) {
    const issues = [], warnings = [], mappings = [], used = new Set();
    const snapshotQuestions = options.snapshotQuestions || questions;
    const snapshotValid = !!options.snapshotId && options.snapshotSignature === signature(snapshotQuestions)
      && questions.every(q => snapshotQuestions.some(full => signature([q]) === signature([full])));
    const add = (q, result, source, label) => {
      const value = readContent(source || '');
      issues.push({ number: q?.number ?? null, id: q?.sourceId || null, label: label ?? null,
        status: result.status || 'different', code: result.code || errorCode(result.reason, result.status),
        phase: result.phase || 'match', origin: source?.origin && source.origin !== 'source' ? source.origin : q?.origin || source?.origin || null,
        reason: result.reason, ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
        source: value.segments.map(s => ({ format: s.format, raw: String(s.raw).slice(0, 8192) })) });
    };
    entries = entries.filter(entry => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) return true;
      add(null, { status: 'unsupported', code: 'INVALID_DATABASE_ENTRY', reason: 'Mỗi đáp án phải là một object JSON.' });
      return false;
    });
    if (!questions.length || (options.expectedTotal && questions.length !== options.expectedTotal)) {
      add(null, { status: 'incomplete', code: 'INCOMPLETE_EXAM', reason: 'Chưa đọc đủ toàn bộ đề.' });
    }
    const ids = new Set(), numbers = new Set();
    for (const q of questions) {
      const start = issues.length;
      if (q.readError) add(q, { status: 'incomplete', code: 'SCRAPE_INCOMPLETE', phase: 'scrape', reason: q.readError });
      if (numbers.has(q.number) || (q.sourceId && ids.has(String(q.sourceId)))) {
        add(q, { code: 'DUPLICATE_QUESTION', reason: 'ID hoặc số câu bị trùng trong đề.' });
      }
      numbers.add(q.number); if (q.sourceId) ids.add(String(q.sourceId));
      const choices = q.choices || [];
      if (q.readError || q.answerType !== 'SHORT' && choices.length < Math.max(2, q.expectedChoiceCount || 0)) {
        add(q, { status: 'incomplete', code: 'NOT_RENDERED', reason: 'Chưa đọc đủ lựa chọn.' });
      }
      for (const [source, label] of [[q.math_content?.question || q.prompt, null], ...choices.map(c => [c.math_content || c.text, c.label])]) {
        const rendered = toPromptContent(source);
        if (!rendered.ok && !(label && choices.find(c => c.label === label)?.images?.length)) {
          const problem = rendered.diagnostics[0] || {};
          add(q, { status: rendered.status, code: problem.reason?.includes('MathJax') ? 'NOT_RENDERED' : 'SCRAPE_INCOMPLETE',
            phase: 'scrape', reason: problem.reason || 'Nguồn câu hỏi hoặc lựa chọn chưa đầy đủ' }, source, label);
        } else for (const diagnostic of rendered.diagnostics) {
          warnings.push({ number: q.number, id: q.sourceId || null, label, origin: source?.origin && source.origin !== 'source' ? source.origin : q.origin || source?.origin || null,
            phase: 'parse', format: diagnostic.format, status: diagnostic.status, reason: diagnostic.reason });
        }
      }
      const candidates = entries.filter(e => {
        const id = e.id ?? e.question_id ?? e.sourceId;
        if (id != null && String(id).trim()) return String(id) === String(q.sourceId);
        const prompt = e.math_content?.question || e.noi_dung_cau_hoi || e.question_text || e.q_content;
        if (prompt) return compare(prompt, q.math_content?.question || q.prompt).status === 'equal'
          || exactSourceMatch(prompt, q.math_content?.question || q.prompt);
        return snapshotValid && e.snapshot_id === options.snapshotId && Number(e.cau ?? e.q ?? e.number) === q.number;
      });
      if (candidates.length !== 1) {
        add(q, { code: candidates.length ? 'MULTIPLE_MATCHES' : 'MISSING_ANSWER', reason: candidates.length ? 'Nhiều đáp án khớp cùng câu.' : 'Thiếu đáp án khớp ID/nội dung câu; dữ liệu chỉ có số thứ tự cần snapshot_id hợp lệ.' });
        continue;
      }
      const entry = candidates[0]; used.add(entry);
      const declared = String(entry.loai ?? entry.type ?? q.answerType).toUpperCase();
      const types = { MCQ: 'MCQ', SINGLE: 'MCQ', SINGLE_CHOICE: 'MCQ', 0: 'MCQ', TF: 'TF', TRUE_FALSE: 'TF', 1: 'TF', SHORT: 'SHORT', SA: 'SHORT', SHORT_ANSWER: 'SHORT', FILL_IN: 'SHORT', 2: 'SHORT' };
      if (types[declared] !== q.answerType) add(q, { code: 'ANSWER_TYPE_CONFLICT', reason: 'Loại đáp án không khớp loại câu hỏi hiện tại.' });
      const positional = snapshotValid && entry.snapshot_id === options.snapshotId;
      const savedPrompt = entry.math_content?.question || entry.noi_dung_cau_hoi || entry.question_text;
      if (savedPrompt) {
        const result = compare(savedPrompt, q.math_content?.question || q.prompt);
        if (result.status !== 'equal' && !exactSourceMatch(savedPrompt, q.math_content?.question || q.prompt)) {
          add(q, { ...result, code: 'QUESTION_ID_CONFLICT', reason: 'ID câu và nội dung đề mâu thuẫn.' }, savedPrompt);
        }
      }
      const answer = entry.dap_an ?? entry.answer ?? entry.a;
      if (q.answerType === 'SHORT') {
        if (answer == null || String(answer).trim() === '') add(q, { code: 'MISSING_ANSWER', reason: 'Thiếu đáp án trả lời ngắn.' });
        if (issues.length === start) mappings.push({ question: q, entry, answer: String(answer).trim(), verification: { version: 1, basis: 'structured', reason: 'ID/nội dung câu khớp và giá trị trả lời ngắn hợp lệ' } });
        continue;
      }
      if (q.answerType === 'TF') {
        const texts = entry.noi_dung_cac_y || entry.statement_texts || entry.choiceTexts || {};
        const sources = entry.math_content?.statements || {};
        const choiceIds = entry.id_cac_y || {};
        const keys = [...new Set([...Object.keys(texts), ...Object.keys(sources), ...Object.keys(choiceIds)])];
        const mapped = {}, evidence = [];
        for (const key of keys.length ? keys : Object.keys(answer || {})) {
          const source = sources[key] || texts[key];
          const result = verifyChoice(choices, source, choiceIds[key], null,
            { snapshotValid: positional, label: positional ? key : null });
          if (result.status !== 'equal') { add(q, result, source, key); continue; }
          if (sources[key] && texts[key]) {
            const additional = verifyChoice(choices, texts[key], choiceIds[key], null,
              { snapshotValid: positional, label: positional ? key : null });
            if (additional.status !== 'equal' || additional.choice !== result.choice) {
              add(q, { code: 'ID_CONFLICT', reason: 'Nguồn và nội dung ý Đúng/Sai mâu thuẫn hoặc chưa xác minh được.' }, texts[key], key);
              continue;
            }
          }
          const label = result.choice.label, value = answer?.[key];
          if (Object.hasOwn(mapped, label)) add(q, { code: 'MULTIPLE_MATCHES', reason: 'Nhiều ý cùng khớp một lựa chọn Đúng/Sai.' }, source, key);
          else if (!/^(?:đúng|dung|sai|true|false|1|0)$/i.test(String(value))) add(q, { code: 'MISSING_ANSWER', reason: 'Thiếu giá trị Đúng/Sai hợp lệ.' }, '', key);
          else { mapped[label] = /^(?:đúng|dung|true|1)$/i.test(String(value)) ? 'Đúng' : 'Sai'; evidence.push(result.verification); }
        }
        if (Object.keys(mapped).length !== choices.length) add(q, { code: 'MISSING_ANSWER', reason: 'Chưa xác minh đủ các ý Đúng/Sai.' });
        if (!keys.length && !positional) add(q, { code: 'SNAPSHOT_EXPIRED', reason: 'Đáp án Đúng/Sai theo vị trí cần snapshot_id của đề hiện tại.' });
        if (issues.length === start) mappings.push({ question: q, entry, answer: mapped,
          verification: { version: 1, basis: evidence.some(e => e.basis === 'snapshot') ? 'snapshot' : 'structured',
            statements: evidence, reason: 'Các ý Đúng/Sai khớp duy nhất' } });
        continue;
      }
      const source = entry.math_content?.answer || entry.noi_dung_dap_an_goc || entry.noi_dung_dap_an || entry.answer_text || entry.a_content;
      const imageRefs = entry.anh_dap_an ?? entry.answer_images;
      const optionId = entry.id_dap_an ?? entry.answer_id ?? entry.answerId;
      const resolution = verifyChoice(choices, source, optionId, imageRefs,
        { snapshotValid: positional, label: positional ? answer : null });
      const suppliedText = entry.noi_dung_dap_an_goc || entry.noi_dung_dap_an || entry.answer_text || entry.a_content;
      if (entry.math_content?.answer && suppliedText && resolution.status === 'equal') {
        const supplied = verifyChoice(choices, suppliedText, optionId, imageRefs,
          { snapshotValid: positional, label: positional ? answer : null });
        if (supplied.status !== 'equal' || supplied.choice !== resolution.choice) {
          add(q, { ...supplied, code: 'ID_CONFLICT', reason: 'Nguồn và nội dung đáp án người dùng gửi mâu thuẫn hoặc chưa xác minh được.' }, suppliedText);
        }
      }
      if (resolution.status !== 'equal') {
        const comparisons = source ? choices.map(c => ({ ...compare(source, c.math_content || c.text), label: c.label })) : [];
        const difference = comparisons.find(c => c.diagnostic);
        add(q, { ...resolution, ...(!resolution.diagnostic && difference ? { diagnostic: { ...difference.diagnostic, choiceLabel: difference.label } } : {}) }, source);
      } else if (issues.length === start) mappings.push({ question: q, entry, choice: resolution.choice,
        answer: resolution.choice.label, verification: resolution.verification });
    }
    for (const entry of entries) if (!used.has(entry)) add(null, { code: 'QUESTION_NOT_FOUND', reason: `Không tìm thấy câu của đáp án ID ${entry.id ?? entry.sourceId ?? 'không có'}, số ${entry.cau ?? entry.q ?? '?'}.` }, entry.math_content?.question || entry.noi_dung_cau_hoi);
    return { version: 1, ok: !issues.length, count: questions.length, issues, warnings, mappings };
  }
  function matchReport(validation, versions = {}) {
    return { version: 1, canonicalVersion: 2, ...versions, ok: validation.ok, count: validation.count,
      issues: validation.issues, warnings: validation.warnings || [],
      verified: (validation.mappings || []).map(mapping => ({ number: mapping.question.number,
        id: mapping.question.sourceId || null, basis: mapping.verification?.basis || 'structured',
        reason: mapping.verification?.reason || '' })) };
  }
  function splitPrompt(prompt, limit = 60000) {
    const blocks = String(prompt).split(/(?=^=== CÂU \d+ ===)/m);
    const header = blocks.shift();
    if (!blocks.length) {
      if (header.length > limit) throw new Error('Prompt vượt giới hạn và không có ranh giới câu để chia.');
      return [header];
    }
    const parts = []; let current = header;
    for (const block of blocks) {
      if (header.length + block.length > limit) throw new Error('Một câu vượt giới hạn prompt; cần tăng giới hạn để xuất đầy đủ nguồn.');
      if (current.length + block.length > limit) { parts.push(current); current = header; }
      current += block;
    }
    if (current !== header) parts.push(current);
    return parts;
  }
  function inspectPromptSources(questions) {
    const issues = [], warnings = [];
    for (const q of questions) {
      const choices = q.choices || [];
      if (q.answerType !== 'SHORT' && choices.length < Math.max(2, q.expectedChoiceCount || 0)) {
        issues.push({ number: q.number, id: q.sourceId || null, phase: 'scrape', origin: q.origin || null,
          status: 'incomplete', code: 'SCRAPE_INCOMPLETE', reason: q.readError || 'thiếu phương án: chưa đọc đủ phương án.', source: [] });
      }
      for (const [source, label, images] of [[q.math_content?.question || q.prompt, null, []],
        ...choices.map(c => [c.math_content || c.text, c.label, c.images || []])]) {
        const result = toPromptContent(source);
        for (const diagnostic of result.diagnostics) {
          if (!result.ok && images.length) continue;
          const value = { number: q.number, id: q.sourceId || null, label, phase: diagnostic.phase,
            origin: q.origin || source?.origin || null, format: diagnostic.format || null,
            status: diagnostic.status, code: result.ok ? 'UNSUPPORTED_SYNTAX' : /render/.test(diagnostic.reason || '') ? 'NOT_RENDERED' : 'SCRAPE_INCOMPLETE',
            reason: diagnostic.reason, source: result.segments.map(s => ({format:s.format,raw:String(s.raw).slice(0,8192)})) };
          (result.ok ? warnings : issues).push(value);
        }
      }
    }
    if (!questions.length) issues.push({ number: null, id: null, phase: 'scrape', status: 'incomplete', code: 'SCRAPE_INCOMPLETE', reason: 'Chưa đọc được đề.', source: [] });
    return { version: 1, ok: !issues.length, count: questions.length, issues, warnings, mappings: [] };
  }
  return { readContent, canonicalize, compare, text, toPromptContent, splitPrompt, inspectPromptSources, metadata, combine, sourceFingerprint, exactSourceMatch, resolveChoice, verifyChoice, signature, validateExam, matchReport, errorCode };
});
