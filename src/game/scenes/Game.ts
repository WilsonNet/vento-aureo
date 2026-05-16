import Phaser from 'phaser'
import { createDudeAnims } from '../anims/dude/dudeAnims'
import Player from '../characters/Player'
import AIEnemy from '../characters/AIEnemy'
import EnemyBrain from '../characters/EnemyBrain'
import type { AIConfig } from '../characters/AIConfig'
import { playableControls } from '../characters/Controls'
import { EventBus } from '../EventBus'

export default class Game extends Phaser.Scene {
  private platforms?: Phaser.Physics.Arcade.StaticGroup
  private player?: Player
  private aiEnemy?: AIEnemy
  private cursors!: Record<string, Phaser.Input.Keyboard.Key>
  private hpText?: Phaser.GameObjects.Text
  private enemyHpText?: Phaser.GameObjects.Text
  private aiVsAIMode = false
  private playerBrain?: EnemyBrain
  private resetScheduled = false
  private startPlayerX = 100
  private startPlayerY = 500
  private startEnemyX = 700
  private startEnemyY = 500

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

    this.player = new Player(this, this.startPlayerX, this.startPlayerY, 'dude')
    this.aiEnemy = new AIEnemy(this, this.startEnemyX, this.startEnemyY, 'dude')

    this.platforms.create(50, 250, 'ground')
    this.platforms.create(750, 220, 'ground')
    this.platforms.create(600, 400, 'ground')

    camera.startFollow(this.player, true)

    this.hpText = this.add.text(16, 16, `hp: ${this.player.hp}`, {
      fontSize: '32px',
      color: '#000',
    })

    this.enemyHpText = this.add.text(580, 16, `enemy hp: ${this.aiEnemy.hp}`, {
      fontSize: '32px',
      color: '#000',
    })

    this.physics.add.collider(this.player, this.platforms)
    this.physics.add.collider(this.aiEnemy, this.platforms)
    this.physics.add.collider(this.aiEnemy, this.player)
    this.physics.add.collider(
      this.player.bullets,
      this.platforms,
      this.onBulletHitWall as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback
    )
    this.physics.add.collider(
      this.aiEnemy.bullets,
      this.platforms,
      this.onBulletHitWall as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback
    )

    this.resetFight()

    this.physics.add.overlap(
      this.player.bullets,
      this.aiEnemy,
      this.onPlayerBulletHitEnemy as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this
    )

    this.physics.add.overlap(
      this.aiEnemy.bullets,
      this.player,
      this.onEnemyBulletHitPlayer as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this
    )

    this.cursors = this.input.keyboard!.addKeys(playableControls) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >

    this.input.keyboard?.on('keydown-P', () => this.toggleAIVsAI())

