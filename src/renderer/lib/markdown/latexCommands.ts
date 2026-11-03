// Project: Portalogia
// Owner: Joshua H. Kirby
// Copyright (c) 2026 Joshua H. Kirby. All rights reserved.
// Last Modified: 2026-10-06

/**
 * One LaTeX command the editor can complete. `name` has no backslash.
 * `template` (a CodeMirror snippet, with `${…}` fields) is what is inserted
 * when the command takes arguments, so `\frac` lands as `\frac{▮}{▮}` with
 * the cursor in the first brace. `detail` is the short hint shown beside it.
 */
export interface LatexCommand {
  readonly name: string;
  readonly detail: string;
  readonly template?: string;
  /** Sorts commonly typed commands ahead of rarer ones that share a prefix. */
  readonly boost?: number;
}

/** A symbol or operator with no arguments: `[name, what it looks like or is]`. */
type Plain = readonly [name: string, detail: string];

const toPlain = (rows: readonly Plain[]): LatexCommand[] => rows.map(([name, detail]) => ({ name, detail }));

const GREEK: readonly Plain[] = [
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'], ['varepsilon', 'ε'],
  ['zeta', 'ζ'], ['eta', 'η'], ['theta', 'θ'], ['vartheta', 'ϑ'], ['iota', 'ι'], ['kappa', 'κ'],
  ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'], ['varpi', 'ϖ'], ['rho', 'ρ'],
  ['varrho', 'ϱ'], ['sigma', 'σ'], ['varsigma', 'ς'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'ϕ'],
  ['varphi', 'φ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
  ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'],
  ['Sigma', 'Σ'], ['Upsilon', 'Υ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
];

const FUNCTIONS: readonly Plain[] = [
  ['sin', 'sine'], ['cos', 'cosine'], ['tan', 'tangent'], ['cot', 'cotangent'], ['sec', 'secant'], ['csc', 'cosecant'],
  ['arcsin', 'inverse sine'], ['arccos', 'inverse cosine'], ['arctan', 'inverse tangent'],
  ['sinh', 'hyperbolic sine'], ['cosh', 'hyperbolic cosine'], ['tanh', 'hyperbolic tangent'], ['coth', 'hyperbolic cotangent'],
  ['log', 'logarithm'], ['ln', 'natural log'], ['lg', 'log base 10'], ['exp', 'exponential'],
  ['lim', 'limit'], ['limsup', 'limit superior'], ['liminf', 'limit inferior'],
  ['max', 'maximum'], ['min', 'minimum'], ['sup', 'supremum'], ['inf', 'infimum'],
  ['det', 'determinant'], ['dim', 'dimension'], ['gcd', 'greatest common divisor'], ['ker', 'kernel'],
  ['deg', 'degree'], ['hom', 'homomorphisms'], ['arg', 'argument'], ['Pr', 'probability'],
];

const BIG_OPERATORS: readonly Plain[] = [
  ['sum', '∑'], ['prod', '∏'], ['coprod', '∐'], ['int', '∫'], ['iint', '∬'], ['iiint', '∭'], ['oint', '∮'],
  ['bigcup', '⋃'], ['bigcap', '⋂'], ['bigvee', '⋁'], ['bigwedge', '⋀'], ['bigoplus', '⨁'], ['bigotimes', '⨂'],
  ['bigsqcup', '⨆'], ['biguplus', '⨄'],
];

const RELATIONS: readonly Plain[] = [
  ['leq', '≤'], ['le', '≤'], ['geq', '≥'], ['ge', '≥'], ['neq', '≠'], ['ne', '≠'], ['approx', '≈'], ['equiv', '≡'],
  ['sim', '∼'], ['simeq', '≃'], ['cong', '≅'], ['propto', '∝'], ['ll', '≪'], ['gg', '≫'], ['prec', '≺'], ['succ', '≻'],
  ['subset', '⊂'], ['supset', '⊃'], ['subseteq', '⊆'], ['supseteq', '⊇'], ['nsubseteq', '⊈'], ['in', '∈'], ['notin', '∉'],
  ['ni', '∋'], ['perp', '⊥'], ['parallel', '∥'], ['mid', '∣'], ['nmid', '∤'], ['vdash', '⊢'], ['models', '⊨'],
  ['asymp', '≍'], ['doteq', '≐'],
];

const ARROWS: readonly Plain[] = [
  ['to', '→'], ['gets', '←'], ['rightarrow', '→'], ['leftarrow', '←'], ['leftrightarrow', '↔'],
  ['Rightarrow', '⇒'], ['Leftarrow', '⇐'], ['Leftrightarrow', '⇔'], ['implies', '⟹'], ['impliedby', '⟸'], ['iff', '⟺'],
  ['longrightarrow', '⟶'], ['longleftarrow', '⟵'], ['mapsto', '↦'], ['longmapsto', '⟼'],
  ['uparrow', '↑'], ['downarrow', '↓'], ['updownarrow', '↕'], ['Uparrow', '⇑'], ['Downarrow', '⇓'],
  ['nearrow', '↗'], ['searrow', '↘'], ['swarrow', '↙'], ['nwarrow', '↖'],
  ['hookrightarrow', '↪'], ['hookleftarrow', '↩'], ['rightharpoonup', '⇀'], ['leftharpoonup', '↼'], ['rightleftharpoons', '⇌'],
];

const BINARY: readonly Plain[] = [
  ['pm', '±'], ['mp', '∓'], ['times', '×'], ['div', '÷'], ['cdot', '⋅'], ['ast', '∗'], ['star', '⋆'], ['circ', '∘'],
  ['bullet', '∙'], ['oplus', '⊕'], ['ominus', '⊖'], ['otimes', '⊗'], ['oslash', '⊘'], ['odot', '⊙'],
  ['cup', '∪'], ['cap', '∩'], ['setminus', '∖'], ['wedge', '∧'], ['vee', '∨'], ['land', '∧'], ['lor', '∨'],
  ['lnot', '¬'], ['neg', '¬'], ['sqcup', '⊔'], ['sqcap', '⊓'], ['uplus', '⊎'], ['wr', '≀'], ['dagger', '†'], ['ddagger', '‡'],
];

const SYMBOLS: readonly Plain[] = [
  ['infty', '∞'], ['partial', '∂'], ['nabla', '∇'], ['forall', '∀'], ['exists', '∃'], ['nexists', '∄'],
  ['emptyset', '∅'], ['varnothing', '∅'], ['hbar', 'ℏ'], ['ell', 'ℓ'], ['Re', 'ℜ'], ['Im', 'ℑ'], ['aleph', 'ℵ'],
  ['prime', '′'], ['angle', '∠'], ['triangle', '△'], ['square', '□'], ['top', '⊤'], ['bot', '⊥'],
  ['ldots', '…'], ['cdots', '⋯'], ['vdots', '⋮'], ['ddots', '⋱'], ['dots', '…'],
  ['degree', '°'], ['checkmark', '✓'], ['therefore', '∴'], ['because', '∵'], ['wp', '℘'], ['imath', 'ı'], ['jmath', 'ȷ'],
];

const DELIMITERS: readonly Plain[] = [
  ['left', 'auto-sized opening delimiter'], ['right', 'auto-sized closing delimiter'],
  ['langle', '⟨'], ['rangle', '⟩'], ['lfloor', '⌊'], ['rfloor', '⌋'], ['lceil', '⌈'], ['rceil', '⌉'],
  ['lvert', '|'], ['rvert', '|'], ['lVert', '‖'], ['rVert', '‖'], ['vert', '|'], ['Vert', '‖'],
  ['big', 'larger delimiter'], ['Big', 'larger delimiter'], ['bigg', 'larger delimiter'], ['Bigg', 'larger delimiter'],
  ['lbrace', '{'], ['rbrace', '}'],
];

const SPACING: readonly Plain[] = [
  ['quad', 'wide space'], ['qquad', 'wider space'], ['enspace', 'half a quad'], ['thinspace', 'thin space'],
  ['displaystyle', 'full-size operators'], ['textstyle', 'inline-size operators'],
  ['scriptstyle', 'script size'], ['scriptscriptstyle', 'script-script size'],
  ['limits', 'limits above and below'], ['nolimits', 'limits at the side'],
];

/** Commands that take arguments: the snippet puts the cursor in the first one. `${…}` fields are Tab stops. */
const WITH_ARGUMENTS: readonly LatexCommand[] = [
  { name: 'frac', detail: 'fraction', template: '\\frac{${numerator}}{${denominator}}', boost: 10 },
  { name: 'dfrac', detail: 'display fraction', template: '\\dfrac{${numerator}}{${denominator}}' },
  { name: 'tfrac', detail: 'text fraction', template: '\\tfrac{${numerator}}{${denominator}}' },
  { name: 'cfrac', detail: 'continued fraction', template: '\\cfrac{${numerator}}{${denominator}}' },
  { name: 'binom', detail: 'binomial', template: '\\binom{${n}}{${k}}' },
  { name: 'sqrt', detail: 'square root', template: '\\sqrt{${radicand}}', boost: 8 },
  { name: 'overline', detail: 'bar over', template: '\\overline{${expression}}' },
  { name: 'underline', detail: 'line under', template: '\\underline{${expression}}' },
  { name: 'overbrace', detail: 'brace over', template: '\\overbrace{${expression}}^{${label}}' },
  { name: 'underbrace', detail: 'brace under', template: '\\underbrace{${expression}}_{${label}}' },
  { name: 'hat', detail: 'â', template: '\\hat{${x}}' },
  { name: 'widehat', detail: 'wide hat', template: '\\widehat{${x}}' },
  { name: 'tilde', detail: 'ã', template: '\\tilde{${x}}' },
  { name: 'widetilde', detail: 'wide tilde', template: '\\widetilde{${x}}' },
  { name: 'bar', detail: 'ā', template: '\\bar{${x}}' },
  { name: 'vec', detail: 'a⃗', template: '\\vec{${x}}', boost: 5 },
  { name: 'dot', detail: 'ȧ', template: '\\dot{${x}}' },
  { name: 'ddot', detail: 'ä', template: '\\ddot{${x}}' },
  { name: 'overrightarrow', detail: 'arrow over', template: '\\overrightarrow{${expression}}' },
  { name: 'text', detail: 'upright text', template: '\\text{${text}}', boost: 6 },
  { name: 'textbf', detail: 'bold text', template: '\\textbf{${text}}' },
  { name: 'textit', detail: 'italic text', template: '\\textit{${text}}' },
  { name: 'mathbf', detail: 'bold', template: '\\mathbf{${x}}', boost: 3 },
  { name: 'mathrm', detail: 'roman', template: '\\mathrm{${x}}', boost: 3 },
  { name: 'mathit', detail: 'italic', template: '\\mathit{${x}}' },
  { name: 'mathbb', detail: 'blackboard bold ℝ', template: '\\mathbb{${x}}', boost: 4 },
  { name: 'mathcal', detail: 'calligraphic 𝒜', template: '\\mathcal{${x}}', boost: 3 },
  { name: 'mathfrak', detail: 'fraktur 𝔄', template: '\\mathfrak{${x}}' },
  { name: 'mathsf', detail: 'sans-serif', template: '\\mathsf{${x}}' },
  { name: 'mathtt', detail: 'monospace', template: '\\mathtt{${x}}' },
  { name: 'boldsymbol', detail: 'bold symbol', template: '\\boldsymbol{${x}}' },
  { name: 'operatorname', detail: 'named operator', template: '\\operatorname{${name}}' },
  { name: 'boxed', detail: 'boxed', template: '\\boxed{${expression}}' },
  { name: 'cancel', detail: 'struck out', template: '\\cancel{${expression}}' },
  { name: 'color', detail: 'colour the rest', template: '\\color{${red}}' },
  { name: 'textcolor', detail: 'coloured text', template: '\\textcolor{${red}}{${text}}' },
  { name: 'xrightarrow', detail: 'arrow with label', template: '\\xrightarrow{${label}}' },
  { name: 'xleftarrow', detail: 'arrow with label', template: '\\xleftarrow{${label}}' },
  { name: 'overset', detail: 'symbol over', template: '\\overset{${above}}{${base}}' },
  { name: 'underset', detail: 'symbol under', template: '\\underset{${below}}{${base}}' },
  { name: 'stackrel', detail: 'symbol over', template: '\\stackrel{${above}}{${base}}' },
  { name: 'phantom', detail: 'invisible', template: '\\phantom{${expression}}' },
  { name: 'tag', detail: 'equation tag', template: '\\tag{${label}}' },
  { name: 'hspace', detail: 'horizontal space', template: '\\hspace{${1em}}' },
  { name: 'not', detail: 'negation slash', template: '\\not' },
];

/** Full forms worth offering whole: a limit, sum or integral with its bounds. Matched by the command's own name, so `\su` offers both `\sum` and `\sum_{i=1}^{n}`. */
const LIMIT_FORMS: readonly LatexCommand[] = [
  { name: 'sum', detail: 'sum with bounds', template: '\\sum_{${i=1}}^{${n}} ${}', boost: 9 },
  { name: 'prod', detail: 'product with bounds', template: '\\prod_{${i=1}}^{${n}} ${}' },
  { name: 'int', detail: 'integral with bounds', template: '\\int_{${a}}^{${b}} ${}\\,d${x}', boost: 9 },
  { name: 'lim', detail: 'limit with approach', template: '\\lim_{${x \\to 0}} ${}', boost: 7 },
  { name: 'max', detail: 'maximum over', template: '\\max_{${x}} ${}' },
  { name: 'min', detail: 'minimum over', template: '\\min_{${x}} ${}' },
];

/** `\begin{…}…\end{…}` blocks, offered whole as `\begin{name}`. */
export const LATEX_ENVIRONMENTS: readonly string[] = [
  'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix',
  'cases', 'aligned', 'align', 'align*', 'alignedat', 'gathered', 'gather', 'gather*', 'split', 'array', 'equation', 'equation*',
  'CD', 'subarray',
];

/** Every command, in no particular order — what the editor completes `\` and bare words against. */
export const LATEX_COMMANDS: readonly LatexCommand[] = [
  ...WITH_ARGUMENTS,
  ...LIMIT_FORMS,
  ...toPlain(GREEK),
  ...toPlain(FUNCTIONS),
  ...toPlain(BIG_OPERATORS),
  ...toPlain(RELATIONS),
  ...toPlain(ARROWS),
  ...toPlain(BINARY),
  ...toPlain(SYMBOLS),
  ...toPlain(DELIMITERS),
  ...toPlain(SPACING),
];

/**
 * The commands whose name starts with `prefix`, best first: the commonly
 * typed (`boost`), then the shorter, then alphabetical. A command offered in
 * two forms (`\sum` and `\sum` with bounds) appears as both.
 * @param prefix What follows the backslash (or a bare word), case-sensitive — `\Delta` and `\delta` differ.
 * @param limit The most to return.
 */
export function matchLatexCommands(prefix: string, limit: number): LatexCommand[] {
  return LATEX_COMMANDS.filter((command) => command.name.startsWith(prefix))
    .sort(
      (a, b) =>
        (b.boost ?? 0) - (a.boost ?? 0) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name) ||
        Number(a.template !== undefined) - Number(b.template !== undefined),
    )
    .slice(0, limit);
}
