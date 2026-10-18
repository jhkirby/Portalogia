/**
 * @name Renderer-controlled URL fetched by the main process
 * @description The main process isn't bound by a page's CSP or the renderer's
 *              network sandbox. A URL taken from an IPC payload and fetched in
 *              main lets an untrusted document make requests from the user's
 *              machine, including to `localhost` and private-network hosts
 *              (server-side request forgery). Restrict scheme *and* destination.
 * @kind path-problem
 * @problem.severity warning
 * @security-severity 5.5
 * @precision medium
 * @id northstar/ipc-to-outbound-request
 * @tags security
 *       external/cwe/cwe-918
 */

import javascript
import lib.NorthstarIpc

/** The URL argument of an outbound request made in the main process. */
class RequestUrlSink extends DataFlow::Node {
  RequestUrlSink() {
    this = any(ClientRequest req).getUrl()
    or
    // `session.fetch(url)` / `net.fetch(url)` from Electron.
    exists(DataFlow::MethodCallNode call |
      call.getMethodName() = "fetch" and
      this = call.getArgument(0)
    )
    or
    // A fetch injected for tests: `fetchImpl: typeof fetch = fetch`.
    exists(DataFlow::ParameterNode p, DataFlow::CallNode call |
      p.getName().regexpMatch("(?i).*fetch.*") and
      call.getCalleeNode().getALocalSource() = p and
      this = call.getArgument(0)
    )
  }
}

module Config implements DataFlow::ConfigSig {
  predicate isSource(DataFlow::Node node) { node instanceof NorthstarIpc::IpcPayloadSource }

  predicate isSink(DataFlow::Node node) { node instanceof RequestUrlSink }

  predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
    NorthstarIpc::ipcTaintStep(pred, succ)
  }
}

module Flow = TaintTracking::Global<Config>;

import Flow::PathGraph

from Flow::PathNode source, Flow::PathNode sink, NorthstarIpc::IpcPayloadSource src
where Flow::flowPath(source, sink) and src = source.getNode()
select sink.getNode(), source, sink,
  "The main process requests a URL taken from $@ (IPC channel '" +
    src.getChannelName() + "').", src, "a renderer-supplied value"
