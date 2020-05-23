import Phaser from 'phaser'

export default class Melee extends Phaser.GameObjects.Sprite {
  private existanceCounter = 0;
  constructor (scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bomb')
    scene.add.existing(this)
  }
  fire (x: number, y: number, angle: number) {
    console.log('Bullet -> fire -> angle', angle)
    // this.body.reset(x, y)
    this.setActive(true)
    this.setVisible(true)
    // this.scene.physics.velocityFromRotation(angle, 600, this.body.velocity)
  }
  preUpdate(t: number, dt: number){
    super.preUpdate(t, dt)
    this.existanceCounter += dt;
    if (this.existanceCounter > 150) {
      this.existanceCounter= 0
      this.destroy(true)
    }
  }
}