import * as THREE from 'three';

export type ParticleStyle = {
  color: string;
  size: number;
  grow: number;
  life: number;
  gravity: number;
  drag: number;
  opacity: number;
  lift: number;
  spread: number;
  rate: number;
  additive?: boolean;
};

export const PARTICLE_STYLES: Record<string, ParticleStyle> = {
  GRASS: {
    color: '#4b3a22',
    size: 0.09,
    grow: 0.2,
    life: 0.7,
    gravity: -9,
    drag: 0.4,
    opacity: 0.9,
    lift: 3.2,
    spread: 1.2,
    rate: 0.5,
  },
  DIRT: {
    color: '#b08a62',
    size: 0.22,
    grow: 1.3,
    life: 1.0,
    gravity: 0.5,
    drag: 2.4,
    opacity: 0.17,
    lift: 1.3,
    spread: 0.7,
    rate: 0.5,
  },
  SAND: {
    color: '#e3c690',
    size: 0.2,
    grow: 1.1,
    life: 0.9,
    gravity: -0.6,
    drag: 2.2,
    opacity: 0.2,
    lift: 1.5,
    spread: 0.8,
    rate: 0.55,
  },
  MUD: {
    color: '#2e2016',
    size: 0.1,
    grow: 0.3,
    life: 0.75,
    gravity: -9,
    drag: 0.3,
    opacity: 0.95,
    lift: 3.4,
    spread: 1.4,
    rate: 0.7,
  },
  ICE: {
    color: '#f4fbff',
    size: 0.1,
    grow: 0.5,
    life: 0.55,
    gravity: -5,
    drag: 1.2,
    opacity: 0.5,
    lift: 2.4,
    spread: 1.2,
    rate: 0.7,
  },
  WATER: {
    color: '#e9fbff',
    size: 0.04,
    grow: 0.25,
    life: 1.4,
    gravity: 1.6,
    drag: 2.5,
    opacity: 0.32,
    lift: 0.3,
    spread: 0.5,
    rate: 0.6,
    additive: true,
  },
};

export class Particles {
  readonly points: THREE.Points;
  readonly style: ParticleStyle;
  private capacity: number;
  private cursor = 0;
  private start: THREE.BufferAttribute;
  private velocity: THREE.BufferAttribute;
  private birth: THREE.BufferAttribute;
  private material: THREE.ShaderMaterial;
  private dirty = false;
  private light = new THREE.Color(1, 1, 1);

  constructor(style: ParticleStyle, capacity = 900) {
    this.style = style;
    this.capacity = capacity;
    const geometry = new THREE.BufferGeometry();
    this.start = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.velocity = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.birth = new THREE.BufferAttribute(new Float32Array(capacity * 2).fill(-100), 2);
    this.start.setUsage(THREE.DynamicDrawUsage);
    this.velocity.setUsage(THREE.DynamicDrawUsage);
    this.birth.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.start);
    geometry.setAttribute('aVelocity', this.velocity);
    geometry.setAttribute('aBirth', this.birth);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(style.color) },
        uLight: { value: this.light },
        uSize: { value: style.size },
        uGrow: { value: style.grow },
        uLife: { value: style.life },
        uGravity: { value: style.gravity },
        uDrag: { value: style.drag },
        uOpacity: { value: style.opacity },
        uScale: { value: 600 },
      },
      vertexShader: [
        'attribute vec3 aVelocity;',
        'attribute vec2 aBirth;',
        'uniform float uTime;',
        'uniform float uSize;',
        'uniform float uGrow;',
        'uniform float uLife;',
        'uniform float uGravity;',
        'uniform float uDrag;',
        'uniform float uScale;',
        'varying float vFade;',
        'void main() {',
        '  float age = uTime - aBirth.x;',
        '  float life = uLife * aBirth.y;',
        '  float t = clamp(age / life, 0.0, 1.0);',
        '  float travel = (1.0 - exp(-uDrag * age)) / max(uDrag, 0.001);',
        '  vec3 p = position + aVelocity * travel;',
        '  p.y += 0.5 * uGravity * age * age;',
        '  p.y = max(p.y, position.y - 0.4);',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  float alive = step(0.0, age) * step(age, life);',
        '  vFade = alive * (1.0 - t) * smoothstep(0.0, 0.08, t + 0.02);',
        '  gl_PointSize = alive * (uSize + uGrow * t) * aBirth.y * uScale / max(0.1, -mv.z);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform vec3 uLight;',
        'uniform float uOpacity;',
        'varying float vFade;',
        'void main() {',
        '  vec2 c = gl_PointCoord - 0.5;',
        '  float d = dot(c, c) * 4.0;',
        '  float a = smoothstep(1.0, 0.25, d) * vFade * uOpacity;',
        '  if (a < 0.004) discard;',
        '  gl_FragColor = vec4(uColor * uLight * (0.85 + 0.3 * (0.5 - c.y)), a);',
        '}',
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: style.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setLight(color: THREE.Color): void {
    this.light.copy(color);
  }

  setViewport(height: number, fov: number): void {
    this.material.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, time: number, scale: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.start.setXYZ(i, x, y, z);
    this.velocity.setXYZ(i, vx, vy, vz);
    this.birth.setXY(i, time, scale);
    this.dirty = true;
  }

  update(time: number): void {
    this.material.uniforms.uTime.value = time;
    if (!this.dirty) return;
    this.dirty = false;
    this.start.needsUpdate = true;
    this.velocity.needsUpdate = true;
    this.birth.needsUpdate = true;
  }
}
