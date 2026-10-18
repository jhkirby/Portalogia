/**
 * @name Renderer-controlled URL loaded without the scheme allowlist
 * @description Every URL a tab loads must pass `isNavigableUrl` (http, https,
 *              about, northstar). A URL from an IPC payload that reaches
 *              `loadURL`, `createTab` or `shell.openExternal` without that check
 *              could open `file:`, `javascript:` or an OS protocol handler.
 * @kind path-problem
 * @problem.severity error
 * @security-severity 7.0
 * @precision high
 * @id northstar/ipc-to-unvalidated-navigation
 * @tags security
 *       external/cwe/cwe-601
 *       external/cwe/cwe-939
 */

import javascript
import lib.NorthstarIpc

/** A URL argument that a page, window or the OS will open. */
class NavigationSink extends DataFlow::Node {
  NavigationSink() {
    exists(DataFlow::MethodCallNode call |
      call.getMethodName() = ["loadURL", "createTab", "createTabAndFocusAddressBar"] and
      this = call.getArgument(0)
    )
    or
    this = DataFlow::moduleMember("electron", "shell").getAMethodCall("openExternal").getArgument(0)
  }
}

/** `isNavigableUrl(x)`: true means `x` uses an allowed scheme. */
class NavigableUrlGuard extends DataFlow::CallNode {
  NavigableUrlGuard() { this.getCalleeName() = "isNavigableUrl" }

  predicate blocksExpr(boolean outcome, Expr e) { outcome = true and e = this.getArgument(0).asExpr() }
}

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { node instanceof NorthstarIpc::IpcPayloadSource }

  predicate isSink(DataFlow::Node node) { node instanceof NavigationSink }

  predicate isBarrier(DataFlow::Node node) {
    node = DataFlow::MakeBarrierGuard<NavigableUrlGuard>::getABarrierNode()
  }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    NorthstarIpc::ipcTaintStep(pred, succ)
  }
}

module Flow = TaintTracking::Global<Config>;

import Flow::PathGraph

from Flow::PathNode source, Flow::PathNode sink, NorthstarIpc::IpcPayloadSource src
where Flow::flowPath(source, sink) and src = source.getNode()
select sink.getNode(), source, sink,
  "URL from $@ (IPC channel '" + src.getChannelName() +
    "') is opened without passing isNavigableUrl.", src, "a renderer-supplied value"
