import { Howl } from "howler";

export function createUiClickSfx() {
  return new Howl({
    src: ["/audio/ui-click.mp3"],
    volume: 0.3,
  });
}
