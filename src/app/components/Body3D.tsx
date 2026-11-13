/**
 * Просмотр 3D-фотометрического тела (three.js). Модуль грузится лениво — three.js нужен
 * только на вкладке «3D-тело» и в 3D-предпросмотре операций.
 *
 * Фотометрические оси (X — C0, Y — C90, Z — вверх) переводятся в оси three.js (Y — вверх):
 * (x, y, z) → (x, z, −y). Это поворот, ориентация (правая тройка) сохраняется.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildBody, meshCStep, meshLines, planeCurve, type CameraLink, type HousingBox, type View3D } from '../../charts/body3d';
import type { Photometry } from '../../core/index';

const DIST = 3.6;
/** Радиус сферы, которая должна целиком помещаться в кадр (оси и подписи — до 1,26). */
const FIT_R = 1.42;
const FOV = 32;

/** Расстояние камеры, при котором сфера FIT_R помещается и по высоте, и по ширине. */
function fitDistance(aspect: number): number {
  const v = (FOV * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
  return FIT_R / Math.sin(Math.min(v, h) / 2);
}
/** Положение камеры для вида, в фотометрических осях (потом → three). */
const VIEW_POS: Record<View3D, [number, number, number]> = {
  iso: [1.75, -2.6, 1.15], // с C≈−56°, чуть сверху: C0 справа, C90 — вглубь
  front: [0, -DIST, 0], // на плоскость C0–C180, C0 справа (как полярная КСС)
  side: [DIST, 0, 0], // на плоскость C90–C270, C90 справа
  below: [0, -0.001, -DIST],
  above: [0, -0.001, DIST],
};

const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

interface Props {
  /** Фотометрия типа C (summary.asC). */
  photometry: Photometry;
  /** Сила света, равная радиусу 1 (общий масштаб). По умолчанию — максимум тела. */
  scale?: number;
  /** Плоскости C, которые обводятся линиями (C и C + 180°). */
  planes: number[];
  /** Корпус светильника в масштабе тела (null — не показывать). */
  housing?: HousingBox | null;
  view?: View3D;
  /** Счётчик: при изменении камера возвращается в вид view. */
  viewNonce?: number;
  link?: CameraLink;
  height: number;
}

export default function Body3D({ photometry, scale, planes, housing = null, view = 'iso', viewNonce = 0, link, height }: Props) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const nadirEl = useRef<HTMLDivElement | null>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    labels: CSS2DRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    body: THREE.Group;
    render: () => void;
  } | null>(null);

  // сцена, камера, оси — один раз
  useEffect(() => {
    const el = host.current!;
    const css = getComputedStyle(document.documentElement);
    const ink = new THREE.Color(css.getPropertyValue('--ink3').trim() || '#888');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    el.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer();
    labels.domElement.className = 'b3d-labels';
    el.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 3, 4);
    camera.add(sun); // свет «из-за плеча» — тело одинаково освещено при любом повороте
    scene.add(camera);

    // оси: горизонтальное кольцо γ = 90°, лучи C0 / C90 / C180 / C270, вертикаль надир — зенит
    const axes = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.55 });
    const dashMat = new THREE.LineDashedMaterial({ color: ink, dashSize: 0.04, gapSize: 0.04, transparent: true, opacity: 0.55 });
    const R = 1.12;
    const ring: THREE.Vector3[] = [];
    for (let k = 0; k <= 96; k++) ring.push(toThree(R * Math.cos((k / 96) * 2 * Math.PI), R * Math.sin((k / 96) * 2 * Math.PI), 0));
    const ringLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), dashMat);
    ringLine.computeLineDistances();
    axes.add(ringLine);
    const add2 = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), mat);
      l.computeLineDistances();
      axes.add(l);
    };
    for (const c of [0, 90, 180, 270]) {
      const r = (c * Math.PI) / 180;
      add2(toThree(0, 0, 0), toThree(R * Math.cos(r), R * Math.sin(r), 0), c === 0 || c === 90 ? lineMat : dashMat);
    }
    add2(toThree(0, 0, -R), toThree(0, 0, R), dashMat);
    const label = (text: string, p: THREE.Vector3, cls = '') => {
      const d = document.createElement('div');
      d.className = `b3d-label ${cls}`;
      d.textContent = text;
      const o = new CSS2DObject(d);
      o.position.copy(p);
      axes.add(o);
      axisLabels.push({ el: d, dir: p.clone().normalize() });
      return d;
    };
    const axisLabels: Array<{ el: HTMLDivElement; dir: THREE.Vector3 }> = [];
    const L = 1.26;
    label('C0 · X', toThree(L, 0, 0), 'strong');
    label('C90 · Y', toThree(0, L, 0), 'strong');
    label('C180', toThree(-L, 0, 0));
    label('C270', toThree(0, -L, 0));
    nadirEl.current = label(`γ 0° · ${t('b3d.nadir')}`, toThree(0, 0, -L));
    label(`γ 180° · Z`, toThree(0, 0, L));
    scene.add(axes);

    const body = new THREE.Group();
    scene.add(body);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 20;
    const view = new THREE.Vector3();
    const render = () => {
      // подпись оси, направленной почти на зрителя, легла бы в центр поверх других — прячем
      view.copy(camera.position).normalize();
      for (const a of axisLabels) a.el.style.opacity = Math.abs(a.dir.dot(view)) > 0.94 ? '0' : '';
      renderer.render(scene, camera);
      labels.render(scene, camera);
    };
    const onChange = () => {
      render();
      if (link && !applying) for (const f of link.subs) f(camera.position.toArray(), controls.target.toArray(), me);
    };
    let applying = false;
    const me = {};
    const sub = (pos: number[], target: number[], from: unknown) => {
      if (from === me) return;
      applying = true;
      camera.position.fromArray(pos);
      controls.target.fromArray(target);
      controls.update();
      applying = false;
      render();
    };
    link?.subs.add(sub);
    controls.addEventListener('change', onChange);

    const resize = () => {
      const w = el.clientWidth || 300;
      const h = el.clientHeight || 300;
      renderer.setSize(w, h);
      labels.setSize(w, h);
      const prevFit = fitDistance(camera.aspect);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // сохраняем приближение пользователя относительно «вписанного» расстояния
      if (camera.position.lengthSq() > 0) {
        const k = camera.position.length() / prevFit || 1;
        camera.position.setLength(fitDistance(camera.aspect) * k);
        controls.update();
      }
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    ctx.current = { renderer, labels, scene, camera, controls, body, render };
    resize();
    return () => {
      ro.disconnect();
      link?.subs.delete(sub);
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
      el.innerHTML = '';
      ctx.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link]);

  // язык подписей
  useEffect(() => {
    if (nadirEl.current) nadirEl.current.textContent = `γ 0° · ${t('b3d.nadir')}`;
  }, [t]);

  // вид камеры
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const [x, y, z] = VIEW_POS[view];
    c.camera.position.copy(toThree(x, y, z).setLength(fitDistance(c.camera.aspect)));
    c.controls.target.set(0, 0, 0);
    c.controls.update(); // вызывает 'change' → отрисовка и синхронизация
  }, [view, viewNonce, link]);

  // тело
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    for (const o of [...c.body.children]) {
      c.body.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material).dispose();
    }
    const mesh = buildBody(photometry, { scale });
    const pos = new Float32Array(mesh.positions.length);
    for (let k = 0; k < mesh.positions.length / 3; k++) {
      pos[k * 3] = mesh.positions[k * 3];
      pos[k * 3 + 1] = mesh.positions[k * 3 + 2];
      pos[k * 3 + 2] = -mesh.positions[k * 3 + 1];
    }
    const css = getComputedStyle(document.documentElement);
    const dark = (css.getPropertyValue('color-scheme') || '').includes('dark') || document.documentElement.dataset.theme === 'dark';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();
    // тело — светлая полупрозрачная поверхность и сетка по C и γ, без условных цветов
    const surf = new THREE.Mesh(
      geo,
      new THREE.MeshLambertMaterial({
        color: dark ? 0x8a8a8a : 0xf2f2f2,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    c.body.add(surf);
    const s0 = scale && scale > 0 ? scale : mesh.peak || 1;
    const lines = meshLines(photometry, s0, meshCStep(photometry), 10);
    const lp = new Float32Array(lines.length);
    for (let k = 0; k < lines.length / 3; k++) {
      lp[k * 3] = lines[k * 3];
      lp[k * 3 + 1] = lines[k * 3 + 2];
      lp[k * 3 + 2] = -lines[k * 3 + 1];
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    c.body.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: dark ? 0xd0d0d0 : 0x3a3a3a, transparent: true, opacity: dark ? 0.6 : 0.5 })));

    // корпус светильника: нижняя грань — на уровне светящей части (центр тела), корпус — вверх
    if (housing) {
      const h = housing;
      const edge = dark ? 0xeeeeee : 0x222222;
      const boxGeo =
        h.shape === 'circle'
          ? new THREE.CylinderGeometry(h.length / 2, h.length / 2, h.height, 48)
          : new THREE.BoxGeometry(h.length, h.height, h.width);
      const box = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: dark ? 0x5a5a5a : 0xb8b8b8 }));
      box.position.set(0, h.height / 2, 0);
      c.body.add(box);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeo, 30), new THREE.LineBasicMaterial({ color: edge }));
      edges.position.copy(box.position);
      c.body.add(edges);
      if (h.luminous) {
        const lgeo =
          h.luminous.shape === 'circle'
            ? new THREE.CircleGeometry(h.luminous.length / 2, 48)
            : new THREE.PlaneGeometry(h.luminous.length, h.luminous.width);
        const lum = new THREE.Mesh(lgeo, new THREE.MeshBasicMaterial({ color: 0xfff6c8, side: THREE.DoubleSide }));
        lum.rotation.x = Math.PI / 2;
        lum.position.y = -0.0015;
        c.body.add(lum);
        const le = new THREE.LineSegments(new THREE.EdgesGeometry(lgeo), new THREE.LineBasicMaterial({ color: edge }));
        le.rotation.x = Math.PI / 2;
        le.position.y = -0.002;
        c.body.add(le);
      }
    }
    // обводка плоскостей: первая — сплошная, остальные — пунктиром (как на полярной КСС)
    const s = s0;
    planes.forEach((pc, i) => {
      const pts = planeCurve(photometry, pc, s * 0.995);
      const v: THREE.Vector3[] = [];
      for (let k = 0; k < pts.length; k += 3) v.push(toThree(pts[k], pts[k + 1], pts[k + 2]));
      const mat =
        i === 0
          ? new THREE.LineBasicMaterial({ color: 0x111111 })
          : new THREE.LineDashedMaterial({ color: 0x111111, dashSize: 0.035, gapSize: 0.025 });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), mat);
      line.computeLineDistances();
      c.body.add(line);
    });
    c.render();
  }, [photometry, scale, planes, housing]);

  return <div ref={host} className="b3d" style={{ height }} />;
}
