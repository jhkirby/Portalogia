/**
 * @name Weak Content-Security-Policy directive
 * @description Finds CSP directives in string literals that weaken the policy:
 *              `'unsafe-inline'`/`'unsafe-eval'` for scripts, wildcard or bare
 *              scheme sources (`*`, `https:`, `http:`) for scripts, connections,
 *              frames or images. A scheme-wide `img-src`/`connect-src` lets any
 *              rendered content beacon to any host. Results inside a branch on
 *              an `isDev`-style flag are reported as development-only.
 * @kind problem
 * @problem.severity recommendation
 * @security-severity 4.0
 * @precision high
 * @id portalogia/weak-content-security-policy
 * @tags security
 *       external/cwe/cwe-693
 */

import javascript

/** Holds if `directive` names a weakness in a CSP directive string. */
bindingset[directive]
predicate weakness(string directive, string why) {
  directive.regexpMatch("(?i)\\s*script-src\\b.*'unsafe-inline'.*") and
  why = "script-src allows 'unsafe-inline'"
  or
  directive.regexpMatch("(?i)\\s*script-src\\b.*'unsafe-eval'.*") and
  why = "script-src allows 'unsafe-eval'"
  or
  exists(string name, string src |
    name = directive.regexpCapture("(?i)\\s*([a-z-]+-src)\\b.*", 1).toLowerCase() and
    name = ["script-src", "connect-src", "frame-src", "img-src", "default-src", "worker-src"] and
    src = directive.regexpFind("(?<=\\s)(\\*|https?:|wss?:)(?=\\s|$)", _, _) and
    why = name + " allows any host via '" + src + "'"
  )
}

/** Holds if `e` sits in a conditional on a development flag. */
predicate isDevOnly(Expr e) {
  exists(ConditionalExpr c |
    e.getParent*() = c.getConsequent() and
    c.getCondition().(VarAccess).getName().regexpMatch("(?i)is_?dev.*")
  )
}

from StringLiteral lit, string why, string scope
where
  weakness(lit.getValue(), why) and
  if isDevOnly(lit) then scope = " (development builds only)" else scope = ""
select lit, "Content-Security-Policy: " + why + scope + "."
