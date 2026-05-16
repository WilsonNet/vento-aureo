import Phaser from "phaser";
import { FacingState } from "../characters/playerStates";

export default class Melee extends Phaser.GameObjects.Sprite {
	private existanceCounter = 0;
	private xModifier: number;
	private yModifier = 0;

	constructor(
		scene: Phaser.Scene,
		facingState: FacingState,
		x: number,
		y: number,
	) {
		super(scene, x, y, "bomb");

		console.log("Melee -> facingState", facingState);
		if (facingState === FacingState.LEFT) {
			this.xModifier = -30;
		} else {
			this.xModifier = 30;
		}

		this.x += this.xModifier;
		this.y += this.yModifier;
		scene.add.existing(this);
	}

	fire() {
		this.setActive(true);
		this.setVisible(true);
	}

	preUpdate(t: number, dt: number) {
		super.preUpdate(t, dt);
		this.existanceCounter += dt;
		if (this.existanceCounter > 150) {
			this.existanceCounter = 0;
			this.destroy(true);
		}
	}

	updatePosition(x: number, y: number) {
		this.x = x + this.xModifier;
		this.y = y;
	}
}
