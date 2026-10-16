/* X-ray: real bones drawn inside Dude (skull, spine, ribs, pelvis, arm, hand, leg and foot bones).
   Each bone shape is drawn where it sits in his A-pose picture, then moved with the rig bone it belongs to,
   so the skeleton moves with him. */
window.XRAY = (function () {
  const O = [170, 46];   // his picture's crop corner (rig.json "origin")
  const P = (x, y) => [x - O[0], y - O[1]];
  const mulM = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

  // ---------- shape helpers (picture coordinates) ----------
  function longBone(g, a, b, w, knob) {   // a shaft with knobbly ends, like a humerus or a femur
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const at = (t, o) => [a[0] + dx * t + nx * o, a[1] + dy * t + ny * o];
    g.beginPath();
    const p1 = at(.1, w * .5), p2 = at(.5, w * .38), p3 = at(.9, w * .5), q3 = at(.9, -w * .5), q2 = at(.5, -w * .38), q1 = at(.1, -w * .5);
    g.moveTo(...p1); g.quadraticCurveTo(...p2, ...p3); g.lineTo(...q3); g.quadraticCurveTo(...q2, ...q1); g.closePath(); g.fill(); g.stroke();
    for (const [t, side] of [[.04, 1], [.04, -1], [.96, 1], [.96, -1]]) { const c = at(t, side * knob * .42); g.beginPath(); g.arc(c[0], c[1], knob * .55, 0, Math.PI * 2); g.fill(); g.stroke(); }
  }
  function blob(g, pts) { g.beginPath(); g.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); } g.closePath(); g.fill(); g.stroke(); }
  function hole(g, x, y, rx, ry, col) { g.save(); g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  // ---------- the bones ----------
  const SHAPES = {
    head(g, c) {   // skull: cranium, eye sockets, nose, cheekbones, upper teeth
      const [cx, cy] = P(465, 141);
      blob(g, [[cx, cy - 52], [cx + 40, cy - 44], [cx + 46, cy - 6], [cx + 40, cy + 26], [cx + 22, cy + 40], [cx - 22, cy + 40], [cx - 40, cy + 26], [cx - 46, cy - 6], [cx - 40, cy - 44]]);
      hole(g, cx - 22, cy + 1, 12, 10, c.dark); hole(g, cx + 22, cy + 1, 12, 10, c.dark);
      g.save(); g.fillStyle = c.dark; g.beginPath(); g.moveTo(cx, cy + 12); g.lineTo(cx - 5, cy + 25); g.lineTo(cx + 5, cy + 25); g.closePath(); g.fill(); g.restore();
      g.beginPath(); g.moveTo(cx - 40, cy + 16); g.quadraticCurveTo(cx - 30, cy + 22, cx - 16, cy + 20); g.moveTo(cx + 40, cy + 16); g.quadraticCurveTo(cx + 30, cy + 22, cx + 16, cy + 20); g.stroke();
      const [tx, ty] = P(451, 178); g.beginPath(); g.rect(tx, ty, 28, 7); g.fill(); g.stroke();
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(tx + i * 28 / 6, ty); g.lineTo(tx + i * 28 / 6, ty + 7); g.stroke(); }
    },
    jaw(g) {   // mandible and lower teeth
      const a = P(430, 166), b = P(500, 166), chin = P(465, 213);
      g.beginPath(); g.moveTo(...a); g.quadraticCurveTo(a[0] + 4, chin[1] - 6, chin[0] - 10, chin[1]); g.lineTo(chin[0] + 10, chin[1]); g.quadraticCurveTo(b[0] - 4, chin[1] - 6, ...b);
      g.lineTo(b[0] - 7, b[1]); g.quadraticCurveTo(b[0] - 10, chin[1] - 13, chin[0], chin[1] - 9); g.quadraticCurveTo(a[0] + 10, chin[1] - 13, a[0] + 7, a[1]); g.closePath(); g.fill(); g.stroke();
      const [tx, ty] = P(452, 187); g.beginPath(); g.rect(tx, ty, 26, 6); g.fill(); g.stroke();
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(tx + i * 26 / 6, ty); g.lineTo(tx + i * 26 / 6, ty + 6); g.stroke(); }
    },
    neck(g) { for (let y = 222; y < 296; y += 12) { const [x, yy] = P(458, y); g.beginPath(); g.roundRect(x, yy, 15, 9, 3); g.fill(); g.stroke(); } },
    chest(g, c) {   // thoracic spine, ribs, breastbone
      for (let y = 300; y < 398; y += 11) { const [x, yy] = P(458, y); g.beginPath(); g.roundRect(x, yy, 16, 8, 3); g.fill(); g.stroke(); }
      g.save(); g.lineWidth = c.lw * 2.1; g.strokeStyle = c.fill; g.fillStyle = 'transparent';
      for (let i = 0; i < 9; i++) {
        const y0 = 306 + i * 9.6, r = 34 + 34 * Math.sin(Math.min(1, (i + 2) / 6) * Math.PI / 2), drop = 16 + i * 1.4, front = 10 + i * 4.5;
        for (const sd of [-1, 1]) {
          const s0 = P(466 + sd * 7, y0), e1 = P(466 + sd * r, y0 + drop), e2 = P(466 + sd * front, y0 + drop + 15);
          g.beginPath(); g.moveTo(...s0); g.quadraticCurveTo(s0[0] + sd * r * 1.05, s0[1] - 6, ...e1); g.quadraticCurveTo(e1[0] - sd * 3, e1[1] + 16, ...e2); g.stroke();
        }
      }
      g.restore();
      g.save(); g.lineWidth = c.lw * .8;
      for (let i = 0; i < 9; i++) {
        const y0 = 306 + i * 9.6, r = 34 + 34 * Math.sin(Math.min(1, (i + 2) / 6) * Math.PI / 2), drop = 16 + i * 1.4, front = 10 + i * 4.5;
        for (const sd of [-1, 1]) {
          const s0 = P(466 + sd * 7, y0), e1 = P(466 + sd * r, y0 + drop), e2 = P(466 + sd * front, y0 + drop + 15);
          g.beginPath(); g.moveTo(...s0); g.quadraticCurveTo(s0[0] + sd * r * 1.05, s0[1] - 6, ...e1); g.quadraticCurveTo(e1[0] - sd * 3, e1[1] + 16, ...e2); g.stroke();
        }
      }
      g.restore();
      const [sx, sy] = P(460, 302); g.beginPath(); g.roundRect(sx, sy, 12, 78, 5); g.fill(); g.stroke();
    },
    waist(g) { for (let y = 402; y < 470; y += 14) { const [x, yy] = P(455, y); g.beginPath(); g.roundRect(x, yy, 22, 11, 4); g.fill(); g.stroke(); } },
    root(g, c) {   // pelvis: hip bones, sacrum, hip sockets
      for (const sd of [-1, 1]) {
        const X = x => 467 + sd * x;
        blob(g, [P(X(10), 470), P(X(46), 462), P(X(62), 478), P(X(56), 502), P(X(44), 520), P(X(30), 532), P(X(12), 530), P(X(8), 500)]);
        hole(g, ...P(X(36), 512), 8, 9, c.dark);
      }
      blob(g, [P(458, 468), P(476, 468), P(472, 500), P(467, 512), P(462, 500)]);
    },
  };
  // arms and legs: shapes from each bone's own ends, so the left and right sides both work
  function limb(g, c, b, kind) {
    const a = P(b.x + O[0], b.y + O[1]), e = P(b.x2 + O[0], b.y2 + O[1]);
    const dx = e[0] - a[0], dy = e[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    const off = (p, o) => [p[0] + nx * o, p[1] + ny * o];
    const side = /L$/.test(b.name) ? -1 : 1;   // which way is "outside" for this side
    if (kind === 'shoulder') { g.save(); g.lineWidth = c.lw * 3.4; g.strokeStyle = c.fill; g.beginPath(); g.moveTo(...lerp2(a, e, .05)); g.quadraticCurveTo(...off(lerp2(a, e, .5), 4), ...e); g.stroke(); g.restore(); g.save(); g.lineWidth = c.lw * .8; g.beginPath(); g.moveTo(...lerp2(a, e, .05)); g.quadraticCurveTo(...off(lerp2(a, e, .5), 4), ...e); g.stroke(); g.restore(); return; }
    if (kind === 'upperArm') return longBone(g, lerp2(a, e, .02), lerp2(a, e, .97), 10, 13);
    if (kind === 'foreArm') { longBone(g, off(lerp2(a, e, .05), 3.2), off(lerp2(a, e, .98), 3.6), 5, 7); longBone(g, off(lerp2(a, e, .03), -3.2), off(lerp2(a, e, .97), -4.2), 5.5, 7); return; }
    if (kind === 'hand') { for (let i = 0; i < 6; i++) { const p = off(lerp2(a, e, .12 + (i % 2) * .16), (i - 2.5) * 3.2); g.beginPath(); g.arc(p[0], p[1], 2.8, 0, Math.PI * 2); g.fill(); g.stroke(); } for (let i = 0; i < 4; i++) longBone(g, off(lerp2(a, e, .4), (i - 1.5) * 4.2), off(lerp2(a, e, 1.15), (i - 1.5) * 3.6), 2.6, 3.4); return; }
    if (kind === 'thumb') { longBone(g, lerp2(a, e, 0), lerp2(a, e, .52), 3.4, 4.4); longBone(g, lerp2(a, e, .56), lerp2(a, e, .95), 3, 3.8); return; }
    if (kind === 'fingers') { for (let i = 0; i < 4; i++) { const o = (i - 1.5) * 4.6; longBone(g, off(lerp2(a, e, .02), o), off(lerp2(a, e, .38), o), 2.6, 3.4); longBone(g, off(lerp2(a, e, .41), o * .95), off(lerp2(a, e, .68), o * .95), 2.4, 3.1); longBone(g, off(lerp2(a, e, .71), o * .9), off(lerp2(a, e, .9 - Math.abs(i - 1.5) * .05), o * .9), 2.2, 2.8); } return; }
    if (kind === 'thigh') { longBone(g, lerp2(a, e, .03), lerp2(a, e, .98), 12, 16); const head = off(lerp2(a, e, .02), side * 9); g.beginPath(); g.arc(head[0], head[1], 7.5, 0, Math.PI * 2); g.fill(); g.stroke(); return; }
    if (kind === 'shin') { longBone(g, lerp2(a, e, .05), lerp2(a, e, .99), 10, 14); longBone(g, off(lerp2(a, e, .07), side * 9), off(lerp2(a, e, .97), side * 8), 4, 6); g.beginPath(); g.ellipse(a[0], a[1] - 2, 8, 10, 0, 0, Math.PI * 2); g.fill(); g.stroke(); return; }
    if (kind === 'foot') { g.beginPath(); g.ellipse(...off(lerp2(a, e, .08), -side * 6), 9, 7, 0, 0, Math.PI * 2); g.fill(); g.stroke(); for (let i = 0; i < 5; i++) { const o = (i - 2) * 4.2; longBone(g, off(lerp2(a, e, .22), o * .7), off(lerp2(a, e, .78), o), 3, 4); longBone(g, off(lerp2(a, e, .82), o), off(lerp2(a, e, 1.02 - Math.abs(i - 2) * .03), o * 1.05), 2.6, 3.2); } }
  }
  const KIND = n => n.replace(/[LR]$/, '');

  // the order he's drawn in: spine and pelvis at the back, then ribs, skull, then arms and legs
  const ORDER = ['root', 'waist', 'chest', 'neck', 'head', 'jaw', 'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'shoulderL', 'shoulderR', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR', 'thumbL', 'thumbR', 'fingersL', 'fingersR'];

  function draw(g, rig, view, dpr) {
    const css = getComputedStyle(document.documentElement);
    const c = { fill: 'rgba(238,246,252,.94)', line: 'rgba(120,170,205,.9)', dark: 'rgba(20,40,60,.85)', lw: 1.1 };
    g.save();
    g.shadowColor = 'rgba(150,215,255,.75)'; g.shadowBlur = 10 * dpr;
    for (const name of ORDER) {
      const b = rig.bones[rig.byName[name]]; if (!b) continue;
      const K = rig.skinOf(name), V = [view.scale, 0, 0, view.scale, view.x, view.y], M = mulM(V, K);
      g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      g.fillStyle = c.fill; g.strokeStyle = c.line; g.lineWidth = c.lw; g.lineJoin = 'round'; g.lineCap = 'round';
      if (SHAPES[name]) SHAPES[name](g, c); else limb(g, c, b, KIND(name));
    }
    g.restore();
    void css;
  }
  return { draw };
})();
