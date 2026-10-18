/**
 * @name Parsed JSON used without schema validation (main process)
 * @description State files under userData (sessions, bookmarks, history,
 *              annotations) and engine caches are read back with `JSON.parse`.
 *              Anything that can write those files — another process, a sync
 *              client, a crafted import — then controls their shape. The
 *              convention here is `schema.parse(JSON.parse(text))`; this flags
 *              main-process parses whose result never reaches a zod check.
 * @kind problem
 * @problem.severity recommendation
 * @security-severity 3.5
 * @precision medium
 * @id northstar/unvalidated-json-parse
 * @tags security
 *       external/cwe/cwe-502
 *       external/cwe/cwe-20
 */

import javascript
import lib.NorthstarIpc

DataFlow::CallNode jsonParse() { result = DataFlow::globalVarRef("JSON").getAMemberCall("parse") }

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { node = jsonParse() }

  predicate isSink(DataFlow::Node node) {
    exists(DataFlow::MethodCallNode call |
      NorthstarIpc::isSchemaValidation(call) and node = call.getArgument(0)
    )
  }
}

module Flow = DataFlow::Global<Config>;

from DataFlow::CallNode parse
where
  parse = jsonParse() and
  parse.getFile().getRelativePath().matches("src/main/%") and
  not Flow::flow(parse, _)
select parse, "JSON.parse result is used without a schema check."
