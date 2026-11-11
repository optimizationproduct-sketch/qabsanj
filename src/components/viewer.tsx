import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Analysis } from "@/fea/analyze";
import { sectionById } from "@/fea/sections";

type Props = {
  analysis: Analysis | null;
  selected: number | null;
  onSelect: (id: number | null) => void;
  combo: string;
  deformed: boolean;
  scale: number;
  slabs: boolean;
};

function cssColor(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function mix(a: THREE.Color, b: THREE.Color, t: number) {
  return a.clone().lerp(b, Math.min(1, Math.max(0, t)));
}

export function FrameView({ analysis, selected, onSelect, combo, deformed, scale, slabs }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    rebuild: () => void;
    update: () => void;
  } | null>(null);
  const props = useRef({ analysis, selected, onSelect, combo, deformed, scale, slabs });
  props.current = { analysis, selected, onSelect, combo, deformed, scale, slabs };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(new THREE.Color(cssColor("--color-bg", "#0e141b")));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 800);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(8, 6, 5);
    camera.position.set(22, 12, 22);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const hemi = new THREE.HemisphereLight(0xd5e2ef, 0x2a2118, 0.85);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xfff4e5, 1.35);
    dir.position.set(12, 28, 8);
    scene.add(dir);

    const root = new THREE.Group();
    scene.add(root);
    const grid = new THREE.GridHelper(40, 20, 0x314556, 0x1c2a38);
    grid.position.y = 0;
    scene.add(grid);

    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let px = 0;
    let py = 0;
    const onDown = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
    };
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - px, ev.clientY - py) > 8) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(pointer, camera);
      const hits = ray.intersectObjects(root.children, true);
      const hit = hits.find((h) => h.object.userData.memberId !== undefined);
      props.current.onSelect(hit ? (hit.object.userData.memberId as number) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const fit = () => {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 4);
      controls.target.copy(center);
      camera.position.set(center.x + span * 0.95, center.y + span * 0.55, center.z + span * 1.15);
      camera.near = span / 80;
      camera.far = span * 40;
      camera.updateProjectionMatrix();
      controls.update();
      const gridSize = Math.max(20, Math.ceil(span * 2));
      grid.scale.set(gridSize / 40, 1, gridSize / 40);
    };

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const fitted = { key: "" };
    const apiLocal = {
      rebuild() {
        const dump: THREE.BufferGeometry[] = [];
        const mats = new Set<THREE.Material>();
        root.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
            dump.push(o.geometry);
            const list = Array.isArray(o.material) ? o.material : [o.material];
            list.forEach((mm) => mats.add(mm));
          }
        });
        root.clear();
        dump.forEach((g) => g.dispose());
        mats.forEach((mm) => mm.dispose());
        const a = props.current.analysis;
        if (!a) return;
        const steel = new THREE.Color(cssColor("--color-steel", "#8aa4b8"));
        const copper = new THREE.Color(cssColor("--color-copper", "#e3a04a"));
        const bad = new THREE.Color(cssColor("--color-bad", "#f08a84"));
        const ok = new THREE.Color(cssColor("--color-ok", "#8fd0a8"));
        const ink = new THREE.Color(cssColor("--color-bg", "#0e141b"));
        const colorOf = (ratio: number) => {
          if (!Number.isFinite(ratio)) return steel.clone();
          if (ratio <= 0.6) return mix(steel, ok, ratio / 0.6);
          if (ratio <= 1) return mix(ok, copper, (ratio - 0.6) / 0.4);
          return mix(copper, bad, Math.min(1, ratio - 1));
        };
        const disp = a.disp[props.current.combo] ?? a.disp.ExP ?? a.disp.D;
        const amp =
          props.current.deformed && a.maxDisp > 1e-9
            ? (Math.max(a.input.storyH, 3) * 0.45 * props.current.scale) / a.maxDisp
            : 0;
        const pOf = (id: number, useDisp: boolean) => {
          const n = a.nodes[id];
          const ux = useDisp && disp ? disp[id * 6] * amp : 0;
          const uy = useDisp && disp ? disp[id * 6 + 1] * amp : 0;
          const uz = useDisp && disp ? disp[id * 6 + 2] * amp : 0;
          return new THREE.Vector3(n.x + ux, n.z + uz, n.y + uy);
        };
        if (props.current.deformed) {
          const pts: number[] = [];
          for (const m of a.members) {
            const a3 = pOf(m.i, false);
            const b3 = pOf(m.j, false);
            pts.push(a3.x, a3.y, a3.z, b3.x, b3.y, b3.z);
          }
          const geo = new THREE.BufferGeometry();
          geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
          root.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: steel, transparent: true, opacity: 0.28 })));
        }
        const byId = new Map(a.memberResults.map((m) => [m.id, m.ratio]));
        for (const m of a.members) {
          const sec = sectionById(m.sectionId);
          const pi = pOf(m.i, props.current.deformed);
          const pj = pOf(m.j, props.current.deformed);
          const axis = pj.clone().sub(pi);
          const len = Math.max(axis.length(), 0.05);
          const group = new THREE.Group();
          const mat = new THREE.MeshStandardMaterial({
            color: colorOf(byId.get(m.id) ?? 0.4),
            metalness: 0.62,
            roughness: 0.38,
            emissive: ink,
          });
          group.userData.mat = mat;
          if (sec.kind === "pipe") {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(sec.h / 2, sec.h / 2, len, 14), mat);
            mesh.rotation.z = Math.PI / 2;
            mesh.userData.memberId = m.id;
            group.add(mesh);
          } else if (sec.kind === "box") {
            const t = Math.max(sec.tf, 0.008);
            const outer = sec.h;
            const plates: Array<[number, number, number, number, number, number]> = [
              [len, outer, t, 0, 0, outer / 2 - t / 2],
              [len, outer, t, 0, 0, -(outer / 2 - t / 2)],
              [len, t, outer - 2 * t, 0, outer / 2 - t / 2, 0],
              [len, t, outer - 2 * t, 0, -(outer / 2 - t / 2), 0],
            ];
            for (const [w, h, d, x, y, z] of plates) {
              const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
              mesh.position.set(x, y, z);
              mesh.userData.memberId = m.id;
              group.add(mesh);
            }
          } else {
            const webH = Math.max(sec.h - 2 * sec.tf, sec.h * 0.45);
            const parts: Array<[number, number, number, number]> = [
              [sec.tw, webH, 0, 0],
              [sec.b, sec.tf, 0, sec.h / 2 - sec.tf / 2],
              [sec.b, sec.tf, 0, -(sec.h / 2 - sec.tf / 2)],
            ];
            for (const [bw, bh, , z] of parts) {
              const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, Math.max(bw, 0.01), Math.max(bh, 0.008)), mat);
              mesh.position.z = z;
              mesh.userData.memberId = m.id;
              group.add(mesh);
            }
          }
          const mid = pi.clone().add(pj).multiplyScalar(0.5);
          const xDir = axis.clone().normalize();
          const up = Math.abs(xDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const yDir = new THREE.Vector3().crossVectors(up, xDir).normalize();
          const zDir = new THREE.Vector3().crossVectors(xDir, yDir).normalize();
          group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xDir, yDir, zDir));
          group.position.copy(mid);
          group.userData.memberId = m.id;
          root.add(group);
        }
        if (props.current.slabs && !props.current.deformed) {
          const slabMat = new THREE.MeshStandardMaterial({
            color: steel,
            transparent: true,
            opacity: 0.14,
            roughness: 0.9,
            metalness: 0,
            side: THREE.DoubleSide,
          });
          for (let k = 1; k <= a.input.stories; k++) {
            const w = a.input.nx * a.input.bayX;
            const d = a.input.ny * a.input.bayY;
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), slabMat);
            const z0 = k * a.input.storyH;
            let uz = 0;
            if (props.current.deformed && disp) {
              const tops = a.nodes.filter((n) => n.story === k);
              uz = (tops.reduce((s, n) => s + disp[n.id * 6 + 2], 0) / tops.length) * amp;
            }
            mesh.position.set(w / 2, z0 + uz, d / 2);
            root.add(mesh);
          }
        }
        for (const n of a.nodes) {
          if (!n.base) continue;
          const foot = new THREE.Mesh(
            new THREE.BoxGeometry(0.55, 0.18, 0.55),
            new THREE.MeshStandardMaterial({ color: 0x3d4d5e, roughness: 0.85 }),
          );
          foot.position.set(n.x, 0.09, n.y);
          root.add(foot);
        }
        const modelKey = `${a.nodes.length}|${a.members.length}|${a.input.nx}|${a.input.ny}|${a.input.stories}|${a.input.bayX}|${a.input.bayY}|${a.input.storyH}|${a.input.system}`;
        if (fitted.key !== modelKey) {
          fit();
          fitted.key = modelKey;
        }
        apiLocal.update();
      },
      update() {
        const sel = props.current.selected;
        const copper = new THREE.Color(cssColor("--color-copper", "#e3a04a"));
        root.traverse((obj) => {
          const mat = obj.userData.mat as THREE.MeshStandardMaterial | undefined;
          if (!mat) return;
          const on = obj.userData.memberId === sel && sel !== null;
          mat.emissive.copy(on ? copper : new THREE.Color(0x000000));
          mat.emissiveIntensity = on ? 0.55 : 0;
        });
      },
    };
    api.current = apiLocal;
    apiLocal.rebuild();

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.rebuild();
  }, [analysis, combo, deformed, scale, slabs]);

  useEffect(() => {
    api.current?.update();
  }, [selected]);

  return <div ref={host} className="h-full w-full" />;
}
