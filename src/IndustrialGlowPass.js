import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// HDR highlights only; reduced-resolution blur does not redraw the mill geometry.
export class IndustrialGlowPass extends UnrealBloomPass {
  constructor() { super(new Vector2(1, 1), 0.26, 0.14, 1.02); }
  setSize(width, height) {
    // Restore the pre-optimization bloom working resolution.
    const ratio = Math.min(1, 1920 / Math.max(width, 1));
    super.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
  }
}
