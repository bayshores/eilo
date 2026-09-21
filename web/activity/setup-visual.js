import { sourceMark } from '../home/source-marks.js';

export function setupVisual(source = 'browser') {
  const visual = document.createElement('div');
  visual.className = 'source-setup-visual';
  visual.setAttribute('aria-hidden', 'true');
  const app = document.createElement('div');
  app.className = 'source-setup-visual__source';
  app.append(sourceMark(source));
  const link = document.createElement('div');
  link.className = 'source-setup-visual__link';
  for (let index = 0; index < 3; index++) link.append(document.createElement('span'));
  const eilo = document.createElement('div');
  eilo.className = 'source-setup-visual__eilo';
  eilo.textContent = 'felis';
  visual.append(app, link, eilo);
  return visual;
}

export function animateSetup(element) {
  if (
    globalThis.document?.hidden ||
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
    globalThis.document?.body?.classList?.contains('reduce-motion')
  )
    return;
  const motion = globalThis.gsap;
  if (!motion) return;
  motion.killTweensOf(element);
  motion.fromTo(
    element,
    { opacity: 0.4, y: 5 },
    {
      opacity: 1,
      y: 0,
      duration: 0.18,
      ease: 'power1.out',
      clearProps: 'opacity,transform',
      overwrite: true,
    },
  );
}
