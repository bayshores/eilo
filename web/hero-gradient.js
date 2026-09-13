import * as THREE from './vendor/three/three.module.min.js';
import { hexToHsv } from './styles/accent.js';
import { normalizeAccent } from './home/storage.js';

// Gradient and palette adapted from bayshores/hackdavis2026 at dcdf11d.
// https://github.com/bayshores/hackdavis2026/blob/dcdf11d53c19dd17dbcbae59dc935ff30e1f65a9/components/bg/Grainient.tsx
// Time stays at zero. Draw only when the window or accent changes.
const fragmentShader = `precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uTimeSpeed;
uniform float uColorBalance;
uniform float uWarpStrength;
uniform float uWarpFrequency;
uniform float uWarpSpeed;
uniform float uWarpAmplitude;
uniform float uBlendAngle;
uniform float uBlendSoftness;
uniform float uRotationAmount;
uniform float uNoiseScale;
uniform float uGrainAmount;
uniform float uGrainScale;
uniform float uGrainAnimated;
uniform float uContrast;
uniform float uGamma;
uniform float uSaturation;
uniform vec2 uCenterOffset;
uniform float uZoom;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
out vec4 fragColor;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);float n=mix(mix(dot(-1.0+2.0*hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(-1.0+2.0*hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),mix(dot(-1.0+2.0*hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(-1.0+2.0*hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);return 0.5+0.5*n;}
void mainImage(out vec4 o, vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);
  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;
  float frequency=uWarpFrequency;
  float ws=max(uWarpStrength,0.001);
  float amplitude=uWarpAmplitude/ws;
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*frequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(frequency*1.5)+warpTime)/(amplitude*0.5);
  vec3 colLav=uColor1;
  vec3 colOrg=uColor2;
  vec3 colDark=uColor3;
  float b=uColorBalance;
  float s=max(uBlendSoftness,0.0);
  mat2 blendRot=Rot(radians(uBlendAngle));
  float blendX=(tuv*blendRot).x;
  float edge0=-0.3-b-s;
  float edge1=0.2-b+s;
  float v0=0.5-b+s;
  float v1=-0.3-b-s;
  vec3 layer1=mix(colDark,colOrg,S(edge0,edge1,blendX));
  vec3 layer2=mix(colOrg,colLav,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));
  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5){grainUv+=vec2(iTime*0.05);}
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;
  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  col=clamp(col,0.0,1.0);
  o=vec4(col,1.0);
}
void main(){
  vec4 o=vec4(0.0);
  mainImage(o,gl_FragCoord.xy);
  fragColor=o;
}
`;

function palette(hex) {
  const { h, s, v } = hexToHsv(normalizeAccent(hex));
  const lightness = v * (1 - s / 2);
  const saturation =
    lightness === 0 || lightness === 1 ? 0 : (v - lightness) / Math.min(lightness, 1 - lightness);
  return [
    [h + 15, Math.min(1, saturation + 0.1), 0.72],
    [h - 35, Math.min(1, saturation + 0.05), 0.42],
    [h + 30, Math.min(1, saturation + 0.05), 0.62],
  ].map(([hue, sat, light]) => {
    const color = new THREE.Color().setHSL((((hue % 360) + 360) % 360) / 360, sat, light);
    return color.toArray().map((channel) => Math.round(channel * 255) / 255);
  });
}

export function createHeroGradient(parent) {
  function updateFallback(hex) {
    const colors = palette(hex);
    ['one', 'two', 'three'].forEach((name, i) =>
      parent.style.setProperty(
        '--gradient-' + name,
        'rgb(' + colors[i].map((v) => Math.round(v * 255)).join(' ') + ')',
      ),
    );
    return colors;
  }
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: false,
      powerPreference: 'low-power',
    });
  } catch {
    return { setAccent: updateFallback };
  }
  const uniforms = Object.fromEntries(
    Object.entries({
      iResolution: new THREE.Vector2(1, 1),
      iTime: 0,
      uTimeSpeed: 0,
      uColorBalance: 0,
      uWarpStrength: 1,
      uWarpFrequency: 5,
      uWarpSpeed: 2,
      uWarpAmplitude: 50,
      uBlendAngle: 0,
      uBlendSoftness: 0.05,
      uRotationAmount: 500,
      uNoiseScale: 2,
      uGrainAmount: 0.1,
      uGrainScale: 2,
      uGrainAnimated: 0,
      uContrast: 1.5,
      uGamma: 1,
      uSaturation: 1,
      uCenterOffset: new THREE.Vector2(0, 0),
      uZoom: 0.9,
      uColor1: new THREE.Vector3(),
      uColor2: new THREE.Vector3(),
      uColor3: new THREE.Vector3(),
    }).map(([key, value]) => [key, { value }]),
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: 'in vec3 position; void main(){gl_Position=vec4(position,1.);}',
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.Camera();
  const canvas = renderer.domElement;
  canvas.className = 'hero-gradient-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.mode = 'static';
  parent.append(canvas);
  let ready = false,
    draws = 0;
  function draw() {
    if (!ready) return;
    renderer.render(scene, camera);
    canvas.dataset.draws = String(++draws);
  }
  function resize() {
    const { width, height } = parent.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    uniforms.iResolution.value.set(canvas.width, canvas.height);
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(parent);
  resize();
  addEventListener(
    'beforeunload',
    () => {
      observer.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
    { once: true },
  );
  return {
    setAccent(hex) {
      const colors = updateFallback(hex);
      colors.forEach((color, i) => uniforms['uColor' + (i + 1)].value.fromArray(color));
      canvas.dataset.accent = hex;
      ready = true;
      draw();
    },
  };
}
