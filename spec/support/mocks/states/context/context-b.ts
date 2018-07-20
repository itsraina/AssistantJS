import { inject, injectable, optional } from "inversify";
import { BasicHandable } from "../../../../../src/assistant-source";
import { TranslateHelper } from "../../../../../src/components/i18n/public-interfaces";
import { Logger } from "../../../../../src/components/root/public-interfaces";
import { BaseState } from "../../../../../src/components/state-machine/base-state";
import { stayInContext } from "../../../../../src/components/state-machine/decorators/stay-in-context-decorator";
import { State, Transitionable } from "../../../../../src/components/state-machine/public-interfaces";
import { injectionNames } from "../../../../../src/injection-names";
import { MockHandlerA, MockHandlerASpecificTypes } from "../../unifier/response-handler/mock-handler-a";

@stayInContext(() => false)
@injectable()
export class ContextBState extends BaseState<MockHandlerASpecificTypes, MockHandlerA<MockHandlerASpecificTypes>> implements State.Required {
  public extraction: any;

  constructor(
    @inject(injectionNames.current.responseHandler) responseHandler: MockHandlerA<MockHandlerASpecificTypes>,
    @inject("core:unifier:current-extraction") extraction: any,
    @inject("core:i18n:current-translate-helper") translateHelper: TranslateHelper,
    @inject("core:root:current-logger") logger: Logger
  ) {
    super(responseHandler, translateHelper, extraction, logger);
    this.extraction = extraction;
  }

  public async exampleBIntent(machine: Transitionable) {
    // do something
  }
}
