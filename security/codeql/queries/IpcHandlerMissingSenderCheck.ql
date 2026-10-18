/**
 * @name IPC handler does not authorise its sender
 * @description An `ipcMain` handler that never checks `event.sender` accepts the
 *              message from any renderer, including a compromised web tab. In
 *              Northstar every web page is a renderer on the same `ipcMain`, so
 *              a handler must call a sender guard (`chromeWindowOf`,
 *              `isChromeSender`, `owns*Contents`, ...) before acting.
 * @kind problem
 * @problem.severity warning
 * @security-severity 7.5
 * @precision medium
 * @id northstar/ipc-handler-missing-sender-check
 * @tags security
 *       external/cwe/cwe-284
 *       external/cwe/cwe-863
 */

import javascript
import lib.NorthstarIpc

from NorthstarIpc::IpcHandler handler, string channel, string problem
where
  channel = handler.getChannelName() and
  not handler.isForwarder() and
  not handler.authorisesSender() and
  (
    not handler.consultsSender() and
    problem = "never looks at its sender, so any renderer (including a web tab) can call it"
    or
    handler.consultsSender() and
    problem =
      "reads its sender but calls no recognised sender guard; check that it authorises the caller"
  )
select handler, "IPC handler for channel '" + channel + "' " + problem + "."
