import {
  Disc3,
  Gamepad2,
  Keyboard as KeyboardIcon,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Zap,
} from "lucide-react";
import { useEmu } from "@/lib/emu/store";

export interface QuickDockProps {
  onDisk: () => void;
  onReset: () => void;
  onSnapshot: () => void;
  onPauseToggle: () => void;
  onWarp: () => void;
  onSwapJoy: () => void;
  paused: boolean;
}

/** One-tap controls — always visible on touch layouts when powered on. */
export function QuickDock({ onDisk, onReset, onSnapshot, onPauseToggle, onWarp, onSwapJoy, paused }: QuickDockProps) {
  const s = useEmu();

  const toggleFullscreen = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) void el.requestFullscreen?.();
    else void document.exitFullscreen?.();
  };

  return (
    <div className="g64-dock" aria-label="Quick controls">
      <button type="button" className="g64-dock-btn" aria-label="Insert disk" title="Mount disk" onClick={onDisk}>
        <Disc3 className="size-5" />
      </button>
      <button
        type="button"
        className="g64-dock-btn"
        data-on={s.showKeyboard ? "true" : "false"}
        aria-label="Keyboard"
        title="PETSCII keyboard"
        onClick={() => s.setShowKeyboard(!s.showKeyboard)}
      >
        <KeyboardIcon className="size-5" />
      </button>
      <button
        type="button"
        className="g64-dock-btn"
        data-on={s.showJoystick ? "true" : "false"}
        aria-label="Joystick"
        title="On-screen joystick"
        onClick={() => s.setShowJoystick(!s.showJoystick)}
      >
        <Gamepad2 className="size-5" />
      </button>
      <button
        type="button"
        className="g64-dock-btn"
        data-on={s.mouseMode ? "true" : "false"}
        aria-label="Mouse mode"
        title="1351 mouse / touchpad"
        onClick={() => s.setMouseMode(!s.mouseMode)}
      >
        <MousePointer2 className="size-5" />
      </button>
      <button
        type="button"
        className="g64-dock-btn"
        data-on={s.wasdIsJoy ? "true" : "false"}
        data-kbjoy={s.wasdIsJoy ? "true" : "false"}
        aria-label={s.wasdIsJoy ? "Keyboard joystick on" : "Keyboard joystick off"}
        title={s.wasdIsJoy ? "WASD is the joystick — tap to type letters" : "Keyboard joystick off — tap so WASD moves the stick"}
        onClick={() => s.setWasdIsJoy(!s.wasdIsJoy)}
      >
        WASD
      </button>
      <button
        type="button"
        className="g64-dock-btn"
        aria-label={s.mouseMode ? `Swap 1351 port ${s.joyPort}` : `Swap joystick port ${s.joyPort}`}
        title={
          s.mouseMode ? `1351 on port ${s.joyPort} — tap to swap` : `Joystick on port ${s.joyPort} — tap to swap`
        }
        onClick={onSwapJoy}
      >
        P{s.joyPort}
      </button>
      <button type="button" className="g64-dock-btn" aria-label={paused ? "Resume" : "Pause"} title={paused ? "Resume" : "Pause"} onClick={onPauseToggle}>
        {paused ? <Play className="size-5" /> : <Pause className="size-5" />}
      </button>
      <button type="button" className="g64-dock-btn" data-on={s.warped ? "true" : "false"} aria-label="Warp mode" title="Fast-forward" onClick={onWarp}>
        <Zap className="size-5" />
      </button>
      <button type="button" className="g64-dock-btn" aria-label="Save state" title="Snapshots" onClick={onSnapshot}>
        <Save className="size-5" />
      </button>
      <button type="button" className="g64-dock-btn" aria-label="Reset" title="Reset to READY" onClick={onReset}>
        <RotateCcw className="size-5" />
      </button>
      <button type="button" className="g64-dock-btn" aria-label="Fullscreen" title="Fullscreen" onClick={toggleFullscreen}>
        <Maximize2 className="size-5" />
      </button>
    </div>
  );
}
