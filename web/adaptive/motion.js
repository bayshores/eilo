export const ADAPTIVE_MOTION = Object.freeze({ quick: 120, standard: 180, settle: 360 });

/** Motion is optional presentation polish: state changes always happen synchronously. */
export function createAdaptiveMotion({
  gsap,
  Flip,
  reducedMotion = false,
  isBusy = () => false,
} = {}) {
  let animation = null;
  let entrance = null;
  const values = new Map();
  let animatedNodes = [];
  let destroyed = false;
  const clearTransient = () => {
    if (gsap?.set && animatedNodes.length)
      gsap.set(animatedNodes, { clearProps: 'transform,opacity' });
    animatedNodes = [];
  };
  const cancel = () => {
    animation?.kill?.();
    entrance?.kill?.();
    entrance = null;
    for (const [target, value] of values) {
      value.tween?.kill?.();
      for (const [key, end] of Object.entries(value.attributes))
        target.setAttribute(key, String(end));
    }
    values.clear();
    animation = null;
    clearTransient();
  };
  const transition = (mutator, targets = [], { content = false, getTargets } = {}) => {
    if (destroyed) return undefined;
    cancel();
    const nodes = Array.from(targets || []).filter(Boolean);
    const reduce = typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion;
    const mayAnimate = !reduce && !globalThis.document?.hidden && !isBusy() && gsap && Flip;
    const state = mayAnimate && nodes.length ? Flip.getState(nodes) : null;
    const result = mutator();
    if (state) {
      animatedNodes = nodes;
      animation = Flip.from(state, {
        duration: (content ? ADAPTIVE_MOTION.standard : ADAPTIVE_MOTION.settle) / 1000,
        ease: 'power2.out',
        absolute: false,
        scale: true,
      });
    }
    const arriving =
      mayAnimate && getTargets ? getTargets().filter((node) => !nodes.includes(node)) : [];
    if (arriving.length && gsap.fromTo) {
      animatedNodes.push(...arriving);
      entrance = gsap.fromTo(
        arriving,
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: ADAPTIVE_MOTION.standard / 1000,
          ease: 'power2.out',
          clearProps: 'opacity,transform',
        },
      );
    }
    return result;
  };
  const feedback = (target) => {
    const reduce = typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion;
    if (destroyed || reduce || globalThis.document?.hidden || isBusy() || !gsap?.to || !target)
      return;
    cancel();
    animatedNodes = [target];
    animation = gsap.to(target, {
      duration: ADAPTIVE_MOTION.quick / 1000,
      scale: 0.985,
      yoyo: true,
      repeat: 1,
      ease: 'power1.out',
      clearProps: 'transform',
    });
  };
  const onVisibility = () => {
    if (globalThis.document?.hidden) cancel();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
  return {
    transition,
    feedback,
    values(target, attributes) {
      const reduce = typeof reducedMotion === 'function' ? reducedMotion() : reducedMotion;
      if (destroyed || reduce || globalThis.document?.hidden || isBusy() || !gsap?.to) {
        for (const [key, end] of Object.entries(attributes)) target.setAttribute(key, String(end));
        return;
      }
      const entry = { attributes, tween: null };
      values.set(target, entry);
      entry.tween = gsap.to(target, {
        attr: attributes,
        duration: ADAPTIVE_MOTION.standard / 1000,
        ease: 'power2.out',
        onComplete: () => values.delete(target),
      });
    },
    cancel,
    destroy() {
      cancel();
      destroyed = true;
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
    },
  };
}
