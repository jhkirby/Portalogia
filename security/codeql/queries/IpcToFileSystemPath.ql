/**
 * @name Renderer-controlled file path in the main process
 * @description A file path built from an IPC payload lets a renderer (or the
 *              untrusted document it shows) choose which file the main process
 *              reads, writes, renames or deletes. Paths should be reduced to a
 *              bare name (`basename`, `toNoteFileName`) or resolved from state
 *              the main process already holds.
 * @kind path-problem
 * @problem.severity warning
 * @security-severity 6.5
 * @precision medium
 * @id portalogia/ipc-to-filesystem-path
 * @tags security
 *       external/cwe/cwe-22
 *       external/cwe/cwe-73
 */

import javascript
import lib.PortalogiaIpc

/**
 * `history.hasMarkdownAccess(path)` / `hasPdfAccess(path)`: true means main
 * already knows this exact path (the user opened it before).
 */
class KnownPathGuard extends DataFlow::MethodCallNode {
  KnownPathGuard() { this.getMethodName().regexpMatch("has[A-Za-z]*Access") }

  predicate blocksExpr(boolean outcome, Expr e) {
    outcome = true and e = this.getAnArgument().asExpr()
  }
}

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { node instanceof PortalogiaIpc::IpcPayloadSource }

  predicate isSink(DataFlow::Node node) { node = any(FileSystemAccess fs).getAPathArgument() }

  predicate isBarrier(DataFlow::Node node) {
    // Reducing to the last path segment can't climb out of a directory.
    node = DataFlow::moduleMember(["path", "node:path"], "basename").getACall()
    or
    node.(DataFlow::CallNode).getCalleeName() = ["basename", "toNoteFileName"]
    or
    node = DataFlow::MakeBarrierGuard<KnownPathGuard>::getABarrierNode()
  }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    PortalogiaIpc::ipcTaintStep(pred, succ)
  }
}

module Flow = TaintTracking::Global<Config>;

import Flow::PathGraph

from Flow::PathNode source, Flow::PathNode sink, PortalogiaIpc::IpcPayloadSource src
where Flow::flowPath(source, sink) and src = source.getNode()
select sink.getNode(), source, sink,
  "File path depends on $@ (IPC channel '" + src.getChannelName() + "').", src,
  "a renderer-supplied value"
