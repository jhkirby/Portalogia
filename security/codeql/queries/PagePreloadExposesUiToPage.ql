/**
 * @name Page preload UI reachable by the visited site
 * @description The `tab*` preloads draw Portalogia UI (comments, text boxes,
 *              highlights) into an arbitrary website's DOM. That UI, and the
 *              user's private text in it, must sit in a `closed` shadow root
 *              the preload created itself. An `open` shadow root is readable
 *              through `element.shadowRoot`; adopting an existing element by id
 *              lets the page pre-plant the container.
 * @kind problem
 * @problem.severity warning
 * @security-severity 5.0
 * @precision high
 * @id portalogia/page-preload-ui-exposed
 * @tags security
 *       external/cwe/cwe-668
 */

import javascript

/** Holds if `f` is a preload that runs inside web pages (not an app page). */
predicate isPagePreload(File f) {
  f.getRelativePath().regexpMatch("src/preload/tab[A-Za-z]*\\.ts")
}

from DataFlow::MethodCallNode call, string problem
where
  isPagePreload(call.getFile()) and
  (
    call.getMethodName() = "attachShadow" and
    not call.getOptionArgument(0, "mode").getStringValue() = "closed" and
    problem = "attaches a shadow root that is not 'closed'; the page can read it via .shadowRoot"
    or
    call.getMethodName() = ["getElementById", "querySelector"] and
    call.getReceiver() = DataFlow::globalVarRef("document") and
    // The result is used as a container (something is appended to it).
    exists(DataFlow::MethodCallNode append |
      append.getMethodName() = ["appendChild", "append", "prepend", "attachShadow"] and
      append.getReceiver().getALocalSource() = call
    ) and
    problem = "reuses an element looked up in the page's DOM as a UI container; the page can plant it"
  )
select call, "Page preload " + problem + "."
