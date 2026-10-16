/* Dude with bones: his painting is cut into parts (legs, body, head, arms) on a skeleton, and every frame the
   bones are posed and the painting bends with them (WebGL, "linear blend skinning"). The rig itself (rig.json +
   rig.png + rig-groups.png) is made from one A-pose picture by rigtools/build_rig.py.
   DudeRig.create(canvas, { json, image, groups })  ->  rig.draw(pose, view)
   DudeMoves: makes the poses (idle, talk, listen, look, wave, point, dance, shrug, think, nod, no). */
(function (global) {
  'use strict';
  // ---------- 2D affine matrices [a, b, c, d, e, f]:  x' = a x + c y + e,  y' = b x + d y + f ----------
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const inv = m => { const det = m[0] * m[3] - m[1] * m[2]; const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det; return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]; };
  const T = (x, y) => [1, 0, 0, 1, x, y];
  const R = r => { const c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
  const Sc = (x, y) => [x, 0, 0, y, 0, 0];

  const VS = `#version 300 es
  in vec2 aPos; in vec2 aUv; uniform vec4 uView; out vec2 vUv;
  void main() { vUv = aUv; vec2 p = aPos * uView.xy + uView.zw; gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0); }`;
  const FS = `#version 300 es
  precision mediump float; in vec2 vUv; uniform sampler2D uTex; uniform sampler2D uGroups; uniform float uBit; uniform float uSolid; uniform vec4 uTint; out vec4 o;
  void main() {
    if (uSolid < 0.5) { float bits = floor(texture(uGroups, vUv).r * 255.0 / 4.0 + 0.5); if (mod(floor(bits / uBit), 2.0) < 1.0) discard; }
    vec4 c = texture(uTex, vUv);
    c.rgb = mix(c.rgb, uTint.rgb * c.a, uTint.a);
    o = c;
  }`;

  function create(canvas, src) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) throw new Error('no WebGL2');
    const J = src.json, W = J.w, H = J.h;
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const U = n => gl.getUniformLocation(prog, n);
    const uView = U('uView'), uBit = U('uBit'), uSolid = U('uSolid'), uTint = U('uTint');
    const tex = (img, nearest) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !nearest);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (nearest) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); }
      else { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); }
      return t;
    };
    const tColor = tex(src.image, false), tGroups = tex(src.groups, true);
    gl.useProgram(prog);
    gl.uniform1i(U('uTex'), 0); gl.uniform1i(U('uGroups'), 1);

    // ---------- bones ----------
    const bones = J.bones.map(b => Object.assign({}, b));
    const byName = {}; bones.forEach((b, i) => { byName[b.name] = i; b.i = i; });
    bones.forEach(b => {
      b.p = b.parent == null ? -1 : byName[b.parent];
      b.ang = Math.atan2(b.y2 - b.y, b.x2 - b.x); b.len = Math.hypot(b.x2 - b.x, b.y2 - b.y);
      b.bind = mul(T(b.x, b.y), R(b.ang)); b.ibind = inv(b.bind);
    });
    bones.forEach(b => { b.local = b.p < 0 ? b.bind : mul(bones[b.p].ibind, b.bind); });

    // ---------- meshes ----------
    const aPos = gl.getAttribLocation(prog, 'aPos'), aUv = gl.getAttribLocation(prog, 'aUv');
    const meshes = J.meshes.map((m, gi) => {
      const n = m.verts.length / 2, rest = new Float32Array(m.verts), uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[i * 2] = rest[i * 2] / W; uv[i * 2 + 1] = rest[i * 2 + 1] / H; }
      // weights as 4 bone slots per vertex
      const wb = new Uint8Array(n * 4), ww = new Float32Array(n * 4);
      m.w.forEach((list, i) => list.slice(0, 4).forEach(([b, w], k) => { wb[i * 4 + k] = b; ww[i * 4 + k] = w; }));
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, rest, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.tris), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { group: m.group, bit: Math.pow(2, J.groups.indexOf(m.group)), n, rest, out: new Float32Array(n * 2), wb, ww, vao, pb, count: m.tris.length };
    });
    // little sprites drawn on his face: mouth shapes and eyelids. One quad, re-filled for each.
    const SP = J.sprites || { mouthA: J.mouth }, quad = (() => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(8), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aUv); gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, pb, ub, p: new Float32Array(8), u: new Float32Array(8) };
    })();
    const mq = J.mouth;
    const K = new Float32Array(bones.length * 6);   // skin matrices
    const world = new Array(bones.length);
    // pose: { root: {x, y, rot, sx, sy}, b: { name: { r, x, y, s } }, jaw: 0..1 }
    function solve(pose) {
      const P = pose.b || {}, rt = pose.root || {};
      for (const b of bones) {
        const q = P[b.name] || {};
        let m = mul(b.local, T(q.x || 0, q.y || 0));
        m = mul(m, R(q.r || 0));
        if (q.s) m = mul(m, Sc(q.s, q.sy || q.s));
        if (b.p < 0) {   // root: move / turn / squash around its own point, in screen directions
          const o = b.bind;
          m = mul(T(o[4] + (rt.x || 0), o[5] + (rt.y || 0)), mul(R(rt.rot || 0), mul(Sc(rt.sx || 1, rt.sy || 1), mul(T(-o[4], -o[5]), m))));
        } else m = mul(world[b.p], m);
        world[b.i] = m;
        const k = mul(m, b.ibind);
        K.set(k, b.i * 6);
      }
    }
    // Each bone's move as a 2D "dual quaternion" (rotation + shift). Blending these, instead of blending the moved
    // points, keeps elbows, knees and shoulders full when they bend (no pinching or collapsing).
    const DQ = new Float32Array(bones.length * 4);
    function makeDQ() {
      for (let i = 0; i < bones.length; i++) {
        const o = i * 6, th = Math.atan2(K[o + 1], K[o]), w = Math.cos(th / 2), z = Math.sin(th / 2), tx = K[o + 4], ty = K[o + 5];
        DQ[i * 4] = w; DQ[i * 4 + 1] = z; DQ[i * 4 + 2] = .5 * (tx * w + ty * z); DQ[i * 4 + 3] = .5 * (-tx * z + ty * w);
      }
    }
    function skin(mesh) {
      const { rest, out, wb, ww, n } = mesh;
      for (let i = 0; i < n; i++) {
        const x = rest[i * 2], y = rest[i * 2 + 1];
        let W = 0, Z = 0, DX = 0, DY = 0, w0 = 0, z0 = 0;
        for (let k = 0; k < 4; k++) {
          const wt = ww[i * 4 + k]; if (!wt) continue;
          const o = wb[i * 4 + k] * 4;
          let w = DQ[o], z = DQ[o + 1], dx = DQ[o + 2], dy = DQ[o + 3];
          if (k === 0) { w0 = w; z0 = z; } else if (w * w0 + z * z0 < 0) { w = -w; z = -z; dx = -dx; dy = -dy; }   // the short way round
          W += wt * w; Z += wt * z; DX += wt * dx; DY += wt * dy;
        }
        const len = Math.hypot(W, Z) || 1; W /= len; Z /= len; DX /= len; DY /= len;
        const c = W * W - Z * Z, sn = 2 * W * Z, tx = 2 * (DX * W - DY * Z), ty = 2 * (DX * Z + DY * W);
        out[i * 2] = c * x - sn * y + tx; out[i * 2 + 1] = sn * x + c * y + ty;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
    }
    const pt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    // view: { scale, x, y } -> rig pixel (0,0) lands at canvas pixel (x, y), times scale. flip: mirror left/right
    function draw(pose, view) {
      solve(pose); makeDQ();
      const cw = canvas.width, ch = canvas.height, s = view.scale;
      gl.viewport(0, 0, cw, ch); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(prog);
      const fx = view.flip ? -1 : 1;
      gl.uniform4f(uView, s * fx / cw, s / ch, (view.flip ? view.x + W * s : view.x) / cw, view.y / ch);
      const tint = view.tint || [0, 0, 0, 0]; gl.uniform4f(uTint, tint[0], tint[1], tint[2], tint[3]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tColor);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tGroups);
      gl.uniform1f(uSolid, 0);
      for (const m of meshes) {
        skin(m);
        gl.uniform1f(uBit, m.bit);
        gl.bindVertexArray(m.vao); gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
        if (m.group === 'head') drawFace(pose);
      }
      gl.bindVertexArray(null);
    }
    function sprite(name, corners, boneName) {
      const sp = SP[name]; if (!sp) return;
      const k = Array.from(K.subarray(byName[boneName] * 6, byName[boneName] * 6 + 6));
      corners.forEach(([x, y], i) => { const q = pt(k, x, y); quad.p[i * 2] = q[0]; quad.p[i * 2 + 1] = q[1]; });
      const u0 = sp.u / W, v0 = sp.v / H, u1 = (sp.u + sp.w) / W, v1 = (sp.v + sp.h) / H;
      quad.u.set([u0, v0, u1, v0, u1, v1, u0, v1]);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.ub); gl.bufferSubData(gl.ARRAY_BUFFER, 0, quad.u);
      gl.uniform1f(uBit, 8); gl.bindVertexArray(quad.vao); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    // his face on top of his head: the inside of his mouth when it opens, and his eyelids when he blinks
    function drawFace(pose) {
      const open = Math.min(1, pose.jaw || 0);
      if (open > .03) {
        const shape = pose.mouth || 'A', wide = shape === 'E' ? 1.25 : shape === 'O' ? .62 : 1;
        const hw = (9.5 + open * 1.5) * wide, top = mq.y - 1.2, bot = mq.y + 1 + open * (shape === 'E' ? 4.5 : 7.5);
        sprite('mouth' + shape, [[mq.x - hw, top], [mq.x + hw, top], [mq.x + hw, bot], [mq.x - hw, bot]], 'head');
      }
      const b = Math.min(1, pose.blink || 0);
      if (b > .06 && J.eyes) for (const e of J.eyes) {
        const hw = e.w / 2, y0 = e.y - 1.5, y1 = e.y - 1.5 + b * (e.h + 1.5);
        sprite('lid', [[e.x - hw, y0], [e.x + hw, y0], [e.x + hw, y1], [e.x - hw, y1]], 'head');
      }
    }
    // a bone's move from his picture to now (for drawing things on him, like his real bones)
    function skinOf(name) { const i = byName[name]; return Array.from(K.subarray(i * 6, i * 6 + 6)); }
    // where a bone point ends up (rig pixels), e.g. to put a speech bubble at his head
    function where(name, along = 1) { const b = bones[byName[name]], m = world[b.i]; if (!m) return [b.x + (b.x2 - b.x) * along, b.y + (b.y2 - b.y) * along]; return pt(m, b.len * along, 0); }
    return { draw, where, skinOf, w: W, h: H, feet: J.feet, bones, byName, gl, json: J };
  }

  /* ================= his moves ================= */
  const D = Math.PI / 180, clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const noise = (t, s) => Math.sin(t * 1.3 + s) * .5 + Math.sin(t * 2.7 + s * 2.1) * .3 + Math.sin(t * 4.1 + s * 3.7) * .2;
  // arms hang relaxed instead of the A-pose
  const REST = { upperArmL: { r: -16 * D }, upperArmR: { r: 17 * D }, foreArmL: { r: -4 * D }, foreArmR: { r: 4 * D }, handL: { r: 6 * D }, handR: { r: -6 * D } };

  function Moves() {
    this.state = 'idle'; this.t0 = 0; this.prev = null; this.blendT = 1; this.cur = null;
    this.look = { x: 0, y: 0 };           // where he looks / points, in rig pixels relative to his head
    this.talk = 0;                        // how loud he's talking, 0..1 (or -1 = make it up)
    this.bpm = 96;
    this.nextBlink = 0; this.blinkAt = -1;
  }
  Moves.prototype.set = function (state, now) { if (state === this.state) return; this.prev = this.cur; this.blendT = 0; this.state = state; this.t0 = now; };
  Moves.prototype.pose = function (now, dt) {
    const t = now / 1000, st = (now - this.t0) / 1000, s = this.state;
    const b = {}, root = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    const add = (n, k, v) => { const o = b[n] || (b[n] = { r: 0, x: 0, y: 0 }); o[k] = (o[k] || 0) + v; };
    for (const n in REST) add(n, 'r', REST[n].r);
    // always: breathing, a little sway, eyes-level looking
    const br = Math.sin(t * 2 * Math.PI / 3.8);
    add('chest', 'x', br * .9);   // breathing: his chest rises and falls a little
    add('upperArmL', 'r', -br * .8 * D); add('upperArmR', 'r', br * .8 * D);
    root.x += noise(t * .35, 1) * 2.5;
    add('head', 'r', noise(t * .4, 5) * 1.6 * D);
    const lx = clamp(this.look.x / 400, -1, 1), ly = clamp(this.look.y / 400, -1, 1);
    let jaw = 0, mouth = 'A';
    // he blinks every few seconds (sometimes twice)
    if (now > this.nextBlink) { this.blinkAt = now; this.nextBlink = now + 1800 + Math.random() * 4200; if (Math.random() < .2) this.nextBlink = now + 260; }
    const bt = now - this.blinkAt, blink = this.blinkAt < 0 ? 0 : bt < 70 ? bt / 70 : bt < 180 ? 1 - (bt - 70) / 110 : 0;
    // his fingers and thumbs are never perfectly still
    add('thumbL', 'r', noise(t * .6, 7) * 4 * D); add('thumbR', 'r', noise(t * .6, 9) * 4 * D);
    add('fingersL', 'r', noise(t * .5, 11) * 3 * D); add('fingersR', 'r', noise(t * .5, 13) * 3 * D);
    const lookAt = (k = 1) => { add('head', 'r', lx * 9 * D * k); add('neck', 'r', lx * 3 * D * k); add('head', 'x', -ly * 4 * k); add('head', 'y', lx * 3 * k); add('chest', 'r', lx * 1.2 * D * k); };

    if (s === 'idle') {
      lookAt(.8);
      // now and then: a slow look around
      const lk = Math.sin(t * .23) > .7 ? Math.sin(t * .9) : 0; add('head', 'r', lk * 5 * D);
    } else if (s === 'listen') {
      lookAt(.6);
      add('head', 'r', (-6 + Math.sin(st * 2.2) * 2.5) * D);          // head tilted, small nods
      add('head', 'x', Math.max(0, Math.sin(st * 2.6)) * 3);
      add('waist', 'r', -1.5 * D);
    } else if (s === 'talk') {
      lookAt(.5);
      const lvl = this.talk >= 0 ? this.talk : clamp(Math.abs(Math.sin(st * 9.1) * Math.sin(st * 3.3 + 1)) * 1.3, 0, 1);
      jaw = lvl;
      const vs = Math.floor(st * 9); mouth = ['A', 'E', 'A', 'O', 'E', 'A'][vs % 6];   // mouth shapes, like syllables
      add('brow', 'x', Math.max(0, Math.sin(st * 1.7)) * 2.5);
      add('head', 'x', lvl * 2.5); add('head', 'r', (Math.sin(st * 2.1) * 3 + lvl * 2) * D);
      // talking with his hands: the right forearm comes up and moves with the words
      const g = ease(clamp(st / .5, 0, 1));
      add('upperArmR', 'r', g * 4 * D); add('foreArmR', 'r', g * (78 + Math.sin(st * 3.1) * 12 + lvl * 10) * D); add('handR', 'r', g * (-25 + Math.sin(st * 4.3) * 14) * D);
      add('upperArmL', 'r', g * -2 * D); add('foreArmL', 'r', g * (-14 + Math.sin(st * 2.3 + 2) * 6) * D);
    } else if (s === 'wave') {
      lookAt(.6);
      const g = ease(clamp(st / .45, 0, 1)), w = Math.sin(st * 2 * Math.PI * 1.8);
      // elbow stays low (his big sleeve doesn't like going up), forearm up next to his head
      add('upperArmR', 'r', g * -34 * D); add('foreArmR', 'r', g * (-128 + w * 20) * D); add('handR', 'r', g * (-8 + w * 18) * D);
      add('head', 'r', g * -4 * D); add('chest', 'r', g * -1.5 * D);
      jaw = .25 * g;
    } else if (s === 'point') {
      // the arm on the side of the target points at it: elbow low, forearm aims (his big sleeve doesn't like going up)
      const right = this.look.x >= 0, side = right ? 'R' : 'L', g = ease(clamp(st / .4, 0, 1));
      const up = right ? -32 : 32;
      const want = Math.atan2(this.look.y + 60, Math.abs(this.look.x) + 1) / D;   // 0 = straight out, minus = up
      const restFore = right ? 62.3 + 17 + 4 : 115.4 - 16 - 4;                    // the forearm's angle when he just stands
      const target = right ? want : 180 - want;
      let d = target - (restFore + up); while (d > 180) d -= 360; while (d < -180) d += 360;
      add('upperArm' + side, 'r', g * up * D); add('foreArm' + side, 'r', g * d * D); add('hand' + side, 'r', g * (right ? -12 : 12) * D);
      lookAt(1);
    } else if (s === 'dance') {
      const beat = t * this.bpm / 60, ph = beat % 1, bb = Math.cos(ph * Math.PI * 2);
      const down = (1 - bb) / 2, drop = down * 7;      // he dips on every beat: knees go out, feet stay on the floor
      const k = Math.acos(clamp(1 - drop / 485, -1, 1));
      root.y += drop;
      add('thighL', 'r', k); add('shinL', 'r', -2 * k); add('footL', 'r', k);
      add('thighR', 'r', -k); add('shinR', 'r', 2 * k); add('footR', 'r', -k);
      const sw = Math.sin(beat * Math.PI);            // arms swing every two beats, elbows bent
      // both arms swing the same way, elbows a little out
      add('upperArmL', 'r', (4 + sw * 13) * D); add('foreArmL', 'r', (14 + sw * 8) * D); add('handL', 'r', (10 + sw * 6) * D);
      add('upperArmR', 'r', (-4 + sw * 13) * D); add('foreArmR', 'r', (-14 + sw * 8) * D); add('handR', 'r', (-10 + sw * 6) * D);
      add('chest', 'x', -down * 1.5);
      add('shoulderL', 'r', down * 4 * D); add('shoulderR', 'r', -down * 4 * D);   // shoulders bounce
      add('head', 'r', (sw * 5) * D); add('head', 'x', down * 5); add('waist', 'r', sw * 2 * D); add('chest', 'r', sw * 2.5 * D); root.x += sw * 6;
    } else if (s === 'shrug') {
      const g = Math.sin(clamp(st / 1.4, 0, 1) * Math.PI);
      add('shoulderL', 'r', 13 * D * g); add('shoulderR', 'r', -13 * D * g);   // shoulders up
      add('upperArmL', 'r', 6 * D * g); add('upperArmR', 'r', -6 * D * g);
      add('foreArmL', 'r', 34 * D * g); add('foreArmR', 'r', -34 * D * g); add('handL', 'r', 25 * D * g); add('handR', 'r', -25 * D * g);
      add('head', 'r', -8 * D * g); add('neck', 'y', 3 * g); jaw = .15 * g;
    } else if (s === 'think') {
      lookAt(.3);
      const g = ease(clamp(st / .6, 0, 1));
      add('upperArmR', 'r', g * 12 * D); add('foreArmR', 'r', g * 152 * D); add('handR', 'r', g * -35 * D);
      add('head', 'r', g * (8 + Math.sin(st * .8) * 2) * D); add('head', 'x', g * 2);
    } else if (s === 'nod' || s === 'no') {
      const g = clamp(1 - st / 1.6, 0, 1);
      if (s === 'nod') { add('head', 'x', Math.max(0, Math.sin(st * 9)) * 6 * g); add('brow', 'x', 3 * g); jaw = .25 * g; mouth = 'E'; }
      else { add('head', 'r', Math.sin(st * 10) * 7 * D * g); add('head', 'y', Math.sin(st * 10) * 3 * g); add('brow', 'x', -2 * g); }
    }
    add('jaw', 'x', jaw * 6);   // his jaw drops a little when he talks (the inside of his mouth shows)
    const pose = { root, b, jaw, mouth, blink };
    // smooth change from the last move
    if (this.prev && this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 300);
      const k = ease(this.blendT), P = this.prev;
      for (const n of new Set([...Object.keys(b), ...Object.keys(P.b)])) {
        const a = P.b[n] || {}, c = b[n] || (b[n] = { r: 0, x: 0, y: 0 });
        for (const key of ['r', 'x', 'y']) c[key] = lerp(a[key] || 0, c[key] || 0, k);
        if (a.s || c.s) { c.s = lerp(a.s || 1, c.s || 1, k); c.sy = lerp(a.sy || 1, c.sy || 1, k); }
      }
      for (const key of ['x', 'y', 'rot']) root[key] = lerp(P.root[key] || 0, root[key], k);
      for (const key of ['sx', 'sy']) root[key] = lerp(P.root[key] || 1, root[key], k);
      pose.jaw = lerp(P.jaw || 0, jaw, k);
    }
    this.cur = JSON.parse(JSON.stringify(pose));
    return pose;
  };

  global.DudeRig = { create, Moves };
})(typeof window !== 'undefined' ? window : globalThis);
