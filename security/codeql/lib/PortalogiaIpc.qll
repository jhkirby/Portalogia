/**
 * Models Portalogia's Electron IPC conventions so the queries in `queries/`
 * can reason about them.
 *
 * Portalogia registers handlers in two shapes:
 *
 *  1. Directly: `ipcMain.on|handle(channel, (event, rawRequest) => ...)`.
 *  2. Through a local wrapper (`handle(channel, schema, action)` in
 *     `registerTabIpc.ts`) whose own `ipcMain.handle` callback validates the
 *     payload and then calls `action(parsed.data, event)`. The `action`
 *     lambda passed at each call site is the code that really acts, so it is
 *     treated as a handler too, with its event at the forwarded position.
 *
 * Senders are authorised by helper functions (`chromeWindowOf`,
 * `isChromeSender`, `owns*Contents`, ...), listed in `isSenderGuardName`.
 * Add a name there when the code gains a new guard.
 */

import javascript

module PortalogiaIpc {
  /** The `ipcMain` object imported from `electron`. */
  DataFlow::SourceNode ipcMain() { result = DataFlow::moduleMember("electron", "ipcMain") }

  /** The `ipcRenderer` object imported from `electron`. */
  DataFlow::SourceNode ipcRenderer() { result = DataFlow::moduleMember("electron", "ipcRenderer") }

  /** A call `ipcMain.on|once|handle|handleOnce(channel, callback)`. */
  class IpcRegistration extends DataFlow::MethodCallNode {
    IpcRegistration() { this = ipcMain().getAMethodCall(["on", "once", "handle", "handleOnce"]) }

    /** Holds if this is `handle`/`handleOnce` (an `invoke` reply channel). */
    predicate isInvokeHandler() { this.getMethodName() = ["handle", "handleOnce"] }

    /** The registered callback, wherever its function is defined. */
    DataFlow::FunctionNode getHandlerFunction() { result = this.getArgument(1).getAFunctionValue() }

    /** A readable name for the channel: `IpcChannel.X` becomes `X`, literals are kept. */
    string getChannelName() { result = channelName(this.getArgument(0)) }
  }

  /** A readable name for a channel expression. */
  string channelName(DataFlow::Node channel) {
    if exists(channel.getStringValue())
    then result = channel.getStringValue()
    else
      if channel instanceof DataFlow::PropRead
      then result = channel.(DataFlow::PropRead).getPropertyName()
      else
        if channel.getALocalSource() instanceof DataFlow::ParameterNode
        then
          result =
            "<any channel registered via " + channel.getContainer().(Function).describe() + ">"
        else
          if channel.asExpr() instanceof VarAccess
          then result = channel.asExpr().(VarAccess).getName()
          else result = channel.toString()
  }

  /** Holds if `inner` lies lexically inside `outer`, or is `outer`. */
  bindingset[outer]
  predicate nestedIn(StmtContainer inner, StmtContainer outer) {
    inner = outer or inner.getEnclosingContainer+() = outer
  }

  /**
   * Holds if wrapper function `w` registers `reg` on the channel named by
   * its own parameter `c` and, inside that registration's callback, calls its
   * own parameter `i`, passing the IPC event as argument `k`.
   *
   * Requiring the channel to be a parameter is what separates a registration
   * helper (`handle(channel, schema, action)`) from a function that merely
   * receives a resolver (`registerTabIpc(resolveTabManager, ...)`).
   */
  predicate forwardsEvent(DataFlow::FunctionNode w, int c, int i, int k, IpcRegistration reg) {
    nestedIn(reg.getContainer(), w.getFunction()) and
    reg.getArgument(0).getALocalSource() = w.getParameter(c) and
    exists(DataFlow::FunctionNode cb, DataFlow::InvokeNode call |
      cb = reg.getHandlerFunction() and
      nestedIn(call.getContainer(), cb.getFunction()) and
      call.getCalleeNode().getALocalSource() = w.getParameter(i) and
      call.getArgument(k).getALocalSource() = cb.getParameter(0)
    )
  }

  /**
   * Holds if wrapper `w` registers `reg` on the channel named by its parameter
   * `c` and calls its parameter `i` from inside that registration's callback.
   */
  predicate callsActionParameter(DataFlow::FunctionNode w, int c, int i, IpcRegistration reg) {
    callsActionParameterWithRequest(w, c, i, _, reg)
  }

