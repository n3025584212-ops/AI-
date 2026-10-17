import { Color, CustomBlending, Matrix4, NoBlending, Vector4 } from 'three';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

function contactSize(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const ratio = Math.min(0.5, 1280 / safeWidth);
  return [Math.max(1, Math.round(safeWidth * ratio)), Math.max(1, Math.round(safeHeight * ratio))];
}

// AO describes the fixed machine silhouette, so roller/strip animation can
// reuse it. Invalidate after visibility, explode, or machine geometry changes.
// The owner must set enabled=false in transparent mode: normal overrides
// deliberately render solid depth and are not valid for translucent shells.
export class IndustrialContactPass extends SSAOPass {
  constructor(scene, camera, width = 1, height = 1) {
    const [aoWidth, aoHeight] = contactSize(width, height);
    super(scene, camera, aoWidth, aoHeight, 24);
    this.kernelRadius = 0.65;
    this.minDistance = 0.00015;
    this.maxDistance = 0.02;
    this.output = SSAOPass.OUTPUT.Default;
    this.needsSwap = false;
    this._contactDirty = true;
    this._contactDisposed = false;
    this._cachedCameraWorld = new Matrix4();
    this._cachedProjection = new Matrix4();
    this._cachedNear = NaN;
    this._cachedFar = NaN;
    this._cachedSettings = '';
    this._savedClearColor = new Color();
    this._savedViewport = new Vector4();
    this._savedScissor = new Vector4();
    this.rebuildCount = 0;
  }

  _overrideVisibility() {
    super._overrideVisibility();
    // MeshNormalMaterial does not inherit the S5 strip clipping planes.
    // The thin strip adds negligible contact shadow; omit it from AO depth.
    this.scene.traverse(object => {
      if (object.isMesh && object.userData.part === 'strip' && object.visible) {
        object.visible = false;
        this._visibilityCache.push(object);
      }
    });
  }

  invalidateGeometry() {
    this._contactDirty = true;
  }

  setSize(width, height) {
    const [aoWidth, aoHeight] = contactSize(width, height);
    if (aoWidth !== this.width || aoHeight !== this.height) super.setSize(aoWidth, aoHeight);
    this.invalidateGeometry();
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!this.enabled || this._contactDisposed) return;
    this.camera.updateWorldMatrix(true, false);
    const uniforms = this.ssaoMaterial.uniforms;
    uniforms.cameraNear.value = this.camera.near;
    uniforms.cameraFar.value = this.camera.far;
    uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
    uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    uniforms.kernelRadius.value = this.kernelRadius;
    uniforms.minDistance.value = this.minDistance;
    uniforms.maxDistance.value = this.maxDistance;
    this.depthRenderMaterial.uniforms.cameraNear.value = this.camera.near;
    this.depthRenderMaterial.uniforms.cameraFar.value = this.camera.far;
    const settings = `${this.kernelRadius}/${this.minDistance}/${this.maxDistance}`;
    const rebuild = this._contactDirty
      || !this._cachedCameraWorld.equals(this.camera.matrixWorld)
      || !this._cachedProjection.equals(this.camera.projectionMatrix)
      || this._cachedNear !== this.camera.near || this._cachedFar !== this.camera.far
      || this._cachedSettings !== settings;

    // Parent helpers restore clear state on success, but not on renderer errors.
    // Keep an outer restoration boundary around the entire cached pass.
    const originalTarget = renderer.getRenderTarget();
    const originalFace = renderer.getActiveCubeFace();
    const originalMip = renderer.getActiveMipmapLevel();
    const originalAutoClear = renderer.autoClear;
    const originalClearAlpha = renderer.getClearAlpha();
    const originalOverride = this.scene.overrideMaterial;
    const originalBackground = this.scene.background;
    const originalShadowAuto = renderer.shadowMap.autoUpdate;
    const originalShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const originalScissorTest = renderer.getScissorTest();
    renderer.getClearColor(this._savedClearColor);
    renderer.getViewport(this._savedViewport);
    renderer.getScissor(this._savedScissor);

    try {
      if (rebuild) {
        this._contactDirty = true;
        this._overrideVisibility();
        this.scene.background = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.shadowMap.needsUpdate = false;
        try {
          this._renderOverride(renderer, this.normalMaterial, this.normalRenderTarget, 0x7777ff, 1);
        } finally {
          this._restoreVisibility();
          this.scene.overrideMaterial = originalOverride;
          this.scene.background = originalBackground;
          renderer.shadowMap.autoUpdate = originalShadowAuto;
          renderer.shadowMap.needsUpdate = originalShadowNeedsUpdate;
        }
        this._renderPass(renderer, this.ssaoMaterial, this.ssaoRenderTarget);
        this._renderPass(renderer, this.blurMaterial, this.blurRenderTarget);
        this._cachedCameraWorld.copy(this.camera.matrixWorld);
        this._cachedProjection.copy(this.camera.projectionMatrix);
        this._cachedNear = this.camera.near;
        this._cachedFar = this.camera.far;
        this._cachedSettings = settings;
        this._contactDirty = false;
        this.rebuildCount += 1;
      }

      if (this.renderToScreen) {
        // The usual integration puts this before SMAA/OutputPass. Also support
        // being last by copying scene colour before the multiplicative blend.
        this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
        this.copyMaterial.blending = NoBlending;
        this._renderPass(renderer, this.copyMaterial, null);
      }
      this.copyMaterial.uniforms.tDiffuse.value = this.blurRenderTarget.texture;
      this.copyMaterial.blending = CustomBlending;
      this._renderPass(renderer, this.copyMaterial, this.renderToScreen ? null : readBuffer);
    } finally {
      this._restoreVisibility();
      this.scene.overrideMaterial = originalOverride;
      this.scene.background = originalBackground;
      renderer.shadowMap.autoUpdate = originalShadowAuto;
      renderer.shadowMap.needsUpdate = originalShadowNeedsUpdate;
      renderer.autoClear = originalAutoClear;
      renderer.setClearColor(this._savedClearColor, originalClearAlpha);
      renderer.setRenderTarget(originalTarget, originalFace, originalMip);
      renderer.setViewport(this._savedViewport);
      renderer.setScissor(this._savedScissor);
      renderer.setScissorTest(originalScissorTest);
    }
  }

  dispose() {
    if (this._contactDisposed) return;
    this._contactDisposed = true;
    this._restoreVisibility();
    super.dispose();
    // Current SSAOPass.dispose omits these two owned GPU resources.
    this.ssaoMaterial.dispose();
    this.noiseTexture.dispose();
  }
}

export default IndustrialContactPass;
