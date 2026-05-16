import { useRef, useState } from 'react'
import { IRefPhaserGame, PhaserGame } from './PhaserGame'
import { EventBus } from './game/EventBus'

function App() {
  const phaserRef = useRef<IRefPhaserGame | null>(null)
  const [bulletCount, setBulletCount] = useState(0)

  EventBus.on('bullet-fired', () => {
    setBulletCount((c) => c + 1)
  })

  return (
    <div id="app">
      <PhaserGame ref={phaserRef} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          padding: '8px 16px',
          background: 'rgba(0,0,0,0.7)',
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: '18px',
          borderRadius: '0 0 0 8px',
        }}
      >
        Bullets fired: {bulletCount}
      </div>
    </div>
  )
}

export default App
