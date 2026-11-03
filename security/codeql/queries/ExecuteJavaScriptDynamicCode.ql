/**
 * @name Script built from non-constant text and run in a page
 * @description `webContents.executeJavaScript(code)` runs `code` in the page's
 *              main world. If any part of `code` is interpolated from data that
 *              isn't a compile-time constant, and isn't serialised with
 *              `JSON.stringify`, a crafted value can break out of its string
 *              and run arbitrary script in that page.
 * @kind problem
 * @problem.severity warning
 * @security-severity 6.0
 * @precision medium
 * @id portalogia/execute-javascript-dynamic-code
 * @tags security
 *       external/cwe/cwe-94
 *       external/cwe/cwe-95
 */

import javascript

/** Holds if `e` always evaluates to a string fixed at build time. */
predicate isConstantText(Expr e) {
  e instanceof ConstantString
  or
  exists(e.getStringValue())
  or
  // A `const X = '...'` (possibly imported) referenced by name.
  exists(DataFlow::Node src |
    src = e.flow().getALocalSource() and
    (
      src.asExpr() instanceof ConstantString
      or
      exists(src.getStringValue())
      or
      exists(ImportSpecifier spec, ConstDeclStmt decl, VariableDeclarator d |
        src.asExpr() = spec.getLocal() and
        d = decl.getADecl() and
        d.getBindingPattern().(VarDecl).getName() = spec.getImportedName() and
        d.getInit() instanceof ConstantString
      )
    )
  )
  or
  isConstantText(e.(ParExpr).getExpression())
  or
  isConstantText(e.(AddExpr).getLeftOperand()) and isConstantText(e.(AddExpr).getRightOperand())
  or
  forall(Expr part | part = e.(TemplateLiteral).getAnElement() | isConstantText(part))
}

/** Holds if `e` is safely serialised for embedding in script. */
predicate isSerialised(Expr e) {
  e.(MethodCallExpr).getReceiver().(GlobalVarAccess).getName() = "JSON" and
  e.(MethodCallExpr).getMethodName() = "stringify"
  or
  e instanceof NumberLiteral
}

/** A piece of the script text that is neither constant nor serialised. */
Expr dynamicPart(Expr script) {
  exists(Expr e | e = script.(TemplateLiteral).getAnElement() and not e instanceof TemplateElement |
    not isConstantText(e) and not isSerialised(e) and result = e
  )
  or
  not script instanceof TemplateLiteral and
  not isConstantText(script) and
  not isSerialised(script) and
  // Follow a script built by a helper method (`this.buildScript(...)`) to its return.
  if exists(script.flow().(DataFlow::CallNode).getACallee().getAReturnedExpr())
  then
    result =
      dynamicPart(script.flow().(DataFlow::CallNode).getACallee().getAReturnedExpr())
  else result = script
}

from DataFlow::MethodCallNode call, Expr part
where
  call.getMethodName() = "executeJavaScript" and
  part = dynamicPart(call.getArgument(0).asExpr())
select call,
  "executeJavaScript runs script containing $@, which is not a constant and not JSON-serialised.",
  part, part.toString()
