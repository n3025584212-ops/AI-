import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// HDR highlights only; reduced-resolution blur does not redraw the mill geometry.
export class IndustrialGlowPass extends UnrealBloomPass {
  constructor() { super(new Vector2(1, 1), 0.28, 0.30, 1.15); }
  setSize(width, height) {
    const ratio = Math.min(1, 1920 / Math.max(width, 1));
    super.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
  }
}
