import * as THREE from '../vendor/three/three.module.min.js';

// Ported from noRot's VoiceOrb (Safkatul-Islam/noRot,
// 3463a01185fd9c6d9dee19da3107893effd5e187,
// apps/desktop/src/components/VoiceOrb.tsx). The original is MIT licensed.
const NOISE_GLSL = `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x*34.0)+10.0)*x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

function createDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The orb texture could not be created.');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,.9)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
function safeDetail(detail) {
  return THREE.MathUtils.clamp(Math.floor(Number.isFinite(detail) ? detail : 14), 0, 14);
}

export function createVoiceOrb(container, { detail = 14, interactive = true } = {}) {
  if (!(container instanceof HTMLElement)) throw new TypeError('An orb container is required.');
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  camera.position.z = 3;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
  } catch (error) {
    throw new Error('WebGL is unavailable for the felis orb.', { cause: error });
  }
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = 'background:transparent;display:block;opacity:0';
  container.append(renderer.domElement);
  const texture = createDotTexture(),
    geometry = new THREE.IcosahedronGeometry(1, safeDetail(detail)),
    material = new THREE.PointsMaterial({
      map: texture,
      color: '#fac399',
      transparent: true,
      opacity: 0.82,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
      size: 1,
      sizeAttenuation: true,
    });
  const uniforms = {
    time: { value: 0 },
    radius: { value: 1 },
    amplitude: { value: 0 },
    noiseStrength: { value: 0.28 },
    particleSizeMin: { value: 0.01 },
    particleSizeMax: { value: 0.08 },
    cursorPos: { value: new THREE.Vector3(0, 0, 1) },
    cursorActive: { value: 0 },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `
