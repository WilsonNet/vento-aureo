import Phaser from 'phaser'
import { createDudeAnims } from '../anims/dude/dudeAnims'
import Player from '../characters/Player'
import { playableControls, debuggableControls } from '../characters/Controls'
import { EventBus } from '../EventBus'

export default class Game extends Phaser.Scene {
  private platforms?: Phaser.Physics.Arcade.StaticGroup
  private player?: Player
  private debbugablePlayer?: Player
  private cursors!: Record<string, Phaser.Input.Keyboard.Key>
  private debbugableCursors!: Record<string, Phaser.Input.Keyboard.Key>
  private hpText?: Phaser.GameObjects.Text
  private hpText2?: Phaser.GameObjects.Text

  constructor() {
    super('Game')
  }

  preload() {}

  create() {
    const camera = this.cameras.main
    createDudeAnims(this.anims)

    camera.setBounds(0, 0, 800, 600, true)

    this.add.image(400, 300, 'sky')
    this.platforms = this.physics.add.staticGroup()
    const ground = this.platforms.create(
      400,
      568,
      'ground'
    ) as Phaser.Physics.Arcade.Sprite
    ground.setScale(2).refreshBody()

    this.player = new Player(this, 25, 20, 'dude')
    this.debbugablePlayer = new Player(this, 400, 20, 'dude')

    this.platforms.create(50, 250, 'ground')
    this.platforms.create(750, 220, 'ground')
    this.platforms.create(600, 400, 'ground')

    camera.startFollow(this.player, true)

    this.hpText = this.add.text(16, 16, `hp: ${this.player.hp}`, {
      fontSize: '32px',
      color: '#000',
    })

    this.hpText2 = this.add.text(640, 16, `hp: ${this.debbugablePlayer.hp}`, {
      fontSize: '32px',
      color: '#000',
    })

    this.physics.add.collider(this.player, this.platforms)
    this.physics.add.collider(this.debbugablePlayer, this.platforms)
    this.physics.add.collider(this.debbugablePlayer, this.player)
    this.cursors = this.input.keyboard!.addKeys(playableControls) as Record<string, Phaser.Input.Keyboard.Key>
    this.debbugableCursors = this.input.keyboard!.addKeys(debuggableControls) as Record<string, Phaser.Input.Keyboard.Key>

    this.input.mouse?.disableContextMenu()

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const playerVector = new Phaser.Math.Vector2(this.player!.x, this.player!.y)
      this.player!.setMouseAngle(Phaser.Math.Angle.BetweenPoints(playerVector, pointer))
    })

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.player!.machineAttack(pointer, this)
    })

    EventBus.emit('current-scene-ready', this)
  }

  update(t: number, dt: number) {
    this.player?.update(t, dt, this.cursors)
    this.debbugablePlayer?.update(t, dt, this.debbugableCursors)
  }
}
