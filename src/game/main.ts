import Phaser from "phaser";
import Game from "./scenes/Game";
import Preloader from "./scenes/Preloader";

const config: Phaser.Types.Core.GameConfig = {
	type: Phaser.AUTO,
	width: 800,
	height: 600,
	parent: "game-container",
	scene: [Preloader, Game],
};

const StartGame = (parent: string) => {
	return new Phaser.Game({ ...config, parent });
};

export default StartGame;