  /**
   * As `callsActionParameter`, where argument `j` of that call is the parsed
   * request (`parsed.data`): the one value the renderer controls.
   */
  predicate callsActionParameterWithRequest(
    DataFlow::FunctionNode w, int c, int i, int j, IpcRegistration reg
  ) {
    nestedIn(reg.getContainer(), w.getFunction()) and
    reg.getArgument(0).getALocalSource() = w.getParameter(c) and
    exists(DataFlow::FunctionNode cb, DataFlow::InvokeNode call |
      cb = reg.getHandlerFunction() and
      nestedIn(call.getContainer(), cb.getFunction()) and
      call.getCalleeNode().getALocalSource() = w.getParameter(i) and
      call.getArgument(j).getALocalSource().(DataFlow::PropRead).getPropertyName() = "data"
    )
  }

  /**
   * A function that handles an IPC message: either a callback passed
   * straight to `ipcMain`, or an `action` lambda passed to a wrapper that
   * forwards the event to it.
   */
  class IpcHandler extends DataFlow::FunctionNode {
    int eventIndex;
    IpcRegistration registration;
    boolean wrapped;
    DataFlow::Node channel;

    IpcHandler() {
      this = registration.getHandlerFunction() and
      eventIndex = 0 and
      wrapped = false and
      channel = registration.getArgument(0)
      or
      exists(DataFlow::FunctionNode w, int c, int i, DataFlow::InvokeNode wrapperCall |
        forwardsEvent(w, c, i, eventIndex, registration) and
        wrapperCall.getACallee() = w.getFunction() and
        this = wrapperCall.getArgument(i).getAFunctionValue() and
        channel = wrapperCall.getArgument(c) and
        wrapped = true
      )
    }

    /** The registration this handler ends up attached to. */
    IpcRegistration getRegistration() { result = registration }

    /** The channel this handler answers, resolved at the wrapper's call site when wrapped. */
    string getChannelName() { result = channelName(channel) }

    /** Holds if this handler is an `action` lambda reached through a wrapper. */
    predicate isWrapped() { wrapped = true }

    /** The IPC event parameter, if the function declares one. */
    DataFlow::ParameterNode getEventParameter() { result = this.getParameter(eventIndex) }

    /**
     * A parameter carrying renderer-supplied data. For a direct callback that
     * is every parameter after the event; for a wrapped lambda it is every
     * parameter except the event (already validated by the wrapper).
     */
    DataFlow::ParameterNode getAPayloadParameter() {
      exists(int j | result = this.getParameter(j) and j != eventIndex |
        wrapped = true or j > eventIndex
      )
    }

    /**
     * Holds if this direct callback only forwards its event to an `action`
     * parameter of an enclosing wrapper; the lambdas passed to that wrapper
     * are then judged instead.
     */
    predicate isForwarder() {
      wrapped = false and
      exists(DataFlow::FunctionNode w | forwardsEvent(w, _, _, _, registration))
    }

    /** A call made anywhere inside this handler, including nested closures. */
    DataFlow::InvokeNode getAnInnerCall() { nestedIn(result.getContainer(), this.getFunction()) }

    /** A reference to the event, or to `event.sender`, inside this handler. */
    DataFlow::Node getASenderReference() {
      result = this.getEventParameter().getAPropertyRead("sender")
      or
      exists(DataFlow::InvokeNode call |
        call = this.getAnInnerCall() and
        result = call.getAnArgument() and
        result.getALocalSource() = this.getEventParameter()
      )
    }

    /** Holds if the handler consults its sender in any way. */
    predicate consultsSender() { exists(this.getASenderReference()) }

    /** A call to a recognised sender guard inside this handler. */
    DataFlow::InvokeNode getASenderGuardCall() {
      result = this.getAnInnerCall() and
      isSenderGuardName(result.getCalleeName())
    }

    /**
     * Holds if the handler authorises its sender: it calls a sender guard
     * itself, or its event / `event.sender` reaches a guard call or an
     * identity comparison (`view.webContents === sender`) in a function it
     * delegates to.
     */
    predicate authorisesSender() {
      exists(this.getASenderGuardCall())
      or
      exists(DataFlow::Node sink |
        SenderFlow::flow(this.getEventParameter(), sink)
      )
    }
  }

  /** Where an IPC event's sender ends up being checked. */
  private predicate isSenderCheck(DataFlow::Node node) {
    exists(DataFlow::InvokeNode call |
      isSenderGuardName(call.getCalleeName()) and node = call.getAnArgument()
    )
    or
    exists(EqualityTest eq | node = eq.getAnOperand().flow())
  }

