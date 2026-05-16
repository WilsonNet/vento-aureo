import Phaser from 'phaser'
import Bullets from '../skills/Bullets'
import Melee from '../weapons/Melee'
import { AIOutput } from './EnemyBrain'

import {
  FacingState,
  ActionState,
  MovementState,
  StanceState,
} from './playerStates'

interface DoublePressEntry {
  lastTime: number
  canDouble: boolean
}

export default class Player extends Phaser.Physics.Arcade.Sprite {
  private doublePressEligibility: Record<number, DoublePressEntry> = {}
  private movementState = MovementState.NATURAL
  private stateTimer = 0
  private stanceState = StanceState.RANGED
  public bullets!: Bullets
  private mouseAngle = 0
  private actionState = ActionState.NATURAL
  private melee?: Melee
  hp = 100
  lastFacingDirection = 1
  private aiOverrideInput: AIOutput | null = null
  private lastAttackTime = 0
  private attackCooldown = 1000

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, frame)
    scene.physics.add.existing(this)
    scene.sys.displayList.add(this)
    scene.sys.updateList.add(this)
    this.setBounce(0.4)
    this.setCollideWorldBounds(true)
    this.bullets = new Bullets(scene)
    this.bullets.setOwner('PLAYER')
  }

  checkDoubleEligibility(
    key: Phaser.Input.Keyboard.Key,
    eligibilityState: Record<number, DoublePressEntry>,
    time: number
  ) {
    const { keyCode } = key
    const lastTime = eligibilityState[keyCode]?.lastTime ?? 0
    const currentTime = time
    const isJustPressed = Phaser.Input.Keyboard.JustDown(key)
    const deltaTime = currentTime - lastTime
    const eligibility = eligibilityState[keyCode]
    let canDouble = eligibility?.canDouble ?? false
    isJustPressed && canDouble && deltaTime < 200
      ? (canDouble = true)
      : (canDouble = false)
    if (canDouble)
      console.table({ hayai: '早い', deltaTime, currentTime, lastTime })
    eligibilityState[keyCode] = {
      canDouble: !canDouble,
      lastTime: currentTime,
    }
    return canDouble
  }

  takeDamage(amount: number) {
    this.hp -= amount
  }

  setAIOverride(input: AIOutput | null) {
    this.aiOverrideInput = input
  }

  performAIAttack(angle: number) {
    this.mouseAngle = angle
    if (this.stanceState === StanceState.RANGED) {
      this.bullets.fireBullet(this.body!.x, this.body!.y, angle)
    } else {
      this.meleeAttack(this.scene)
    }
  }

  meleeAttack(scene: Phaser.Scene) {
    const facing = this.decideFacing()
    this.melee = new Melee(scene, facing, this.x, this.y)
  }

  getMouseAngle() {
    return this.mouseAngle
  }

  getFacingDirection(): number {
    const key = this.anims.currentAnim?.key
    const dir = key === 'left' ? -1 : 1
    this.lastFacingDirection = dir
    return dir
  }

  setMouseAngle(angle: number) {
    this.mouseAngle = angle
  }

  machineAttack(pointer: Phaser.Input.Pointer, scene: Phaser.Scene) {
    const now = scene.game.loop.time
    if (now - this.lastAttackTime < this.attackCooldown) return
    switch (this.stanceState) {
      case StanceState.MELEE:
        if (pointer.leftButtonDown()) {
          this.lastAttackTime = now
          this.meleeAttack(scene)
        } else if (pointer.rightButtonDown()) {
          this.actionState = ActionState.BLOCKING
          console.count('Blocking')
        } else if (pointer.rightButtonReleased()) {
          console.count('Unblocking')
          this.actionState = ActionState.NATURAL
        }
        break
      case StanceState.RANGED:
        this.lastAttackTime = now
        this.bullets.fireBullet(this.body!.x, this.body!.y, this.mouseAngle)
        break
    }
  }

  preUpdate(t: number, dt: number) {
    super.preUpdate(t, dt)

    if (this.movementState !== MovementState.NATURAL) this.stateTimer += dt

    const dashSpeed = 1000
    const wallJumpHorizontal = 100
    const wallJumpHeight = -100

    switch (this.movementState) {
      case MovementState.DASHING_LEFT:
        this.setVelocityX(-dashSpeed)
        if (this.stateTimer >= 250) this.cleanMovementState()
        break

      case MovementState.DASHING_RIGHT:
        this.setVelocityX(dashSpeed)
        if (this.stateTimer >= 250) this.cleanMovementState()
        break

      case MovementState.WALL_JUMPING_LEFT:
        this.setVelocity(-wallJumpHorizontal, wallJumpHeight)
        this.stateTimer += dt
        if (this.stateTimer >= 700) this.cleanMovementState()
        break

      case MovementState.WALL_JUMPING_RIGHT:
        this.setVelocity(wallJumpHorizontal, wallJumpHeight)
        this.stateTimer += dt
        if (this.stateTimer >= 700) this.cleanMovementState()
        break

      default:
        this.cleanMovementState()
        break
    }

    switch (this.actionState) {
      case ActionState.BLOCKING:
        if (
          this.body?.touching.down ||
          this.movementState === MovementState.NATURAL
        ) {
          this.setVelocityX(0)
        }
        this.anims.play('idle')
        break
      default:
        break
    }
  }

  private cleanMovementState() {
    this.movementState = MovementState.NATURAL
    this.stateTimer = 0
  }

  decideFacing = () => {
    const currentKey = this.anims.currentAnim?.key
    const direction = currentKey?.split('-')[0]
    if (direction === 'left') {
      return FacingState.LEFT
    } else {
      return FacingState.RIGHT
    }
  }

  decideIdle() {
    const currentFacing = this.decideFacing()
    if (currentFacing === FacingState.LEFT) {
      this.anims.play('left')
    } else {
      this.anims.play('right')
    }
    this.setVelocityX(0)
  }

  private updateAI(t: number, dt: number) {
    const input = this.aiOverrideInput!
    this.melee?.updatePosition(this.x, this.y)
    if (this.movementState !== MovementState.NATURAL) return
    this.actionState = ActionState.NATURAL
    const sideRun = 160
    if (input.switchToMelee) {
      this.stanceState = StanceState.MELEE
    } else if (input.switchToRanged) {
      this.stanceState = StanceState.RANGED
    }
    if (input.moveLeft) {
      this.setVelocityX(-sideRun)
      this.anims.play('left', true)
    } else if (input.moveRight) {
      this.setVelocityX(sideRun)
      this.anims.play('right', true)
    } else {
      this.decideIdle()
    }
    if (input.jump) {
      this.handleJump()
    }
    if (input.attack && this.scene.game.loop.time - this.lastAttackTime > this.attackCooldown) {
      this.lastAttackTime = this.scene.game.loop.time
      this.performAIAttack(input.aimAngle)
    }
  }

  update(t: number, dt: number, cursors: Record<string, Phaser.Input.Keyboard.Key>) {
    this.melee?.updatePosition(this.x, this.y)
    if (this.aiOverrideInput) {
      this.updateAI(t, dt)
      return
    }
    if (this.movementState !== MovementState.NATURAL) return
    const sideRun = 160
    if (!cursors?.right?.isDown && cursors?.left?.isDown) {
      if (
        this.checkDoubleEligibility(
          cursors.left,
          this.doublePressEligibility,
          t
        )
      ) {
        this.movementState = MovementState.DASHING_LEFT
      } else {
        this.setVelocityX(-sideRun)
      }
      this.anims.play('left', true)
    } else if (cursors?.right?.isDown && !cursors?.left?.isDown) {
      if (
        this.checkDoubleEligibility(
          cursors.right,
          this.doublePressEligibility,
          t
        )
      ) {
        this.movementState = MovementState.DASHING_RIGHT
      } else {
        this.setVelocityX(sideRun)
      }
      this.anims.play('right', true)
    } else {
      this.decideIdle()
    }
    if (cursors?.up?.isDown) {
      this.handleJump()
    }
    if (Phaser.Input.Keyboard.JustDown(cursors.switchMelee)) {
      this.stanceState = StanceState.MELEE
      console.log(this.stanceState)
    } else if (Phaser.Input.Keyboard.JustDown(cursors.switchRanged)) {
      this.stanceState = StanceState.RANGED
      console.log(this.stanceState)
    }
  }

  handleJump() {
    if (this.body?.touching.down) {
      this.setVelocityY(-330)
    } else if (this.body?.touching.right) {
      this.movementState = MovementState.WALL_JUMPING_LEFT
    } else if (this.body?.touching.left) {
      this.movementState = MovementState.WALL_JUMPING_RIGHT
    }
  }
}
