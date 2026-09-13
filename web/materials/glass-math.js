// Shape-aware background refraction. Maps update only when surface dimensions change.
export function glassOffset(x, y, width, height, radius) {
  const px = x - width * 0.5,
    py = y - height * 0.5;
  const qx = Math.abs(px) - (width * 0.5 - radius);
  const qy = Math.abs(py) - (height * 0.5 - radius);
  const ox = Math.max(qx, 0),
    oy = Math.max(qy, 0);
  const length = Math.hypot(ox, oy);
  const distance = radius - length - Math.min(Math.max(qx, qy), 0);
  const shoulder = Math.min(radius + 7, 24);
  const strength = Math.max(0, 1 - Math.max(0, distance) / shoulder) ** 2;
  const nx = length ? ox / length : Number(qx > qy);
  const ny = length ? oy / length : Number(qy >= qx);
  return [-nx * Math.sign(px) * strength, -ny * Math.sign(py) * strength];
}

export function glassPose(x, y) {
  const dx = Math.max(-1, Math.min(1, x));
  const dy = Math.max(-1, Math.min(1, y));
  return {
    rotation: `${dy || 0} ${dx === 0 && dy === 0 ? 1 : -dx || 0} 0 ${Math.min(1, Math.hypot(dx, dy)) * 2.4}deg`,
    lightX: `${50 + dx * 30}%`,
    lightY: `${22 + dy * 22}%`,
    lightAngle: `${135 + dx * 30 + dy * 15}deg`,
  };
}

export function mapSize(width, height) {
  const scale = Math.min(0.5, Math.sqrt(160000 / Math.max(1, width * height)));
  return {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil(height * scale)),
  };
}
