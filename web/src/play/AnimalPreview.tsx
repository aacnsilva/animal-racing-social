import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Species } from '../lib/types';
import { buildAnimal } from '../race/animals';

export function AnimalPreview({ species, color }: { species: Species; color: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return undefined;
    }
    renderer.debug.checkShaderErrors = import.meta.env.DEV;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    scene.add(new THREE.HemisphereLight('#dff3ff', '#3a5a40', 1.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const rig = buildAnimal(species, color);
    const turntable = new THREE.Group();
    turntable.add(rig.root);
    const discGeometry = new THREE.CylinderGeometry(2.6, 2.9, 0.25, 40);
    const discMaterial = new THREE.MeshStandardMaterial({ color: '#1d2f29', roughness: 0.6, metalness: 0.2 });
    const disc = new THREE.Mesh(discGeometry, discMaterial);
    disc.position.y = -0.13;
    turntable.add(disc);
    const rimGeometry = new THREE.TorusGeometry(2.75, 0.05, 6, 48);
    const rimMaterial = new THREE.MeshBasicMaterial({ color });
    const rim = new THREE.Mesh(rimGeometry, rimMaterial);
    rim.rotation.x = Math.PI / 2;
    turntable.add(rim);
    scene.add(turntable);
    const focus = rig.height * 0.48;
    camera.position.set(0, focus + 1.6, 6.2 + rig.height * 1.15);
    camera.lookAt(0, focus, 0);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let raf = 0;
    let last = performance.now();
    let time = 0;
    let visible = true;
    const watcher = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    });
    watcher.observe(container);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || now - last < 30) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      turntable.rotation.y = time * 0.6 + 0.6;
      rig.update('RUNNING', 15, dt, time);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      watcher.disconnect();
      discMaterial.dispose();
      rimMaterial.dispose();
      discGeometry.dispose();
      rimGeometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      window.setTimeout(() => renderer.forceContextLoss(), 1500);
    };
  }, [species, color]);

  return <div ref={host} className="gp-preview" aria-hidden />;
}
