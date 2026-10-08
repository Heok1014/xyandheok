import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { HOME_ITEMS, placement3D } from './home-layout.js';
import { getCropStatus } from './engine.js?v=2';
import { RETREAT_PLOTS, RETREAT_START, canWalk, movePlayer, distance, nearestInteraction } from './retreat-rules.js?v=4';

export async function createRetreatView({ container, onInteract, onMove, onFailure, onTick }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb3bdad);
  scene.fog = new THREE.Fog(0xb3bdad, 27, 70);
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 100);
  const sky = new THREE.HemisphereLight(0xe4ebee, 0x404629, 1.05);
  const sun = new THREE.DirectionalLight(0xffd49e, 2.8);
  sun.position.set(-8, 16, 8); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0005; sun.shadow.normalBias = .025;
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 45 });
  scene.add(sky, sun);
  // A local radiance environment gives PBR wood, glass and water real reflections, without CDN assets.
  const lighting = new THREE.Scene(); lighting.background = new THREE.Color(0x89978d);
  const lightPanel = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xffe9c9, side: THREE.DoubleSide }));
  lightPanel.position.set(-10, 16, 2); lightPanel.lookAt(0, 0, 0); lighting.add(lightPanel);
  const pmrem = new THREE.PMREMGenerator(renderer), env = pmrem.fromScene(lighting, .04);
  scene.environment = env.texture; pmrem.dispose(); lightPanel.geometry.dispose(); lightPanel.material.dispose();
  const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('role', 'group');
  canvas.setAttribute('aria-label', '湖畔3D世界。WASD或方向键移动，拖动旋转视角，E互动。点击地面走过去。');
  container.append(canvas);
  let model, pet, atlas, disposed = false, active = false, frame = 0, previous = 0, lastDraw = 0;
  let player = { ...RETREAT_START }, destination = null, direction = { x: 0, z: 0 };
  let yaw = .12, tilt = .58, radius = 16, pointer, throwAnimation, petPoseUntil = 0;
  let state, stamp = '', plotStamp = '', contextStamp = '';
  const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const focus = new THREE.Vector3(0, .7, .5), desiredFocus = new THREE.Vector3();
  const crops = [];
  const marker = new THREE.Mesh(new THREE.RingGeometry(.28, .36, 32), new THREE.MeshBasicMaterial({ color: 0xd9bf8d, transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = .06; scene.add(marker);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.13, 20, 12), new THREE.MeshStandardMaterial({ color: 0xdcca81, roughness: .78 }));
  ball.castShadow = true; ball.visible = false; scene.add(ball);
  const target = new THREE.Mesh(new THREE.RingGeometry(.45, .5, 40), new THREE.MeshBasicMaterial({ color: 0xe8c994, side: THREE.DoubleSide, depthWrite: false }));
  target.rotation.x = -Math.PI / 2; target.position.y = .07; target.visible = false; scene.add(target);
  const listeners = [];
  function listen(object, event, fn) { object.addEventListener(event, fn); listeners.push(() => object.removeEventListener(event, fn)); }
  function queue() { if (active && !disposed && !document.hidden && !frame) frame = requestAnimationFrame(draw); }
  function report() {
    if (!pet) return;
    const near = nearestInteraction(player, pet.position);
    const region = player.x < -3 ? '菜园' : player.x > 3 ? '湖边' : player.z < 0 ? '小屋门前' : '石径';
    const key = `${region}:${near?.kind}:${near?.index}`;
    if (key !== contextStamp) { contextStamp = key; onMove({ near, region }); }
  }
  function animatePet(time, dt) {
    let targetPoint;
    if (throwAnimation) {
      const t = (time - throwAnimation.start) / 1000;
      const { from, to, petFrom } = throwAnimation;
      if (t < .75) {
        const progress = Math.min(1, t / .75);
        ball.position.set(THREE.MathUtils.lerp(from.x, to.x, progress), .25 + Math.sin(progress * Math.PI) * 2.5, THREE.MathUtils.lerp(from.z, to.z, progress));
      } else { ball.position.set(to.x, .18, to.z); targetPoint = t < 2.4 ? to : { x: player.x + .7, z: player.z - .7 }; }
      if (t >= 2.4) { ball.position.copy(pet.position); ball.position.y = .35; }
      if (t > 3.6) { ball.visible = false; throwAnimation = null; }
      if (t < .75) targetPoint = petFrom;
    } else if (distance(player, pet.position) > 2.6) targetPoint = { x: player.x + .8, z: player.z - .9 };
    if (targetPoint && distance(targetPoint, pet.position) > .12) {
      const next = movePlayer(pet.position, { x: targetPoint.x - pet.position.x, z: targetPoint.z - pet.position.z }, dt * .8);
      const moving = distance(next, pet.position) > .002;
      if (moving) pet.rotation.y = Math.atan2(next.x - pet.position.x, next.z - pet.position.z);
      pet.position.x = next.x; pet.position.z = next.z;
      const legs = ['pet_leg_fl', 'pet_leg_fr', 'pet_leg_bl', 'pet_leg_br'];
      for (let i = 0; i < legs.length; i++) {
        const leg = model.getObjectByName(legs[i]);
        if (leg) leg.rotation.x = moving ? Math.sin(time / 95 + i % 2 * Math.PI) * .28 : 0;
      }
    }
    pet.position.y = time < petPoseUntil ? Math.sin((petPoseUntil - time) / 550 * Math.PI) * .07 : 0;
  }
  function draw(time) {
    frame = 0;
    if (!active || disposed || !model || document.hidden) return;
    const dt = Math.min(.05, Math.max(0, (time - (previous || time)) / 1000)); previous = time;
    if (destination) {
      if (distance(player, destination) < .2) { if (canWalk(destination)) player = { ...destination }; destination = null; }
      else player = movePlayer(player, { x: destination.x - player.x, z: destination.z - player.z }, dt);
    } else if (direction.x || direction.z) {
      // Controls are camera-relative; the same keys stay intuitive after orbiting.
      player = movePlayer(player, { x: direction.x * Math.cos(yaw) + direction.z * Math.sin(yaw), z: direction.z * Math.cos(yaw) - direction.x * Math.sin(yaw) }, dt);
    }
    marker.position.x = player.x; marker.position.z = player.z;
    animatePet(time, dt); report(); onTick(time);
    desiredFocus.set(player.x * .55, .7, player.z * .55 - 1.9);
    focus.lerp(desiredFocus, Math.min(1, dt * 4));
    camera.position.set(focus.x + Math.sin(yaw) * radius * Math.cos(tilt), focus.y + Math.sin(tilt) * radius, focus.z + Math.cos(yaw) * radius * Math.cos(tilt));
    camera.lookAt(focus);
    // Cap display work at 30fps; simulation follows monotonic time and pauses when inactive.
    if (time - lastDraw >= 32) { renderer.render(scene, camera); lastDraw = time; }
    queue();
  }
  function resize() {
    if (disposed || !container.clientWidth || !container.clientHeight) return;
    camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix();
    radius = camera.aspect < .8 ? 21 : 16;
    renderer.setSize(container.clientWidth, container.clientHeight, false); queue();
  }
  const observer = new ResizeObserver(resize); observer.observe(container);
  listen(document, 'visibilitychange', () => { previous = 0; direction = { x: 0, z: 0 }; if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else queue(); });
  listen(window, 'blur', () => { direction = { x: 0, z: 0 }; pointer = null; });
  listen(canvas, 'webglcontextlost', event => { event.preventDefault(); dispose(); onFailure('图形上下文中断。存档未改变，可以重新进入。'); });
  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0 || pointer) return;
    canvas.focus({ preventScroll: true });
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  listen(canvas, 'pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer.moved ||= Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 6;
    if (pointer.moved) { yaw -= (event.clientX - pointer.lastX) * .005; tilt = THREE.MathUtils.clamp(tilt + (event.clientY - pointer.lastY) * .003, .28, .94); }
    pointer.lastX = event.clientX; pointer.lastY = event.clientY;
  });
  listen(canvas, 'pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const click = !pointer.moved; pointer = null;
    if (!click || !model) return;
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1), camera);
    const point = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, point)) onInteract({ point: { x: point.x, z: point.z } });
  });
  listen(canvas, 'pointercancel', () => { pointer = null; });
  listen(canvas, 'wheel', event => { event.preventDefault(); radius = THREE.MathUtils.clamp(radius + Math.sign(event.deltaY), 9, 24); });
  function disposeModel(root) {
    const geometries = new Set(), materials = new Set();
    root.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) for (const material of [].concat(object.material)) materials.add(material); });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }
  function dispose() {
    if (disposed) return; disposed = true; active = false;
    cancelAnimationFrame(frame); frame = 0; observer.disconnect(); listeners.forEach(remove => remove());
    disposeModel(scene); atlas?.dispose(); env.dispose(); renderer.dispose(); canvas.remove();
  }
  try {
    const gltf = await new GLTFLoader().loadAsync(new URL('./assets/models/retreat-v4.glb', import.meta.url).href);
    model = gltf.scene;
    if (disposed) { disposeModel(model); throw new Error('3D context was lost while loading'); }
    atlas = await new THREE.TextureLoader().loadAsync(new URL('./assets/retreat-materials.webp', import.meta.url).href);
    if (disposed) { atlas.dispose(); disposeModel(model); throw new Error('3D context was lost while loading'); }
    atlas.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const textured = new Set();
    model.traverse(object => {
      if (!object.isMesh) return;
      for (const material of [].concat(object.material)) {
        if (textured.has(material)) continue;
        const name = material.name;
        const surface = name === 'ground' ? { offset: [0, .5], scale: 1.6 } : /^timber|^bark|^endgrain/.test(name) ? { offset: [.5, .5], scale: 1.5 } : /^stone/.test(name) ? { offset: [0, 0], scale: 1 } : /roof/.test(name) ? { offset: [.5, 0], scale: 1 } : null;
        if (!surface) continue; textured.add(material);
        material.onBeforeCompile = shader => {
          shader.uniforms.retreatAtlas = { value: atlas };
          shader.vertexShader = 'varying vec3 vRetreatPosition; varying vec3 vRetreatNormal;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vRetreatPosition = (modelMatrix * vec4(transformed, 1.0)).xyz; vRetreatNormal = normalize(mat3(modelMatrix) * objectNormal);');
          shader.fragmentShader = 'uniform sampler2D retreatAtlas; varying vec3 vRetreatPosition; varying vec3 vRetreatNormal;\n' + shader.fragmentShader;
          // Triplanar sampling avoids stretched walls and needs no extra UVs in the GLB.
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            vec3 blendAxis = pow(abs(normalize(vRetreatNormal)), vec3(6.0)); blendAxis /= max(dot(blendAxis, vec3(1.0)), 0.0001);
            vec2 atlasOffset = vec2(${surface.offset[0] + .008}, ${surface.offset[1] + .008});
            vec3 tx = texture2D(retreatAtlas, atlasOffset + fract(vRetreatPosition.zy * ${surface.scale.toFixed(2)}) * .484).rgb;
            vec3 ty = texture2D(retreatAtlas, atlasOffset + fract(vRetreatPosition.xz * ${surface.scale.toFixed(2)}) * .484).rgb;
            vec3 tz = texture2D(retreatAtlas, atlasOffset + fract(vRetreatPosition.xy * ${surface.scale.toFixed(2)}) * .484).rgb;
            vec3 naturalColor = pow(tx * blendAxis.x + ty * blendAxis.y + tz * blendAxis.z, vec3(2.2));
            diffuseColor.rgb = mix(diffuseColor.rgb, naturalColor, .82);
          `);
        };
        material.customProgramCacheKey = () => `retreat-atlas-${name}`;
      }
    });
    pet = model.getObjectByName('pet_root');
    if (!pet) throw new Error('Missing pet model');
    model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    for (const id of ['carrot', 'strawberry', 'sunflower']) model.getObjectByName(`crop_${id}`).visible = false;
    scene.add(model);
    for (let i = 0; i < 6; i++) { const group = new THREE.Group(); scene.add(group); crops.push(group); }
  } catch (error) { dispose(); throw error; }
  return {
    update(world, at) {
      state = world;
      const next = JSON.stringify([state.placed, state.adventure.theme]);
      if (next !== stamp) {
        stamp = next;
        for (const id of HOME_ITEMS) {
          const object = model.getObjectByName(`item_${id}`), placed = state.placed.find(piece => piece.id === id);
          object.visible = !!placed;
          if (placed) { const position = placement3D(placed); object.position.set(position.x, position.y + .35, position.z - 4); }
        }
        const theme = state.adventure.theme;
        const night = theme === 'night', sunset = theme === 'sunset';
        scene.background.setHex(night ? 0x263d50 : sunset ? 0xbca38b : 0xb3bdad);
        scene.fog.color.copy(scene.background);
        sun.color.setHex(night ? 0xadc6ef : sunset ? 0xffbd82 : 0xffdeb1);
        sun.intensity = night ? .8 : sunset ? 2.7 : 2.8; sky.intensity = night ? .6 : 1.05;
        renderer.toneMappingExposure = night ? .9 : .95;
      }
      const statuses = state.plots.map(plot => getCropStatus(plot, at));
      const cropKey = JSON.stringify(statuses.map(plot => [plot.crop, plot.ready, Math.floor(plot.progress * 4), plot.watered]));
      if (cropKey !== plotStamp) {
        plotStamp = cropKey;
        statuses.forEach((plot, i) => {
          const group = crops[i]; group.clear();
          if (plot.empty) return;
          const crop = model.getObjectByName(`crop_${plot.crop}`).clone(true); crop.visible = true;
          group.add(crop); group.position.set(RETREAT_PLOTS[i].x, .35, RETREAT_PLOTS[i].z);
          group.scale.setScalar(plot.ready ? 1 : .3 + plot.progress * .65);
        });
      }
    },
    setActive(value) { active = value; previous = 0; direction = { x: 0, z: 0 }; if (active) { resize(); queue(); } else { cancelAnimationFrame(frame); frame = 0; destination = null; } },
    input(x, z) { direction = { x, z }; if (x || z) destination = null; },
    walkTo(point) { destination = { ...point }; },
    nudge(x, z) { destination = { x: player.x + (x * Math.cos(yaw) + z * Math.sin(yaw)) * 1.2, z: player.z + (z * Math.cos(yaw) - x * Math.sin(yaw)) * 1.2 }; },
    getPlayer() { return { ...player }; },
    getNearby() { return nearestInteraction(player, pet.position); },
    reset() { yaw = .12; tilt = .58; player = { ...RETREAT_START }; destination = null; contextStamp = ''; resize(); },
    turn() { yaw += Math.PI / 4; },
    touchPet() { petPoseUntil = performance.now() + 550; },
    showTarget(power, tolerance) { target.visible = true; target.position.set(-1 + power * 5, .07, 6); target.scale.setScalar(tolerance * 5 / .48); },
    hideTarget() { target.visible = false; },
    throwBall(power) { throwAnimation = { start: performance.now(), from: { ...player }, to: { x: -1 + power * 5, z: 6 }, petFrom: { x: pet.position.x, z: pet.position.z } }; ball.visible = true; },
    dispose,
  };
}
