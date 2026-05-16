import Phaser from 'phaser'
import Game from './scenes/Game'
import Preloader from './scenes/Preloader'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 300 },
      debug: false,
    },
  },
  scene: [Preloader, Game],
}

const StartGame = (parent: string) => {
  return new Phaser.Game({ ...config, parent })
}

export default StartGame
