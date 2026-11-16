/**
 * @name IPC payload used without schema validation
 * @description Renderer-supplied IPC arguments are attacker-controlled once a
 *              renderer is compromised. Portalogia's convention is to pass every
 *              raw payload through a zod schema (`schema.safeParse(raw)`) before
 *              use; this finds payload parameters that never go through one.
 * @kind problem
 * @problem.severity warning
 * @security-severity 5.0
 * @precision medium
 * @id portalogia/ipc-payload-not-validated
 * @tags security
 *       external/cwe/cwe-20
 */

import javascript
import lib.PortalogiaIpc

/** Holds if `payload` reaches a zod check, here or in a function it is passed to. */
predicate isSchemaChecked(DataFlow::ParameterNode payload) {
  PortalogiaIpc::PayloadValidationFlow::flow(payload, _)
}

/** Holds if every use of `payload` pins it to a literal (`payload === true`). */
predicate onlyComparedStrictly(DataFlow::ParameterNode payload) {
  forex(VarAccess use | use.getVariable() = payload.getParameter().getAVariable() |
    exists(StrictEqualityTest eq | eq.getAnOperand() = use)
  )
}

from PortalogiaIpc::IpcHandler handler, DataFlow::ParameterNode payload
where
  not handler.isWrapped() and
  payload = handler.getAPayloadParameter() and
  // An unused parameter carries nothing.
  exists(VarAccess use | use.getVariable() = payload.getParameter().getAVariable()) and
  not isSchemaChecked(payload) and
  not onlyComparedStrictly(payload)
select payload,
  "Payload '" + payload.getName() + "' of IPC channel '" +
    handler.getChannelName() + "' is used without schema validation."