varying float pointCoverage;
uniform float time;
uniform float radius;
uniform float amplitude;
uniform float noiseStrength;
uniform float particleSizeMin;
uniform float particleSizeMax;
uniform vec3 cursorPos;
uniform float cursorActive;
${NOISE_GLSL}${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
vec3 p = position;
float a = clamp(amplitude, 0.0, 1.0);

float n1 = snoise(vec3(p.x * 0.60 + time * 0.35, p.y * 0.40 + time * 0.45, p.z * 0.20 + time * 0.25));
float n2 = snoise(vec3(p.x * 1.15 - time * 0.22, p.y * 0.95 + time * 0.18, p.z * 0.85 - time * 0.14));
float n = (n1 * 0.65 + n2 * 0.35);

// Distort points, then re-project onto a sphere.
p += n * noiseStrength * (0.7 + a * 1.2);
float dynRadius = radius * (1.0 + a * 0.18);
float len = max(length(p), 0.0001);
p *= dynRadius / len;

// ── Cursor bulge (Gaussian radial displacement) ──
vec3 sphereNormal = normalize(p);
float distToCursor = distance(sphereNormal, cursorPos);

// Gaussian falloff — sigma=0.40 gives a ~55° arc bump
float sigma = 0.65;
float gaussian = exp(-(distToCursor * distToCursor) / (2.0 * sigma * sigma));

// Push particles outward — inverted voice coupling: strongest when silent
float bulgeHeight = 0.55;
p += sphereNormal * gaussian * bulgeHeight * cursorActive * (1.0 - a * 0.15);

// Point size — base from noise/amplitude, 30% bonus at bump apex
float n01 = clamp(n * 0.5 + 0.5, 0.0, 1.0);
float s = mix(particleSizeMin, particleSizeMax, n01) * (1.0 + a * 0.35);
s *= (1.0 + gaussian * cursorActive * 0.3);

vec3 transformed = vec3(p.x, p.y, p.z);
`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      'gl_PointSize = size;',
      'gl_PointSize = s * size;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <logdepthbuf_vertex>',
      `
float sampledSize = max(gl_PointSize, 2.0);
pointCoverage = pow(gl_PointSize/sampledSize, 2.0);
gl_PointSize = sampledSize;
#include <logdepthbuf_vertex>
`,
    );
    shader.fragmentShader = 'varying float pointCoverage;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_particle_fragment>',
      `
#include <map_particle_fragment>
diffuseColor.a *= pointCoverage;
`,
    );
  };
  material.needsUpdate = true;
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  const mouse = new THREE.Vector2(),
    cursorTarget = new THREE.Vector3(0, 0, 1),
    raycaster = new THREE.Raycaster(),
    hit = new THREE.Vector3(),
    inverse = new THREE.Matrix4(),
    sphere = new THREE.Sphere(new THREE.Vector3(), 1);
  let targetCursor = 0,
    cursor = 0,
    amplitude = 0,
    smoothedAmplitude = 0,
    reducedMotion = false,
    paused = false,
    busy = false,
    frame = 0,
    lastFrame = 0,
    lastRender = 0,
    lost = false,
    destroyed = false;
  function resize() {
    if (destroyed || lost) return;
    const bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const nativeRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
    const ratio = Math.min(nativeRatio * 2, 4, 512 / Math.max(bounds.width, bounds.height));
    renderer.setPixelRatio(Math.max(1, ratio));
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    renderer.setSize(bounds.width, bounds.height, false);
  }
  function updateCursor() {
    if (!interactive || reducedMotion || targetCursor <= 0) return;
    const radius = points.scale.x * (1 + smoothedAmplitude * 0.18),
      visible =
        radius /
        Math.sqrt(Math.max(0.0001, camera.position.lengthSq() - radius * radius)) /
        Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)),
      distance = mouse.length();
    if (distance >= visible * 3) {
      targetCursor = 0;
      return;
    }
    targetCursor = 1 - distance / (visible * 3);
    sphere.radius = radius;
    raycaster.setFromCamera(mouse, camera);
    if (!raycaster.ray.intersectSphere(sphere, hit))
      raycaster.ray.closestPointToPoint(sphere.center, hit);
    cursorTarget.copy(hit).applyMatrix4(inverse.copy(points.matrixWorld).invert()).normalize();
  }
  function render(now) {
    if (destroyed || lost) return;
    const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
    if (
      !reducedMotion &&
      now - lastRender <
        (busy || amplitude > 0.001 || smoothedAmplitude > 0.001 ? 1000 / 60 : 1000 / 24)
    )
      return;
    lastFrame = now;
    lastRender = now;
    smoothedAmplitude += (amplitude - smoothedAmplitude) * Math.min(1, delta * 6);
    uniforms.time.value += reducedMotion ? 0 : delta * (busy ? 1.4 : 1);
    uniforms.amplitude.value = smoothedAmplitude;
    if (!reducedMotion) {
      const pace = busy ? 1.4 : 1;
      points.rotation.y += delta * 0.156 * pace;
      points.rotation.x += delta * 0.084 * pace;
    }
    points.scale.setScalar(1 + smoothedAmplitude * 0.15);
    points.updateMatrixWorld();
    updateCursor();
    cursor += (targetCursor - cursor) * Math.min(1, delta * (targetCursor > cursor ? 15 : 6));
    if (cursor < 0.005) cursor = 0;
    uniforms.cursorPos.value.lerp(cursorTarget, Math.min(1, delta * 10)).normalize();
    uniforms.cursorActive.value = reducedMotion ? 0 : cursor;
    renderer.render(scene, camera);
    renderer.domElement.style.opacity = '1';
  }
  function schedule() {
    if (destroyed || lost || paused || reducedMotion || frame) return;
    frame = requestAnimationFrame((now) => {
      frame = 0;
      render(now);
      schedule();
    });
  }
  function still() {
    if (!destroyed && !lost && !paused) {
      lastFrame = performance.now();
      lastRender = 0;
      render(lastFrame);
    }
  }
  const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) still();
    }),
    move = (event) => {
      if (!interactive || reducedMotion || destroyed) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      mouse.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -(((event.clientY - bounds.top) / bounds.height) * 2 - 1),
      );
      targetCursor = Math.abs(mouse.x) < 3 && Math.abs(mouse.y) < 3 ? 1 : 0;
    },
    leave = () => {
      targetCursor = 0;
    },
    contextLost = (event) => {
      event.preventDefault();
      lost = true;
      cancelAnimationFrame(frame);
      frame = 0;
    },
    contextRestored = () => {
      lost = false;
      resize();
      if (reducedMotion) still();
      else schedule();
    };
  observer.observe(container);
  container.addEventListener('pointermove', move, { passive: true });
  container.addEventListener('pointerleave', leave);
  renderer.domElement.addEventListener('webglcontextlost', contextLost, false);
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored, false);
  resize();
  schedule();
  return {
    update(next = {}) {
      if (destroyed) return;
      const wasPaused = paused;
      const wasReduced = reducedMotion;
      const previousColor = material.color.getHex();
      if (Object.hasOwn(next, 'amplitude'))
        amplitude = Number.isFinite(next.amplitude)
          ? THREE.MathUtils.clamp(next.amplitude, 0, 1)
          : 0;
      if (Object.hasOwn(next, 'color') && typeof next.color === 'string' && next.color)
        material.color.set(next.color);
      if (Object.hasOwn(next, 'busy')) busy = Boolean(next.busy);
      if (Object.hasOwn(next, 'reducedMotion')) reducedMotion = Boolean(next.reducedMotion);
      if (Object.hasOwn(next, 'paused')) paused = Boolean(next.paused);
      if (paused) {
        cancelAnimationFrame(frame);
        frame = 0;
        return;
      }
      if (reducedMotion) {
        cancelAnimationFrame(frame);
        frame = 0;
        if (!wasReduced || wasPaused || material.color.getHex() !== previousColor) still();
      } else {
        if (wasPaused || wasReduced) lastFrame = 0;
        schedule();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost, false);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored, false);
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.domElement.remove();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
