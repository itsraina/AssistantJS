import { MinimalResponseHandler, Voiceable } from "../interfaces";
import { BaseResponse } from "./base-response";

export class SimpleVoiceResponse extends BaseResponse implements Voiceable {
  constructor(handler: MinimalResponseHandler) {
    super(handler);
  }

  endSessionWith(text: string) {
    this.handler.endSession = true;
    this.prompt(text);
  }

  prompt(text: string) {
    this.handler.voiceMessage = this.prepareText(text);
    this.handler.sendResponse();
  }

  /** Easy overwrite functionality for text preprocessing */
  protected prepareText(text: string) {
    return text;
  }
}