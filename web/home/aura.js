import * as THREE from '../vendor/three/three.module.min.js';

// Adapted from bayshores/obsel's Apache-2.0 backdrop shader. Its edge
// vignette leaves the reading area flat; a fixed phase makes it a still image.
const fragmentShader = `precision highp float;
uniform vec2 u_res;
uniform vec3 u_tint;
out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  float n = smoothstep(0.34, 0.92, fbm(p * 9.0 + vec2(0.83, -0.5)));
  float bar = 1.0 - smoothstep(0.0, 0.26, abs(uv.x - 0.5));
  float rows = 0.70 + 0.30 * (0.5 + 0.5 * sin(gl_FragCoord.y * 1.55));
  float edge = smoothstep(0.36, 1.04, length((uv - 0.5) * vec2(1.0, 1.32)));
  float amount = clamp((n * 0.42 + bar * 0.58) * rows * edge * 0.42, 0.0, 1.0);
  fragColor = vec4(mix(vec3(0.043, 0.039, 0.055), u_tint, amount), 1.0);
}`;

export function mountHomeAura(parent) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  } catch {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const uniforms = {
    u_res: { value: new THREE.Vector2(1, 1) },
    u_tint: { value: new THREE.Color('#e85d92') },
  };
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'in vec3 position; void main(){gl_Position=vec4(position,1.);}',
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const camera = new THREE.Camera();
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  parent.append(canvas);
  const draw = () => {
    const { width, height } = parent.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    uniforms.u_res.value.set(canvas.width, canvas.height);
    renderer.render(scene, camera);
  };
  const observer = new ResizeObserver(draw);
  observer.observe(parent);
  draw();
  return {
    destroy() {
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