    this.input.mouse?.disableContextMenu()

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const playerVector = new Phaser.Math.Vector2(
        this.player!.x,
        this.player!.y
      )
      this.player!.setMouseAngle(
        Phaser.Math.Angle.BetweenPoints(playerVector, pointer)
      )
    })

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.player!.machineAttack(pointer, this)
    })

    EventBus.on('enemy-hp-changed', (hp: number) => {
      this.enemyHpText?.setText(`enemy hp: ${Math.max(0, hp)}`)
    })

    const win = window as unknown as Record<string, unknown>
    win.__toggleAIVsAI = () => this.toggleAIVsAI()
    win.__gameState = () => ({
      aiVsAIMode: this.aiVsAIMode,
      playerHP: this.player?.hp,
      enemyHP: this.aiEnemy?.hp,
      playerState: this.playerBrain?.getCurrentState(),
      enemyState: this.aiEnemy?.getCurrentAIState(),
    })

    EventBus.emit('current-scene-ready', this)
  }

  private resetFight() {
    if (!this.player || !this.aiEnemy) return

    if (this.aiVsAIMode) {
      const playerConfig = this.generateFightConfig()
      const enemyConfig = this.generateFightConfig()
      if (this.playerBrain) {
        this.playerBrain = new EnemyBrain(playerConfig)
      }
      this.aiEnemy.updateConfig(enemyConfig)
      this.aiEnemy.resetBrain()
    }

    this.player.hp = 100
    this.aiEnemy.hp = 100

    this.player.setPosition(this.startPlayerX, this.startPlayerY)
    this.player.setVelocity(0, 0)

    this.aiEnemy.setPosition(this.startEnemyX, this.startEnemyY)
    this.aiEnemy.setVelocity(0, 0)

    this.player.bullets.getChildren().forEach((b) => {
      const bullet = b as Phaser.Physics.Arcade.Sprite
      bullet.disableBody(true, true)
    })
    this.aiEnemy.bullets.getChildren().forEach((b) => {
      const bullet = b as Phaser.Physics.Arcade.Sprite
      bullet.disableBody(true, true)
    })

    this.hpText?.setText('hp: 100')
    this.enemyHpText?.setText('enemy hp: 100')
    this.resetScheduled = false
  }

  private generateFightConfig(): AIConfig {
    const baseSkill = 4 + Math.floor(Math.random() * 4)
    return {
      skillLevel: baseSkill,
      reactionTime: 150 + Math.floor(Math.random() * 250),
      accuracy: 0.45 + Math.random() * 0.4,
      aggressiveness: 0.35 + Math.random() * 0.45,
      dodgeChance: 0.2 + Math.random() * 0.4,
    }
  }

  private toggleAIVsAI() {
    this.aiVsAIMode = !this.aiVsAIMode
    if (this.aiVsAIMode && this.player && this.aiEnemy) {
      this.playerBrain = new EnemyBrain(this.generateFightConfig())
      this.resetFight()
      this.player.setVelocity(0, 0)
      this.player.setAIOverride({
        moveLeft: false,
        moveRight: false,
        jump: false,
        attack: false,
        aimAngle: 0,
        evadeActive: false,
        switchToMelee: false,
        switchToRanged: true,
      })
      console.log('=== AI VS AI MODE ENABLED ===')
      console.log(`Player HP: ${this.player.hp}, Enemy HP: ${this.aiEnemy.hp}`)
      console.log("Type window.__gameState() to inspect, or press 'P' to exit")
    } else {
      this.playerBrain = undefined
      this.player?.setAIOverride(null)
      console.log('=== AI VS AI MODE DISABLED ===')
    }
  }

  private onPlayerBulletHitEnemy(
    character: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    projectile: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bullet = projectile as Phaser.Physics.Arcade.Sprite
    bullet.disableBody(true, true)

    const enemy = character as AIEnemy
    if (enemy.hp <= 0) return
    enemy.takeDamage(10)
    console.log(
      `[FIGHT] Player bullet hit enemy! Enemy HP: ${Math.max(0, enemy.hp)}`
    )
    if (enemy.hp <= 0) {
      console.log('[FIGHT] Enemy defeated!')
      this.scheduleReset(this.aiEnemy!, this.player!)
    }
  }

  private onEnemyBulletHitPlayer(
    character: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    projectile: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const bullet = projectile as Phaser.Physics.Arcade.Sprite
    bullet.disableBody(true, true)

    const player = character as Player
    if (player.hp <= 0) return
    player.takeDamage(10)
    console.log(
      `[FIGHT] Enemy bullet hit player! Player HP: ${Math.max(0, player.hp)}`
    )
    this.hpText?.setText(`hp: ${Math.max(0, player.hp)}`)
    if (player.hp <= 0) {
      console.log('[FIGHT] Player defeated!')
      this.scheduleReset(this.player!, this.aiEnemy!)
    }
  }

  private scheduleReset(defeated: Player | AIEnemy, victor: Player | AIEnemy) {
    if (!this.aiVsAIMode || this.resetScheduled) return
    this.resetScheduled = true
    this.time.delayedCall(2000, () => {
      this.resetScheduled = false
      this.resetFight()
      console.log('=== FIGHT RESET ===')
      console.log('Both fighters restored to full HP')
    })
  }

  private onBulletHitWall(
    obj1: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    obj2: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ) {
    const a = obj1 as Phaser.Physics.Arcade.Sprite
    const b = obj2 as Phaser.Physics.Arcade.Sprite
    const target = a.texture?.key === 'fireball' ? a : b.texture?.key === 'fireball' ? b : null
    target?.disableBody(true, true)
  }

  private logAIVsAIState() {
    if (!this.aiVsAIMode || !this.player || !this.aiEnemy) return
    console.log(
      `[STATE] Player: ${this.playerBrain?.getCurrentState()} | Enemy: ${this.aiEnemy.getCurrentAIState()} | HP ${this.player.hp} vs ${this.aiEnemy.hp}`
    )
  }

  private hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const steps = 20
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      const x = fromX + (toX - fromX) * t
      const y = fromY + (toY - fromY) * t - 18
      const bodies = this.physics.overlapRect(x - 3, y - 3, 6, 6, false, true)
      if (bodies && bodies.length > 0) return false
    }
    return true
  }

  update(t: number, dt: number) {
    if (this.aiVsAIMode && this.player && this.playerBrain && this.aiEnemy) {
      this.updateAIVsAI(t, dt)
    } else {
      this.player?.update(t, dt, this.cursors)
    }

    if (this.player && this.aiEnemy) {
      const los = this.hasLineOfSight(
        this.aiEnemy.x, this.aiEnemy.y,
        this.player.x, this.player.y
      )
      this.aiEnemy.update(
        t,
        dt,
        this.player.x,
        this.player.y,
        this.player.getFacingDirection(),
        los,
        this.player.hp
      )
    }
  }

  private updateAIVsAI(t: number, dt: number) {
    const player = this.player!
    const enemy = this.aiEnemy!
    const brain = this.playerBrain!

    if (player.hp <= 0) return

    const dx = enemy.x - player.x
    const dy = enemy.y - player.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    const los = this.hasLineOfSight(player.x, player.y, enemy.x, enemy.y)

    const pInput = {
      playerX: enemy.x,
      playerY: enemy.y,
      selfX: player.x,
      selfY: player.y,
      distanceToPlayer: distance,
      playerFacingDirection: enemy.getFacingDirection(),
      touchingDown: player.body?.touching.down ?? false,
      touchingLeft: player.body?.touching.left ?? false,
      touchingRight: player.body?.touching.right ?? false,
      hasLineOfSight: los,
      selfHP: player.hp,
      enemyHP: enemy.hp,
    }

    const output = brain.decide(pInput, t, dt)
    player.setAIOverride(output)
    player.update(t, dt, this.cursors)
  }
}
