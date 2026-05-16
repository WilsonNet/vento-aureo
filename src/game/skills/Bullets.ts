import Phaser from 'phaser'
import { EventBus } from '../EventBus'

class Bullet extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'fireball')
  }

  private ownerId = '?'

  setOwner(id: string) {
    this.ownerId = id
  }

  fire(x: number, y: number, angle: number) {
    console.log(`Bullet [${this.ownerId}] -> fire -> angle ${angle.toFixed(3)}`)
    this.enableBody(true, x, y, true, true)
    this.scene.physics.velocityFromRotation(angle, 600, this.body!.velocity)
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta)
    if (this.y <= -32) {
      this.disableBody(true, true)
    }
  }
}

export default class Bullets extends Phaser.Physics.Arcade.Group {
  constructor(scene: Phaser.Scene) {
    super(scene.physics.world, scene)
    this.createMultiple({
      frameQuantity: 900,
      key: 'bullet',
      active: false,
      visible: false,
      classType: Bullet,
    })
  }

  private groupOwner = '?'

  setOwner(id: string) {
    this.groupOwner = id
    this.getChildren().forEach((b) => {
      ;(b as Bullet).setOwner(id)
    })
  }

  fireBullet(x: number, y: number, angle: number) {
    const bullet = this.getFirstDead(false) as Bullet | null
    if (bullet) {
      bullet.setOwner(this.groupOwner)
      bullet.fire(x, y, angle)
      EventBus.emit('bullet-fired')
    }
  }
}
