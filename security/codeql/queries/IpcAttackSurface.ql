/**
 * @name IPC attack surface inventory
 * @description Lists every main-process IPC handler with how it is registered and
 *              whether it authorises its sender. Informational: use it to review
 *              the full renderer → main surface after adding channels.
 * @kind problem
 * @problem.severity recommendation
 * @precision high
 * @id portalogia/ipc-attack-surface
 * @tags security
 *       inventory
 */

import javascript
import lib.PortalogiaIpc

from PortalogiaIpc::IpcHandler handler, string shape, string auth
where
  not handler.isForwarder() and
  (
    handler.isWrapped() and shape = "wrapped action"
    or
    not handler.isWrapped() and
    (if handler.getRegistration().isInvokeHandler() then shape = "invoke" else shape = "send")
  ) and
  if handler.authorisesSender() then auth = "sender authorised" else auth = "sender NOT authorised"
select handler,
  "IPC channel '" + handler.getChannelName() + "' (" + shape + "): " + auth + "."
