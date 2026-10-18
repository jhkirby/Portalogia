/**
 * @name HTML sink not provably fed by DOMPurify
 * @description Writing markup with `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
 *              `document.write`, `srcdoc` or React's `dangerouslySetInnerHTML`
 *              is only safe when the markup was sanitised. This reports each
 *              such sink whose value is neither constant nor reachable (by
 *              data flow) from `DOMPurify.sanitize(...)`. Flow through React
 *              props/state isn't tracked, so a result here means "verify by
 *              hand", not "vulnerable".
 * @kind problem
 * @problem.severity warning
 * @security-severity 6.1
 * @precision low
 * @id northstar/unsanitized-html-sink
 * @tags security
 *       external/cwe/cwe-79
 */

import javascript

/** A value written into the DOM as markup. */
class HtmlSink extends DataFlow::Node {
  string how;

  HtmlSink() {
    exists(DataFlow::PropWrite w | w.getPropertyName() = ["innerHTML", "outerHTML", "srcdoc"] |
      this = w.getRhs() and how = w.getPropertyName()
    )
    or
    exists(DataFlow::MethodCallNode call |
      call.getMethodName() = "insertAdjacentHTML" and this = call.getArgument(1) and how = "insertAdjacentHTML"
      or
      call.getMethodName() = ["write", "writeln"] and
      call.getReceiver() = DataFlow::globalVarRef("document") and
      this = call.getArgument(0) and
      how = "document.write"
    )
    or
    exists(JsxAttribute attr | attr.getName() = "dangerouslySetInnerHTML" |
      this = attr.getValue().flow() and how = "dangerouslySetInnerHTML"
    )
  }

  string getHow() { result = how }
}

/** A call to `DOMPurify.sanitize` (default or named import). */
DataFlow::CallNode purifyCall() {
  result = API::moduleImport("dompurify").getMember("sanitize").getACall()
  or
  result = API::moduleImport("dompurify").getMember("default").getMember("sanitize").getACall()
  or
  result.(DataFlow::MethodCallNode).getMethodName() = "sanitize" and
  result.(DataFlow::MethodCallNode).getReceiver().getALocalSource().asExpr().(VarAccess).getName() =
    "DOMPurify"
}

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { node = purifyCall() }

  predicate isSink(DataFlow::Node node) { node instanceof HtmlSink }
}

module Flow = TaintTracking::Global<Config>;

from HtmlSink sink
where
  not exists(sink.getStringValue()) and
  not sink.asExpr() instanceof ConstantString and
  not Flow::flowTo(sink)
select sink,
  "Markup written via " + sink.getHow() +
    " isn't provably sanitised by DOMPurify; check where this value comes from."
