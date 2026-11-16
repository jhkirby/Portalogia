/**
 * @name Preload bridge exposes raw IPC to the page
 * @description A `contextBridge.exposeInMainWorld` API should offer fixed,
 *              named operations. This flags an exposed function that lets the
 *              page pick the IPC channel (`ipcRenderer.send(channel, ...)` with a
 *              non-constant channel), that hands a page callback straight to
 *              `ipcRenderer.on` (leaking the `IpcRendererEvent`, whose `sender`
 *              is `ipcRenderer` itself), or an API that exposes `ipcRenderer`
 *              outright.
 * @kind problem
 * @problem.severity error
 * @security-severity 8.0
 * @precision high
 * @id portalogia/preload-exposes-raw-ipc
 * @tags security
 *       external/cwe/cwe-749
 */

import javascript
import lib.PortalogiaIpc

/** The object passed to `contextBridge.exposeInMainWorld(name, api)`. */
DataFlow::SourceNode exposedApi() {
  result =
    DataFlow::moduleMember("electron", "contextBridge")
        .getAMethodCall("exposeInMainWorld")
        .getArgument(1)
        .getALocalSource()
}

/** A function reachable as a property of an exposed API (one level deep, or nested objects). */
DataFlow::FunctionNode exposedFunction() {
  result = exposedApi().getAPropertySource()
  or
  result = exposedApi().getAPropertySource().getAPropertySource()
}

from DataFlow::Node culprit, string problem
where
  exists(DataFlow::FunctionNode f, DataFlow::MethodCallNode ipc |
    f = exposedFunction() and
    ipc = PortalogiaIpc::ipcRenderer().getAMethodCall() and
    PortalogiaIpc::nestedIn(ipc.getContainer(), f.getFunction())
  |
    ipc.getMethodName() = ["send", "invoke", "sendSync", "postMessage", "sendToHost"] and
    not exists(ipc.getArgument(0).getStringValue()) and
    not ipc.getArgument(0) instanceof DataFlow::PropRead and
    not ipc.getArgument(0).asExpr() instanceof VarAccess and
    culprit = ipc and
    problem = "lets the page choose which IPC channel to send on"
    or
    ipc.getMethodName() = ["send", "invoke", "sendSync", "postMessage", "sendToHost"] and
    ipc.getArgument(0).getALocalSource() = f.getAParameter() and
    culprit = ipc and
    problem = "lets the page choose which IPC channel to send on"
    or
    ipc.getMethodName() = ["on", "once", "addListener"] and
    ipc.getArgument(1).getALocalSource() = f.getAParameter() and
    culprit = ipc and
    problem = "passes the page's callback straight to ipcRenderer, exposing the IpcRendererEvent"
  )
  or
  culprit = exposedApi().getAPropertyWrite().getRhs() and
  culprit.getALocalSource() = PortalogiaIpc::ipcRenderer() and
  problem = "exposes ipcRenderer itself"
select culprit, "Preload API " + problem + "."
