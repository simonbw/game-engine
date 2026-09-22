import { BaseEntity } from "../core/entity/BaseEntity";
import { Entity, GameEventMap } from "../core/entity/Entity";
import { on } from "../core/entity/handler";

/**
 * An example entity demonstrating basic entity creation and custom event handling.
 * Shows how to extend BaseEntity and implement custom game event responses.
 * Used for testing and as a reference implementation.
 */
export class ExampleEntity extends BaseEntity implements Entity {
  @on("exampleEvent")
  onExampleEvent({ level, message }: GameEventMap["exampleEvent"]) {
    console.log("ExampleEntity event received", level, message);
  }
}
