import BaseEntity from "../core/entity/BaseEntity";
import Entity from "../core/entity/Entity";

export default class ExampleEntity extends BaseEntity implements Entity {
  onExampleEvent({ level, message }: { level: number; message: string }) {
    console.log("ExampleEntity event received", message);
  }
}
