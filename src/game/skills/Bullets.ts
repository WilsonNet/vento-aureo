import Phaser from 'phaser'
import { EventBus } from '../EventBus'

class Bullet extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'fireball')
  }

  fire(x: number, y: number, angle: number) {
    console.log('Bullet -> fire -> angle', angle)
    this.body!.reset(x, y)
    this.setActive(true)
    this.setVisible(true)
    this.scene.physics.velocityFromRotation(angle, 600, this.body!.velocity)
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta)
    if (this.y <= -32) {
      this.setActive(false)
      this.setVisible(false)
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

  fireBullet(x: number, y: number, angle: number) {
    const bullet = this.getFirstDead(false)
    bullet?.fire(x, y, angle)
    EventBus.emit('bullet-fired')
  }
}
