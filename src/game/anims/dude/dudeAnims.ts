import Phaser from 'phaser';

export const createDudeAnims = (anims: Phaser.Animations.AnimationManager) => {
  anims.create({
    key: 'left',
    frames: anims.generateFrameNumbers('dude', {
      start: 0,
      end: 3,
    }),
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: 'right',
    frames: anims.generateFrameNumbers('dude', {
      start: 5,
      end: 8,
    }),
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: 'turn',
    frames: [{ key: 'dude', frame: 4 }],
  });
  anims.create({
    key: 'right-idle',
    frames: [{ key: 'dude', frame: 5 }],
  });
}
