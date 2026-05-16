import Phaser from 'phaser'

export const playableControls = {
  up: Phaser.Input.Keyboard.KeyCodes.W,
  left: Phaser.Input.Keyboard.KeyCodes.A,
  down: Phaser.Input.Keyboard.KeyCodes.S,
  right: Phaser.Input.Keyboard.KeyCodes.D,
  switchMelee: Phaser.Input.Keyboard.KeyCodes.Q,
  switchRanged: Phaser.Input.Keyboard.KeyCodes.E,
  space: Phaser.Input.Keyboard.KeyCodes.SPACE,
}


export const debuggableControls = {
  up: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FIVE,
  left: Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE,
  down: Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO,
  right: Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE,
  switchMelee: Phaser.Input.Keyboard.KeyCodes.NUMPAD_SEVEN,
  switchRanged: Phaser.Input.Keyboard.KeyCodes.NUMPAD_EIGHT,
  space: Phaser.Input.Keyboard.KeyCodes.NUMPAD_EIGHT,

}