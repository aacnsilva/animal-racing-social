import * as THREE from 'three';

const MAX = 420;

export class Particles {
  readonly points: THREE.Points;
  private geometry = new THREE.BufferGeometry();
  private material: THREE.ShaderMaterial;
  private position = new Float32Array(MAX * 3);
  private color = new Float32Array(MAX * 3);
  private misc = new Float32Array(MAX * 2);
  private velocity = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private span = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private gravity = new Float32Array(MAX);
  private cursor = 0;
  private scratch = new THREE.Color();

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    this.geometry.setAttribute('aMisc', new THREE.BufferAttribute(this.misc, 2));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute vec3 aColor; attribute vec2 aMisc; uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aMisc.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aMisc.y <= 0.0 ? 0.0 : aMisc.x * uScale / max(1.0, -mv.z);
        }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vColor, smoothstep(0.5, 0.15, d) * vAlpha);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewport(height: number): void {
    this.material.uniforms.uScale.value = height;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.ColorRepresentation,
    size: number,
    life: number,
    gravity = 0,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.position.set([x, y, z], i * 3);
    this.velocity.set([vx, vy, vz], i * 3);
    this.scratch.set(color);
    this.color.set([this.scratch.r, this.scratch.g, this.scratch.b], i * 3);
    this.life[i] = life;
    this.span[i] = life;
    this.size[i] = size;
    this.gravity[i] = gravity;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        this.misc[i * 2 + 1] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.span[i]);
      this.velocity[i * 3 + 1] -= this.gravity[i] * dt;
      this.position[i * 3] += this.velocity[i * 3] * dt;
      this.position[i * 3 + 1] = Math.max(0.05, this.position[i * 3 + 1] + this.velocity[i * 3 + 1] * dt);
      this.position[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      this.misc[i * 2] = this.size[i] * (1.6 - t * 0.6);
      this.misc[i * 2 + 1] = t * 0.6;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aColor').needsUpdate = true;
    this.geometry.getAttribute('aMisc').needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
