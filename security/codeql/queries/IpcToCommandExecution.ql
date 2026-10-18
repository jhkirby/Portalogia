/**
 * @name Renderer-controlled data reaches a shell or process
 * @description Data from an IPC payload that reaches `child_process`, a node-pty
 *              spawn, or a pty session's `write` runs as commands on the user's
 *              machine. Such a flow is only acceptable behind a sender check
 *              that ties the message to the one renderer allowed to send it
 *              (a terminal tab's own page); the message says whether one exists.
 * @kind path-problem
 * @problem.severity error
 * @security-severity 9.0
 * @precision medium
 * @id northstar/ipc-to-command-execution
 * @tags security
 *       external/cwe/cwe-78
 *       external/cwe/cwe-94
 */

import javascript
import lib.NorthstarIpc

/** An argument that ends up as (part of) a command line or shell input. */
class CommandSink extends DataFlow::Node {
  CommandSink() {
    exists(SystemCommandExecution exec |
      this = exec.getACommandArgument() or this = exec.getArgumentList()
    )
    or
    this = API::moduleImport("node-pty").getMember("spawn").getACall().getArgument([0, 1])
    or
    // `IPty.write(data)`: sessions live in a Map, which API graphs can't follow,
    // so the write is recognised on the class that owns the sessions.
    exists(DataFlow::MethodCallNode write |
      write.getMethodName() = "write" and
      write.getContainer().getEnclosingContainer*() =
        any(ClassDefinition c | c.getName() = "TerminalManager").getAMethod().getBody() and
      this = write.getArgument(0)
    )
  }
}

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { node instanceof NorthstarIpc::IpcPayloadSource }

  predicate isSink(DataFlow::Node node) { node instanceof CommandSink }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    NorthstarIpc::ipcTaintStep(pred, succ)
  }
}

module Flow = TaintTracking::Global<Config>;

import Flow::PathGraph

from Flow::PathNode source, Flow::PathNode sink, NorthstarIpc::IpcPayloadSource src, string guard
where
  Flow::flowPath(source, sink) and
  src = source.getNode() and
  if src.isSenderGuarded()
  then guard = "the handler does check its sender; confirm the check binds the message to its owner"
  else guard = "the handler does NOT check its sender"
select sink.getNode(), source, sink,
  "Command input depends on $@ (IPC channel '" + src.getChannelName() + "'); " + guard
    + ".", src, "a renderer-supplied value"
