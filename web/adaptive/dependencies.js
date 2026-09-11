// Upstream UMD bundles must run as classic scripts; ES modules make their
// window assignment strict and fail on WebKit's getter-only Window property.
async function loadScript(path) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('The local motion assets are unavailable.'));
    document.head.append(script);
  });
}
if (!globalThis.gsap) await loadScript('../vendor/gsap/gsap.min.js');
if (!globalThis.Flip) await loadScript('../vendor/gsap/Flip.min.js');

export const gsap = globalThis.gsap;
export const Flip = globalThis.Flip;
if (!gsap || !Flip) throw new Error('The local motion assets are unavailable.');
gsap.registerPlugin(Flip);