  private module SenderConfig implements DataFlow::ConfigSig {
    predicate isSource(DataFlow::Node node) { node = any(IpcHandler h).getEventParameter() }

    predicate isSink(DataFlow::Node node) { isSenderCheck(node) }

    predicate isAdditionalFlowStep(DataFlow::Node pred, DataFlow::Node succ) {
      exists(DataFlow::PropRead read | read.getPropertyName() = "sender" |
        pred = read.getBase() and succ = read
      )
    }
  }

  /** Flow from an IPC event to a sender check, across function calls. */
  module SenderFlow = DataFlow::Global<SenderConfig>;

  private module PayloadValidationConfig implements DataFlow::ConfigSig {
    predicate isSource(DataFlow::Node node) { node = any(IpcHandler h).getAPayloadParameter() }

    predicate isSink(DataFlow::Node node) {
      exists(DataFlow::MethodCallNode call | isSchemaValidation(call) | node = call.getArgument(0))
    }
  }

  /** Flow from a raw IPC payload to a zod check, across function calls. */
  module PayloadValidationFlow = DataFlow::Global<PayloadValidationConfig>;

  /**
   * Names of Portalogia's sender-authorisation helpers. Each of these either
   * returns nothing for a sender that isn't allowed (chrome page vs. tab
   * page) or throws.
   */
  bindingset[name]
  predicate isSenderGuardName(string name) {
    name =
      [
        "chromeWindowOf", "isChromeSender", "isChrome", "chromeManagerForTab", "pageManager",
        "resolveTabForContents", "isHistoryView", "resolveTabId"
      ]
    or
    name.regexpMatch("resolveTabManager(ForEvent)?")
    or
    name.regexpMatch("owns[A-Za-z]*Contents")
  }

  /** Holds if `call` validates its argument with zod (`schema.parse` / `schema.safeParse`). */
  predicate isSchemaValidation(DataFlow::MethodCallNode call) {
    call.getMethodName() = ["parse", "safeParse", "parseAsync", "safeParseAsync"] and
    // `JSON.parse` / `URL.parse` aren't schema checks.
    not call.getReceiver().(DataFlow::GlobalVarRefNode).getName() = ["JSON", "URL", "Date", "Number"]
  }

  /**
   * A renderer-controlled value arriving in the main process: a payload
   * parameter of an IPC handler. A taint source for the flow queries.
   */
  class IpcPayloadSource extends DataFlow::Node {
    IpcHandler handler;
    string channel;

    IpcPayloadSource() {
      this = handler.getAPayloadParameter() and channel = handler.getChannelName()
      or
      // A parameter of an `action` lambda handed to a helper that registers
      // the channel and calls the lambda with the parsed request, without
      // forwarding the event (`invokeForTab`, `invokeFromPage`). The helper's
      // own callback is the handler that authorises the sender.
      exists(
        DataFlow::FunctionNode w, int c, int i, int j, DataFlow::InvokeNode wrapperCall,
        DataFlow::FunctionNode action
      |
        callsActionParameterWithRequest(w, c, i, j, handler.getRegistration()) and
        not handler.isWrapped() and
        not forwardsEvent(w, _, i, _, _) and
        wrapperCall.getACallee() = w.getFunction() and
        action = wrapperCall.getArgument(i).getAFunctionValue() and
        this = action.getParameter(j) and
        channel = channelName(wrapperCall.getArgument(c))
      )
    }

    IpcHandler getHandler() { result = handler }

    /** The channel the value arrived on. */
    string getChannelName() { result = channel }

    /** Holds if the receiving handler checks who sent the message. */
    predicate isSenderGuarded() { handler.authorisesSender() }
  }

  /**
   * The taint step every IPC flow query needs: through a zod check to the
   * parsed value (`schema.safeParse(raw).data`). Validation constrains a
   * payload's shape, not its content, so the parsed value stays tainted.
   */
  predicate ipcTaintStep(DataFlow::Node pred, DataFlow::Node succ) {
    exists(DataFlow::MethodCallNode call | isSchemaValidation(call) |
      pred = call.getArgument(0) and
      (
        succ = call and call.getMethodName() = ["parse", "parseAsync"]
        or
        // Also covers `const parsed = schema.safeParse(raw); ... parsed.data`.
        succ = call.getAPropertyRead("data")
      )
    )
  }
}
