/* Isolated lifecycle probe, not a browser or accessibility test. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('../frontend/node_modules/typescript');

class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.parent = null; this.inert = false; this.style = {}; this.dataset = {}; }
  appendChild(child) { child.remove(); this.children.push(child); child.parent = this; return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  get isConnected() { return this === document.body || !!this.parent?.isConnected; }
  closest(selector) { return selector === '[inert]' && this.inert ? this : this.parent?.closest(selector) || null; }
  querySelectorAll() { return []; }
  querySelector(selector) { for (const child of this.children) { if (selector === '[role="dialog"]' && child.role === 'dialog') return child; const found = child.querySelector(selector); if (found) return found; } return null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() { document.activeElement = this; }
}
const document = { body: new Element('body'), activeElement: null, createElement: tag => new Element(tag), addEventListener() {}, removeEventListener() {} };
let effects = [];
const jsx = (type, props) => {
  const element = new Element(typeof type === 'string' ? type : 'component');
  element.role = props?.role;
  if (props?.ref) props.ref.current = element;
  for (const child of [props?.children].flat(Infinity)) if (child instanceof Element) element.appendChild(child);
  return element;
};
const react = { useEffect() {}, useId: () => 'probe', useLayoutEffect: fn => effects.push(fn), useRef: value => ({ current: value }), useState: init => [init(), () => {}] };
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/ModalFrame.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(code, { module: moduleObject, exports: moduleObject.exports, document, HTMLElement: Element, require: name => {
  if (name === 'react') return react;
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'react-dom') return { createPortal: (content, host) => { host.appendChild(content); return content; } };
  if (name === 'lucide-react') return { X: () => null };
  throw new Error(`Unexpected import: ${name}`);
} }, { filename: 'ModalFrame.transpiled.cjs' });

function mount() {
  effects = [];
  moduleObject.exports.default({ title: 'Fictional modal', children: null, onClose() {} });
  const cleanups = effects.map(fn => fn());
  return () => cleanups.forEach(fn => fn());
}
function scenario(order, initialOverflow = '') {
  document.body.children = [];
  document.body.style.overflow = initialOverflow;
  const root = document.body.appendChild(new Element('root'));
  document.activeElement = root;
  const cleanups = order.map(() => mount());
  for (const index of order) cleanups[index]();
  return { rootInert: root.inert, bodyOverflow: document.body.style.overflow, remainingHosts: document.body.children.length - 1 };
}
const results = { lifo: scenario([1, 0]), parentThenChild: scenario([0, 1]), threeMixed: scenario([1, 0, 2]), preservesOriginalOverflow: scenario([0, 1], 'scroll') };
console.log(JSON.stringify(results, null, 2));
for (const [name, state] of Object.entries(results)) {
  assert.equal(state.rootInert, false, `${name}: application must not remain inert`);
  assert.equal(state.bodyOverflow, name === 'preservesOriginalOverflow' ? 'scroll' : '', `${name}: original overflow must be restored`);
  assert.equal(state.remainingHosts, 0, `${name}: modal hosts must be removed`);
}
