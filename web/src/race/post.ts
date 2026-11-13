import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

class FinishPass extends Pass {
  private quad: FullScreenQuad;
  private material: THREE.ShaderMaterial;
  private tint = new THREE.Color(1, 1, 1);

  constructor() {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        toneMappingExposure: { value: 1 },
        uVignette: { value: 0.32 },
        uSaturation: { value: 1.08 },
        uTint: { value: this.tint },
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy, 0.0, 1.0);\n}',
      fragmentShader: [
        'uniform sampler2D tDiffuse;',
        'uniform float uVignette;',
        'uniform float uSaturation;',
        'uniform vec3 uTint;',
        '#include <tonemapping_pars_fragment>',
        'varying vec2 vUv;',
        'void main() {',
        '  vec4 texel = texture2D(tDiffuse, vUv);',
        '  vec3 color = texel.rgb * uTint;',
        '  vec2 centred = vUv - 0.5;',
        '  color *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(centred, centred) * 2.2);',
        '  color = ACESFilmicToneMapping(color);',
        '  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));',
        '  color = mix(vec3(luma), color, uSaturation);',
        '  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;',
        '  gl_FragColor = sRGBTransferOETF(vec4(color, 1.0));',
        '  gl_FragColor.rgb += grain / 255.0;',
        '}',
      ].join('\n'),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setTint(color: THREE.Color): void {
    this.tint.copy(color);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

export type Tier = { pixelRatio: number; bloom: boolean; shadow: number; detail: number };

const TIERS: Tier[] = [
  { pixelRatio: 2, bloom: true, shadow: 2048, detail: 1 },
  { pixelRatio: 1.5, bloom: true, shadow: 2048, detail: 0.6 },
  { pixelRatio: 1.25, bloom: false, shadow: 1024, detail: 0.3 },
  { pixelRatio: 1, bloom: false, shadow: 1024, detail: 0 },
];

export class Pipeline {
  readonly finish = new FinishPass();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private renderer: THREE.WebGLRenderer;
  private level: number;
  private slow = 0;
  private average = 1 / 60;
  private settle = 0;
  private width = 1;
  private height = 1;
  onTier: ((tier: Tier) => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    this.level = coarse ? (cores >= 8 ? 1 : 2) : cores <= 4 ? 1 : 0;
    const samples = Math.min(4, renderer.capabilities.maxSamples);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.5, 1.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.finish);
  }

  get tier(): Tier {
    return TIERS[this.level];
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const ratio = Math.min(window.devicePixelRatio || 1, this.tier.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.bloom.enabled = this.tier.bloom;
  }

  render(dt: number): void {
    this.composer.render(dt);
    if (dt <= 0 || dt > 0.25) return;
    this.settle += dt;
    if (this.settle < 2.5) return;
    this.average += (dt - this.average) * 0.05;
    if (this.average > 1 / 48) this.slow += dt;
    else this.slow = Math.max(0, this.slow - dt * 0.5);
    if (this.slow > 1.5 && this.level < TIERS.length - 1) {
      this.level += 1;
      this.slow = 0;
      this.settle = 1;
      this.average = 1 / 60;
      this.setSize(this.width, this.height);
      this.onTier?.(this.tier);
    }
  }

  dispose(): void {
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.bloom.dispose();
    this.finish.dispose();
  }
}
