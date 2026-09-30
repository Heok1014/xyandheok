import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { HOME_ITEMS, HOME_LIGHTS, placement3D, homeSignature } from './home-layout.js';

export async function createHomeView({ container, status, onPet, onFailure }) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 4.5, -4.5, .1, 100);
  const ambient = new THREE.HemisphereLight(0xfff5e4, 0x74694b, 2.5);
  const sun = new THREE.DirectionalLight(0xffefcd, 3.2);
  sun.position.set(3, 9, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512); sun.shadow.bias = -.002;
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: .5, far: 25 });
  scene.add(ambient, sun);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D小家预览。左右键旋转，加减键缩放，Home复位。可以点小猫。');
  container.append(canvas);
  let active = false, disposed = false, model, signature = '', yaw = .68, zoom = 1, pointer;
  let frame = 0, petUntil = 0;
  const raycaster = new THREE.Raycaster();
  function render() {
    if (!active || disposed || !model || document.hidden) return;
    camera.position.set(Math.sin(yaw) * 12, 9, Math.cos(yaw) * 12);
    camera.lookAt(0, .9, 0); camera.zoom = zoom; camera.updateProjectionMatrix();
    const remaining = petUntil - performance.now(), pet = model.getObjectByName('pet_root');
    pet.position.y = remaining > 0 ? Math.sin((1 - remaining / 500) * Math.PI) * .22 : 0;
    renderer.render(scene, camera);
    if (remaining > 0) queue();
  }
  function queue() { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }
  function resize() {
    if (!container.clientWidth || !container.clientHeight) return;
    const width = container.clientWidth, height = container.clientHeight, aspect = width / height;
    const halfHeight = Math.max(4.1, 5.1 / aspect);
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
    camera.top = halfHeight; camera.bottom = -halfHeight;
    renderer.setSize(width, height, false); queue();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  const visibility = () => { if (!document.hidden) queue(); };
  document.addEventListener('visibilitychange', visibility);
  const lost = event => { event.preventDefault(); dispose(); onFailure('3D画面暂时不可用，已保留2D布置和存档。'); };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, last: event.clientX, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (Math.abs(event.clientX - pointer.x) > 5) pointer.moved = true;
    if (pointer.moved) { yaw = Math.max(-.1, Math.min(1.35, yaw + (event.clientX - pointer.last) * .008)); queue(); }
    pointer.last = event.clientX;
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointer || event.pointerId !== pointer.id) return;
    if (!pointer.moved && Math.abs(event.clientY - pointer.y) < 8 && model) {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const pet = model.getObjectByName('pet_root');
      const hit = raycaster.intersectObjects(model.children.filter(object => object.visible), true)[0];
      let object = hit?.object;
      while (object && object !== pet) object = object.parent;
      if (object === pet) touchPet();
    }
    pointer = null;
  });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  function touchPet() {
    if (disposed || !model) return;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) petUntil = performance.now() + 500;
    onPet(); queue();
  }
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', '+', '=', '-', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { yaw = .68; zoom = 1; }
    else if (event.key.startsWith('Arrow')) yaw = Math.max(-.1, Math.min(1.35, yaw + (event.key === 'ArrowRight' ? .12 : -.12)));
    else zoom = Math.max(.85, Math.min(1.35, zoom + (event.key === '-' ? -.1 : .1)));
    queue();
  });
  function dispose() {
    disposed = true; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
    canvas.removeEventListener('webglcontextlost', lost);
    scene.traverse(object => { object.geometry?.dispose(); if (object.material) for (const mat of [].concat(object.material)) mat.dispose(); });
    renderer.dispose(); canvas.remove();
  }
  try {
    const gltf = await new GLTFLoader().loadAsync(new URL('./assets/models/cozy-home.glb', import.meta.url).href);
    model = gltf.scene;
    if (disposed) { scene.add(model); throw new Error('3D context was lost while loading'); }
    model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    scene.add(model); status.textContent = '横向拖动旋转，或用左右键；布置请切回2D。';
  } catch (error) { dispose(); throw error; }
  return {
    update(state) {
      const next = homeSignature(state); if (next === signature) return;
      signature = next;
      for (const id of HOME_ITEMS) {
        const object = model.getObjectByName(`item_${id}`), piece = state.placed.find(entry => entry.id === id);
        object.visible = !!piece;
        if (piece) { const pos = placement3D(piece); object.position.set(pos.x, pos.y, pos.z); }
      }
      const theme = HOME_LIGHTS[state.adventure.theme] || HOME_LIGHTS.morning;
      scene.background = new THREE.Color(theme.background); sun.color.setHex(theme.light);
      sun.intensity = theme.intensity; ambient.intensity = theme.ambient; queue();
    },
    setActive(value) { active = value; if (active) resize(); else cancelAnimationFrame(frame); },
    reset() { yaw = .68; zoom = 1; queue(); },
    touchPet,
    dispose,
  };
}
